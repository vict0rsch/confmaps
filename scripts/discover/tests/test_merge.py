from datetime import date
from typing import Any

from conftest import (
    ATLANTA_PAGE,
    ATLANTA_URL,
    CONF,
    PARIS_HIT,
    FakeFetcher,
    FakeGeocoder,
    atlanta_candidate,
    ev,
)
from ruamel.yaml import YAML

from discover.geo import GeoHit
from discover.merge import (
    UNVERIFIED_COMMENT,
    apply_plan,
    city_slug,
    load_satellites,
    plan_changes,
    unified_diff,
)
from discover.verify import Checked, check_candidate

PARIS_URL = "https://neurips-europe.cc/"
PARIS_PAGE = (
    "NeurIPS 2026 in Paris. Satellite event, December 9-13, 2026. Registration for "
    "non-presenters is sold out. Open to everyone in 2026! Venue: Palais des Congrès."
)
PROGRAM_URL = "https://neurips-europe.cc/program"
PROGRAM_PAGE = "Program. Workshops run until December 14, 2026."
TOKYO_URL = "https://neurips-tokyo.jp/"
TOKYO_PAGE = "NeurIPS 2026 東京 サテライト. 東京, Japan. December 10–12, 2026."
PAGES = {ATLANTA_URL: ATLANTA_PAGE, PARIS_URL: PARIS_PAGE, PROGRAM_URL: PROGRAM_PAGE}


def verified(raw: dict[str, Any], geocoder: FakeGeocoder | None = None) -> Checked:
    fetcher = FakeFetcher({**PAGES, TOKYO_URL: TOKYO_PAGE})
    return check_candidate(raw, CONF, fetcher.get, geocoder or FakeGeocoder())


def paris_candidate(**fields: Any) -> dict[str, Any]:
    base = {
        "parent": "neurips26",
        "rationale": "Official satellite.",
        "name": ev("NeurIPS 2026 in Paris", PARIS_URL, "NeurIPS 2026 in Paris"),
        "link": ev(PARIS_URL, PARIS_URL, ""),
        "city": ev("PARIS", PARIS_URL, "NeurIPS 2026 in Paris"),
        "country": ev("France", PARIS_URL, "NeurIPS 2026 in Paris"),  # derived from the city
        "start": ev("2026-12-09", PARIS_URL, "December 9-13, 2026"),
        "end": ev("2026-12-13", PARIS_URL, "December 9-13, 2026"),
    }
    return base | fields


def tokyo_candidate() -> dict[str, Any]:
    return {
        "parent": "neurips26",
        "rationale": "Regional event.",
        "name": ev("NeurIPS 2026 東京 サテライト", TOKYO_URL, "NeurIPS 2026 東京 サテライト"),
        "link": ev(TOKYO_URL, TOKYO_URL, ""),
        "city": ev("東京", TOKYO_URL, "NeurIPS 2026 東京 サテライト"),
        "country": ev("Japan", TOKYO_URL, "東京, Japan. December"),
        "start": ev("2026-12-10", TOKYO_URL, "December 10–12, 2026"),
        "end": ev("2026-12-12", TOKYO_URL, "December 10–12, 2026"),
    }


PARIS_COORDS = {"neurips26-paris": (PARIS_HIT.lat, PARIS_HIT.lng)}


# --- ids ---------------------------------------------------------------------------------------


def test_city_slug() -> None:
    assert city_slug("Mexico City") == "mexico-city"
    assert city_slug("  Zürich ") == "zurich"
    assert city_slug("São Paulo") == "sao-paulo"
    assert city_slug("St. John's") == "st-john-s"
    assert city_slug("東京") == ""


def test_non_latin_city_id_uses_the_geocoded_english_name_or_a_hash() -> None:
    hit = GeoHit(35.68, 139.76, "Tokyo, Japan", "nominatim")
    c = verified(tokyo_candidate(), FakeGeocoder({"東京|japan": hit}))
    assert not c.dropped
    assert plan_changes([], [c]).additions[0].entry["id"] == "neurips26-tokyo"
    no_ascii = GeoHit(35.68, 139.76, "東京都, 日本", "nominatim")
    c = verified(tokyo_candidate(), FakeGeocoder({"東京|japan": no_ascii}))
    new_id = plan_changes([], [c]).additions[0].entry["id"]
    assert new_id.startswith("neurips26-") and len(new_id) == len("neurips26-") + 8


