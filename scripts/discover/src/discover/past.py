"""``--mode past``: targeting, batching, checks and merge for past main editions.

Targets (DESIGN.md §3): for each ``--series``, the years in
``[--since, --until]`` with no known edition (known = in ``data/build/data.json``, any
source, or in ``data/past_conferences.yml``) and not recorded as not held in
``data/series.yml``; with ``--recheck``, also the recorded ``source: pwc`` editions in that
range (the COVID pass). One API call per batch of at most
:data:`~discover.past_agent.MAX_YEARS_PER_CALL` target years of one series, chronologically.
"""

import re
from collections.abc import Callable, Mapping
from dataclasses import replace
from datetime import date
from typing import Any
from urllib.parse import urlsplit

from .dblp import YEAR_RE, DblpTitles, edition_year_is
from .past_agent import MAX_YEARS_PER_CALL, dblp_listing
from .past_ids import series_of
from .past_merge import PastPlan, apply_past_plan, plan_past_changes, series_profiles
from .past_verify import CheckedEdition, check_edition_safely
from .report import ConferenceRun
from .verify import BOT_CHECK, LimitedPages, Page, canonical_url, normalize, unsafe_url_reason
from .wayback import NO_SNAPSHOT_FLAG, is_wayback

MAX_FETCHES_PER_BATCH = 40  # quote-verification downloads per request (up to six editions)
RECHECK_FIELDS = ["id", "title", "year", "link", "start", "end", "format", "city", "country",
                  "venue"]  # fmt: skip
# The Wayback Machine has no captures before this date: older editions keep their link.
WAYBACK_START = "1996-06-01"
# Stable proceedings pages are accepted links (DESIGN.md "Links of past editions").
PROCEEDINGS_HOSTS = {
    "dblp.org", "aclanthology.org", "proceedings.mlr.press", "papers.nips.cc",
    "proceedings.neurips.cc", "ojs.aaai.org", "aaai.org", "www.aaai.org", "ijcai.org",
    "www.ijcai.org", "openaccess.thecvf.com", "dl.acm.org", "ieeexplore.ieee.org",
    "link.springer.com",
}  # fmt: skip
# A "not held" year needs a source listing the years around it, and recorded editions around
# it, within this many years on each side.
NOT_HELD_WINDOW = 5


def _iso(value: Any) -> Any:
    return value.isoformat() if isinstance(value, date) else value


def known_editions(
    data: dict[str, Any], past: list[dict[str, Any]], series: str
) -> list[dict[str, Any]]:
    """Every recorded edition of a series, as given to the model (avoid duplicates, naming).

    Examples
    --------
    .. code-block:: python

        known_editions(data, past, "neurips")[0]  # {"year": 2016, "id": "nips16", ...}
    """
    mains = {loc["conferenceId"]: loc for loc in data["locations"] if loc["role"] == "main"}
    rows = []
    for c in data["conferences"]:
        if c["series"] != series:
            continue
        loc = mains.get(c["id"], {})
        rows.append(
            {
                "year": c["year"],
                "id": c["id"],
                "title": c["title"],
                "city": loc.get("city"),
                "country": loc.get("country"),
                "format": loc.get("format", "in_person"),
                "start": c["start"],
                "end": c["end"],
                "link": c["link"],
            }
        )
    listed = {r["id"] for r in rows}
    for e in past:
        if series_of(e["title"]) == series and e["id"] not in listed:
            rows.append({k: _iso(e.get(k)) for k in RECHECK_FIELDS if k != "venue"})
    rows = [{k: v for k, v in r.items() if v is not None} for r in rows]
    return sorted(rows, key=lambda r: (r["year"], r["id"]))


