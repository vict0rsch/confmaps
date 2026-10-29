"""Deterministic evidence checks on past editions (DESIGN.md §3).

An edition has one ``source_url`` and one ``quote`` for all its fields. Each field is checked
against them with the satellite primitives (:func:`discover.verify.check_field`: download,
quote on page, value / date in quote, link on page or same site) and these rules:

- ``title``, ``full_name``, ``city``, ``venue``, ``country``: value in quote. A title must
  belong to the series (``series_of``); a title not in the quote that the series already uses
  is :data:`KNOWN_TITLE`, not a model judgement.
- ``start``, ``end``: date in quote; a quote that states no year at all (:data:`STATED_YEAR`)
  counts when the date falls in the edition's year. Then ``start <= end``; at most
  :data:`MAX_DAYS` days; the edition is over; ``start`` falls in the edition's year or the
  next one (flagged in the PR).
- ``link``: linked from the source page or on the same site.
- ``format`` virtual / hybrid: a quote of 20+ characters on the page that plainly says so and
  states no conflicting format (:data:`~discover.verify.FORMAT_IN_QUOTE`; see
  :func:`format_problem`); a quote that does not ("will not be hybrid", "may move online")
  makes it a model judgement with the problem shown. ``in_person``: derived for an edition held
  before :data:`COVID_START` (:data:`~discover.verify.PRE2020_DEFAULT`), otherwise a model
  judgement; with no format at all, ``past_merge`` writes an ``# UNVERIFIED default`` and the PR
  is a draft.
- ``cancelled``: a judgement quote; never applied (listed for human removal).
- ``country``: a model judgement becomes :data:`~discover.verify.DERIVED` when the city is
  verified (value in quote) and geocodes in that country. With a city that is a model
  judgement, the city is still geocoded, but the country stays a model judgement.
- A quote read from dblp's data (``Page.segments``) must fit inside one proceedings title
  that states the edition's year and no other (:func:`edition_pages`).

A failed check flags the field for a human instead of dropping it: the value is kept as a
model judgement, with the failure in its detail. A quote not found on its source page, or a
source page that cannot be read, also adds :data:`UNCONFIRMED_QUOTE_FLAG` to the edition. Only
a malformed field (:data:`DROPPED_REASONS`) is dropped.

Required after the checks: start, end, link, and city + country unless virtual. A virtual
edition drops any city, country and venue; a pinned city must geocode in its country.
"""

import re
from collections.abc import Callable
from dataclasses import dataclass, field, replace
from datetime import date
from typing import Any

from .dblp import edition_year_is
from .past_agent import PAST_FIELD_SCHEMAS
from .past_ids import series_of
from .verify import (
    DATE_IN_QUOTE,
    DERIVED,
    FORMAT_IN_QUOTE,
    JUDGEMENT,
    PRE2020_DEFAULT,
    VALUE_IN_QUOTE,
    Checked,
    FieldCheck,
    Geocode,
    Page,
    check_field,
    date_in_quote,
    normalize,
)

MAX_DAYS = 21
COVID_START = "2020-03-01"
# `link` is a required key of an edition, not one of the optional fields, but it is checked
# like them and needs a value schema too.
CHECK_SCHEMAS: dict[str, dict[str, Any]] = {
    **PAST_FIELD_SCHEMAS,
    "link": {"type": "string", "format": "uri"},
}
# Failures that drop the field: the value or its evidence is unusable. Any other failed check
# keeps the value as a model judgement.
DROPPED_REASONS = {"malformed evidence", "invalid value", "unsafe or malformed source URL"}
UNCONFIRMED_REASONS = {"quote not found on source page", "source page not readable"}
UNCONFIRMED_QUOTE_FLAG = "quote not confirmed on its source page: check the source"
# A title the series already uses (its latest title or a recorded edition's): proceedings
# titles often give only the long name, and such a title needs no human check.
KNOWN_TITLE = "a title the series already uses"
# A year stated in a quote: four digits, or an abbreviated year ('18).
STATED_YEAR = re.compile(r"(?<!\d)\d{4}(?!\d)|['’]\d{2}\b")
PAST_RULES: dict[str, str] = {
    "title": "string",
    "full_name": "string",
    "link": "link",
    "city": "string",
    "country": "string",
    "venue": "string",
    "start": "date",
    "end": "date",
    "format": "judgement",
    "cancelled": "judgement",
}
PLACE_FIELDS = ("city", "country", "venue")
_NTH = (
    r"first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|"
    r"thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth"
)
# A leading edition number ("5th", "The Twelfth", "Thirty-First Annual"): recorded full names
# carry none, so a page stating one must neither change nor be suggested for an entry.
ORDINAL_RE = re.compile(
    rf"^(?:the\s+)?(?:\d+(?:st|nd|rd|th)|{_NTH}|(?:twent|thirt|fort|fift)ieth|"
    rf"(?:twenty|thirty|forty|fifty)[- ](?:{_NTH}))\s+(?:annual\s+)?",
    re.IGNORECASE,
)


