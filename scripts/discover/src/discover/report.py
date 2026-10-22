"""Markdown report: per-candidate evidence tables and a cost summary.

Used for the dry-run output and the PR body. Every model- or web-derived string is rendered
inside a code span or as an encoded autolink, so pages cannot inject Markdown, links, images
or @-mentions into the PR.
"""

import re
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import quote

from .agent import Research
from .cost import PRICES, WEB_SEARCH_USD_PER_1K, Usage
from .merge import Plan
from .verify import Checked

MAX_CELL = 300


@dataclass
class ConferenceRun:
    conference: dict[str, Any]
    research: Research | None = None
    error: str = ""
    checked: list[Checked] = field(default_factory=list)


def code(value: Any) -> str:
    """Inline code span safe inside a GFM table cell.

    Examples
    --------
    .. code-block:: python

        code("a | b `c`")  # "`a \\| b 'c'`"
    """
    text = str(value).lower() if isinstance(value, bool) else str(value)
    text = re.sub(r"\s+", " ", text).replace("`", "'").replace("|", "\\|").strip()
    if len(text) > MAX_CELL:
        text = text[: MAX_CELL - 1] + "…"
    return f"`{text}`" if text else "—"


def link(url: str) -> str:
    """Percent-encoded autolink (no ``|``, spaces, ``<`` or ``>`` can break out)."""
    if not url:
        return "—"
    return f"<{quote(url, safe=":/?#[]@!$&'()*+,;=%~")}>"


def _outcomes(plan: Plan) -> dict[int, str]:
    out: dict[int, str] = {}
    for a in plan.additions:
        out[id(a.candidate)] = f"**add** {code(a.entry['id'])}"
    for u in plan.updates:
        fields = ", ".join(u.changes)
        out[id(u.candidate)] = f"**update** {code(u.id)} ({fields})"
    for c, reason in plan.skipped:
        out[id(c)] = f"skipped: {reason}"
    return out


def evidence_section(runs: list[ConferenceRun], plan: Plan) -> str:
    """Per conference: status, then one evidence table per candidate."""
    outcomes = _outcomes(plan)
    defaulted = {id(a.candidate): a.defaulted for a in plan.additions}
    lines: list[str] = []
    for run in runs:
        conf = run.conference
        lines.append(f"### {conf['title']} {conf['year']} ({code(conf['id'])})")
        r = run.research
        if run.error:
            lines += [f"API error: {code(run.error)}", ""]
            continue
        assert r is not None
        if r.status != "ok":
            lines += [f"No result: {r.status} — {code(r.detail)}", ""]
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
            outcome = f"dropped: {c.dropped}" if c.dropped else outcomes.get(id(c), "—")
            lines += [
                f"#### {code(c.label)} → {outcome}",
                "",
                f"Rationale: {code(c.rationale)}",
                "",
                "| Field | Value | Source | Quote | Check |",
                "|---|---|---|---|---|",
            ]
            for chk in c.checks:
                status = "✅ verified" if chk.kept else f"❌ {chk.reason}"
                lines.append(
                    f"| {chk.field} | {code(chk.value)} | {link(chk.source_url)} "
                    f"| {code(chk.quote)} | {status} |"
                )
            for f in defaulted.get(id(c), []):
                lines.append(f"| {f} | (default) | — | — | ⚠️ no verified evidence |")
            lines.append("")
    return "\n".join(lines)


def _cost_row(label: str, u: Usage) -> str:
    return (
        f"| {label} | {u.requests} | {u.input_tokens:,} | {u.output_tokens:,} "
        f"| {u.cache_creation_input_tokens:,} | {u.cache_read_input_tokens:,} "
        f"| {u.web_search_requests} | {u.web_fetch_requests} | ${u.usd:.2f} |"
    )


def cost_section(runs: list[ConferenceRun], weekly_conferences: int) -> str:
    """Token / tool usage per conference, total, and a projection for a weekly run.

    Parameters
    ----------
    runs : list of ConferenceRun
        Conferences researched in this run.
    weekly_conferences : int
        Number of conferences a scheduled ``--mode upcoming`` run would research today.
    """
    total = Usage()
    lines = [
        (
            "| Conference | Requests | Input | Output | Cache write | Cache read | Searches "
            "| Fetches | Est. USD |"
        ),
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for run in runs:
        if run.research:
            lines.append(_cost_row(code(run.conference["id"]), run.research.usage))
            total += run.research.usage
    lines.append(_cost_row("**Total**", total))
    priced = [r for r in runs if r.research and r.research.usage.requests]
    if priced:
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
            "(its content is billed as input tokens). Fallback-served attempts are priced at the "
            "fallback model's rates. Quote-verification fetches are made by this script and free."
        ),
    ]
    if total.unpriced_models:
        lines.append(f"Not priced (unknown model): {', '.join(sorted(total.unpriced_models))}.")
    return "\n".join(lines)


def tool_log(runs: list[ConferenceRun]) -> str:
    """Server tool calls the model made (queries and URLs), for the dry-run output."""
    lines = []
    for run in runs:
        if run.research and run.research.tool_calls:
            lines.append(f"{run.conference['id']}:")
            lines += [f"  - {call}" for call in run.research.tool_calls]
    return "\n".join(lines)