def test_addition_gets_stable_id_sources_and_conservative_defaults(satellites_text: str) -> None:
    raw = atlanta_candidate(official=None, presents_papers=None, access=None)
    plan = plan_changes(load_satellites(satellites_text), [verified(raw)], PARIS_COORDS)
    (add,) = plan.additions
    assert add.entry["id"] == "neurips26-atlanta"
    assert add.entry["sources"] == [ATLANTA_URL]
    assert add.defaulted == ["official", "presents_papers", "access"]
    assert add.entry["official"] is False and add.entry["presents_papers"] is False
    assert add.entry["access"] == "authors_only"
    assert list(add.entry) == [
        "id", "parent", "name", "link", "city", "country", "venue", "start", "end", "official",
        "presents_papers", "access", "sources",
    ]  # fmt: skip
    text = apply_plan(satellites_text, plan)
    assert f"  official: false  # {UNVERIFIED_COMMENT}\n" in text
    assert f"  access: authors_only  # {UNVERIFIED_COMMENT}\n" in text
    assert text.count(UNVERIFIED_COMMENT) == 3
    assert YAML(typ="safe").load(text)[-1]["access"] == "authors_only"


def test_id_collision_gets_suffix() -> None:
    existing = [{"id": "neurips26-atlanta", "parent": "neurips25", "city": "Atlanta", "start": "x"}]
    plan = plan_changes(existing, [verified(atlanta_candidate())])
    assert plan.additions[0].entry["id"] == "neurips26-atlanta-2"


# --- dedupe / updates ----------------------------------------------------------------------


def test_existing_satellite_with_same_facts_is_not_duplicated(satellites_text: str) -> None:
    access = ev("authors_only", PARIS_URL, "Registration for non-presenters is sold out")
    plan = plan_changes(
        load_satellites(satellites_text), [verified(paris_candidate(access=access))], PARIS_COORDS
    )
    assert plan.empty and not plan.updates
    assert plan.skipped[0][1:] == ("matches an existing entry with no changes", "neurips26-paris")


def test_only_verified_dates_are_applied_the_rest_is_suggested(satellites_text: str) -> None:
    raw = paris_candidate(
        end=ev("2026-12-14", PROGRAM_URL, "Workshops run until December 14, 2026"),
        access=ev("open", PARIS_URL, "Open to everyone in 2026!"),
        official=ev(False, PARIS_URL, "Satellite event, December 9-13, 2026"),
        venue=ev("Palais des Congrès", PARIS_URL, "Venue: Palais des Congrès"),
    )
    plan = plan_changes(load_satellites(satellites_text), [verified(raw)], PARIS_COORDS)
    assert not plan.additions
    (u,) = plan.updates
    assert u.id == "neurips26-paris"
    assert u.changes == {"end": ("2026-12-13", "2026-12-14")}
    assert u.suggested == {
        "official": (True, False),
        "access": ("authors_only", "open"),
        "venue": (None, "Palais des Congrès"),
    }
    assert u.new_sources == [PROGRAM_URL]
    new = apply_plan(satellites_text, plan)
    paris = {s["id"]: s for s in load_satellites(new)}["neurips26-paris"]
    assert paris["end"] == "2026-12-14"
    assert paris["access"] == "authors_only" and paris["official"] is True  # curated, untouched
    assert "venue" not in paris


def test_suggestions_alone_write_nothing(satellites_text: str) -> None:
    raw = paris_candidate(access=ev("open", PARIS_URL, "Open to everyone in 2026!"))
    plan = plan_changes(load_satellites(satellites_text), [verified(raw)], PARIS_COORDS)
    assert plan.empty and plan.suggestions
    assert apply_plan(satellites_text, plan) == satellites_text


