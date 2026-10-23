"""Turn verified candidates into additions and updates of ``data/satellites.yml``.

Rules (deterministic, never deletes anything):

- Dedup: same ``parent`` and same city — same normalized name, or geocoded within
  :data:`SAME_CITY_KM` (aliases, other scripts) — against existing entries and earlier
  candidates.
- New city → addition with a stable id ``<parent>-<city-slug>``; ``sources`` = evidence URLs.
  Required fields without evidence get conservative defaults, each marked with an
  ``# UNVERIFIED default`` YAML comment (see :data:`DEFAULTS`).
- Existing city → only *verified* date changes are applied (:data:`APPLIED_UPDATES`). Every
  other difference (``official``, ``presents_papers``, ``access``, missing ``venue`` /
  ``notes``) is a suggestion shown in the PR, never written over curated data. Identity
  fields (id, parent, name, link, city, country) are never touched.
"""

import hashlib
import re
from dataclasses import dataclass, field
from datetime import date
from typing import Any

from ruamel.yaml.comments import CommentedMap, CommentedSeq
from ruamel.yaml.scalarstring import SingleQuotedScalarString

from . import yamlio
from .geo import haversine_km
from .verify import Checked, norm_city
from .yamlio import append_item, dump, load_entries, load_for_edit, set_ordered

FIELD_ORDER = [
    "id", "parent", "name", "link", "city", "country", "venue", "start", "end", "official",
    "presents_papers", "access", "notes", "sources",
]  # fmt: skip
APPLIED_UPDATES = ["start", "end"]
SUGGESTED_UPDATES = ["official", "presents_papers", "access"]
SUGGESTED_IF_MISSING = ["venue", "notes"]
# satellites.yml requires these. Without evidence an addition still needs a value, so each
# default is chosen so that an unreviewed error never sends a researcher to an event they
# cannot attend or present at: not endorsed, no paper presentations, restricted access.
# `authors_only` (rather than `registration`) is the restrictive choice: wrongly saying
# "anyone can register" makes people plan travel for nothing, while wrongly saying "authors
# only" at worst makes them check the event page. Each default is marked in the YAML, makes
# the PR a draft and is listed under "Needs human verification".
DEFAULTS: dict[str, Any] = {"official": False, "presents_papers": False, "access": "authors_only"}
UNVERIFIED_COMMENT = "UNVERIFIED default — check before merging"
DATE_FIELDS = {"start", "end"}
SAME_CITY_KM = 25.0

Coords = tuple[float, float]


def city_slug(city: str) -> str:
    """Id-safe slug: ``"Mexico City"`` → ``"mexico-city"``, ``"Zürich"`` → ``"zurich"``.

    Examples
    --------
    .. code-block:: python

        f"neurips26-{city_slug('São Paulo')}"  # "neurips26-sao-paulo"
    """
    return re.sub(r"[^a-z0-9]+", "-", norm_city(city)).strip("-")


def _iso(value: Any) -> str:
    """Dates as ISO strings, whether YAML gave a ``date`` (unquoted) or a string."""
    return value.isoformat() if isinstance(value, date) else str(value)


@dataclass
class Addition:
    entry: dict[str, Any]
    candidate: Checked
    defaulted: list[str] = field(default_factory=list)


@dataclass
class Update:
    id: str
    changes: dict[str, tuple[Any, Any]]  # applied: field → (old, new)
    suggested: dict[str, tuple[Any, Any]]  # not applied: field → (old or None, new)
    new_sources: list[str]
    candidate: Checked


@dataclass
class Plan:
    additions: list[Addition] = field(default_factory=list)
    updates: list[Update] = field(default_factory=list)  # with changes and/or suggestions
    skipped: list[tuple[Checked, str, str]] = field(default_factory=list)  # (c, reason, detail)

    @property
    def applied(self) -> list[Update]:
        return [u for u in self.updates if u.changes]

    @property
    def suggestions(self) -> list[Update]:
        return [u for u in self.updates if u.suggested]

    @property
    def empty(self) -> bool:
        """No change to write (suggestions alone are never written)."""
        return not self.additions and not self.applied


def _evidence_sources(c: Checked, fields: list[str]) -> list[str]:
    return list(dict.fromkeys(c.sources[f] for f in fields if f in c.sources))


def _coords(c: Checked) -> Coords | None:
    return (c.geo.lat, c.geo.lng) if c.geo else None


def _same_city(name_a: str, coords_a: Coords | None, name_b: str, coords_b: Coords | None) -> bool:
    if norm_city(name_a) == norm_city(name_b):
        return True
    return bool(coords_a and coords_b and haversine_km(coords_a, coords_b) <= SAME_CITY_KM)


