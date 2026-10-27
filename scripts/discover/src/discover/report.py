"""Markdown report: verification needs, per-candidate evidence, suggestions, cost.

Used for the dry-run output and the PR body, for satellites (one run per conference) and past
editions (one run per batch of years of a series; ``plan`` is then a ``PastPlan``). Every model-, web- or data-derived string
(values, quotes, reasons' details, page errors, content types, parents, hosts, exception text,
conference titles) is rendered inside a code span via :func:`code` or as an encoded autolink
via :func:`link`; reasons themselves are static strings. So pages cannot inject Markdown,
links, images, table cells or @-mentions into the PR.
"""

import re
import unicodedata
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import quote

from .agent import Research
from .cost import PRICES, WEB_SEARCH_USD_PER_1K, Usage
from .geo import GeoHit, cached_hit
from .merge import Plan
from .verify import JUDGEMENT, Checked, unsafe_url_reason

MAX_CELL = 300


@dataclass
class ConferenceRun:
    conference: dict[str, Any]
    research: Research | None = None
    error: str = ""  # why there is no research result (API error, budget)
    checked: list[Checked] = field(default_factory=list)

    @property
    def failed(self) -> bool:
        return bool(self.error) or self.research is None or self.research.status != "ok"


def code(value: Any) -> str:
    """Inline code span safe inside a GFM table cell.

    Control and format characters (including bidi overrides) are removed, whitespace is
    collapsed, backticks become ``'`` and pipes are escaped.

    Examples
    --------
    .. code-block:: python

        code("a | b `c`")  # "`a \\| b 'c'`"
    """
    text = str(value).lower() if isinstance(value, bool) else str(value)
    # Whitespace (newlines included) becomes a space; other control/format characters go.
    text = "".join(
        " " if c.isspace() else c
        for c in text
        if c.isspace() or not unicodedata.category(c).startswith("C")
    )
    text = re.sub(r"\s+", " ", text).replace("`", "'").replace("|", "\\|").strip()
    if len(text) > MAX_CELL:
        text = text[: MAX_CELL - 1] + "…"
    return f"`{text}`" if text else "—"


def link(url: str) -> str:
    """Percent-encoded autolink for a safe http(s) URL (no ``|``, spaces, ``<`` or ``>`` can
    break out); anything else is shown as code."""
    if not url:
        return "—"
    if unsafe_url_reason(url):
        return code(url)
    return f"<{quote(url, safe=":/?#[]@!$&'()*+,;=%~")}>"


def _outcomes(plan: Plan) -> dict[int, str]:
    out: dict[int, str] = {}
    for a in plan.additions:
        out[id(a.candidate)] = f"**add** {code(a.entry['id'])}"
    for u in plan.updates:
        parts = []
        if u.changes:
            parts.append(f"**update** {code(u.id)} ({', '.join(u.changes)})")
        if u.suggested:
            target = "" if u.changes else f" for {code(u.id)}"
            parts.append(f"suggestions{target} (not applied): {', '.join(u.suggested)}")
        out[id(u.candidate)] = "; ".join(parts)
    for c, reason, detail in plan.skipped:
        out[id(c)] = f"skipped: {reason}" + (f" {code(detail)}" if detail else "")
    for c, entry_id in getattr(plan, "removals", []):
        out[id(c)] = f"**needs human removal** {code(entry_id)} (reported cancelled)"
    return out


def _flags(c: Checked) -> list[str]:
    """Static notes a check attached to a candidate (past editions: start in year + 1)."""
    return list(getattr(c, "flags", []))


def _status(chk: Any) -> str:
    if chk.kind == JUDGEMENT:
        return f"⚠️ {JUDGEMENT}"
    if chk.kept:
        return f"✅ {chk.kind}"
    return f"❌ {chk.reason}" + (f" {code(chk.detail)}" if chk.detail else "")


