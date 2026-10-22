import httpx
import pytest

from discover.geo import Geocoder, cached_hit, geocache_key, haversine_km

CACHE = {
    "paris|france": {"display_name": "Paris, Ile-de-France, France", "lat": 48.85, "lng": 2.35}
}


def nominatim(results: object, status: int = 200) -> tuple[httpx.Client, list[httpx.Request]]:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(status, json=results)

    return httpx.Client(transport=httpx.MockTransport(handler)), seen


def result(country: str, kind: str = "city", name: str = "Atlanta") -> dict[str, object]:
    return {
        "lat": "33.75",
        "lon": "-84.39",
        "display_name": f"{name}, {country}",
        "addresstype": kind,
        "address": {"country": country},
    }


def test_key_matches_the_pipeline() -> None:
    assert geocache_key("  Zürich ", "Switzerland") == "zurich|switzerland"


def test_cache_hit_needs_no_network() -> None:
    client, seen = nominatim([])
    hit = Geocoder(CACHE, client)("Paris", "France")
    assert hit is not None and hit.source == "geocache" and hit.english_name == "Paris"
    assert seen == []
    assert cached_hit(CACHE, "Lyon", "France") is None


def test_nominatim_hit_must_be_a_settlement_in_that_country() -> None:
    client, seen = nominatim([result("Canada"), result("United States", "county"),
                              result("United States")])  # fmt: skip
    hit = Geocoder({}, client, sleep=lambda s: None)("Atlanta", "United States")
    assert hit is not None and hit.source == "nominatim" and hit.lat == pytest.approx(33.75)
    params = seen[0].url.params
    assert params["q"] == "Atlanta, United States" and params["accept-language"] == "en"
    assert seen[0].headers["user-agent"].startswith("confmaps.org discovery")


@pytest.mark.parametrize(
    ("results", "status"),
    [([result("Canada")], 200), ([result("United States", "state")], 200), ([], 503),
     ({"error": "x"}, 200), ([{"lat": "x", "lon": "y", "display_name": "z", "addresstype":
     "city", "address": {"country": "United States"}}], 200)],
)  # fmt: skip
def test_nominatim_misses_and_errors_give_none(results: object, status: int) -> None:
    client, _ = nominatim(results, status)
    assert Geocoder({}, client, sleep=lambda s: None)("Atlanta", "United States") is None


def test_rate_limit_and_memo() -> None:
    client, seen = nominatim([result("United States")])
    clock = iter([0.0, 0.0, 0.5, 0.5])
    sleeps: list[float] = []
    geocode = Geocoder({}, client, sleep=sleeps.append, now=lambda: next(clock))
    geocode("Atlanta", "United States")
    geocode("Atlanta", "United States")  # memoized: no request
    geocode("Austin", "United States")
    assert len(seen) == 2
    assert sleeps == [pytest.approx(0.6)]


def test_haversine() -> None:
    assert haversine_km((48.8566, 2.3522), (51.5074, -0.1278)) == pytest.approx(344, abs=2)
