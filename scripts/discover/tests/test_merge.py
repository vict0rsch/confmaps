from typing import Any

from conftest import ATLANTA_PAGE, ATLANTA_URL, FakeFetcher, atlanta_candidate, ev
from ruamel.yaml import YAML

from discover.merge import apply_plan, city_slug, load_satellites, plan_changes, unified_diff
from discover.verify import Checked, check_candidate

PARIS_URL = "https://neurips-europe.cc/"
PARIS_PAGE = (
    "NeurIPS 2026 in Paris. Satellite event, December 9-13, 2026. Registration for "
    "non-presenters is sold out. Open to everyone in 2026! Venue: Palais des Congrès."
)


def verified(raw: dict[str, Any]) -> Checked:
    pages = {ATLANTA_URL: ATLANTA_PAGE, PARIS_URL: PARIS_PAGE}
    return check_candidate(raw, raw["parent"], "Sydney", FakeFetcher(pages).get)


def paris_candidate(**fields: Any) -> dict[str, Any]:
    base = {
        "parent": "neurips26",
        "rationale": "Official satellite.",
        "name": ev("NeurIPS 2026 in Paris", PARIS_URL, "NeurIPS 2026 in Paris"),
        "link": ev(PARIS_URL, PARIS_URL, "NeurIPS 2026 in Paris"),
        "city": ev("PARIS", PARIS_URL, "in Paris"),
        "country": ev("France", PARIS_URL, "NeurIPS 2026 in Paris"),  # quote need not name it
        "start": ev("2026-12-09", PARIS_URL, "December 9-13, 2026"),
        "end": ev("2026-12-13", PARIS_URL, "December 9-13, 2026"),
    }
    return base | fields


# --- ids ---------------------------------------------------------------------------------------


def test_city_slug() -> None:
    assert city_slug("Mexico City") == "mexico-city"
    assert city_slug("  Zürich ") == "zurich"
    assert city_slug("São Paulo") == "sao-paulo"
    assert city_slug("St. John's") == "st-john-s"


def test_addition_gets_stable_id_sources_and_defaults(satellites_text: str) -> None:
    raw = atlanta_candidate(official=None, presents_papers=None, access=None)
    plan = plan_changes(load_satellites(satellites_text), [verified(raw)])
    (add,) = plan.additions
    assert add.entry["id"] == "neurips26-atlanta"
    assert add.entry["sources"] == [ATLANTA_URL]
    assert add.defaulted == ["official", "presents_papers", "access"]
    assert add.entry["official"] is False and add.entry["access"] == "registration"
    assert list(add.entry) == [
        "id", "parent", "name", "link", "city", "country", "venue", "start", "end", "official",
        "presents_papers", "access", "sources",
    ]  # fmt: skip


def test_id_collision_gets_suffix() -> None:
    existing = [{"id": "neurips26-atlanta", "parent": "neurips25", "city": "Atlanta", "start": "x"}]
    plan = plan_changes(existing, [verified(atlanta_candidate())])
    assert plan.additions[0].entry["id"] == "neurips26-atlanta-2"


# --- dedupe / updates ----------------------------------------------------------------------


def test_existing_satellite_with_same_facts_is_not_duplicated(satellites_text: str) -> None:
    access = ev("authors_only", PARIS_URL, "Registration for non-presenters is sold out")
    plan = plan_changes(
        load_satellites(satellites_text), [verified(paris_candidate(access=access))]
    )
    assert plan.empty
    assert plan.skipped[0][1] == "matches neurips26-paris with no verified changes"


def test_update_contains_only_changed_fields(satellites_text: str) -> None:
    raw = paris_candidate(
        name=ev("NeurIPS 2026 in Paris", PARIS_URL, "NeurIPS 2026 in Paris"),  # differs: ignored
        access=ev("open", PARIS_URL, "Open to everyone in 2026!"),
        venue=ev("Palais des Congrès", PARIS_URL, "Venue: Palais des Congrès"),
    )
    plan = plan_changes(load_satellites(satellites_text), [verified(raw)])
    assert not plan.additions
    (u,) = plan.updates
    assert u.id == "neurips26-paris"
    assert u.changes == {"access": ("authors_only", "open"), "venue": (None, "Palais des Congrès")}
    assert u.new_sources == []  # the URL is already in sources