def needs_verification_section(plan: Plan) -> str:
    """Fields of additions that no check verified (defaults, model judgements) and flags."""
    lines = []
    for a in plan.additions:
        c = a.candidate
        for f in a.defaulted:
            lines.append(
                f"- {code(a.entry['id'])} `{f}`: UNVERIFIED default {code(a.entry[f])} "
                "(no evidence; marked in the YAML)"
            )
        for f, kind in c.kinds.items():
            if kind == JUDGEMENT:
                lines.append(
                    f"- {code(a.entry['id'])} `{f}` = {code(c.fields[f])}: model judgement, "
                    "check the quote below"
                )
        lines += [f"- {code(a.entry['id'])}: {flag}" for flag in _flags(c)]
    for u in plan.applied:
        lines += [f"- {code(u.id)}: {flag}" for flag in _flags(u.candidate)]
    return "\n".join(lines) or "Nothing: every written field passed a deterministic check."


def _shown(value: Any, empty: str) -> str:
    return empty if value is None else code(value)


def applied_section(plan: Plan) -> str:
    """Changes written to existing entries: field, old → new value, evidence kind."""
    lines = []
    for u in plan.applied:
        for f, (old, new) in u.changes.items():
            kind = u.candidate.kinds.get(f) or "follows from the verified format or city"
            # An empty old value is a field being added; an empty new value is a removal.
            before, after = _shown(old, "(missing)"), _shown(new, "(removed)")
            lines.append(f"- {code(u.id)} `{f}`: {before} → {after} — {kind}")
    return "\n".join(lines)


def removals_section(plan: Plan) -> str:
    """Recorded editions reported cancelled (with a quote): to be removed by a human."""
    lines = []
    for c, entry_id in getattr(plan, "removals", []):
        chk = next((x for x in c.checks if x.field == "cancelled" and x.kept), None)
        quote = f": {code(chk.quote)}, source {link(chk.source_url)}" if chk else ""
        lines.append(
            f"- {code(entry_id)} reported cancelled{quote} — model judgement; if confirmed, "
            "remove the entry before this PR (or the backfill PR) is merged: the archive "
            "never shrinks afterwards."
        )
    return "\n".join(lines)


def evidence_section(runs: list[ConferenceRun], plan: Plan) -> str:
    """Per conference: status, then one evidence table per candidate."""
    outcomes = _outcomes(plan)
    defaulted = {id(a.candidate): a for a in plan.additions}
    lines: list[str] = []
    for run in runs:
        conf = run.conference
        lines.append(f"### {code(conf['title'])} {code(conf['year'])} ({code(conf['id'])})")
        r = run.research
        if run.error or r is None:
            lines += [f"Not researched: {code(run.error)}", ""]
            continue
        if r.status != "ok":
            lines += [f"No result: {code(r.status)} — {code(r.detail)}", ""]
            continue
        served = f", served by fallback model {code(r.served_by)}" if r.served_by else ""
        lines += [
            (
                f"{len(r.candidates)} candidate(s) from the model; "
                f"{r.usage.web_search_requests} web searches, "
                f"{r.usage.web_fetch_requests} fetches{served}."
            ),
            "",
        ]
        for c in run.checked:
            if c.dropped:
                outcome = f"dropped: {c.dropped}" + (
                    f" {code(c.dropped_detail)}" if c.dropped_detail else ""
                )
            else:
                outcome = outcomes.get(id(c), "—")
            lines += [f"#### {code(c.label)} → {outcome}", "", f"Rationale: {code(c.rationale)}"]
            lines += ["", *(f"Flag: {flag}" for flag in _flags(c))] if _flags(c) else []
            lines += [
                "",
                "| Field | Value | Source | Quote | Check |",
                "|---|---|---|---|---|",
            ]
            for chk in c.checks:
                lines.append(
                    f"| {chk.field} | {code(chk.value)} | {link(chk.source_url)} "
                    f"| {code(chk.quote)} | {_status(chk)} |"
                )
            addition = defaulted.get(id(c))
            for f in addition.defaulted if addition else []:
                lines.append(
                    f"| {f} | {code(addition.entry[f])} (default) | — | — | ⚠️ UNVERIFIED default |"
                )
            lines.append("")
    return "\n".join(lines)


