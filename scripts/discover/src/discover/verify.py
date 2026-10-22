"""Deterministic evidence checks on model candidates.

Each field's ``quote`` must appear (after normalization) in the text of the page at its
``source_url``, downloaded here independently of the model. Values are type-checked. Fields
that fail are dropped; candidates missing a required field afterwards are dropped.
"""

import html
import ipaddress
import re
import socket
import unicodedata
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urljoin, urlsplit

import httpx

from .agent import ACCESS_VALUES, FIELD_SCHEMAS, REQUIRED_FIELDS

USER_AGENT = "confmaps.org discovery (+https://confmaps.org)"
TIMEOUT_S = 20.0
MAX_BYTES = 5_000_000  # pages are truncated to this size before matching
MIN_QUOTE_CHARS = 4

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
_SKIP_TAGS = {"script", "style", "noscript", "template", "svg", "head"}


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

        normalize("Dec 9–13,  2026") == "dec 9-13, 2026"
    """
    text = unicodedata.normalize("NFKC", html.unescape(text))
    text = text.translate(_DASHES).translate(_QUOTES).translate(_INVISIBLE)
    return re.sub(r"\s+", " ", text.casefold()).strip()


class _TextExtractor(HTMLParser):
    """Visible text of an HTML page; block-level tags become spaces, inline tags do not."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.skip_depth = 0
        self.title: list[str] = []
        self.in_title = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "title":
            self.in_title = True
        elif tag in _SKIP_TAGS:
            self.skip_depth += 1
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


def html_to_text(markup: str) -> str:
    """Visible text (plus ``<title>``) of an HTML document, without scripts and styles.

    Examples
    --------
    .. code-block:: python

        html_to_text("<p>Dec <b>9</b>&ndash;13</p><script>x()</script>")  # "Dec 9–13"
    """
    parser = _TextExtractor()
    parser.feed(markup)
    parser.close()
    return " ".join(["".join(parser.title), "".join(parser.parts)])


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


# Hostnames whose last label is numeric are IPv4 to URL parsers and resolvers ("2130706433",
# "0x7f.1", "127.1"); only canonical dotted quads are accepted.
_NUMERIC_LABEL = re.compile(r"^(0x[0-9a-f]*|[0-9]+)$")
DEFAULT_PORTS = {"http": 80, "https": 443}
MAX_REDIRECTS = 5

Resolver = Callable[[str, int], list[str]]


class UnsafeURL(Exception):
    """A URL that must not be fetched."""


