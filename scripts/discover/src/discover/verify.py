"""Deterministic evidence checks on model candidates.

Every field comes with ``{value, source_url, quote}``. The page at ``source_url`` is downloaded
here, independently of the model, and each field is checked by a rule that ties the value to
the evidence:

- ``name``, ``city``, ``venue``: the quote is on the page and contains the value.
- ``start``, ``end``: the quote is on the page and contains the date's day, month and year.
- ``country``: as for strings, or derived: the verified city geocodes in that country.
- ``link``: an ``href`` of the source page, or on the same site (registrable domain).
- ``official``, ``presents_papers``, ``access``, ``notes``: the (longer) quote is on the page,
  but whether it supports the value is the model's judgement. These are labelled as such and
  never overwrite curated entries (see ``merge``).

Fields that fail are dropped; candidates missing a required field afterwards are dropped.
"""

import html
import ipaddress
import re
import socket
import time
import unicodedata
import zlib
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date, timedelta
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urljoin, urlsplit, urlunsplit

import httpx

from .agent import ACCESS_VALUES, FIELD_SCHEMAS, REQUIRED_FIELDS
from .geo import GeoHit

USER_AGENT = "confmaps.org discovery (+https://confmaps.org)"
TIMEOUT_S = 15.0  # per connect / read operation
FETCH_DEADLINE_S = 30.0  # wall clock per page, redirects included
MAX_BYTES = 5_000_000  # pages are truncated to this size before matching
MAX_FETCHES_PER_CONFERENCE = 25
MIN_QUOTE_CHARS = 12
MIN_QUOTE_WORDS = 2
MIN_JUDGEMENT_QUOTE_CHARS = 20
PLAUSIBLE_DAYS = 60  # a satellite starts/ends within this many days of its parent edition

STRING_FIELDS = {"name", "city", "venue", "country"}
DATE_FIELDS = {"start", "end"}
JUDGEMENT_FIELDS = {"official", "presents_papers", "access", "notes"}

# Check kinds, shown per field in the PR.
VALUE_IN_QUOTE = "quote on page, value in quote"
DATE_IN_QUOTE = "quote on page, date in quote"
LINKED = "linked from source page"
SAME_SITE = "same site as source page"
DERIVED = "derived from geocoded city"
JUDGEMENT = "model judgement (quote shown)"
VERIFIED_KINDS = {VALUE_IN_QUOTE, DATE_IN_QUOTE, LINKED, SAME_SITE, DERIVED}

_DASHES = dict.fromkeys(map(ord, "\u2010\u2011\u2012\u2013\u2014\u2015\u2212"), "-")
_QUOTES = {ord(c): "'" for c in "\u2018\u2019\u201a\u201b\u2032"} | {
    ord(c): '"' for c in "\u201c\u201d\u201e\u201f\u2033"
}
_INVISIBLE = dict.fromkeys(map(ord, "\u00ad\u200b\u200c\u200d\u2060\ufeff"))
_BLOCK_TAGS = {
    "address", "article", "aside", "blockquote", "br", "dd", "div", "dl", "dt", "figcaption",
    "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "nav", "ol",
    "p", "pre", "section", "table", "td", "th", "title", "tr", "ul",
}  # fmt: skip
# `head` is not skipped: with an unclosed <head>, skipping it would drop the whole body.
_SKIP_TAGS = {"script", "style", "noscript", "template", "svg"}


def normalize(text: str) -> str:
    """Normalize text for quote matching.

    Unescapes HTML entities, applies NFKC (non-breaking spaces become spaces), unifies dashes
    and curly quotes, removes invisible characters, case-folds and collapses whitespace.

    Parameters
    ----------
    text : str
        Page text or quote.

    Returns
    -------
    str
        Normalized text.

    Examples
    --------
    .. code-block:: python

        normalize("Dec 9–13,  2026") == "dec 9-13, 2026"
    """
    text = unicodedata.normalize("NFKC", html.unescape(text))
    text = text.translate(_DASHES).translate(_QUOTES).translate(_INVISIBLE)
    return re.sub(r"\s+", " ", text.casefold()).strip()


def _fold(text: str) -> str:
    """:func:`normalize` without diacritics (``"Zürich"`` matches ``"Zurich"``)."""
    decomposed = unicodedata.normalize("NFKD", normalize(text))
    return "".join(c for c in decomposed if not unicodedata.combining(c))


