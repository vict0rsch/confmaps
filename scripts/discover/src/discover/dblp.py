"""dblp pages read through dblp's SPARQL endpoint (its HTML pages serve a bot check).

dblp's table-of-contents and series index pages list proceedings volumes whose titles state the
edition, often with its city, country and dates ("Proceedings of the 36th International
Conference on Machine Learning, ICML 2019, 9-15 June 2019, Long Beach, California, USA").
:class:`DblpTitles` returns those titles from dblp's open SPARQL endpoint (CC0 metadata): the
titles of a series' target years are listed in the past-mode prompt with their page, and a
quote copied from such a title is checked when the page itself shows only the bot check.
"""

import json
import math
import os
import re
import time
from collections.abc import Callable
from datetime import date, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import httpx

from .geo import USER_AGENT
from .verify import Page, normalize

SPARQL_URL = "https://sparql.dblp.org/sparql"
TIMEOUT_S = 90.0  # listing a series' volumes often takes 10-45 s
MIN_INTERVAL_S = 1.0  # no documented limit: stay gentle
# Listings saved on disk are reused this long: past volumes rarely change, new ones appear late.
CACHE_DAYS = 30
HOSTS = {"dblp.org", "www.dblp.org", "dblp.uni-trier.de", "www.dblp.uni-trier.de"}
# Only these characters ever reach the query: keys and page names are checked first.
INDEX_RE = re.compile(r"/db/conf/([a-z0-9_-]+)(?:/|/index\.html)?")
TOC_RE = re.compile(r"/db/conf/([a-z0-9_-]+)/([a-z0-9_-]+)\.html")
KEY_RE = re.compile(r"[a-z0-9_-]+")
# A volume's table of contents as dblp records it (no ``.html``), turned into the page URL.
TOC_PAGE_RE = re.compile(r"https://dblp\.org/db/conf/[a-z0-9_-]+/[a-z0-9_-]+")
YEAR_RE = re.compile(r"(?<!\d)\d{4}(?!\d)")
# Volumes listed per target year: series such as ECCV publish many volumes a year, and every
# year of a batch should get titles.
MAX_VOLUMES_PER_YEAR = 2
VIA_SPARQL = "dblp's SPARQL data (proceedings titles only)"
QUERY = """PREFIX dblp: <https://dblp.org/rdf/schema#>
SELECT DISTINCT ?title ?year WHERE {{
  ?volume {match} ;
    dblp:bibtexType <http://purl.org/net/nknouf/ns/bibtex#Proceedings> ;
    dblp:title ?title .
  OPTIONAL {{ ?volume dblp:yearOfPublication ?year }}
}}"""
EDITIONS_QUERY = """PREFIX dblp: <https://dblp.org/rdf/schema#>
SELECT DISTINCT ?toc ?title ?year WHERE {{
  ?volume dblp:publishedInStream <https://dblp.org/streams/conf/{key}> ;
    dblp:bibtexType <http://purl.org/net/nknouf/ns/bibtex#Proceedings> ;
    dblp:title ?title ;
    dblp:listedOnTocPage ?toc .
  OPTIONAL {{ ?volume dblp:yearOfPublication ?year }}
}}"""
# Series keys (``seriesOf(title)``) whose dblp stream has another key, checked against dblp's
# stream labels (October 2026). Any other series is looked up under its own key; a series with
# no stream there gets no titles.
STREAMS = {
    "3dv": "3dim",
    "aamas": "ifaamas",  # conf/aamas is ALAMAS
    "acm-mm": "mm",
    "clear": "clear2",  # conf/clear is Classification of Events, Activities and Relationships
    "ecml-pkdd": "pkdd",
    "facct": "fat",
    "fg": "fgr",  # conf/fg is Formal Grammar
    "iccc": "icccrea",  # conf/iccc is Computer Communication
    "icme": "icmcs",
    "icmr": "mir",
    "ijcnlp-aacl": "aacl",
    "iswc": "semweb",  # conf/iswc is Wearable Computers
    "neurips": "nips",
    "ruleml-rr": "rulemlrr",
    "sem": "starsem",
    "siggraph-asia": "siggrapha",
}


def sparql_query(url: str) -> str | None:
    """The query for the proceedings titles that a dblp page lists, or ``None`` for any other URL.

    A series index (``/db/conf/<key>/``) lists every volume of the series; a table of contents
    (``/db/conf/<key>/<page>.html``) the volumes on that page, which dblp records without
    ``.html``.

    Examples
    --------
    .. code-block:: python

        sparql_query("https://dblp.org/db/conf/icml/icml2019.html")
        # "...?volume dblp:listedOnTocPage <https://dblp.org/db/conf/icml/icml2019> ;..."
    """
    parts = urlsplit(url)
    if parts.scheme != "https" or parts.netloc.lower() not in HOSTS:
        return None
    if m := INDEX_RE.fullmatch(parts.path):
        match = f"dblp:publishedInStream <https://dblp.org/streams/conf/{m[1]}>"
    elif m := TOC_RE.fullmatch(parts.path):
        match = f"dblp:listedOnTocPage <https://dblp.org/db/conf/{m[1]}/{m[2]}>"
    else:
        return None
    return QUERY.format(match=match)


