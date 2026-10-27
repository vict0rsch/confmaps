"""``--mode past``: targeting, batching, checks and merge for past main editions.

Targets (DESIGN.md §3): for each ``--series``, the years in
``[--since, --until]`` with no known edition (known = in ``data/build/data.json``, any
source, or in ``data/past_conferences.yml``); with ``--recheck``, also the recorded
``source: pwc`` editions in that range (the COVID pass). One API call per batch of at most
:data:`~discover.past_agent.MAX_YEARS_PER_CALL` target years of one series, chronologically.
"""

from collections.abc import Callable, Mapping
from dataclasses import replace
from datetime import date
from typing import Any

from .past_agent import MAX_YEARS_PER_CALL
from .past_ids import series_of
from .past_merge import PastPlan, apply_past_plan, plan_past_changes, series_profiles
from .past_verify import CheckedEdition, check_edition_safely
from .report import ConferenceRun
from .verify import LimitedPages, Page, canonical_url
from .wayback import NO_SNAPSHOT_FLAG, is_wayback

MAX_FETCHES_PER_BATCH = 40  # quote-verification downloads per request (up to six editions)
RECHECK_FIELDS = ["id", "title", "year", "link", "start", "end", "format", "city", "country",
                  "venue"]  # fmt: skip


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

    Returns
    -------
    tuple of (list of dict, list of str)
        Batches (prompt-ready: ``id``, ``series``, ``title``, ``full_name``, ``year`` label,
        ``years``, ``known``, ``recheck``) and unknown series.

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
        years = sorted({y for y in range(first, until + 1) if y not in known_years} | set(to_check))
        for i in range(0, len(years), MAX_YEARS_PER_CALL):
            chunk = years[i : i + MAX_YEARS_PER_CALL]
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


UNOPENED_NOTE = "the agent never opened this page: the quote may come from a search result"


def _note_unopened(run: ConferenceRun) -> None:
    """Explain a quote missing from a page the agent cited without opening it."""
    assert run.research is not None
    opened = {
        canonical_url(call.removeprefix("web_fetch: ").strip())
        for call in run.research.tool_calls
        if call.startswith("web_fetch: ")
    }
    for edition in run.checked:
        for check in edition.checks:
            failed = check.reason in ("quote not found on source page", "source page not readable")
            if failed and check.source_url and canonical_url(check.source_url) not in opened:
                check.detail = f"{check.detail}; {UNOPENED_NOTE}" if check.detail else UNOPENED_NOTE


def check_and_plan(
    runs: list[ConferenceRun],
    data: dict[str, Any],
    past: list[dict[str, Any]],
    past_text: str,
    get_page: Any,
    geocoder: Any,
    today: date,
    on_checked: Callable[[ConferenceRun], None] | None = None,
    snapshot: Callable[[str, str], str | None] | None = None,
) -> tuple[PastPlan, str]:
    """Verify every returned edition, then plan and apply the changes to the file text.

    ``on_checked(run)`` is called once each request's editions are checked (progress display).
    ``snapshot(url, day)`` (a :class:`~discover.wayback.Snapshots`) replaces each new edition's
    live ``link`` with its Wayback copy closest to the edition's end; without one, the live link
    is written with a review comment and a flag. It also lets checks read the archived copy of
    a source page that cannot be read live (:func:`archived_fallback`).

    Examples
    --------
    .. code-block:: python

        plan, new_text = check_and_plan(runs, data, past, text, PageFetcher().get, geo, today)
    """
    if snapshot is not None:
        get_page = archived_fallback(get_page, snapshot)
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
    editions = [c for run in runs for c in run.checked if isinstance(c, CheckedEdition)]
    plan = plan_past_changes(past, data, editions, series_profiles(data, past))
    for a in plan.additions:
        live = a.entry["link"]
        if snapshot is not None and not is_wayback(live):
            # Past links are archived copies: old conference domains get hijacked.
            archived = snapshot(live, a.entry["end"])
            if archived:
                a.entry["link"] = archived
            else:
                a.candidate.flags.append(NO_SNAPSHOT_FLAG)
    return plan, apply_past_plan(past_text, plan)