def suggestions_section(plan: Plan) -> str:
    """Differences on existing entries that are not applied (model judgement, fill-ins)."""
    lines = []
    for u in plan.suggestions:
        for f, (old, new) in u.suggested.items():
            source = link(u.candidate.sources.get(f, ""))
            lines.append(
                f"- {code(u.id)} `{f}`: {code(old) if old is not None else '(missing)'} → "
                f"{code(new)} — {u.candidate.kinds.get(f, '')}, source {source}"
            )
    return "\n".join(lines)


def new_city_rows(plan: Plan) -> list[tuple[str, str, str, GeoHit | None]]:
    """``(entry id, city, country, geocoder hit)`` of every city a plan writes: additions with
    a city (virtual editions have none) and applied city changes."""
    rows = [
        (a.entry["id"], a.entry["city"], a.entry["country"], a.candidate.geo)
        for a in plan.additions
        if a.entry.get("city")
    ]
    for u in plan.applied:
        if (u.changes.get("city") or (None, None))[1]:
            c = u.candidate
            rows.append((u.id, c.fields["city"], c.fields["country"], c.geo))
    return rows


def new_cities_section(plan: Plan, geocache: dict[str, Any]) -> str:
    """Resolved coordinates of each new city: the pipeline's geocache entry if present (what
    the map will show), else the discovery geocoder's hit."""
    lines = [
        "| Entry | City | Country | Lat, lng | Geocoder display name | From |",
        "|---|---|---|---|---|---|",
    ]
    for entry_id, city, country, geo in new_city_rows(plan):
        hit = cached_hit(geocache, city, country) or geo
        if hit is None:
            where, name, source = "—", "—", "not geocoded"
        else:
            where, name = f"{hit.lat:.4f}, {hit.lng:.4f}", code(hit.display_name)
            source = "data/geocache.json" if hit.source == "geocache" else "Nominatim (discovery)"
        lines.append(
            f"| {code(entry_id)} | {code(city)} | {code(country)} | {where} | {name} | {source} |"
        )
    return "\n".join(lines)


def _cost_row(label: str, u: Usage) -> str:
    return (
        f"| {label} | {u.requests} | {u.input_tokens:,} | {u.output_tokens:,} "
        f"| {u.cache_creation_input_tokens:,} | {u.cache_read_input_tokens:,} "
        f"| {u.web_search_requests} | {u.web_fetch_requests} | ${u.usd:.2f} |"
    )


def total_usage(runs: list[ConferenceRun]) -> Usage:
    total = Usage()
    for run in runs:
        if run.research:
            total += run.research.usage
    return total