def plan_batches(
    data: dict[str, Any],
    past: list[dict[str, Any]],
    series_list: list[str],
    since: int | Mapping[str, int],
    until: int,
    recheck: bool = False,
    dblp: DblpTitles | None = None,
    not_held: Mapping[str, set[int]] | None = None,
) -> tuple[list[dict[str, Any]], list[str]]:
    """Batches of target years to research, and the series that have no recorded edition.

    Parameters
    ----------
    data : dict
        Parsed ``data/build/data.json``.
    past : list of dict
        ``data/past_conferences.yml`` entries.
    series_list : list of str
        Series keys (``seriesOf(title)``), in the order given on the command line.
    since, until : int
        Inclusive year range. ``since`` may instead map each series key to its own first year.
    recheck : bool, optional
        Also target recorded ``source: pwc`` editions in the range.
    dblp : DblpTitles, optional
        Lists each batch's dblp proceedings titles of its target years in the prompt.
    not_held : mapping of str to set of int, optional
        Per series key, the years recorded as not held in ``data/series.yml``: never targets.

    Returns
    -------
    tuple of (list of dict, list of str)
        Batches (prompt-ready: ``id``, ``series``, ``title``, ``full_name``, ``year`` label,
        ``years``, ``known``, ``recheck``, ``dblp``) and unknown series.

    Examples
    --------
    .. code-block:: python

        batches, unknown = plan_batches(data, past, ["neurips"], 1987, 2015)
        [b["years"] for b in batches]  # [[1987, ..., 1992], [1993, ...], ...]
    """
    profiles = series_profiles(data, past)
    batches, unknown = [], []
    for series in series_list:
        if series not in profiles:
            unknown.append(series)
            continue
        first = since[series] if isinstance(since, Mapping) else since
        known = known_editions(data, past, series)
        known_years = {k["year"] for k in known}
        to_check = {
            e["year"]: {k: _iso(e[k]) for k in RECHECK_FIELDS if k in e}
            for e in past
            if recheck
            and e.get("source") == "pwc"
            and series_of(e["title"]) == series
            and first <= e["year"] <= until
        }
        missing = {y for y in range(first, until + 1) if y not in known_years}
        years = sorted((missing | set(to_check)) - (not_held or {}).get(series, set()))
        for i in range(0, len(years), MAX_YEARS_PER_CALL):
            chunk = years[i : i + MAX_YEARS_PER_CALL]
            volumes = dblp.editions(series, chunk) if dblp is not None else []
            span = f"{chunk[0]}" if len(chunk) == 1 else f"{chunk[0]}-{chunk[-1]}"
            batches.append(
                {
                    "id": f"{series}-{span}",
                    "series": series,
                    "title": profiles[series]["title"],
                    "full_name": profiles[series]["full_name"],
                    "year": span,
                    "years": chunk,
                    "known": known,
                    # JSON keys: the batch is saved with the API result (--from-results).
                    "recheck": {str(y): to_check[y] for y in chunk if y in to_check},
                    "dblp": dblp_listing(volumes),
                }
            )
    return batches, unknown


def archived_fallback(
    get_page: Callable[[str], Page], snapshot: Callable[[str, str], str | None]
) -> Callable[[str], Page]:
    """``get_page`` that reads the latest Wayback copy of a page it cannot read live (a bot
    check, a timeout), so a quote is verified on the archived text; the page records the copy.

    Examples
    --------
    .. code-block:: python

        get_page = archived_fallback(PageFetcher().get, Snapshots())
    """

    def get(url: str) -> Page:
        page = get_page(url)
        if page.text is not None or is_wayback(url):
            return page
        copy = snapshot(url, "")
        if not copy:
            return page
        archived = get_page(copy)
        return replace(archived, archived=copy) if archived.text is not None else page

    return get


def dblp_fallback(
    get_page: Callable[[str], Page], titles: Callable[[str], Page | None]
) -> Callable[[str], Page]:
    """``get_page`` that reads a dblp page behind its bot check through dblp's SPARQL data
    (:class:`~discover.dblp.DblpTitles`): the proceedings titles the page lists. The page URL
    stays the cited source; the page records where its text came from in ``via``.

    Examples
    --------
    .. code-block:: python

        get_page = dblp_fallback(PageFetcher().get, DblpTitles())
    """

    def get(url: str) -> Page:
        page = get_page(url)
        if page.text is not None or page.error != BOT_CHECK:
            return page
        return titles(url) or page

    return get


UNOPENED_NOTE = "the agent never opened this page: the quote may come from a search result"


