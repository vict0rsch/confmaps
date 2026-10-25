"""Turn verified past editions into additions and updates of ``data/past_conferences.yml``.

Rules (deterministic, never deletes an entry; docs/backfill-spec.md §5.5):

- Dedupe by ``series|year`` against the past file, ``data.json`` (any source) and earlier
  editions of the run.
- New edition → addition appended to the file: id per the shared convention
  (:func:`~discover.past_ids.past_edition_id`, never suffixed: a clash is skipped),
  ``source: curated``, ``sources`` = evidence URLs, ``title`` verified else the series'
  latest title, ``full_name`` only if verified, ``tags`` copied from the series' latest
  edition. Without a format, ``in_person`` is written with an ``# UNVERIFIED default`` comment.
- Existing entry (``--recheck``): on ``source: pwc`` entries, verified changes of
  :data:`APPLIED_UPDATES` are applied (PwC is lower trust than evidence; a switch to virtual
  deletes city, country and venue; a new city without a verified venue deletes the old venue;
  new evidence URLs are appended to ``sources``). A switch from virtual to in person or hybrid
  (which adds a pin to the map) is never applied. Every other difference, and every difference
  on a ``source: curated`` entry, is a suggestion shown in the PR, never written.
- ``cancelled`` is never applied: the entry is listed for human removal before merge.
"""

import re
from dataclasses import dataclass, field
from datetime import date
from typing import Any

from ruamel.yaml.comments import CommentedMap, CommentedSeq
from ruamel.yaml.scalarstring import SingleQuotedScalarString

from .merge import UNVERIFIED_COMMENT, Addition, Plan, Update
from .past_ids import is_track, past_edition_id, series_of
from .past_verify import PLACE_FIELDS, CheckedEdition
from .yamlio import append_item, delete_key, dump, load_for_edit, set_ordered

FIELD_ORDER = [
    "id", "title", "year", "full_name", "link", "start", "end", "format", "city", "country",
    "venue", "tags", "notes", "source", "pwc", "sources",
]  # fmt: skip
APPLIED_UPDATES = ["format", "city", "country", "venue", "start", "end"]
SUGGESTED_UPDATES = [*APPLIED_UPDATES, "title", "full_name", "link"]
DATE_FIELDS = {"start", "end"}
DEFAULT_FORMAT = "in_person"
WIDTH = 4096  # the importer never folds long strings (e.g. `pwc.fixes` notes)
HEADER = """\
# Past main editions (docs/backfill-spec.md §1): imported from paperswithcode/ai-deadlines
# (source: pwc) or added with evidence URLs by the discovery agent (source: curated).
"""


def _iso(value: Any) -> Any:
    return value.isoformat() if isinstance(value, date) else value


@dataclass
class PastPlan(Plan):
    # Editions reported cancelled with a quote: (edition, id of the recorded entry).
    removals: list[tuple[CheckedEdition, str]] = field(default_factory=list)