def test_free_text_fields_are_never_overwritten() -> None:
    existing = [
        {"id": "neurips26-paris", "parent": "neurips26", "name": "Old", "city": "Paris",
         "start": "2026-12-09", "end": "2026-12-13", "official": True, "presents_papers": True,
         "access": "authors_only", "notes": "Curated note", "venue": "Hall A"}
    ]  # fmt: skip
    raw = paris_candidate(
        notes=ev("Another note", PARIS_URL, "Satellite event"),
        venue=ev("Palais", PARIS_URL, "Venue: Palais des Congrès"),
    )
    assert plan_changes(existing, [verified(raw)]).empty


def test_duplicate_candidates_in_one_run() -> None:
    plan = plan_changes([], [verified(atlanta_candidate()), verified(atlanta_candidate())])
    assert len(plan.additions) == 1
    assert plan.skipped[0][1] == "duplicate of an earlier candidate in this run"


def test_dropped_candidates_are_ignored() -> None:
    bad = verified(atlanta_candidate(city=None))
    assert bad.dropped
    assert plan_changes([], [bad]).empty


# --- YAML ----------------------------------------------------------------------------------------


def test_round_trip_is_byte_identical(satellites_text: str) -> None:
    plan = plan_changes(load_satellites(satellites_text), [])
    assert apply_plan(satellites_text, plan) == satellites_text


def test_apply_preserves_comments_order_and_never_deletes(satellites_text: str) -> None:
    raw_update = paris_candidate(
        access=ev("open", ATLANTA_URL, "Registration is open to all."),  # new source URL
    )
    raw_update["city"] = ev("Paris", PARIS_URL, "in Paris")
    plan = plan_changes(
        load_satellites(satellites_text), [verified(raw_update), verified(atlanta_candidate())]
    )
    assert len(plan.updates) == 1 and len(plan.additions) == 1
    new = apply_plan(satellites_text, plan)

    old_lines = satellites_text.splitlines()
    new_lines = new.splitlines()
    # Header comments untouched.
    assert new_lines[:7] == old_lines[:7]
    # Only additions in the diff, except the one changed `access` value.
    diff = unified_diff(satellites_text, new)
    removed = [
        line for line in diff.splitlines() if line.startswith("-") and not line.startswith("---")
    ]
    assert removed == ["-  access: authors_only"]
    # Every original entry and key is still there.
    old, after = load_satellites(satellites_text), load_satellites(new)
    after_by_id = {s["id"]: s for s in after}
    for s in old:
        assert set(s) <= set(after_by_id[s["id"]])
    assert [s["id"] for s in after][: len(old)] == [s["id"] for s in old]
    paris = after_by_id["neurips26-paris"]
    assert paris["access"] == "open" and paris["sources"][-1] == ATLANTA_URL
    # Blank line between entries kept; the new source sits right after the old ones.
    assert "    - https://blog.neurips.cc/2026/04/22/neurips-newsletter-april-2026/\n" in new
    assert f"    - {ATLANTA_URL}\n\n- id: neurips26-atlanta\n" in new
    atl = after_by_id["neurips26-atlanta"]
    assert atl["start"] == "2026-12-09" and atl["official"] is True
    assert "  start: '2026-12-09'\n" in new
    assert new.count("\n\n- id: ") == 4  # every entry preceded by one blank line
    assert "\n\n\n" not in new


def test_output_parses_as_plain_yaml(satellites_text: str) -> None:
    plan = plan_changes(load_satellites(satellites_text), [verified(atlanta_candidate())])
    parsed = YAML(typ="safe").load(apply_plan(satellites_text, plan))
    assert parsed[-1]["id"] == "neurips26-atlanta"
    assert isinstance(parsed[-1]["start"], str)
    assert len(parsed) == 4
