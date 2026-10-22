"""Turn verified candidates into additions and updates of ``data/satellites.yml``.

Rules (deterministic, never deletes anything):

- Dedup key: ``(parent, normalized city)`` against existing entries and earlier candidates.
- New key → addition with a stable id ``<parent>-<city-slug>``; ``sources`` = verified URLs.
- Existing key → update with changed fields only. Only factual fields are overwritten
  (``UPDATABLE``); free-text fields are filled only when missing (``FILL_IF_MISSING``);
  identity fields (id, parent, name, link, city, country) are never touched.
"""

import difflib
import io
import re
from dataclasses import dataclass, field
from typing import Any

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap, CommentedSeq
from ruamel.yaml.scalarstring import SingleQuotedScalarString

from .verify import Checked, norm_city

FIELD_ORDER = [
    "id", "parent", "name", "link", "city", "country", "venue", "start", "end", "official",
    "presents_papers", "access", "notes", "sources",
]  # fmt: skip
UPDATABLE = ["start", "end", "official", "presents_papers", "access"]
FILL_IF_MISSING = ["venue", "notes"]
# satellites.yml requires these; without verified evidence they get conservative defaults
# that the PR evidence table flags as unverified.
DEFAULTS: dict[str, Any] = {"official": False, "presents_papers": False, "access": "registration"}
DATE_FIELDS = {"start", "end"}


def city_slug(city: str) -> str:
    """Id-safe slug: ``"Mexico City"`` → ``"mexico-city"``, ``"Zürich"`` → ``"zurich"``.

    Examples
    --------
    .. code-block:: python

        f"neurips26-{city_slug('São Paulo')}"  # "neurips26-sao-paulo"
    """
    return re.sub(r"[^a-z0-9]+", "-", norm_city(city)).strip("-")


@dataclass
class Addition:
    entry: dict[str, Any]
    candidate: Checked
    defaulted: list[str] = field(default_factory=list)


@dataclass
class Update:
    id: str
    changes: dict[str, tuple[Any, Any]]  # field → (old, new); old is None when filled in
    new_sources: list[str]
    candidate: Checked


@dataclass
class Plan:
    additions: list[Addition] = field(default_factory=list)
    updates: list[Update] = field(default_factory=list)
    skipped: list[tuple[Checked, str]] = field(default_factory=list)

    @property
    def empty(self) -> bool:
        return not self.additions and not self.updates


def _verified_sources(c: Checked) -> list[str]:
    return list(dict.fromkeys(c.sources[f] for f in FIELD_ORDER if f in c.sources))


def plan_changes(existing: list[dict[str, Any]], candidates: list[Checked]) -> Plan:
    """Dedupe verified candidates against existing satellites and each other.

    Parameters
    ----------
    existing : list of dict
        Current ``satellites.yml`` entries (plain dicts).
    candidates : list of Checked
        Verified candidates; those with ``dropped`` set are ignored.

    Returns
    -------
    Plan
        Additions, updates (changed fields only) and skipped candidates with reasons.

    Examples
    --------
    .. code-block:: python

        plan = plan_changes(load_satellites(text), checked)
        new_text = apply_plan(text, plan)
    """
    plan = Plan()
    by_key = {(s["parent"], norm_city(s["city"])): s for s in existing}
    ids = {s["id"] for s in existing}
    seen: set[tuple[str, str]] = set()
    for c in candidates:
        if c.dropped:
            continue
        key = (c.parent, norm_city(c.fields["city"]))
        if key in seen:
            plan.skipped.append((c, "duplicate of an earlier candidate in this run"))
            continue
        seen.add(key)
        current = by_key.get(key)
        if current is None:
            plan.additions.append(_addition(c, ids))
        elif update := _update(current, c):
            plan.updates.append(update)
        else:
            plan.skipped.append((c, f"matches {current['id']} with no verified changes"))
    return plan


def _addition(c: Checked, ids: set[str]) -> Addition:
    base = f"{c.parent}-{city_slug(c.fields['city'])}"
    new_id, n = base, 2
    while new_id in ids:
        new_id, n = f"{base}-{n}", n + 1
    ids.add(new_id)
    entry: dict[str, Any] = {"id": new_id, "parent": c.parent}
    defaulted = []
    for f in FIELD_ORDER[2:-1]:
        if f in c.fields:
            entry[f] = c.fields[f]
        elif f in DEFAULTS:
            entry[f] = DEFAULTS[f]
            defaulted.append(f)
    entry["sources"] = _verified_sources(c)
    return Addition(entry, c, defaulted)