def _note_unopened(run: ConferenceRun) -> None:
    """Explain a quote missing from a page the agent cited without opening it (dblp pages
    whose titles the prompt listed count as opened)."""
    assert run.research is not None
    opened = {
        canonical_url(call.removeprefix("web_fetch: ").strip())
        for call in run.research.tool_calls
        if call.startswith("web_fetch: ")
    } | {canonical_url(row["url"]) for row in run.conference.get("dblp") or []}
    for edition in run.checked:
        for check in edition.checks:
            failed = check.reason in ("quote not found on source page", "source page not readable")
            if failed and check.source_url and canonical_url(check.source_url) not in opened:
                check.detail = f"{check.detail}; {UNOPENED_NOTE}" if check.detail else UNOPENED_NOTE


def _around(year: int, years: set[int]) -> bool:
    """Whether ``years`` has one within :data:`NOT_HELD_WINDOW` years before ``year`` and one
    within that many years after it."""
    return any(year - NOT_HELD_WINDOW <= y < year for y in years) and any(
        year < y <= year + NOT_HELD_WINDOW for y in years
    )


def _names_edition(page: Page, year: int, titles: set[str]) -> bool:
    """Whether a page names an edition of the series held in ``year``.

    On a dblp page, a proceedings title of that edition (:func:`~discover.dblp.edition_year_is`).
    Elsewhere, one of the series ``titles`` next to the year: ``AAAI-89``, ``AAAI 1989``,
    ``AAAI'89`` or ``1989 AAAI``, case-insensitive. The bare year alone (a citation, prose) does
    not count.

    Examples
    --------
    .. code-block:: python

        _names_edition(Page(normalize("AAAI-88 Saint Paul. AAAI-89 Detroit.")), 1989, {"AAAI"})
        # True
    """
    if page.segments is not None:
        return any(edition_year_is(title, published, year) for title, published in page.segments)
    names = "|".join(re.escape(normalize(title)) for title in sorted(titles))
    pattern = (
        rf"(?<!\w)(?:{names})[ \-'’]?(?:{year}|{year % 100:02d})(?!\w)"
        rf"|(?<!\w){year}\s+(?:{names})(?!\w)"
    )
    return bool(names) and re.search(pattern, page.text or "", re.IGNORECASE) is not None


def _check_not_held(
    item: dict[str, Any],
    batch: dict[str, Any],
    pages: Callable[[str], Page],
    edition_years: dict[str, set[int]],
    series_entries: dict[str, Any],
) -> tuple[str, str]:
    """``(source, "")`` when a year the model reports as not held can be recorded, else
    ``("", why not)``.

    The year must be a target of ``batch`` with no edition of the series (``edition_years``);
    its source must be readable through ``pages``, name a year within :data:`NOT_HELD_WINDOW`
    years on each side (a list cut off before or after it proves nothing) and name no edition
    of the series that year (:func:`_names_edition`, with the batch's title and the titles of
    its known editions); the series must have editions on each side within that window, so a
    year before the earliest known edition is never recorded; and the series must have a
    ``data/series.yml`` entry. The source is the canonical URL, or the Wayback copy that was
    read.

    Examples
    --------
    .. code-block:: python

        source, why_not = _check_not_held(item, run.conference, pages, years, series_entries)
    """
    series, year, url = str(batch["series"]), item.get("year"), item.get("source_url")
    if year not in batch["years"]:
        return "", "not a target year"
    held = edition_years.get(series, set())
    if year in held:
        return "", "an edition exists"
    if not isinstance(url, str) or unsafe_url_reason(url):
        return "", "source not readable"
    page = pages(canonical_url(url))
    if page.text is None:
        return "", "source not readable"
    # A dblp page's text is its proceedings titles.
    texts = [title for title, _ in page.segments] if page.segments is not None else [page.text]
    if not _around(year, {int(y) for text in texts for y in YEAR_RE.findall(text)}):
        return "", "source does not list the years around it"
    titles = {t for t in (batch["title"], *(k.get("title") for k in batch["known"])) if t}
    if _names_edition(page, year, titles):
        return "", "source names an edition that year"
    if not _around(year, held):
        return "", "not between known editions"
    if series not in series_entries:
        return "", "no series.yml entry"
    return page.archived or canonical_url(url), ""


