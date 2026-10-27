"""City geocoding for candidate checks: ``data/geocache.json`` first, then Nominatim.

Used to derive/confirm a candidate's country from its verified city, to dedupe cities written
differently (aliases, non-Latin scripts) by coordinates, to build ids for non-Latin city names,
and to show the resolved coordinates in the PR. The map's coordinates still come from the data
pipeline (``pnpm data:build``, ``scripts/lib/geocode.ts``), which writes ``data/geocache.json``.
"""

import math
import re
import time
import unicodedata
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import httpx

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "confmaps.org discovery (+https://confmaps.org)"
MIN_INTERVAL_S = 1.1  # Nominatim usage policy: at most 1 request per second
TIMEOUT_S = 20.0
SETTLEMENTS = {"city", "town", "village", "hamlet", "municipality"}


def _norm(s: str) -> str:
    decomposed = unicodedata.normalize("NFKD", s)
    stripped = "".join(c for c in decomposed if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", stripped.lower()).strip()


def geocache_key(city: str, country: str) -> str:
    """Same key as ``geocacheKey`` in ``scripts/lib/geocode.ts``: ``"city|country"`` normalized.

    Examples
    --------
    .. code-block:: python

        geocache_key("Zürich", "Switzerland")  # "zurich|switzerland"
    """
    return f"{_norm(city)}|{_norm(country)}"


@dataclass(frozen=True)
class GeoHit:
    lat: float
    lng: float
    display_name: str
    source: str  # "geocache" | "nominatim"

    @property
    def english_name(self) -> str:
        """First component of the display name (Nominatim is queried in English)."""
        return self.display_name.split(",")[0].strip()


def haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Great-circle distance in km between ``(lat, lng)`` points."""
    rad = math.pi / 180
    h = (
        math.sin((b[0] - a[0]) * rad / 2) ** 2
        + math.cos(a[0] * rad) * math.cos(b[0] * rad) * math.sin((b[1] - a[1]) * rad / 2) ** 2
    )
    return 2 * 6371 * math.asin(math.sqrt(h))


def cached_hit(geocache: dict[str, Any], city: str, country: str) -> GeoHit | None:
    """The ``data/geocache.json`` entry for a city, without any network call."""
    entry = geocache.get(geocache_key(city, country))
    if not isinstance(entry, dict):
        return None
    try:
        return GeoHit(
            float(entry["lat"]), float(entry["lng"]), str(entry["display_name"]), "geocache"
        )
    except (KeyError, TypeError, ValueError):
        return None


class Geocoder:
    """``(city, country) -> GeoHit | None``; a hit means the city exists in that country.

    A cache entry for ``"city|country"`` counts as a hit (the pipeline geocoded it restricted to
    that country). Otherwise Nominatim is asked for ``"city, country"`` in English and the first
    settlement whose address country matches ``country`` is used, else the first hit in that
    country (as ``scripts/lib/geocode.ts`` does). Network or parsing problems
    give ``None``: the caller treats the city as unconfirmed, never as an error for the run.

    Examples
    --------
    .. code-block:: python

        geocode = Geocoder(json.loads(Path("data/geocache.json").read_text()))
        hit = geocode("Atlanta", "United States")  # GeoHit(33.75, -84.39, "Atlanta, ...")
    """

    def __init__(
        self,
        geocache: dict[str, Any],
        client: httpx.Client | None = None,
        sleep: Callable[[float], None] = time.sleep,
        now: Callable[[], float] = time.monotonic,
    ) -> None:
        self.geocache = geocache
        self.client = client or httpx.Client(timeout=TIMEOUT_S, trust_env=False)
        self.sleep = sleep
        self.now = now
        self.last = -math.inf
        self.memo: dict[str, GeoHit | None] = {}

    def __call__(self, city: str, country: str) -> GeoHit | None:
        key = geocache_key(city, country)
        if key not in self.memo:
            self.memo[key] = cached_hit(self.geocache, city, country) or self._nominatim(
                city, country
            )
        return self.memo[key]

    def _nominatim(self, city: str, country: str) -> GeoHit | None:
        wait = self.last + MIN_INTERVAL_S - self.now()
        if wait > 0:
            self.sleep(wait)
        self.last = self.now()
        params = {
            "q": f"{city}, {country}",
            "format": "jsonv2",
            "limit": "5",
            "addressdetails": "1",
            "accept-language": "en",
        }
        try:
            response = self.client.get(
                NOMINATIM_URL, params=params, headers={"User-Agent": USER_AGENT}
            )
            response.raise_for_status()
            results = response.json()
        except (httpx.HTTPError, ValueError):
            return None
        if not isinstance(results, list):
            return None
        in_country = [
            r
            for r in results
            if isinstance(r, dict)
            and _norm(str((r.get("address") or {}).get("country", ""))) == _norm(country)
        ]
        if not in_country:
            return None
        best = next(
            (r for r in in_country if {r.get("addresstype"), r.get("type")} & SETTLEMENTS),
            in_country[0],
        )
        try:
            return GeoHit(
                float(best["lat"]), float(best["lon"]), str(best["display_name"]), "nominatim"
            )
        except (KeyError, TypeError, ValueError):
            return None