def held_in(title: str, year_of_publication: str, years: list[int]) -> bool:
    """Whether a proceedings volume belongs to one of ``years``.

    The years the title states decide; the year of publication counts only for a title that
    states none (NeurIPS 1987 was published in 1988, and its title says 1987).

    Examples
    --------
    .. code-block:: python

        held_in("Neural Information Processing Systems, Denver, 1987", "1988", [1988])  # False
    """
    stated = {int(y) for y in YEAR_RE.findall(title)}
    if stated:
        return bool(stated & set(years))
    return year_of_publication.isdigit() and int(year_of_publication) in years


def edition_year_is(title: str, year_of_publication: str, year: int) -> bool:
    """Whether a proceedings title is evidence for the edition of ``year`` (verification).

    Stricter than :func:`held_in`: the title must state that year and no other ("ICPR 2020,
    January 10-15, 2021" is evidence for neither), or state no year with a matching year of
    publication.

    Examples
    --------
    .. code-block:: python

        edition_year_is("ICML 2019, 9-15 June 2019, Long Beach", "2019", 2019)  # True
    """
    stated = {int(y) for y in YEAR_RE.findall(title)}
    if stated:
        return stated == {year}
    return year_of_publication == str(year)


def default_cache_path() -> Path:
    """Where the dblp listings are saved between runs (outside the repository).

    Examples
    --------
    .. code-block:: python

        default_cache_path()  # ~/.cache/confmaps-discover/dblp-volumes.json
    """
    base = os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache"
    return Path(base) / "confmaps-discover" / "dblp-volumes.json"


def _page(rows: list[tuple[str, str]]) -> Page | None:
    """The :class:`Page` of ``(title, year of publication)`` rows, or ``None`` if there are none."""
    if not rows:
        return None
    segments = tuple(sorted({(normalize(title), year) for title, year in rows}))
    text = "\n".join(title for title, _ in segments)
    return Page(text, via=VIA_SPARQL, segments=segments)


def _stream_key(series: str) -> str | None:
    """The series' dblp stream key, or ``None`` if it cannot be put in a query."""
    key = STREAMS.get(series, series)
    return key if KEY_RE.fullmatch(key) else None