class _TextExtractor(HTMLParser):
    """Visible text and link targets of an HTML page; block-level tags become spaces."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.hrefs: list[str] = []
        self.skip_depth = 0
        self.title: list[str] = []
        self.in_title = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "title":
            self.in_title = True
        elif tag in _SKIP_TAGS:
            self.skip_depth += 1
        if tag in ("a", "area"):
            self.hrefs += [v for k, v in attrs if k == "href" and v]
        if tag in _BLOCK_TAGS:
            self.parts.append(" ")

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self.in_title = False
        elif tag in _SKIP_TAGS and self.skip_depth:
            self.skip_depth -= 1
        if tag in _BLOCK_TAGS:
            self.parts.append(" ")

    def handle_data(self, data: str) -> None:
        if self.in_title:
            self.title.append(data)
        elif not self.skip_depth:
            self.parts.append(data)


def _parse_html(markup: str) -> tuple[str, list[str]]:
    parser = _TextExtractor()
    parser.feed(markup)
    parser.close()
    return " ".join(["".join(parser.title), "".join(parser.parts)]), parser.hrefs


def html_to_text(markup: str) -> str:
    """Visible text (plus ``<title>``) of an HTML document, without scripts and styles.

    Examples
    --------
    .. code-block:: python

        html_to_text("<p>Dec <b>9</b>&ndash;13</p><script>x()</script>")  # "Dec 9–13"
    """
    return _parse_html(markup)[0]


def norm_city(city: str) -> str:
    """Dedup key for a city: no diacritics, case-folded, single spaces.

    Examples
    --------
    .. code-block:: python

        norm_city("  Zürich ") == norm_city("zurich")  # True
    """
    decomposed = unicodedata.normalize("NFKD", city)
    stripped = "".join(c for c in decomposed if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", stripped.casefold()).strip()


# ---------------------------------------------------------------------------
# URL safety (SSRF) and canonical URLs
# ---------------------------------------------------------------------------

# Hostnames whose last label is numeric are IPv4 to URL parsers and resolvers ("2130706433",
# "0x7f.1", "127.1"); only canonical dotted quads are accepted.
_NUMERIC_LABEL = re.compile(r"^(0x[0-9a-f]*|[0-9]+)$")
DEFAULT_PORTS = {"http": 80, "https": 443}
MAX_REDIRECTS = 5
# Not covered (or not on every Python version) by the ipaddress flags: deprecated IPv6
# site-local and the deprecated 6to4 relay anycast range.
_DENIED_NETWORKS = [ipaddress.ip_network("fec0::/10"), ipaddress.ip_network("192.88.99.0/24")]

Resolver = Callable[[str, int], list[str]]


class UnsafeURL(Exception):
    """A URL that must not be fetched."""


def _ip_problem(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> str | None:
    """Why an address is off-limits (anything not globally routable), or ``None``."""
    mapped = getattr(ip, "ipv4_mapped", None)
    if mapped is not None:
        return _ip_problem(mapped)
    for net in _DENIED_NETWORKS:
        if ip.version == net.version and ip in net:
            return f"{ip} is in {net}"
    for flag in ("is_loopback", "is_private", "is_link_local", "is_reserved", "is_multicast",
                 "is_unspecified"):  # fmt: skip
        if getattr(ip, flag):
            return f"{ip} is {flag[3:].replace('_', '-')}"
    if not ip.is_global:
        return f"{ip} is not a public address"
    return None


def _ascii_host(host: str) -> str:
    """IDNA-encoded, lower-case hostname. Raises ``UnicodeError`` for invalid names.

    The round trip also rejects what resolvers and httpx would choke on later: empty or
    over-long labels and invalid ``xn--`` labels.
    """
    host = host.rstrip(".").lower()
    if ":" in host:  # IPv6 literal
        return host
    ascii_host = host.encode("idna").decode("ascii")
    ascii_host.encode("ascii").decode("idna")
    return ascii_host


def unsafe_url_reason(url: str) -> str | None:
    """Static checks (no DNS): why ``url`` must not be fetched, or ``None``.

    Rejects whitespace and control characters, non-http(s) schemes, ports other than 80/443,
    credentials in the URL, invalid (non-IDNA) or local hostnames, non-canonical numeric hosts
    and literal non-public IP addresses.

    Examples
    --------
    .. code-block:: python

        unsafe_url_reason("http://169.254.169.254/latest/")  # "169.254.169.254 is link-local"
        unsafe_url_reason("https://neurips.cc/")  # None
    """
    if any(c.isspace() or unicodedata.category(c).startswith("C") for c in url):
        return "whitespace or control characters in URL"
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError:
        return "malformed URL"
    if parts.scheme not in DEFAULT_PORTS or not parts.hostname:
        return "not an http(s) URL"
    if port not in (None, 80, 443):
        return f"port {port} not allowed"
    if parts.username is not None or parts.password is not None:
        return "credentials in URL"
    try:
        host = _ascii_host(parts.hostname)
    except UnicodeError:
        return "invalid hostname"
    if host == "localhost" or host.endswith((".localhost", ".local", ".internal")):
        return "local hostname"
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        if _NUMERIC_LABEL.match(host.rsplit(".", 1)[-1]):
            return f"non-canonical numeric host {host!r}"
        return None
    return _ip_problem(ip)


def canonical_url(url: str) -> str:
    """Canonical form of a URL that passed :func:`unsafe_url_reason`.

    Lower-case scheme and IDNA host, no default port, no fragment, ``/`` for an empty path.

    Examples
    --------
    .. code-block:: python

        canonical_url("HTTPS://Bücher.example:443#top")  # "https://xn--bcher-kva.example/"
    """
    parts = urlsplit(url)
    host = _ascii_host(parts.hostname or "")
    if ":" in host:
        host = f"[{host}]"
    port = parts.port
    netloc = host if port in (None, DEFAULT_PORTS.get(parts.scheme)) else f"{host}:{port}"
    return urlunsplit((parts.scheme.lower(), netloc, parts.path or "/", parts.query, ""))


def _link_key(url: str) -> str:
    return canonical_url(url).rstrip("/")


# Multi-label public suffixes (eTLD) common for conference sites, plus hosting platforms where
# every subdomain is a different owner. Anything else: the registrable domain is the last two
# labels. A heuristic on purpose (no network or bundled suffix list); it only decides whether
# `link` may differ from `source_url`, and the PR still shows both.
_MULTI_LABEL_SUFFIXES = {
    "ac.at", "ac.be", "ac.cn", "ac.il", "ac.in", "ac.jp", "ac.kr", "ac.nz", "ac.uk", "ac.za",
    "co.at", "co.il", "co.in", "co.jp", "co.kr", "co.nz", "co.uk", "co.za", "com.ar", "com.au",
    "com.br", "com.cn", "com.hk", "com.mx", "com.my", "com.sg", "com.tr", "com.tw", "edu.au",
    "edu.cn", "edu.hk", "edu.sg", "edu.tr", "edu.tw", "gov.uk", "ne.jp", "net.au", "or.jp",
    "org.au", "org.br", "org.cn", "org.uk", "res.in",
    "github.io", "gitlab.io", "pages.dev", "netlify.app", "vercel.app", "web.app",
    "firebaseapp.com", "herokuapp.com", "blogspot.com", "wordpress.com", "wixsite.com",
    "notion.site", "readthedocs.io",
}  # fmt: skip


def registrable_domain(host: str) -> str:
    """eTLD+1 heuristic: ``"www.cs.ox.ac.uk"`` → ``"ox.ac.uk"``, ``"a.neurips.cc"`` → ``"neurips.cc"``.

    Examples
    --------
    .. code-block:: python

        registrable_domain("2026.emnlp.org") == registrable_domain("emnlp.org")  # True
    """
    labels = _ascii_host(host).split(".")
    n = 3 if ".".join(labels[-2:]) in _MULTI_LABEL_SUFFIXES else 2
    return ".".join(labels[-n:])


def same_site(a: str, b: str) -> bool:
    """Whether two URLs share a registrable domain (IP hosts must be equal)."""
    ha, hb = urlsplit(a).hostname or "", urlsplit(b).hostname or ""
    try:
        ipaddress.ip_address(ha)
        return ha == hb
    except ValueError:
        return registrable_domain(ha) == registrable_domain(hb)


def system_resolver(host: str, port: int) -> list[str]:
    """All addresses ``host`` resolves to (A and AAAA), via ``getaddrinfo``."""
    infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    return list(dict.fromkeys(info[4][0] for info in infos))


@dataclass(frozen=True)
class Pinned:
    """A vetted fetch target: connect to one of ``ips``, present ``host`` as Host and SNI."""

    url: str  # original URL
    host: str  # IDNA (ASCII) hostname
    port: int
    ips: tuple[str, ...]  # every resolved address, all public

    @property
    def ip(self) -> str:
        return self.ips[0]


def vet_url(url: str, resolver: Resolver = system_resolver) -> Pinned:
    """Validate a URL and pin it to its resolved public addresses.

    Every address the host resolves to must be public, so a hostname pointing (even partly)
    at private, loopback, link-local or metadata addresses is rejected. The caller connects to
    the returned IPs, so a DNS change after this check (rebinding) cannot move the target.

    Raises
    ------
    UnsafeURL
        If the URL fails :func:`unsafe_url_reason` or any resolved address is not public.

    Examples
    --------
    .. code-block:: python

        pinned = vet_url("https://neurips.cc/Conferences/2026")
        pinned.ips  # e.g. ("198.202.70.92",)
    """
    reason = unsafe_url_reason(url)
    if reason:
        raise UnsafeURL(reason)
    parts = urlsplit(url)
    host = _ascii_host(parts.hostname or "")  # cannot fail after unsafe_url_reason
    port = parts.port or DEFAULT_PORTS[parts.scheme]
    try:
        addresses = resolver(host, port)
    except (OSError, UnicodeError) as e:
        raise UnsafeURL(f"cannot resolve {host}: {e}") from e
    if not addresses:
        raise UnsafeURL(f"{host} has no addresses")
    for address in addresses:
        try:
            problem = _ip_problem(ipaddress.ip_address(address.split("%")[0]))
        except ValueError:
            problem = f"unparseable address {address!r}"
        if problem:
            raise UnsafeURL(f"{host} resolves to a non-public address ({problem})")
    return Pinned(url, host, port, tuple(addresses))


def _pinned_request(client: httpx.Client, target: Pinned, ip: str) -> httpx.Request:
    """GET request that connects to ``ip`` but keeps Host header and TLS SNI/cert check."""
    parts = urlsplit(target.url)
    ip_host = f"[{ip}]" if ":" in ip else ip
    default = DEFAULT_PORTS[parts.scheme] == target.port
    netloc = ip_host if default else f"{ip_host}:{target.port}"
    host_header = target.host if default else f"{target.host}:{target.port}"
    extensions = {"sni_hostname": target.host} if parts.scheme == "https" else {}
    return client.build_request(
        "GET",
        parts._replace(netloc=netloc, fragment="").geturl(),
        # identity: no decompression bombs (compressed bodies are still inflated with a cap).
        headers={"Host": host_header, "Accept-Encoding": "identity"},
        extensions=extensions,
    )


@dataclass
class Page:
    text: str | None  # normalized page text, None when unavailable
    error: str = ""  # static reason when unavailable
    detail: str = ""  # dynamic detail (server- or exception-provided; escaped in reports)
    links: frozenset[str] = frozenset()  # canonical href targets (see _link_key)


def page_from_markup(raw: str, base_url: str, is_html: bool = True) -> Page:
    """Normalized text and link targets of a downloaded document.

    Examples
    --------
    .. code-block:: python

        page = page_from_markup('<a href="/x">X 2026</a>', "https://a.org/")
        page.links  # frozenset({"https://a.org/x"})
    """
    if not is_html:
        return Page(normalize(raw))
    text, hrefs = _parse_html(raw)
    links = set()
    for href in hrefs:
        target = urljoin(base_url, href.strip())
        if unsafe_url_reason(target) is None:
            links.add(_link_key(target))
    return Page(normalize(text), links=frozenset(links))


class PageFetcher:
    """Downloads and caches the normalized text of source pages for one run.

    Source URLs come from a model that read untrusted pages, so every hop (including
    redirects, followed manually) is vetted and pinned with :func:`vet_url`. No failure of a
    single page (bad URL, network, encoding) escapes :meth:`get`: it becomes a ``Page`` with
    ``text=None``.

    Parameters
    ----------
    client : httpx.Client, optional
        HTTP client; by default one with the identifying User-Agent, a timeout, no automatic
        redirects, no proxies from the environment and no connection reuse (each pinned
        connection gets its own TLS handshake for its hostname).
    resolver : callable, optional
        ``(host, port) -> [ip, ...]``; :func:`system_resolver` by default.
    now : callable, optional
        Monotonic clock for the per-page deadline.

    Examples
    --------
    .. code-block:: python

        fetcher = PageFetcher()
        page = fetcher.get("https://neurips.cc/Conferences/2026")
        found = page.text is not None and quote_on_page("held in Atlanta", page.text)
    """

    def __init__(
        self,
        client: httpx.Client | None = None,
        resolver: Resolver = system_resolver,
        now: Callable[[], float] = time.monotonic,
    ) -> None:
        self.client = client or httpx.Client(
            headers={"User-Agent": USER_AGENT},
            timeout=TIMEOUT_S,
            follow_redirects=False,
            trust_env=False,
            limits=httpx.Limits(max_keepalive_connections=0),
        )
        self.resolver = resolver
        self.now = now
        self.pages: dict[str, Page] = {}

    def get(self, url: str) -> Page:
        if url not in self.pages:
            self.pages[url] = self._fetch(url)
        return self.pages[url]

    def _send(self, target: Pinned) -> httpx.Response:
        """Send to each vetted address in turn until one accepts the connection."""
        error: httpx.TransportError | None = None
        for ip in target.ips:
            try:
                return self.client.send(_pinned_request(self.client, target, ip), stream=True)
            except (httpx.ConnectError, httpx.ConnectTimeout) as e:
                error = e
        assert error is not None
        raise error

    def _fetch(self, url: str) -> Page:
        deadline = self.now() + FETCH_DEADLINE_S
        try:
            for _ in range(MAX_REDIRECTS + 1):
                if self.now() > deadline:
                    return Page(None, "fetch deadline exceeded")
                target = vet_url(url, self.resolver)
                response = self._send(target)
                try:
                    if response.is_redirect:
                        url = urljoin(url, response.headers.get("location", ""))
                        continue
                    if response.status_code >= 400:
                        return Page(None, "HTTP error", str(response.status_code))
                    return self._read(response, url, deadline)
                finally:
                    response.close()
            return Page(None, "too many redirects")
        except UnsafeURL as e:
            return Page(None, "unsafe URL", str(e))
        except httpx.HTTPError as e:
            return Page(None, "fetch failed", f"{type(e).__name__}: {e}")
        except (httpx.InvalidURL, ValueError, UnicodeError) as e:
            return Page(None, "invalid URL", f"{type(e).__name__}: {e}")
        except Exception as e:  # noqa: BLE001 - one bad page must never abort the run
            return Page(None, "unexpected fetch error", f"{type(e).__name__}: {e}")

    def _read(self, response: httpx.Response, url: str, deadline: float) -> Page:
        ctype = response.headers.get("content-type", "").split(";")[0].strip().lower()
        if not (ctype.startswith("text/") or ctype in ("application/xhtml+xml", "")):
            return Page(None, "unsupported content type", ctype)
        encoding = response.headers.get("content-encoding", "").strip().lower()
        if encoding in ("", "identity"):
            inflate = None
        elif encoding in ("gzip", "x-gzip", "deflate"):
            inflate = zlib.decompressobj(zlib.MAX_WBITS | (16 if "gzip" in encoding else 0))
        else:
            return Page(None, "unsupported content encoding", encoding)
        body = bytearray()
        # Raw bytes: httpx never decodes, so the size cap holds for the decompressed text too.
        for chunk in response.iter_raw():
            if self.now() > deadline:
                return Page(None, "fetch deadline exceeded")
            if inflate is not None:
                chunk = inflate.decompress(chunk, MAX_BYTES - len(body) + 1)
            body += chunk
            if len(body) >= MAX_BYTES:
                del body[MAX_BYTES:]
                break
        try:
            raw = bytes(body).decode(response.encoding or "utf-8", errors="replace")
        except LookupError:  # unknown charset in Content-Type
            raw = bytes(body).decode("utf-8", errors="replace")
        is_html = "html" in ctype or (not ctype and "<html" in raw[:2000].lower())
        return page_from_markup(raw, str(url), is_html)


class LimitedPages:
    """``url -> Page`` that allows at most ``limit`` distinct URLs (one conference's budget).

    Examples
    --------
    .. code-block:: python

        get_page = LimitedPages(PageFetcher().get, MAX_FETCHES_PER_CONFERENCE)
    """

    def __init__(self, get_page: Callable[[str], Page], limit: int) -> None:
        self.get_page = get_page
        self.limit = limit
        self.seen: set[str] = set()

    def __call__(self, url: str) -> Page:
        if url not in self.seen and len(self.seen) >= self.limit:
            return Page(None, "fetch limit per conference reached", str(self.limit))
        self.seen.add(url)
        return self.get_page(url)


# ---------------------------------------------------------------------------
# Quote, value and date matching
# ---------------------------------------------------------------------------

_TOKEN = re.compile(r"\w+|[^\w\s]")


def _phrase_pattern(text: str) -> re.Pattern[str] | None:
    """Regex for a normalized phrase, matched on word boundaries.

    Words must be separated by whitespace on the page as in the phrase (``"9 13"`` does not
    match inside ``"19 13"`` or ``"913"``); only spacing around punctuation is free
    (``"9 – 13"`` matches ``"9–13"``).
    """
    tokens = _TOKEN.findall(text)
    if not tokens:
        return None
    parts = []
    for prev, tok in zip([None, *tokens], tokens, strict=False):
        if prev is not None:
            both_words = re.fullmatch(r"\w+", prev) and re.fullmatch(r"\w+", tok)
            parts.append(r"\s+" if both_words else r"\s*")
        parts.append(re.escape(tok))
    head = r"(?<!\w)" if re.match(r"\w", tokens[0]) else ""
    tail = r"(?!\w)" if re.match(r"\w", tokens[-1]) else ""
    return re.compile(head + "".join(parts) + tail)


def quote_long_enough(quote: str, min_chars: int = MIN_QUOTE_CHARS) -> bool:
    """At least ``min_chars`` characters and :data:`MIN_QUOTE_WORDS` words, once normalized."""
    q = normalize(quote)
    return len(q) >= min_chars and len(re.findall(r"\w+", q)) >= MIN_QUOTE_WORDS


def quote_on_page(quote: str, page_text: str) -> bool:
    """Whether a (long enough) quote appears in normalized page text, on word boundaries.

    Case, repeated whitespace, dashes and curly quotes never matter, nor does spacing around
    punctuation; words are never glued together or split.

    Examples
    --------
    .. code-block:: python

        quote_on_page("Held in ATLANTA, GA", normalize("<p>held in  Atlanta, GA</p>"))  # True
        quote_on_page("Dec 9 13", normalize("Dec 19 13"))  # False
    """
    if not quote_long_enough(quote):
        return False
    pattern = _phrase_pattern(normalize(quote))
    return bool(pattern and pattern.search(page_text))


def value_in_quote(value: str, quote: str) -> bool:
    """Whether a string value appears in its quote (word boundaries, diacritics ignored).

    Examples
    --------
    .. code-block:: python

        value_in_quote("Zürich", "held in Zurich, Switzerland")  # True
        value_in_quote("Paris", "held in Parisot")  # False
    """
    pattern = _phrase_pattern(_fold(value))
    return bool(pattern and pattern.search(_fold(quote)))


_MONTH_NAMES = [
    # English (full and abbreviated), then French, German, Spanish, Italian and Portuguese
    # full names, without diacritics.
    ("january", "jan", "janvier", "januar", "enero", "gennaio", "janeiro"),
    ("february", "feb", "fevrier", "februar", "febrero", "febbraio", "fevereiro"),
    ("march", "mar", "mars", "marz", "marzo", "marco"),
    ("april", "apr", "avril", "abril", "aprile"),
    ("may", "mai", "mayo", "maggio", "maio"),
    ("june", "jun", "juin", "juni", "junio", "giugno", "junho"),
    ("july", "jul", "juillet", "juli", "julio", "luglio", "julho"),
    ("august", "aug", "aout", "agosto"),
    ("september", "sep", "sept", "septembre", "septiembre", "settembre", "setembro"),
    ("october", "oct", "octobre", "oktober", "octubre", "ottobre", "outubro"),
    ("november", "nov", "novembre", "noviembre", "novembro"),
    ("december", "dec", "decembre", "dezember", "diciembre", "dicembre", "dezembro"),
]
MONTHS = {name: i for i, names in enumerate(_MONTH_NAMES, 1) for name in names}


def date_in_quote(iso: str, quote: str) -> bool:
    """Whether a quote states a date's year, month and day, in any common format.

    The year must appear as four digits (or ``'26``); the month as a name, an abbreviation or
    a number; the day as a number (ordinals allowed). A numeric month and the day must be two
    different numbers in the quote.

    Examples
    --------
    .. code-block:: python

        date_in_quote("2026-12-13", "December 9–13, 2026")  # True
        date_in_quote("2026-12-13", "December 9–12, 2026")  # False
        date_in_quote("2026-12-09", "09/12/2026")  # True
    """
    d = date.fromisoformat(iso)
    q = _fold(quote)
    tokens = re.findall(r"[a-z]+|\d+", q)
    has_year = str(d.year) in tokens or f"'{d.year % 100:02d}" in q
    small = [int(t) for t in tokens if t.isdigit() and len(t) <= 2]
    if not has_year or d.day not in small:
        return False
    if any(MONTHS.get(t) == d.month for t in tokens):
        return True
    needed = 2 if d.month == d.day else 1
    return small.count(d.month) >= needed


def coerce_value(name: str, value: Any) -> tuple[Any, str]:
    """Validate a field value. Returns ``(value, "")`` or ``(None, reason)``.

    Strings are stripped and single-lined; ``link`` must be a safe http(s) URL (stored in
    canonical form); dates must be valid ISO dates; booleans must be booleans; ``access`` must
    be one of the allowed values.
    """
    kind = FIELD_SCHEMAS[name]["type"]
    if kind == "boolean":
        return (value, "") if isinstance(value, bool) else (None, "not a boolean")
    if not isinstance(value, str):
        return None, "not a string"
    if name == "link":
        link = value.strip()
        if reason := unsafe_url_reason(link):
            return None, f"not a public http(s) URL: {reason}"
        return canonical_url(link), ""
    value = re.sub(r"\s+", " ", value).strip()
    if not value:
        return None, "empty"
    if name == "access" and value not in ACCESS_VALUES:
        return None, f"access must be one of {', '.join(ACCESS_VALUES)}"
    if name in DATE_FIELDS:
        try:
            date.fromisoformat(value)
        except ValueError:
            return None, "not a YYYY-MM-DD date"
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            return None, "not a YYYY-MM-DD date"
    return value, ""


# ---------------------------------------------------------------------------
# Candidate checks
# ---------------------------------------------------------------------------


@dataclass
class FieldCheck:
    field: str
    value: Any
    source_url: str
    quote: str
    kind: str = ""  # the check that passed (VALUE_IN_QUOTE, ..., JUDGEMENT); "" if failed
    reason: str = ""  # static failure reason
    detail: str = ""  # dynamic failure detail (escaped in reports)

    @property
    def kept(self) -> bool:
        return bool(self.kind)


@dataclass
class Checked:
    """A candidate after verification; ``fields`` holds only values that passed a check."""

    parent: str
    rationale: str
    fields: dict[str, Any] = field(default_factory=dict)
    kinds: dict[str, str] = field(default_factory=dict)  # field → check kind
    sources: dict[str, str] = field(default_factory=dict)  # field → canonical source URL
    checks: list[FieldCheck] = field(default_factory=list)
    geo: GeoHit | None = None
    dropped: str = ""  # non-empty (static): why the whole candidate was dropped
    dropped_detail: str = ""  # dynamic detail for `dropped` (escaped in reports)

    @property
    def label(self) -> str:
        name = next((c.value for c in self.checks if c.field == "name"), None)
        city = next((c.value for c in self.checks if c.field == "city"), None)
        return f"{name or '(unnamed)'} — {city or '(no city)'}"

    def verified(self, f: str) -> bool:
        return self.kinds.get(f) in VERIFIED_KINDS


Geocode = Callable[[str, str], GeoHit | None]


def _check_field(name: str, ev: dict[str, Any], get_page: Callable[[str], Page]) -> FieldCheck:
    url, quote = ev.get("source_url"), ev.get("quote")
    check = FieldCheck(name, ev.get("value"), str(url or ""), str(quote or ""))
    if not isinstance(url, str) or not isinstance(quote, str):
        check.reason = "malformed evidence"
        return check
    value, problem = coerce_value(name, ev.get("value"))
    if problem:
        check.reason, check.detail = "invalid value", problem
        return check
    check.value = value
    if problem := unsafe_url_reason(url):
        check.reason, check.detail = "unsafe or malformed source URL", problem
        return check
    check.source_url = canonical_url(url)
    page = get_page(check.source_url)
    if page.text is None:
        check.reason = "source page not readable"
        check.detail = f"{page.error} {page.detail}".strip()
        return check

    if name == "link":
        if _link_key(value) in page.links:
            check.kind = LINKED
        elif same_site(value, check.source_url):
            check.kind = SAME_SITE
        else:
            check.reason = "link neither on the source page nor on its site"
        return check

    min_chars = MIN_JUDGEMENT_QUOTE_CHARS if name in JUDGEMENT_FIELDS else MIN_QUOTE_CHARS
    if not quote_long_enough(quote, min_chars):
        check.reason = "quote too short"
        check.detail = f"needs {min_chars}+ characters and {MIN_QUOTE_WORDS}+ words"
    elif not quote_on_page(quote, page.text):
        check.reason = "quote not found on source page"
    elif name in STRING_FIELDS and not value_in_quote(value, quote):
        check.reason = "value not in quote"
    elif name in DATE_FIELDS and not date_in_quote(value, quote):
        check.reason = "date not in quote"
    else:
        check.kind = (
            VALUE_IN_QUOTE
            if name in STRING_FIELDS
            else DATE_IN_QUOTE
            if name in DATE_FIELDS
            else JUDGEMENT
        )
    return check


def check_candidate(
    raw: dict[str, Any],
    conference: dict[str, Any],
    get_page: Callable[[str], Page],
    geocode: Geocode,
) -> Checked:
    """Verify every field of one raw candidate, then apply candidate-level rules.

    Parameters
    ----------
    raw : dict
        One element of the model's ``candidates`` list.
    conference : dict
        The researched conference (``id``, ``start``, ``end``, ``main_location``); ``parent``
        must equal its id, and the satellite's dates must be within :data:`PLAUSIBLE_DAYS`.
    get_page : callable
        ``url -> Page``, normally a :class:`LimitedPages` over :meth:`PageFetcher.get`.
    geocode : callable
        ``(city, country) -> GeoHit | None``, normally :class:`discover.geo.Geocoder`.

    Returns
    -------
    Checked
        Per-field outcomes, kept fields, and a drop reason if the candidate is unusable.

    Examples
    --------
    .. code-block:: python

        checked = check_candidate(raw, conf, LimitedPages(fetcher.get, 25), Geocoder(cache))
        if not checked.dropped:
            print(checked.fields["city"], checked.kinds["country"])
    """
    out = Checked(parent=str(raw.get("parent", "")), rationale=str(raw.get("rationale", "")))
    for name in FIELD_SCHEMAS:
        ev = raw.get(name)
        if not isinstance(ev, dict):
            continue
        check = _check_field(name, ev, get_page)
        out.checks.append(check)
        if check.kept:
            out.fields[name] = check.value
            out.kinds[name] = check.kind
            out.sources[name] = check.source_url

    # Country: a quote naming it, or derived from the verified city via the geocoder.
    country_check = next((c for c in out.checks if c.field == "country"), None)
    country = country_check.value if country_check and isinstance(country_check.value, str) else ""
    if "city" in out.fields and country:
        out.geo = geocode(out.fields["city"], country)
        if out.geo is not None and "country" not in out.fields:
            assert country_check is not None
            country_check.kind, country_check.reason, country_check.detail = DERIVED, "", ""
            out.fields["country"] = country
            out.kinds["country"] = DERIVED

    def drop(reason: str, detail: str = "") -> Checked:
        out.dropped, out.dropped_detail = reason, detail
        return out

    conf_id = str(conference["id"])
    if out.parent != conf_id:
        return drop("parent is not the researched conference", f"{out.parent} ≠ {conf_id}")
    if missing := [f for f in REQUIRED_FIELDS if f not in out.fields]:
        return drop("missing verified required field(s)", ", ".join(missing))
    start, end = out.fields["start"], out.fields["end"]
    if start > end:
        return drop("start is after end", f"{start} > {end}")
    lo = date.fromisoformat(conference["start"]) - timedelta(days=PLAUSIBLE_DAYS)
    hi = date.fromisoformat(conference["end"]) + timedelta(days=PLAUSIBLE_DAYS)
    if not (lo <= date.fromisoformat(start) and date.fromisoformat(end) <= hi):
        return drop(
            f"dates not within {PLAUSIBLE_DAYS} days of the parent edition",
            f"{start}..{end} vs {conference['start']}..{conference['end']}",
        )
    main_city = (conference.get("main_location") or {}).get("city")
    if main_city and norm_city(out.fields["city"]) == norm_city(main_city):
        return drop("same city as the parent's main venue")
    if out.geo is None:
        return drop("city not found by the geocoder in that country")
    return out


def check_candidate_safely(
    raw: Any,
    conference: dict[str, Any],
    get_page: Callable[[str], Page],
    geocode: Geocode,
) -> Checked:
    """:func:`check_candidate` that turns any unexpected error into a dropped candidate."""
    try:
        if not isinstance(raw, dict):
            raise TypeError(f"candidate is a {type(raw).__name__}, not an object")
        return check_candidate(raw, conference, get_page, geocode)
    except Exception as e:  # noqa: BLE001 - one bad candidate must not abort the run
        parent = str(raw.get("parent", "")) if isinstance(raw, dict) else ""
        return Checked(
            parent=parent,
            rationale="",
            dropped="internal error while checking the candidate",
            dropped_detail=f"{type(e).__name__}: {e}",
        )