def check_and_plan(
    runs: list[ConferenceRun],
    data: dict[str, Any],
    past: list[dict[str, Any]],
    past_text: str,
    get_page: Any,
    geocoder: Any,
    today: date,
    series_entries: dict[str, Any],
    on_checked: Callable[[ConferenceRun], None] | None = None,
    snapshot: Callable[[str, str], str | None] | None = None,
    dblp: Callable[[str], Page | None] | None = None,
) -> tuple[PastPlan, str]:
    """Verify every returned edition, then plan and apply the changes to the file text.

    Once every edition is checked, each year the model reports as not held is recorded in
    ``plan.not_held`` (or listed in ``plan.not_held_skipped`` with the reason) by
    :func:`_check_not_held`, which counts the editions of ``data.json``, of the past file and
    kept in this run; ``series_entries`` is the parsed ``data/series.yml``.
    ``on_checked(run)`` is called once each request's editions are checked (progress display).
    ``snapshot(url, day)`` (a :class:`~discover.wayback.Snapshots`) replaces each new edition's
    live ``link`` with its Wayback copy closest to the edition's end; without one, the live link
    is written with a review comment and a flag. Editions that ended before
    :data:`WAYBACK_START` and links on :data:`PROCEEDINGS_HOSTS` keep their link. ``snapshot``
    also lets checks read the archived copy of a source page that cannot be read live
    (:func:`archived_fallback`). ``dblp(url)`` (a :class:`~discover.dblp.DblpTitles`) is tried
    first for a dblp page behind its bot check (:func:`dblp_fallback`).

    Examples
    --------
    .. code-block:: python

        plan, new_text = check_and_plan(
            runs, data, past, text, PageFetcher().get, geo, today, series_entries
        )
    """
    if dblp is not None:
        get_page = dblp_fallback(get_page, dblp)
    if snapshot is not None:
        get_page = archived_fallback(get_page, snapshot)
    checked: list[tuple[ConferenceRun, LimitedPages]] = []
    for run in runs:
        if run.research and run.research.status == "ok":
            pages = LimitedPages(get_page, MAX_FETCHES_PER_BATCH)
            run.checked = [
                check_edition_safely(raw, run.conference, pages, geocoder, today)
                for raw in run.research.candidates
            ]
            _note_unopened(run)
            if on_checked is not None:
                on_checked(run)
            checked.append((run, pages))
    editions = [c for run in runs for c in run.checked if isinstance(c, CheckedEdition)]
    plan = plan_past_changes(past, data, editions, series_profiles(data, past))

    # Years with an edition, per series: in data.json, in the past file or kept in this run (a
    # reported cancellation never becomes an edition).
    edition_years: dict[str, set[int]] = {}
    for series, year in [
        *((c["series"], c["year"]) for c in data["conferences"]),
        *((series_of(e["title"]), e["year"]) for e in past),
        *((c.parent, c.year) for c in editions if not c.dropped and not c.cancelled),
    ]:
        edition_years.setdefault(series, set()).add(year)
    for run, pages in checked:
        assert run.research is not None  # only runs with a usable result were checked
        series = str(run.conference["series"])
        for item in run.research.not_held:
            source, why_not = _check_not_held(
                item, run.conference, pages, edition_years, series_entries
            )
            if why_not:
                plan.not_held_skipped.append(({**item, "series": series}, why_not))
            else:
                reason = str(item.get("reason", ""))
                plan.not_held.append(
                    {"series": series, "year": item["year"], "source": source, "reason": reason}
                )

    for a in plan.additions:
        live = a.entry["link"]
        stable = a.entry["end"] < WAYBACK_START or urlsplit(live).hostname in PROCEEDINGS_HOSTS
        if snapshot is not None and not is_wayback(live) and not stable:
            # Past links are archived copies: old conference domains get hijacked.
            archived = snapshot(live, a.entry["end"])
            if archived:
                a.entry["link"] = archived
            else:
                a.candidate.flags.append(NO_SNAPSHOT_FLAG)
    return plan, apply_past_plan(past_text, plan)