def cost_section(runs: list[ConferenceRun], weekly_conferences: int | None) -> str:
    """Token / tool usage per request, total, and a projection for a weekly run.

    Parameters
    ----------
    runs : list of ConferenceRun
        Conferences (or past-edition batches) researched in this run.
    weekly_conferences : int, optional
        Number of conferences a scheduled ``--mode upcoming`` run would research today; no
        projection when ``None`` (past mode).
    """
    total = total_usage(runs)
    lines = [
        (
            "| Request | Requests | Input | Output | Cache write | Cache read | Searches "
            "| Fetches | Est. USD |"
        ),
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for run in runs:
        if run.research:
            lines.append(_cost_row(code(run.conference["id"]), run.research.usage))
    lines.append(_cost_row("**Total**", total))
    priced = [r for r in runs if r.research and r.research.usage.requests]
    if priced and weekly_conferences is None:
        avg = total.usd / len(priced)
        lines += ["", f"Average ${avg:.2f} per request (one series, up to six years)."]
    elif priced and weekly_conferences is not None:
        avg = total.usd / len(priced)
        lines += [
            "",
            (
                f"Average ${avg:.2f} per conference → projected weekly `--mode upcoming` run "
                f"({weekly_conferences} conferences): ~${avg * weekly_conferences:.2f}."
            ),
        ]
    p = PRICES["claude-opus-5-5"]
    lines += [
        "",
        (
            f"Assumptions: claude-opus-5-5 list prices ${p.input:g}/${p.output:g} per MTok "
            f"input/output, ${p.cache_write:g} cache write (5 min), ${p.cache_read:g} cache read; "
            f"web search ${WEB_SEARCH_USD_PER_1K:g} per 1,000; web fetch has no per-call fee "
            "(its content is billed as input tokens); no code-execution fee (the tool is not "
            "declared; dynamic filtering has no extra charge). Fallback-served attempts are "
            "priced at the fallback model's rates. Quote-verification fetches and geocoding are "
            "made by this script and free."
        ),
    ]
    if total.unpriced_models:
        names = ", ".join(code(m) for m in sorted(total.unpriced_models))
        lines.append(f"Not priced (unknown model): {names}.")
    return "\n".join(lines)


PAST_INTRO = (
    "Proposed by the discovery agent in past mode (`scripts/discover --mode past`, "
    "docs/backfill-spec.md §5). **Review before merging.** The Check column says what this "
    "script verified for each field: *quote on page, value in quote* / *date in quote* (the "
    "quote was found on the downloaded source page and contains the value), *linked from "
    "source page* / *same site as source page* (for `link`), *derived from geocoded city* (for "
    "`country`), *quote on page, format in quote* (the quote says virtual/online or hybrid), "
    "*derived: in person (pre-2020 default)* (a verified city, held before March 2020). *Model "
    "judgement (quote shown)* only means the quote is on the page: whether it supports the "
    "value is for you to judge. Recorded `source: pwc` editions receive verified changes of "
    "format, place and dates; other differences, and any on `source: curated` entries, are "
    "suggestions. A reported cancellation is never applied."
)


def build_body(
    runs: list[ConferenceRun],
    plan: Plan,
    summary: str,
    weekly_conferences: int | None,
    geocache: dict[str, Any],
    intro: str | None = None,
) -> str:
    """The PR body (also printed by ``--dry-run``); ``intro`` replaces the satellite intro."""
    failed = [r for r in runs if r.failed]
    sections = [
        intro
        or (
            "Proposed by the satellite discovery agent (`scripts/discover`, DESIGN.md §3). "
            "**Review before merging.** The Check column says what this script verified for "
            "each field: *quote on page, value in quote* / *date in quote* (the quote was found "
            "on the downloaded source page and contains the value), *linked from source page* "
            "/ *same site as source page* (for `link`), *derived from geocoded city* (for "
            "`country`). *Model judgement (quote shown)* only means the quote is on the page: "
            "whether it supports the value is for you to judge. Existing entries only receive "
            "verified date changes; other differences are listed as suggestions."
        ),
        summary,
        "## Needs human verification",
        needs_verification_section(plan),
    ]
    if removals := removals_section(plan):
        sections += ["## Needs human removal (before merge)", removals]
    if plan.applied:
        sections += ["## Applied changes", applied_section(plan)]
    if plan.suggestions:
        sections += ["## Suggested changes (not applied)", suggestions_section(plan)]
    if new_city_rows(plan):
        sections += ["## New cities", new_cities_section(plan, geocache)]
    if failed:
        sections.append(
            "Conferences without a usable result (see Evidence): "
            + ", ".join(code(r.conference["id"]) for r in failed)
        )
    sections += [
        "## Evidence",
        evidence_section(runs, plan),
        "## Cost",
        cost_section(runs, weekly_conferences),
    ]
    return "\n\n".join(sections)


def tool_log(runs: list[ConferenceRun]) -> str:
    """Server tool calls the model made (queries and URLs), for the dry-run output."""
    lines = []
    for run in runs:
        if run.research and run.research.tool_calls:
            lines.append(f"conference {run.conference['id']}:")
            lines += [f"  - {call}" for call in run.research.tool_calls]
    return "\n".join(lines)