def _update(current: dict[str, Any], c: Checked) -> Update | None:
    changes: dict[str, tuple[Any, Any]] = {}
    for f in UPDATABLE:
        if f in c.fields and c.fields[f] != current.get(f):
            changes[f] = (current.get(f), c.fields[f])
    for f in FILL_IF_MISSING:
        if f in c.fields and not current.get(f):
            changes[f] = (None, c.fields[f])
    start = changes.get("start", (None, current["start"]))[1]
    end = changes.get("end", (None, current["end"]))[1]
    if start > end:  # a partial date update must not produce start > end
        changes.pop("start", None)
        changes.pop("end", None)
    if not changes:
        return None
    have = set(current.get("sources") or [])
    used = [c.sources[f] for f in FIELD_ORDER if f in changes and f in c.sources]
    new_sources = [u for u in dict.fromkeys(used) if u not in have]
    return Update(current["id"], changes, new_sources, c)


# ---------------------------------------------------------------------------
# YAML (ruamel round-trip: comments, key order and quoting are preserved)
# ---------------------------------------------------------------------------


def _yaml() -> YAML:
    y = YAML()
    y.preserve_quotes = True
    y.width = 100
    # Nested lists (`sources`) are indented under their key; the top-level list is dedented by
    # `_dump` to match the hand-written file.
    y.indent(mapping=2, sequence=4, offset=2)
    return y


def _dump(data: Any) -> str:
    out = io.StringIO()
    _yaml().dump(data, out)
    return "".join(line.removeprefix("  ") for line in out.getvalue().splitlines(True))


def load_satellites(text: str) -> list[dict[str, Any]]:
    """``satellites.yml`` text → plain dicts (strings, booleans, lists).

    Examples
    --------
    .. code-block:: python

        sats = load_satellites(Path("data/satellites.yml").read_text())
    """
    data = _yaml().load(text) or []
    return [
        {k: (list(v) if isinstance(v, list) else v) for k, v in entry.items()} for entry in data
    ]


def _scalar(f: str, value: Any) -> Any:
    return SingleQuotedScalarString(value) if f in DATE_FIELDS else value


def _set(m: CommentedMap, key: str, value: Any) -> None:
    """Set ``key`` in canonical field order, keeping a trailing blank line at the end."""
    if key in m:
        m[key] = value
        return
    later = FIELD_ORDER[FIELD_ORDER.index(key) + 1 :]
    pos = next((i for i, k in enumerate(m) if k in later), len(m))
    if pos == len(m) and len(m):
        # Blank lines between entries are stored as a comment on the last key: move it.
        last = list(m)[-1]
        trailing = m.ca.items.pop(last, None)
        m.insert(pos, key, value)
        if trailing is not None:
            m.ca.items[key] = trailing
    else:
        m.insert(pos, key, value)


def _append(seq: CommentedSeq, value: Any) -> None:
    """Append to a list, keeping the comment (blank line) that follows its last item."""
    trailing = seq.ca.items.pop(len(seq) - 1, None)
    seq.append(value)
    if trailing is not None:
        seq.ca.items[len(seq) - 1] = trailing


def apply_plan(text: str, plan: Plan) -> str:
    """Apply a plan to ``satellites.yml`` text; existing entries and comments are kept.

    Parameters
    ----------
    text : str
        Current file content.
    plan : Plan
        Changes from :func:`plan_changes`.

    Returns
    -------
    str
        New file content (identical to ``text`` for an empty plan).

    Examples
    --------
    .. code-block:: python

        Path("data/satellites.yml").write_text(apply_plan(text, plan))
    """
    if plan.empty:
        return text
    data = _yaml().load(text)
    if data is None:  # file with comments only
        out = text
    else:
        by_id = {entry["id"]: entry for entry in data}
        for u in plan.updates:
            entry = by_id[u.id]
            for f, (_, new) in u.changes.items():
                _set(entry, f, _scalar(f, new))
            if u.new_sources:
                if "sources" not in entry:
                    _set(entry, "sources", CommentedSeq())
                for url in u.new_sources:
                    _append(entry["sources"], url)
        out = _dump(data)
    for a in plan.additions:
        entry = CommentedMap()
        for f, value in a.entry.items():
            entry[f] = _scalar(f, value)
        out = out.rstrip("\n") + "\n\n" + _dump(CommentedSeq([entry]))
    return out


def unified_diff(old: str, new: str, path: str = "data/satellites.yml") -> str:
    return "".join(
        difflib.unified_diff(old.splitlines(True), new.splitlines(True), f"a/{path}", f"b/{path}")
    )