def strip_ordinal(name: str) -> str:
    """``name`` without a leading edition number.

    Examples
    --------
    .. code-block:: python

        strip_ordinal("The Twelfth International Conference on Learning Representations")
        # "International Conference on Learning Representations"
    """
    stripped = ORDINAL_RE.sub("", name, count=1)
    return stripped[:1].upper() + stripped[1:] if stripped else name


FORMAT_HEDGED = "quote negates or hedges the format"
# A format is asserted by a clause that names it with no negation or hedge in that clause.
_CLAUSE_BREAK = re.compile(r"[.;:!?,()\[\]]|\s-\s|\b(?:but|however|whereas|although|though)\b")
_MENTIONS = {
    "hybrid": re.compile(r"\bhybrid\b"),
    "virtual": re.compile(r"\b(?:virtual(?:ly)?|online)\b"),
    "in_person": re.compile(r"\bin-? ?person\b"),
}
_EXCLUSIVE = {
    "virtual": re.compile(
        r"\b(?:fully|only|purely|entirely|exclusively|completely|all)[- ](?:virtual(?:ly)?|online)\b"
        r"|\b(?:virtual|online)[- ]only\b"
    ),
    "in_person": re.compile(
        r"\b(?:fully|only|purely|entirely|exclusively)[- ]in-? ?person\b|\bin-? ?person[- ]only\b"
    ),
}
_NEGATION = re.compile(
    r"\b(?:not|no|never|nor|none|cannot|without|instead|rather than|unable|impossible"
    r"|cancel(?:l?ed|lation|s)?|called off|no longer)\b|n't\b"
)
_HEDGE = re.compile(
    r"\b(?:might|could|if|unless|whether|possibl[ey]|tentative(?:ly)?|plan(?:s|ned|ning)?|hope"
    r"|expect(?:s|ed)?|subject to|depending|tbd|tba"
    r"|to be (?:confirmed|decided|determined|announced))\b"
    r"|(?<!\d )\bmay\b(?! \d)"  # not the month ("May 12", "12 May")
)


@dataclass
class CheckedEdition(Checked):
    """A past edition after verification (``parent`` is the series key)."""

    year: int = 0
    cancelled: bool = False  # a kept `cancelled: true` (model judgement, quote shown)
    flags: list[str] = field(default_factory=list)  # static notes for the PR

    @property
    def label(self) -> str:
        if self.fields.get("format") == "virtual":
            place = "online"
        else:
            place = next((c.value for c in self.checks if c.field == "city"), None) or "(no city)"
        return f"{self.parent} {self.year} — {place}"


def _format_claims(quote: str) -> tuple[set[str], set[str]]:
    """``(asserted, hedged)``: formats (and ``only:<format>``) the quote's clauses state plainly,
    and formats only named in a clause with a negation or a hedge."""
    asserted: set[str] = set()
    hedged: set[str] = set()
    for clause in _CLAUSE_BREAK.split(normalize(quote)):
        found = {f for f, rx in _MENTIONS.items() if rx.search(clause)}
        if _NEGATION.search(clause) or _HEDGE.search(clause):
            hedged |= found
        else:
            asserted |= found | {f"only:{f}" for f, rx in _EXCLUSIVE.items() if rx.search(clause)}
    if {"in_person", "virtual"} <= asserted:
        asserted.add("hybrid")
    return asserted, hedged