def test_curated_free_text_fields_are_never_suggested() -> None:
    existing = [
        {"id": "neurips26-paris", "parent": "neurips26", "name": "Old", "city": "Paris",
         "start": "2026-12-09", "end": "2026-12-13", "official": True, "presents_papers": True,
         "access": "authors_only", "notes": "Curated note", "venue": "Hall A"}
    ]  # fmt: skip
    raw = paris_candidate(
        notes=ev("Another note", PARIS_URL, "Satellite event, December 9-13, 2026"),
        venue=ev("Palais des Congrès", PARIS_URL, "Venue: Palais des Congrès"),
    )
    plan = plan_changes(existing, [verified(raw)])
    assert plan.empty and not plan.updates


def test_unquoted_yaml_dates_are_compared_as_iso() -> None:
    existing = [
        {"id": "neurips26-paris", "parent": "neurips26", "city": "Paris",
         "start": date(2026, 12, 9), "end": date(2026, 12, 13), "official": True,
         "presents_papers": True, "access": "authors_only"}
    ]  # fmt: skip
    assert plan_changes(existing, [verified(paris_candidate())]).skipped


def test_alias_city_within_25_km_is_the_same_satellite(satellites_text: str) -> None:
    near = GeoHit(PARIS_HIT.lat + 0.05, PARIS_HIT.lng, "Paris, France", "nominatim")
    page = "NeurIPS 2026 in Ville de Paris, December 9-13, 2026."
    raw = paris_candidate(
        city=ev("Ville de Paris", PARIS_URL + "x", "NeurIPS 2026 in Ville de Paris"),
        start=ev("2026-12-09", PARIS_URL + "x", "December 9-13, 2026"),
    )
    fetcher = FakeFetcher({**PAGES, PARIS_URL + "x": page})
    c = check_candidate(raw, CONF, fetcher.get, FakeGeocoder({"ville de paris|france": near}))
    plan = plan_changes(load_satellites(satellites_text), [c], PARIS_COORDS)
    assert not plan.additions
    assert plan.skipped[0][2] == "neurips26-paris"
    # Without coordinates for the existing entry, the different name is a new city.
    assert plan_changes(load_satellites(satellites_text), [c]).additions


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
        end=ev("2026-12-14", PROGRAM_URL, "Workshops run until December 14, 2026"),
    )
    plan = plan_changes(
        load_satellites(satellites_text),
        [verified(raw_update), verified(atlanta_candidate())],
        PARIS_COORDS,
    )
    assert len(plan.applied) == 1 and len(plan.additions) == 1
    new = apply_plan(satellites_text, plan)

    old_lines = satellites_text.splitlines()
    new_lines = new.splitlines()
    # Header comments untouched.
    assert new_lines[:7] == old_lines[:7]
    # Only additions in the diff, except the one changed `end` value.
    diff = unified_diff(satellites_text, new)
    removed = [
        line for line in diff.splitlines() if line.startswith("-") and not line.startswith("---")
    ]
    assert removed == ["-  end: '2026-12-13'"]
    # Every original entry and key is still there.
    old, after = load_satellites(satellites_text), load_satellites(new)
    after_by_id = {s["id"]: s for s in after}
    for s in old:
        assert set(s) <= set(after_by_id[s["id"]])
    assert [s["id"] for s in after][: len(old)] == [s["id"] for s in old]
    paris = after_by_id["neurips26-paris"]
    assert paris["end"] == "2026-12-14" and paris["sources"][-1] == PROGRAM_URL
    # Blank line between entries kept; the new source sits right after the old ones.
    assert "    - https://blog.neurips.cc/2026/04/22/neurips-newsletter-april-2026/\n" in new
    assert f"    - {PROGRAM_URL}\n\n- id: neurips26-atlanta\n" in new
    atl = after_by_id["neurips26-atlanta"]
    assert atl["start"] == "2026-12-09" and atl["official"] is True
    assert "  start: '2026-12-09'\n" in new
    assert UNVERIFIED_COMMENT not in new  # every Atlanta field had evidence
    assert new.count("\n\n- id: ") == 4  # every entry preceded by one blank line
    assert "\n\n\n" not in new


def test_output_parses_as_plain_yaml(satellites_text: str) -> None:
    plan = plan_changes(load_satellites(satellites_text), [verified(atlanta_candidate())])
    parsed = YAML(typ="safe").load(apply_plan(satellites_text, plan))
    assert parsed[-1]["id"] == "neurips26-atlanta"
    assert isinstance(parsed[-1]["start"], str)
    assert len(parsed) == 4
