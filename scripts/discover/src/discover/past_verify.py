"""Deterministic evidence checks on past editions (docs/backfill-spec.md §5.4).

Reuses the satellite primitives (:func:`discover.verify.check_field`: download, quote on page,
value / date in quote, link on page or same site, geocoding) with these rules:

- ``title``, ``full_name``, ``city``, ``venue``, ``country``: value in quote (country may be
  derived from the geocoded city). A title must belong to the series (``series_of``).
- ``start``, ``end``: date in quote; ``start <= end``; at most :data:`MAX_DAYS` days; the
  edition is over; ``start`` falls in the edition's year or the next one (flagged in the PR).
- ``link``: linked from the source page or on the same site.
- ``format`` virtual / hybrid: a quote of 20+ characters on the page that plainly says so and
  states no conflicting format (:data:`~discover.verify.FORMAT_IN_QUOTE`; see
  :func:`format_problem`). A quote that only negates or hedges the claimed format ("will not be
  hybrid", "may move online") keeps it as a model judgement, never verified. ``in_person``:
  derived for an edition held
  before :data:`COVID_START` in a verified city
  (:data:`~discover.verify.PRE2020_DEFAULT`), otherwise a model judgement; with neither,
  ``past_merge`` writes an ``# UNVERIFIED default`` and the PR is a draft.
- ``cancelled``: a judgement quote; never applied (listed for human removal).

Required after the checks: start, end, link, and city + country unless virtual. A virtual
edition drops any city, country and venue; a pinned city must geocode in its country.
"""

import re
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date
from typing import Any

from .past_agent import PAST_FIELD_SCHEMAS
from .past_ids import series_of
from .verify import (
    FORMAT_IN_QUOTE,
    PRE2020_DEFAULT,
    VALUE_IN_QUOTE,
    Checked,
    FieldCheck,
    Geocode,
    Page,
    check_field,
    normalize,
    resolve_country,
)

MAX_DAYS = 21
COVID_START = "2020-03-01"
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
        One element of the model's ``editions`` list.
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
    for name, rule in PAST_RULES.items():
        ev = raw.get(name)
        if not isinstance(ev, dict):
            continue
        check = check_field(name, ev, get_page, rule, PAST_FIELD_SCHEMAS)
        if check.kept and name == "title" and series_of(check.value) != series:
            check.kind, check.reason = "", "title is not of this series"
            check.detail = f"{series_of(check.value)} ≠ {series}"
        if check.kept and name == "format":
            problem = format_problem(check.value, check.quote)
            if problem == FORMAT_HEDGED:
                pass  # stays a model judgement: never verified, so never applied by --recheck
            elif problem:
                check.kind, check.reason = "", problem
            elif check.value != "in_person":
                check.kind = FORMAT_IN_QUOTE
        out.checks.append(check)
        if check.kept:
            out.fields[name] = check.value
            out.kinds[name] = check.kind
            out.sources[name] = check.source_url

    def drop(reason: str, detail: str = "") -> CheckedEdition:
        out.dropped, out.dropped_detail = reason, detail
        return out

    if out.year not in _target_years(batch):
        return drop("year is not a target year of this request", str(raw.get("year")))
    out.cancelled = out.fields.pop("cancelled", False) is True
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
    else:
        resolve_country(out, geocode)

    claimed = {str(c.value) for c in out.checks if c.field == "format" and not c.kept}
    if fmt is None and claimed & {"virtual", "hybrid"}:
        return drop("virtual or hybrid format claimed but not verified")
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

    # In person: derived before the pandemic in a verified city, else the model's judgement
    # (kept as is) or, with no format at all, an UNVERIFIED default written by past_merge.
    pre_pandemic = start < COVID_START and out.kinds.get("city") == VALUE_IN_QUOTE
    if fmt in (None, "in_person") and pre_pandemic:
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