def series_profiles(data: dict[str, Any], past: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Per series: the latest main edition's ``title``, ``full_name`` and ``tags``.

    ``data.json`` conferences (tracks excluded) and past entries both count; the newest year
    wins, ``data.json`` first on a tie.

    Examples
    --------
    .. code-block:: python

        series_profiles(data, past)["neurips"]  # {"title": "NeurIPS", "tags": [...], ...}
    """
    rows = [
        (c["year"], 1, c["series"], c["title"], c.get("fullName"), c.get("tags") or [])
        for c in data["conferences"]
        if not is_track(c["title"])
    ] + [
        (e["year"], 0, series_of(e["title"]), e["title"], e.get("full_name"), e.get("tags") or [])
        for e in past
    ]
    out: dict[str, dict[str, Any]] = {}
    for _, _, series, title, full_name, tags in sorted(rows, key=lambda r: (r[0], r[1])):
        out[series] = {"title": title, "full_name": full_name, "tags": list(tags)}
    return out


def plan_past_changes(
    past: list[dict[str, Any]],
    data: dict[str, Any],
    editions: list[CheckedEdition],
    profiles: dict[str, dict[str, Any]],
) -> PastPlan:
    """Dedupe verified editions and decide additions, updates, suggestions and removals.

    Parameters
    ----------
    past : list of dict
        Current ``past_conferences.yml`` entries (plain dicts).
    data : dict
        Parsed ``data/build/data.json``.
    editions : list of CheckedEdition
        Verified editions; dropped ones are ignored.
    profiles : dict
        :func:`series_profiles` (latest title and tags per series).

    Returns
    -------
    PastPlan
        Additions, updates (applied changes and suggestions), removals and skipped editions.

    Examples
    --------
    .. code-block:: python

        plan = plan_past_changes(past, data, checked, series_profiles(data, past))
        new_text = apply_past_plan(text, plan)
    """
    plan = PastPlan()
    by_key = {(series_of(e["title"]), e["year"]): e for e in past}
    in_data = {(c["series"], c["year"]): c["id"] for c in data["conferences"]}
    ids = {c["id"] for c in data["conferences"]} | {e["id"] for e in past}
    seen: set[tuple[str, int]] = set()
    for c in editions:
        if c.dropped:
            continue
        key = (c.parent, c.year)
        if key in seen:
            plan.skipped.append((c, "duplicate of an earlier edition in this run", ""))
            continue
        seen.add(key)
        current = by_key.get(key)
        if c.cancelled:
            if current is not None:
                plan.removals.append((c, current["id"]))
            else:
                plan.skipped.append((c, "reported cancelled; no recorded edition to remove", ""))
        elif current is not None:
            if update := _update(current, c):
                plan.updates.append(update)
            else:
                plan.skipped.append((c, "matches a recorded edition", current["id"]))
        elif key in in_data:
            plan.skipped.append((c, "already in data.json", in_data[key]))
        elif c.parent not in profiles:
            plan.skipped.append((c, "unknown series (no recorded edition)", c.parent))
        else:
            new_id = past_edition_id(c.parent, c.year, data["conferences"])
            if new_id in ids:
                plan.skipped.append((c, "id already used by another edition", new_id))
                continue
            ids.add(new_id)
            plan.additions.append(_addition(c, new_id, profiles[c.parent]))
    return plan


def _evidence_sources(c: CheckedEdition, fields: list[str]) -> list[str]:
    return list(dict.fromkeys(c.sources[f] for f in fields if f in c.sources))


def _addition(c: CheckedEdition, new_id: str, profile: dict[str, Any]) -> Addition:
    f = c.fields
    entry: dict[str, Any] = {"id": new_id, "title": f.get("title") or profile["title"]}
    entry["year"] = c.year
    if "full_name" in f:
        entry["full_name"] = f["full_name"]
    entry |= {"link": f["link"], "start": f["start"], "end": f["end"]}
    entry["format"] = f.get("format", DEFAULT_FORMAT)
    if entry["format"] != "virtual":
        entry |= {k: f[k] for k in PLACE_FIELDS if k in f}
    entry["tags"] = list(profile["tags"])
    entry["source"] = "curated"
    entry["sources"] = _evidence_sources(c, FIELD_ORDER)
    return Addition(entry, c, [] if "format" in f else ["format"])


def _update(current: dict[str, Any], c: CheckedEdition) -> Update | None:
    cur = {k: _iso(current.get(k)) for k in SUGGESTED_UPDATES}
    changes: dict[str, tuple[Any, Any]] = {}
    if current.get("source") == "pwc":
        # Leaving virtual adds a physical location: a false pin is the worst error, so that
        # change is always a suggestion for a human.
        if (
            c.verified("format")
            and c.fields["format"] != cur["format"]
            and cur["format"] != "virtual"
        ):
            changes["format"] = (cur["format"], c.fields["format"])
        fmt = changes.get("format", (None, cur["format"]))[1]
        if fmt == "virtual":
            # A virtual edition has no place (and the schema forbids one).
            changes |= {k: (cur[k], None) for k in PLACE_FIELDS if cur[k] is not None}
        elif cur["format"] != "virtual" or "format" in changes:
            for k in PLACE_FIELDS:
                if c.verified(k) and c.fields[k] != cur[k]:
                    changes[k] = (cur[k], c.fields[k])
            if "city" in changes and "venue" not in changes and cur["venue"] is not None:
                changes["venue"] = (cur["venue"], None)  # the old venue was in the old city
        for k in DATE_FIELDS:
            if c.verified(k) and c.fields[k] != cur[k]:
                changes[k] = (cur[k], c.fields[k])
        start = changes.get("start", (None, cur["start"]))[1]
        end = changes.get("end", (None, cur["end"]))[1]
        if start > end:  # a partial date update must not produce start > end
            changes.pop("start", None)
            changes.pop("end", None)
    suggested = {
        k: (cur[k], c.fields[k])
        for k in SUGGESTED_UPDATES
        if k in c.fields and c.fields[k] != cur[k] and k not in changes
    }
    if not changes and not suggested:
        return None
    have = set(current.get("sources") or [])
    new_sources = [u for u in _evidence_sources(c, list(changes)) if u not in have]
    return Update(current["id"], changes, suggested, new_sources, c)


def _scalar(f: str, value: Any) -> Any:
    return SingleQuotedScalarString(value) if f in DATE_FIELDS else value


def _new_entry(a: Addition) -> CommentedMap:
    entry = CommentedMap()
    for f, value in a.entry.items():
        entry[f] = CommentedSeq(value) if isinstance(value, list) else _scalar(f, value)
    entry["tags"].fa.set_flow_style()  # `tags: [a, b]`, as the importer writes it
    for f in a.defaulted:
        # The column counts the 4-space indent this entry gets before `dump` dedents it.
        entry.yaml_add_eol_comment(UNVERIFIED_COMMENT, f, column=4 + len(f"{f}: {a.entry[f]}") + 2)
    return entry


ENTRY_START = re.compile(r"^- id: *([^\s#]+)", re.MULTILINE)
ENTRY_YEAR = re.compile(r"^  year: *(\d+)", re.MULTILINE)


def insert_sorted(text: str, block: str, key: tuple[int, str]) -> str:
    """Insert one dumped entry before the first entry that sorts after it by ``(year, id)``.

    The file is kept sorted by ``(year, id)`` (``scripts/import-pwc.test.ts``). The text around
    the insertion is unchanged; an entry that sorts after every other one is appended.

    Examples
    --------
    .. code-block:: python

        insert_sorted("- id: a16\n  year: 2016\n", "- id: a00\n  year: 2000\n", (2000, "a00"))
        # "- id: a00\n  year: 2000\n\n- id: a16\n  year: 2016\n"
    """
    starts = [m.start() for m in ENTRY_START.finditer(text)]
    for pos, end in zip(starts, [*starts[1:], len(text)], strict=False):
        entry = text[pos:end]
        year = ENTRY_YEAR.search(entry)
        id_ = ENTRY_START.match(entry)
        if year and id_ and (int(year[1]), id_[1]) > key:
            return text[:pos] + block.rstrip("\n") + "\n\n" + text[pos:]
    return text.rstrip("\n") + "\n\n" + block


def apply_past_plan(text: str, plan: PastPlan) -> str:
    """Apply additions and applied updates; other entries and all comments are kept.

    Parameters
    ----------
    text : str
        Current file content (``""`` if the file does not exist yet).
    plan : PastPlan
        Changes from :func:`plan_past_changes` (suggestions and removals are not written).

    Returns
    -------
    str
        New file content (identical to ``text`` for an empty plan). Without applied updates the
        existing text is kept byte for byte, and each addition is inserted in ``(year, id)``
        order (:func:`insert_sorted`).

    Examples
    --------
    .. code-block:: python

        Path("data/past_conferences.yml").write_text(apply_past_plan(text, plan))
    """
    if plan.empty:
        return text
    out = text if text.strip() else HEADER
    data = load_for_edit(text) if plan.applied else None
    if data:
        by_id = {entry["id"]: entry for entry in data}
        for u in plan.applied:
            entry = by_id[u.id]
            for f, (_, new) in u.changes.items():
                if new is None:
                    delete_key(entry, f)
                else:
                    set_ordered(entry, f, _scalar(f, new), FIELD_ORDER)
            if u.new_sources and "sources" not in entry:
                set_ordered(entry, "sources", CommentedSeq(u.new_sources), FIELD_ORDER)
            elif u.new_sources:
                for url in u.new_sources:
                    append_item(entry["sources"], url)
        out = dump(data, WIDTH)
    for a in plan.additions:
        block = dump(CommentedSeq([_new_entry(a)]), WIDTH)
        out = insert_sorted(out, block, (int(a.entry["year"]), a.entry["id"]))
    return out
