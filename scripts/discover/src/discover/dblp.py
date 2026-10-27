"""dblp pages read through dblp's SPARQL endpoint (its HTML pages serve a bot check).

dblp's table-of-contents and series index pages list proceedings volumes whose titles state the
edition, often with its city, country and dates ("Proceedings of the 36th International
Conference on Machine Learning, ICML 2019, 9-15 June 2019, Long Beach, California, USA").
:class:`DblpTitles` returns those titles from dblp's open SPARQL endpoint (CC0 metadata): the
titles of a series' target years are listed in the past-mode prompt with their page, and a
quote copied from such a title is checked when the page itself shows only the bot check.
"""

import math
import re
import time
from collections.abc import Callable
from urllib.parse import urlsplit

import httpx

from .geo import USER_AGENT
from .verify import Page, normalize

SPARQL_URL = "https://sparql.dblp.org/sparql"
TIMEOUT_S = 20.0
MIN_INTERVAL_S = 1.0  # no documented limit: stay gentle
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
    ) -> None:
        self.client = client or httpx.Client(timeout=TIMEOUT_S, trust_env=False)
        self.sleep = sleep
        self.now = now
        self.last = -math.inf
        self.results: dict[str, Page | None] = {}
        self.volumes: dict[str, list[tuple[str, str, str]]] = {}

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
        rows = [r for r in self._select(query) or [] if "title" in r]
        if not rows:
            return None
        segments = tuple(sorted({(normalize(r["title"]), r.get("year", "")) for r in rows}))
        text = "\n".join(title for title, _ in segments)
        return Page(text, via=VIA_SPARQL, segments=segments)

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
        key = STREAMS.get(series, series)
        if not KEY_RE.fullmatch(key):
            return []
        if key not in self.volumes:
            rows = self._select(EDITIONS_QUERY.format(key=key)) or []
            self.volumes[key] = [
                (f"{r['toc']}.html", r["title"], r.get("year", ""))
                for r in rows
                if "title" in r and TOC_PAGE_RE.fullmatch(r.get("toc", ""))
            ]
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

    def __call__(self, url: str) -> Page | None:
        query = sparql_query(url)
        if query is None:
            return None
        if query not in self.results:
            self.results[query] = self._titles(query)
        return self.results[query]