def plan_changes(
    existing: list[dict[str, Any]],
    candidates: list[Checked],
    existing_coords: dict[str, Coords] | None = None,
) -> Plan:
    """Dedupe verified candidates against existing satellites and each other.

    Parameters
    ----------
    existing : list of dict
        Current ``satellites.yml`` entries (plain dicts).
    candidates : list of Checked
        Verified candidates; those with ``dropped`` set are ignored.
    existing_coords : dict, optional
        Satellite id → ``(lat, lng)`` of its city (from ``data/geocache.json``).

    Returns
    -------
    Plan
        Additions, updates (applied changes and suggestions) and skipped candidates.

    Examples
    --------
    .. code-block:: python

        plan = plan_changes(load_satellites(text), checked, {"neurips26-paris": (48.86, 2.35)})
        new_text = apply_plan(text, plan)
    """
    coords = existing_coords or {}
    plan = Plan()
    ids = {s["id"] for s in existing}
    seen: list[Checked] = []
    for c in candidates:
        if c.dropped:
            continue
        city = c.fields["city"]
        if any(
            p.parent == c.parent and _same_city(p.fields["city"], _coords(p), city, _coords(c))
            for p in seen
        ):
            plan.skipped.append((c, "duplicate of an earlier candidate in this run", ""))
            continue
        seen.append(c)
        current = next(
            (
                s
                for s in existing
                if s["parent"] == c.parent
                and _same_city(s["city"], coords.get(s["id"]), city, _coords(c))
            ),
            None,
        )
        if current is None:
            plan.additions.append(_addition(c, ids))
        elif update := _update(current, c):
            plan.updates.append(update)
        else:
            plan.skipped.append((c, "matches an existing entry with no changes", current["id"]))
    return plan


def _addition(c: Checked, ids: set[str]) -> Addition:
    city = c.fields["city"]
    # Non-Latin names ("東京") have no ASCII slug: use the geocoded English name, else a hash.
    slug = city_slug(city) or (c.geo and city_slug(c.geo.english_name)) or ""
    slug = slug or hashlib.sha1(norm_city(city).encode()).hexdigest()[:8]
    base = f"{c.parent}-{slug}"
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
    entry["sources"] = _evidence_sources(c, FIELD_ORDER)
    return Addition(entry, c, defaulted)


def _update(current: dict[str, Any], c: Checked) -> Update | None:
    changes: dict[str, tuple[Any, Any]] = {}
    for f in APPLIED_UPDATES:
        if c.verified(f) and c.fields[f] != _iso(current.get(f)):
            changes[f] = (_iso(current.get(f)), c.fields[f])
    start = changes.get("start", (None, _iso(current["start"])))[1]
    end = changes.get("end", (None, _iso(current["end"])))[1]
    if start > end:  # a partial date update must not produce start > end
        changes.pop("start", None)
        changes.pop("end", None)
    suggested: dict[str, tuple[Any, Any]] = {}
    for f in SUGGESTED_UPDATES:
        if f in c.fields and c.fields[f] != current.get(f):
            suggested[f] = (current.get(f), c.fields[f])
    for f in SUGGESTED_IF_MISSING:
        if f in c.fields and not current.get(f):
            suggested[f] = (None, c.fields[f])
    if not changes and not suggested:
        return None
    have = set(current.get("sources") or [])
    new_sources = [u for u in _evidence_sources(c, list(changes)) if u not in have]
    return Update(current["id"], changes, suggested, new_sources, c)


# ---------------------------------------------------------------------------
# YAML (ruamel round-trip: comments, key order and quoting are preserved; see ``yamlio``)
# ---------------------------------------------------------------------------


def load_satellites(text: str) -> list[dict[str, Any]]:
    """``satellites.yml`` text → plain dicts (strings, booleans, lists).

    Examples
    --------
    .. code-block:: python

        sats = load_satellites(Path("data/satellites.yml").read_text())
    """
    return load_entries(text)


def _scalar(f: str, value: Any) -> Any:
    return SingleQuotedScalarString(value) if f in DATE_FIELDS else value


def apply_plan(text: str, plan: Plan) -> str:
    """Apply a plan's additions and applied updates; existing entries and comments are kept.

    Parameters
    ----------
    text : str
        Current file content.
    plan : Plan
        Changes from :func:`plan_changes` (suggestions are not written).

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
    data = load_for_edit(text)
    if data is None:  # file with comments only
        out = text
    else:
        by_id = {entry["id"]: entry for entry in data}
        for u in plan.applied:
            entry = by_id[u.id]
            for f, (_, new) in u.changes.items():
                set_ordered(entry, f, _scalar(f, new), FIELD_ORDER)
            if u.new_sources and "sources" not in entry:
                set_ordered(entry, "sources", CommentedSeq(u.new_sources), FIELD_ORDER)
            elif u.new_sources:
                for url in u.new_sources:
                    append_item(entry["sources"], url)
        out = dump(data)
    for a in plan.additions:
        entry = CommentedMap()
        for f, value in a.entry.items():
            entry[f] = _scalar(f, value)
        for f in a.defaulted:
            # Two spaces after the value (ruamel would otherwise align all comments). The
            # column counts the 4-space indent this entry gets before `dump` dedents it.
            value = str(a.entry[f]).lower() if isinstance(a.entry[f], bool) else a.entry[f]
            entry.yaml_add_eol_comment(UNVERIFIED_COMMENT, f, column=4 + len(f"{f}: {value}") + 2)
        out = out.rstrip("\n") + "\n\n" + dump(CommentedSeq([entry]))
    return out


def unified_diff(old: str, new: str, path: str = "data/satellites.yml") -> str:
    return yamlio.unified_diff(old, new, path)