def _ip_problem(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> str | None:
    """Why an address is off-limits (anything not globally routable), or ``None``."""
    mapped = getattr(ip, "ipv4_mapped", None)
    if mapped is not None:
        return _ip_problem(mapped)
    for flag in ("is_loopback", "is_private", "is_link_local", "is_reserved", "is_multicast",
                 "is_unspecified"):  # fmt: skip
        if getattr(ip, flag):
            return f"{ip} is {flag[3:].replace('_', '-')}"
    if not ip.is_global:
        return f"{ip} is not a public address"
    return None


def unsafe_url_reason(url: str) -> str | None:
    """Static checks (no DNS): why ``url`` must not be fetched, or ``None``.

    Rejects non-http(s) schemes, ports other than 80/443, credentials in the URL, local
    hostnames, non-canonical numeric hosts and literal non-public IP addresses.

    Examples
    --------
    .. code-block:: python

        unsafe_url_reason("http://169.254.169.254/latest/")  # "169.254.169.254 is link-local"
        unsafe_url_reason("https://neurips.cc/")  # None
    """
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
    host = parts.hostname.rstrip(".").lower()
    if host == "localhost" or host.endswith((".localhost", ".local", ".internal")):
        return "local hostname"
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        if _NUMERIC_LABEL.match(host.rsplit(".", 1)[-1]):
            return f"non-canonical numeric host {host!r}"
        return None
    return _ip_problem(ip)


def system_resolver(host: str, port: int) -> list[str]:
    """All addresses ``host`` resolves to (A and AAAA), via ``getaddrinfo``."""
    infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    return list(dict.fromkeys(info[4][0] for info in infos))


@dataclass(frozen=True)
class Pinned:
    """A vetted fetch target: connect to ``ip``, present ``host`` as Host header and SNI."""

    url: str  # original URL
    host: str
    port: int
    ip: str


def vet_url(url: str, resolver: Resolver = system_resolver) -> Pinned:
    """Validate a URL and pin it to one resolved public address.

    Every address the host resolves to must be public, so a hostname pointing (even partly)
    at private, loopback, link-local or metadata addresses is rejected. The caller connects to
    the returned IP, so a DNS change after this check (rebinding) cannot move the target.

    Raises
    ------
    UnsafeURL
        If the URL fails :func:`unsafe_url_reason` or any resolved address is not public.

    Examples
    --------
    .. code-block:: python

        pinned = vet_url("https://neurips.cc/Conferences/2026")
        pinned.ip  # e.g. "198.202.70.92"
    """
    reason = unsafe_url_reason(url)
    if reason:
        raise UnsafeURL(reason)
    parts = urlsplit(url)
    host = parts.hostname.rstrip(".").lower()  # type: ignore[union-attr]
    port = parts.port or DEFAULT_PORTS[parts.scheme]
    try:
        addresses = resolver(host, port)
    except OSError as e:
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
    return Pinned(url, host, port, addresses[0])


def _pinned_request(client: httpx.Client, target: Pinned) -> httpx.Request:
    """GET request that connects to the pinned IP but keeps Host header and TLS SNI/cert check."""
    parts = urlsplit(target.url)
    ip_host = f"[{target.ip}]" if ":" in target.ip else target.ip
    default = DEFAULT_PORTS[parts.scheme] == target.port
    netloc = ip_host if default else f"{ip_host}:{target.port}"
    host_header = target.host if default else f"{target.host}:{target.port}"
    extensions = {"sni_hostname": target.host} if parts.scheme == "https" else {}
    return client.build_request(
        "GET",
        parts._replace(netloc=netloc).geturl(),
        headers={"Host": host_header},
        extensions=extensions,
    )


@dataclass
class Page:
    text: str | None  # normalized page text, None when unavailable
    error: str = ""


class PageFetcher:
    """Downloads and caches the normalized text of source pages for one run.

    Source URLs come from a model that read untrusted pages, so every hop (including
    redirects, followed manually) is vetted and pinned with :func:`vet_url`.

    Parameters
    ----------
    client : httpx.Client, optional
        HTTP client; by default one with the identifying User-Agent, a timeout, no automatic
        redirects, no proxies from the environment and no connection reuse (each pinned
        connection gets its own TLS handshake for its hostname).
    resolver : callable, optional
        ``(host, port) -> [ip, ...]``; :func:`system_resolver` by default.

    Examples
    --------
    .. code-block:: python

        fetcher = PageFetcher()
        page = fetcher.get("https://neurips.cc/Conferences/2026")
        found = page.text is not None and quote_on_page("Atlanta", page.text)
    """

    def __init__(
        self, client: httpx.Client | None = None, resolver: Resolver = system_resolver
    ) -> None:
        self.client = client or httpx.Client(
            headers={"User-Agent": USER_AGENT},
            timeout=TIMEOUT_S,
            follow_redirects=False,
            trust_env=False,
            limits=httpx.Limits(max_keepalive_connections=0),
        )
        self.resolver = resolver
        self.pages: dict[str, Page] = {}

    def get(self, url: str) -> Page:
        if url not in self.pages:
            self.pages[url] = self._fetch(url)
        return self.pages[url]

    def _fetch(self, url: str) -> Page:
        try:
            for _ in range(MAX_REDIRECTS + 1):
                target = vet_url(url, self.resolver)
                response = self.client.send(_pinned_request(self.client, target), stream=True)
                try:
                    if response.is_redirect:
                        url = urljoin(url, response.headers.get("location", ""))
                        continue
                    if response.status_code >= 400:
                        return Page(None, f"HTTP {response.status_code}")
                    return self._read(response)
                finally:
                    response.close()
            return Page(None, "too many redirects")
        except UnsafeURL as e:
            return Page(None, f"unsafe URL: {e}")
        except httpx.HTTPError as e:
            return Page(None, f"fetch failed: {type(e).__name__}: {e}")

    @staticmethod
    def _read(response: httpx.Response) -> Page:
        ctype = response.headers.get("content-type", "").split(";")[0].strip().lower()
        if not (ctype.startswith("text/") or ctype in ("application/xhtml+xml", "")):
            return Page(None, f"unsupported content type {ctype}")
        body = bytearray()
        for chunk in response.iter_bytes():
            body += chunk
            if len(body) >= MAX_BYTES:
                del body[MAX_BYTES:]
                break
        raw = bytes(body).decode(response.encoding or "utf-8", errors="replace")
        is_html = "html" in ctype or (not ctype and "<html" in raw[:2000].lower())
        return Page(normalize(html_to_text(raw) if is_html else raw))


def quote_on_page(quote: str, page_text: str) -> bool:
    """Whether a quote appears in normalized page text.

    Whitespace and case never matter; as a second chance the comparison also ignores
    whitespace entirely (e.g. ``"9 – 13"`` vs ``"9–13"``).

    Examples
    --------
    .. code-block:: python

        quote_on_page("Held in ATLANTA", normalize("<p>held in  Atlanta, GA</p>"))  # True
    """
    q = normalize(quote)
    if len(q) < MIN_QUOTE_CHARS:
        return False
    if q in page_text:
        return True
    return _squash(q) in _squash(page_text)


def _squash(text: str) -> str:
    return re.sub(r"\s", "", text)


def coerce_value(name: str, value: Any) -> tuple[Any, str]:
    """Validate a field value. Returns ``(value, "")`` or ``(None, reason)``.

    Strings are stripped and single-lined; ``link`` must be http(s); dates must be valid ISO
    dates; booleans must be booleans; ``access`` must be one of the allowed values.
    """
    kind = FIELD_SCHEMAS[name]["type"]
    if kind == "boolean":
        return (value, "") if isinstance(value, bool) else (None, "not a boolean")
    if not isinstance(value, str):
        return None, "not a string"
    value = re.sub(r"\s+", " ", value).strip()
    if not value:
        return None, "empty"
    if name == "access" and value not in ACCESS_VALUES:
        return None, f"access must be one of {', '.join(ACCESS_VALUES)}"
    if name in ("start", "end"):
        try:
            date.fromisoformat(value)
        except ValueError:
            return None, "not a YYYY-MM-DD date"
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            return None, "not a YYYY-MM-DD date"
    if name == "link" and unsafe_url_reason(value):
        return None, "not a public http(s) URL"
    return value, ""


@dataclass
class FieldCheck:
    field: str
    value: Any
    source_url: str
    quote: str
    kept: bool
    reason: str = ""


@dataclass
class Checked:
    """A candidate after verification; ``fields`` holds only verified values."""

    parent: str
    rationale: str
    fields: dict[str, Any] = field(default_factory=dict)
    sources: dict[str, str] = field(default_factory=dict)  # field → verified source URL
    checks: list[FieldCheck] = field(default_factory=list)
    dropped: str = ""  # non-empty: why the whole candidate was dropped

    @property
    def label(self) -> str:
        name = next((c.value for c in self.checks if c.field == "name"), None)
        city = next((c.value for c in self.checks if c.field == "city"), None)
        return f"{name or '(unnamed)'} — {city or '(no city)'}"


def check_candidate(
    raw: dict[str, Any],
    conference_id: str,
    main_city: str | None,
    get_page: Callable[[str], Page],
) -> Checked:
    """Verify every field of one raw candidate, then apply candidate-level rules.

    Parameters
    ----------
    raw : dict
        One element of the model's ``candidates`` list.
    conference_id : str
        The conference that was researched; ``parent`` must equal it.
    main_city : str, optional
        City of the parent's main venue; a candidate there is not a satellite.
    get_page : callable
        ``url -> Page``, normally :meth:`PageFetcher.get`.

    Returns
    -------
    Checked
        Per-field outcomes, verified fields, and a drop reason if the candidate is unusable.

    Examples
    --------
    .. code-block:: python

        checked = check_candidate(raw, "neurips26", "Sydney", PageFetcher().get)
        if not checked.dropped:
            print(checked.fields["city"])
    """
    out = Checked(parent=str(raw.get("parent", "")), rationale=str(raw.get("rationale", "")))
    for name in FIELD_SCHEMAS:
        ev = raw.get(name)
        if not isinstance(ev, dict):
            continue
        url, quote = str(ev.get("source_url", "")), str(ev.get("quote", ""))
        check = FieldCheck(name, ev.get("value"), url, quote, kept=False)
        out.checks.append(check)
        value, problem = coerce_value(name, ev.get("value"))
        if problem:
            check.reason = f"invalid value: {problem}"
            continue
        check.value = value
        page = get_page(url)
        if page.text is None:
            check.reason = f"source not verifiable ({page.error})"
        elif not quote_on_page(quote, page.text):
            check.reason = "quote not found on source page"
        else:
            check.kept = True
            out.fields[name] = value
            out.sources[name] = url

    if out.parent != conference_id:
        out.dropped = f"parent {out.parent!r} is not the researched conference {conference_id!r}"
    elif missing := [f for f in REQUIRED_FIELDS if f not in out.fields]:
        out.dropped = f"missing verified required field(s): {', '.join(missing)}"
    elif out.fields["start"] > out.fields["end"]:
        out.dropped = f"start {out.fields['start']} is after end {out.fields['end']}"
    elif main_city and norm_city(out.fields["city"]) == norm_city(main_city):
        out.dropped = "same city as the parent's main venue"
    return out