def format_problem(value: str, quote: str) -> str:
    """Why a quote does not state a virtual / hybrid format, or ``""`` (also for in person).

    The claimed format must be stated in a clause without negation or hedge ("not", "no",
    "won't", "instead of", "cancelled", "may", "if", ...) and no other clause may state a
    conflicting format. :data:`FORMAT_HEDGED` when the quote names the claimed format only in a
    negated or hedged clause.

    Examples
    --------
    .. code-block:: python

        format_problem("virtual", "The conference was held virtually this year")  # ""
        format_problem("virtual", "Hybrid: in person in Vienna and online")  # "quote says …"
        format_problem("hybrid", "MIDL will not be hybrid")  # FORMAT_HEDGED
    """
    asserted, hedged = _format_claims(quote)
    if value == "virtual":
        if asserted & {"hybrid", "in_person"}:
            return "quote says hybrid or in person, not virtual"
        if "virtual" in asserted:
            return ""
        return FORMAT_HEDGED if "virtual" in hedged else "quote does not say virtual or online"
    if value == "hybrid":
        if asserted & {"only:virtual", "only:in_person"}:
            return "quote says fully virtual or in person only, not hybrid"
        if "hybrid" in asserted:
            return ""
        named = asserted | hedged
        if "hybrid" in hedged or {"in_person", "virtual"} <= named:
            return FORMAT_HEDGED
        return "quote does not say hybrid"
    return ""


def _target_years(batch: dict[str, Any]) -> set[int]:
    return {int(y) for y in batch["years"]}


def edition_pages(get_page: Callable[[str], Page], year: int) -> Callable[[str], Page]:
    """``get_page`` that keeps only the dblp titles that state the edition's ``year`` and no
    other (:func:`~discover.dblp.edition_year_is`), so a dblp quote must come from a title of
    that edition.

    Examples
    --------
    .. code-block:: python

        get = edition_pages(fetcher.get, 2018)
    """

    def get(url: str) -> Page:
        page = get_page(url)
        if page.segments is None:
            return page
        kept = tuple(s for s in page.segments if edition_year_is(s[0], s[1], year))
        return replace(page, segments=kept)

    return get