class DblpTitles:
    """``url -> Page | None``: the proceedings titles a dblp page lists, one per line.

    The page records :data:`VIA_SPARQL` in ``via`` and each ``(normalized title, year of
    publication)`` in ``segments``: a quote must fit inside one title, of the edition's year
    (``past_verify``). Another URL, a page with no proceedings volume, or a network or parsing
    problem gives ``None``.

    Examples
    --------
    .. code-block:: python

        DblpTitles()("https://dblp.org/db/conf/icml/icml2019.html").text
        # "proceedings of the 36th international conference on machine learning, icml 2019, ..."
    """

    def __init__(
        self,
        client: httpx.Client | None = None,
        sleep: Callable[[float], None] = time.sleep,
        now: Callable[[], float] = time.monotonic,
        cache: Path | None = None,
        today: Callable[[], date] = date.today,
    ) -> None:
        self.client = client or httpx.Client(timeout=TIMEOUT_S, trust_env=False)
        self.sleep = sleep
        self.now = now
        self.last = -math.inf
        self.results: dict[str, Page | None] = {}
        self.volumes: dict[str, list[tuple[str, str, str]]] = {}
        self.failed: set[str] = set()  # stream keys whose listing query failed in this run
        self.cache, self.today = cache, today
        self.fetched: dict[str, str] = {}  # stream key → ISO date of its listing
        self._load_cache()

    def _load_cache(self) -> None:
        """Read the fresh listings of :attr:`cache`; a missing or unreadable file is ignored."""
        if self.cache is None or not self.cache.exists():
            return
        try:
            streams = json.loads(self.cache.read_text())["streams"]
            oldest = self.today() - timedelta(days=CACHE_DAYS)
            for key, entry in streams.items():
                fetched = date.fromisoformat(entry["fetched"])
                rows = [tuple(map(str, r)) for r in entry["volumes"]]
                # The file is outside the repository: keep only what a fresh query could give.
                valid = all(
                    len(r) == 3 and r[0].endswith(".html") and TOC_PAGE_RE.fullmatch(r[0][:-5])
                    for r in rows
                )
                if KEY_RE.fullmatch(key) and fetched >= oldest and valid:
                    self.volumes[key], self.fetched[key] = rows, entry["fetched"]
        except (OSError, ValueError, KeyError, TypeError, AttributeError):
            self.volumes.clear()
            self.fetched.clear()

    def save_cache(self) -> None:
        """Write the listings of this run and the fresh cached ones to :attr:`cache`."""
        if self.cache is None:
            return
        streams: dict[str, Any] = {
            key: {"fetched": self.fetched[key], "volumes": [list(v) for v in volumes]}
            for key, volumes in sorted(self.volumes.items())
            if key in self.fetched
        }
        self.cache.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.cache.with_suffix(".tmp")
        tmp.write_text(json.dumps({"streams": streams}, ensure_ascii=False) + "\n")
        tmp.replace(self.cache)

    def is_cached(self, series: str) -> bool:
        """Whether the series' volumes are already listed (from the cache or earlier)."""
        return _stream_key(series) in self.volumes

    def _select(self, query: str) -> list[dict[str, str]] | None:
        """Rows (variable → value) of a SELECT query; ``None`` on any problem."""
        wait = self.last + MIN_INTERVAL_S - self.now()
        if wait > 0:
            self.sleep(wait)
        self.last = self.now()
        try:
            response = self.client.get(
                SPARQL_URL,
                params={"query": query},
                headers={"User-Agent": USER_AGENT, "Accept": "application/sparql-results+json"},
            )
            response.raise_for_status()
            bindings = response.json()["results"]["bindings"]
            return [{k: str(v["value"]) for k, v in b.items()} for b in bindings]
        except (httpx.HTTPError, ValueError, KeyError, TypeError, AttributeError):
            return None

    def _titles(self, query: str) -> Page | None:
        rows = [(r["title"], r.get("year", "")) for r in self._select(query) or [] if "title" in r]
        return _page(rows)

    def _listed(self, url: str) -> Page | None:
        """The page's titles from its series' listing (:meth:`list_volumes`), without a query;
        ``None`` when that listing is missing or failed, or does not hold the page."""
        path = urlsplit(url).path
        if m := INDEX_RE.fullmatch(path):
            key, toc = m[1], None
        elif m := TOC_RE.fullmatch(path):
            key, toc = m[1], f"https://dblp.org/db/conf/{m[1]}/{m[2]}.html"
        else:
            return None
        # A series index lists every volume of its stream; a table of contents, those on it.
        return _page([(t, y) for u, t, y in self.volumes.get(key, []) if toc in (None, u)])

    def editions(self, series: str, years: list[int]) -> list[tuple[str, str]]:
        """``(table-of-contents page URL, title)`` of the series' proceedings volumes held in
        ``years`` (:func:`held_in`): at most :data:`MAX_VOLUMES_PER_YEAR` per year, by URL
        within a year, years in order; a volume of several of those years is listed once.
        ``[]`` for a series with no stream or on failure.

        Examples
        --------
        .. code-block:: python

            DblpTitles().editions("icml", [2019])
            # [("https://dblp.org/db/conf/icml/icml2019.html", "Proceedings of the 36th ...")]
        """
        key = _stream_key(series)
        if key is None or self.list_volumes(series) is None:
            return []
        # One year of publication per volume, whatever the row order: the smallest.
        first: dict[tuple[str, str], str] = {}
        for u, t, year in sorted(self.volumes[key]):
            first.setdefault((u, t), year)
        volumes = sorted(first.items())
        counts = dict.fromkeys(years, 0)
        picked: list[tuple[str, str]] = []
        for target in sorted(years):
            for volume, year in volumes:
                # A volume takes a place in every target year it belongs to: it is added only
                # while each of those years has room.
                matched = [y for y in counts if held_in(volume[1], year, [y])]
                if target not in matched or volume in picked:
                    continue
                if all(counts[y] < MAX_VOLUMES_PER_YEAR for y in matched):
                    picked.append(volume)
                    for y in matched:
                        counts[y] += 1
        return picked

    def list_volumes(self, series: str, retry: bool = False) -> int | None:
        """Query the series' proceedings volumes once (unless cached): how many it has, or
        ``None`` when the query failed (a timeout, an HTTP error). A series with no stream
        has 0. ``retry`` queries again a series whose query failed.

        Examples
        --------
        .. code-block:: python

            DblpTitles().list_volumes("icml")  # 43
        """
        key = _stream_key(series)
        if key is None:
            return 0
        if retry and key in self.failed:
            self.failed.discard(key)
            self.volumes.pop(key, None)
        if key not in self.volumes:
            rows = self._select(EDITIONS_QUERY.format(key=key))
            if rows is None:
                self.failed.add(key)
            else:
                self.fetched[key] = self.today().isoformat()
            self.volumes[key] = [
                (f"{r['toc']}.html", r["title"], r.get("year", ""))
                for r in rows or []
                if "title" in r and TOC_PAGE_RE.fullmatch(r.get("toc", ""))
            ]
        return None if key in self.failed else len(self.volumes[key])

    def __call__(self, url: str) -> Page | None:
        query = sparql_query(url)
        if query is None:
            return None
        if query not in self.results:
            self.results[query] = self._listed(url) or self._titles(query)
        return self.results[query]