def check_edition(
    raw: dict[str, Any],
    batch: dict[str, Any],
    get_page: Callable[[str], Page],
    geocode: Geocode,
    today: date,
) -> CheckedEdition:
    """Verify every field of one raw edition, then apply edition-level rules.

    Parameters
    ----------
    raw : dict
        One element of the model's ``editions`` list: plain field values, with one
        ``source_url`` and one ``quote`` for all of them.
    batch : dict
        The researched batch (``series``, ``years``); the edition's year must be a target.
    get_page : callable
        ``url -> Page``, normally a :class:`~discover.verify.LimitedPages`.
    geocode : callable
        ``(city, country) -> GeoHit | None``.
    today : date
        Reference date: the edition must be over.

    Returns
    -------
    CheckedEdition
        Per-field outcomes, kept fields, flags, and a drop reason if unusable.

    Examples
    --------
    .. code-block:: python

        e = check_edition(raw, batch, LimitedPages(fetcher.get, 40), Geocoder(cache), today)
        if not e.dropped:
            print(e.fields["start"], e.kinds["format"])
    """
    series = str(batch["series"])
    year = raw.get("year")
    out = CheckedEdition(
        parent=series,
        rationale=str(raw.get("rationale", "")),
        year=year if isinstance(year, int) and not isinstance(year, bool) else 0,
    )
    pages = edition_pages(get_page, out.year)
    known_titles = {batch.get("title")} | {k.get("title") for k in batch.get("known") or []}
    for name, rule in PAST_RULES.items():
        if name not in raw:
            continue
        ev = {"value": raw[name], "source_url": raw["source_url"], "quote": raw["quote"]}
        check = check_field(name, ev, pages, rule, CHECK_SCHEMAS)
        # A quote that states no year at all ("Sun Dec 8th through Sat the 14th") still dates an
        # edition of that year; a quote that states another year never does.
        if (
            check.reason == "date not in quote"
            and not STATED_YEAR.search(check.quote)
            and int(check.value[:4]) == out.year
            and date_in_quote(check.value, f"{check.quote} {out.year}")
        ):
            check.kind, check.reason = DATE_IN_QUOTE, ""
        if check.reason in UNCONFIRMED_REASONS and UNCONFIRMED_QUOTE_FLAG not in out.flags:
            out.flags.append(UNCONFIRMED_QUOTE_FLAG)
        if check.reason and check.reason not in DROPPED_REASONS:
            # Kept for a human to check; the reason stays, so the failure is still known.
            check.kind = JUDGEMENT
            check.detail = f"{check.reason}: {check.detail}" if check.detail else check.reason
        if check.kept and name == "title" and series_of(check.value) != series:
            check.kind, check.reason = "", "title is not of this series"
            check.detail = f"{series_of(check.value)} ≠ {series}"
        elif check.kind == JUDGEMENT and name == "title" and check.value in known_titles:
            check.kind, check.reason, check.detail = KNOWN_TITLE, "", ""
        if check.kept and name == "format" and not check.reason:
            problem = format_problem(check.value, check.quote)
            if problem:
                # Never verified, so never applied by --recheck.
                check.kind, check.detail = JUDGEMENT, problem
            elif check.value != "in_person":
                check.kind = FORMAT_IN_QUOTE
        out.checks.append(check)
        if check.kept:
            out.fields[name] = check.value
            out.kinds[name] = check.kind
            out.sources[name] = check.source_url

    if "full_name" in out.fields:
        out.fields["full_name"] = strip_ordinal(out.fields["full_name"])

    def drop(reason: str, detail: str = "") -> CheckedEdition:
        out.dropped, out.dropped_detail = reason, detail
        return out

    if out.year not in _target_years(batch):
        return drop("year is not a target year of this request", str(raw.get("year")))
    out.cancelled = out.fields.pop("cancelled", False) is True
    # Not a field of the entry: drop its kind and source too, or the report looks it up.
    out.kinds.pop("cancelled", None)
    out.sources.pop("cancelled", None)
    if out.cancelled:
        return out  # never applied: listed for human removal, nothing else is needed

    fmt = out.fields.get("format")
    if fmt == "virtual":
        # A virtual edition has no place; any city the model gave is not kept.
        for check in out.checks:
            if check.field in PLACE_FIELDS and check.kept:
                check.kind, check.reason = "", "not kept: virtual edition"
                for d in (out.fields, out.kinds, out.sources):
                    d.pop(check.field, None)
    elif "city" in out.fields and "country" in out.fields:
        out.geo = geocode(out.fields["city"], out.fields["country"])
        # A verified city that the geocoder finds in that country confirms the country. A city
        # that is only the model's judgement confirms nothing, so its country stays one too.
        if (
            out.geo is not None
            and out.kinds["country"] == JUDGEMENT
            and out.kinds.get("city") == VALUE_IN_QUOTE
        ):
            country = next(c for c in out.checks if c.field == "country")
            country.kind, country.reason, country.detail = DERIVED, "", ""
            out.kinds["country"] = DERIVED

    required = ["start", "end", "link"] + ([] if fmt == "virtual" else ["city", "country"])
    if missing := [f for f in required if f not in out.fields]:
        return drop("missing verified required field(s)", ", ".join(missing))

    start, end = out.fields["start"], out.fields["end"]
    if start > end:
        return drop("start is after end", f"{start} > {end}")
    days = (date.fromisoformat(end) - date.fromisoformat(start)).days + 1
    if days > MAX_DAYS:
        return drop(f"longer than {MAX_DAYS} days", f"{start}..{end}")
    if date.fromisoformat(end) >= today:
        return drop("edition not over yet", end)
    start_year = int(start[:4])
    if start_year not in (out.year, out.year + 1):
        return drop("start is not in the edition's year or the next", start)
    if start_year == out.year + 1:
        out.flags.append(f"starts in {start_year}, the year after its edition year {out.year}")

    # In person: derived before the pandemic, else the model's judgement (kept as is) or, with
    # no format at all, an UNVERIFIED default written by past_merge.
    if fmt in (None, "in_person") and start < COVID_START:
        kept = next((c for c in out.checks if c.field == "format" and c.kept), None)
        if kept is None:
            kept = FieldCheck("format", "in_person", "", "")
            out.checks.append(kept)
        kept.kind = PRE2020_DEFAULT
        out.fields["format"], out.kinds["format"] = "in_person", PRE2020_DEFAULT
    if fmt != "virtual" and out.geo is None:
        return drop("city not found by the geocoder in that country")
    return out


def check_edition_safely(
    raw: Any,
    batch: dict[str, Any],
    get_page: Callable[[str], Page],
    geocode: Geocode,
    today: date,
) -> CheckedEdition:
    """:func:`check_edition` that turns any unexpected error into a dropped edition."""
    try:
        if not isinstance(raw, dict):
            raise TypeError(f"edition is a {type(raw).__name__}, not an object")
        return check_edition(raw, batch, get_page, geocode, today)
    except Exception as e:  # noqa: BLE001 - one bad edition must not abort the run
        return CheckedEdition(
            parent=str(batch.get("series", "")),
            rationale="",
            dropped="internal error while checking the edition",
            dropped_detail=f"{type(e).__name__}: {e}",
        )
