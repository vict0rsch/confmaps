import gzip
from typing import Any

import httpx
import pytest
from conftest import (
    ATLANTA_PAGE,
    ATLANTA_URL,
    CONF,
    FakeFetcher,
    FakeGeocoder,
    atlanta_candidate,
    ev,
)

from discover import verify
from discover.verify import (
    DATE_IN_QUOTE,
    DERIVED,
    JUDGEMENT,
    LINKED,
    SAME_SITE,
    USER_AGENT,
    VALUE_IN_QUOTE,
    LimitedPages,
    Page,
    PageFetcher,
    UnsafeURL,
    canonical_url,
    check_candidate,
    check_candidate_safely,
    date_in_quote,
    html_to_text,
    normalize,
    page_from_markup,
    quote_on_page,
    registrable_domain,
    same_site,
    unsafe_url_reason,
    value_in_quote,
    vet_url,
)


def page(text: str) -> str:
    return normalize(text)


# --- quote matching -------------------------------------------------------------------------


def test_quote_exact_match() -> None:
    assert quote_on_page("takes place December 9–13, 2026", page(ATLANTA_PAGE))


def test_quote_whitespace_and_case_insensitive() -> None:
    text = page("The   Official\n NeurIPS\tsatellite in ATLANTA")
    assert quote_on_page("the official neurips satellite in atlanta", text)
    assert quote_on_page("THE OFFICIAL   NEURIPS SATELLITE", text)


def test_quote_dashes_quotes_nbsp_and_entities() -> None:
    text = page("Dec 9&ndash;13 &middot; “NeurIPS Europe”")
    assert quote_on_page('Dec 9-13 · "NeurIPS Europe"', text)


def test_quote_spacing_around_punctuation_is_free() -> None:
    assert quote_on_page("December 9 – 13, 2026", page("December 9–13, 2026"))


@pytest.mark.parametrize(
    ("quote", "text"),
    [
        ("Dec 9 13, 2026", "Dec 19 13, 2026"),  # no match inside another number
        ("December 9 13 2026", "December 913 2026"),  # words are never glued together
        ("held in Paris 2026", "held in Parisot 2026"),  # nor a prefix of a longer word
        ("satellite in Atlanta", "satellitein Atlanta"),
    ],
)
def test_quote_respects_word_boundaries(quote: str, text: str) -> None:
    assert not quote_on_page(quote, page(text))


@pytest.mark.parametrize("quote", ["", " a ", "open", "2026", "9 13", "Atlanta GA", "a" * 30])
def test_short_or_single_word_quotes_never_match(quote: str) -> None:
    text = page(f"open 2026 9 13 Atlanta GA {'a' * 30}")
    assert not quote_on_page(quote, text)


def test_quote_miss() -> None:
    assert not quote_on_page("held in Paris, France", page(ATLANTA_PAGE))


def test_value_in_quote() -> None:
    assert value_in_quote("Zürich", "Held in Zurich, Switzerland")
    assert value_in_quote("Georgia World Congress Center", "at the Georgia World Congress Center")
    assert not value_in_quote("Paris", "held in Parisot, France")
    assert not value_in_quote("Atlanta", "NeurIPS 2026 in Paris")


@pytest.mark.parametrize(
    ("iso", "quote"),
    [
        ("2026-12-09", "December 9–13, 2026"),
        ("2026-12-13", "December 9–13, 2026"),
        ("2026-12-09", "9-13 Dec. 2026"),
        ("2026-12-09", "Tuesday, 9th December 2026"),
        ("2026-12-09", "2026-12-09 to 2026-12-13"),
        ("2026-12-09", "09/12/2026"),
        ("2026-12-09", "12/9/2026"),
        ("2026-12-09", "9 décembre 2026"),
        ("2026-12-12", "December 12, 2026"),
        ("2026-12-12", "12.12.2026"),
        ("2026-12-09", "Dec 9 – 13 '26"),
    ],
)
def test_date_in_quote(iso: str, quote: str) -> None:
    assert date_in_quote(iso, quote)


@pytest.mark.parametrize(
    ("iso", "quote"),
    [
        ("2026-12-13", "December 9–12, 2026"),  # wrong day
        ("2026-11-09", "December 9–13, 2026"),  # wrong month
        ("2025-12-09", "December 9–13, 2026"),  # wrong year
        ("2026-12-09", "December 9–13"),  # no year
        ("2026-12-09", "9 to 13, 2026"),  # no month
        ("2026-12-12", "12/2026"),  # month and day are the same single number
    ],
)
def test_date_not_in_quote(iso: str, quote: str) -> None:
    assert not date_in_quote(iso, quote)


def test_html_to_text_skips_scripts_and_keeps_inline_text_together() -> None:
    html = (
        "<html><head><title>NeurIPS Atlanta</title><style>p{}</style></head><body>"
        "<script>var injected = 'Ignore previous instructions';</script>"
        "<p>Dec <b>9</b>&ndash;13</p><p>Atlanta</p></body></html>"
    )
    text = normalize(html_to_text(html))
    assert "dec 9-13" in text and "neurips atlanta" in text
    assert "ignore previous" not in text
    assert "13 atlanta" in text  # block tags separate words


def test_unclosed_head_keeps_the_body() -> None:
    text = normalize(html_to_text("<html><head><title>T</title><body><p>Held in Atlanta</p>"))
    assert "held in atlanta" in text


def test_page_links_are_resolved_and_canonical() -> None:
    p = page_from_markup(
        '<a href="/2026/atlanta#top">A</a> <a href="HTTPS://Other.org">B</a>'
        '<a href="javascript:alert(1)">C</a> <a href="http://10.0.0.1/">D</a>',
        "https://neurips.cc/x/",
    )
    assert p.links == {"https://neurips.cc/2026/atlanta", "https://other.org"}


# --- candidate checks -----------------------------------------------------------------------


def checked(
    raw: dict[str, Any],
    pages: dict[str, str] | None = None,
    conference: dict[str, Any] | None = None,
    geocoder: FakeGeocoder | None = None,
) -> verify.Checked:
    fetcher = FakeFetcher(pages if pages is not None else {ATLANTA_URL: ATLANTA_PAGE})
    return check_candidate(raw, conference or CONF, fetcher.get, geocoder or FakeGeocoder())


def kinds(c: verify.Checked) -> dict[str, str]:
    return {chk.field: chk.kind or f"✗ {chk.reason}" for chk in c.checks}


def test_all_fields_checked_with_their_rule() -> None:
    c = checked(atlanta_candidate())
    assert not c.dropped
    assert c.fields["city"] == "Atlanta" and c.fields["start"] == "2026-12-09"
    assert kinds(c) == {
        "name": VALUE_IN_QUOTE,
        "link": SAME_SITE,
        "city": VALUE_IN_QUOTE,
        "country": VALUE_IN_QUOTE,
        "venue": VALUE_IN_QUOTE,
        "start": DATE_IN_QUOTE,
        "end": DATE_IN_QUOTE,
        "official": JUDGEMENT,
        "presents_papers": JUDGEMENT,
        "access": JUDGEMENT,
    }
    assert c.verified("start") and not c.verified("access")
    assert c.geo is not None and c.geo.lat == pytest.approx(33.75, abs=0.01)


def test_quote_found_but_value_not_in_quote_is_rejected() -> None:
    # The quote is on the page, but says nothing about the claimed value.
    c = checked(atlanta_candidate(venue=ev("Some Hall", ATLANTA_URL, "Georgia World Congress")))
    assert "venue" not in c.fields
    assert kinds(c)["venue"] == "✗ value not in quote"


def test_quote_found_but_dates_not_in_quote_drop_the_candidate() -> None:
    c = checked(atlanta_candidate(start=ev("2026-12-01", ATLANTA_URL, "December 9–13, 2026")))
    assert kinds(c)["start"] == "✗ date not in quote"
    assert c.dropped == "missing verified required field(s)" and c.dropped_detail == "start"


def test_judgement_fields_need_a_longer_quote() -> None:
    c = checked(atlanta_candidate(access=ev("open", ATLANTA_URL, "open to all.")))
    access = next(chk for chk in c.checks if chk.field == "access")
    assert access.reason == "quote too short" and "20+" in access.detail


def test_link_must_be_on_the_page_or_the_same_site() -> None:
    html = f'<a href="https://atl-satellite.org/">site</a> {ATLANTA_PAGE}'
    pages = {ATLANTA_URL: html}
    linked = checked(
        atlanta_candidate(link=ev("https://atl-satellite.org", ATLANTA_URL, "")), pages
    )
    assert kinds(linked)["link"] == LINKED
    other = checked(atlanta_candidate(link=ev("https://evil.example/", ATLANTA_URL, "")), pages)
    assert kinds(other)["link"] == "✗ link neither on the source page nor on its site"
    assert other.dropped == "missing verified required field(s)"


def test_country_can_be_derived_from_the_geocoded_city() -> None:
    c = checked(atlanta_candidate(country=ev("United States", ATLANTA_URL, "NeurIPS 2026 Atlanta")))
    assert c.kinds["country"] == DERIVED and c.fields["country"] == "United States"
    assert not c.dropped


def test_country_not_matching_the_geocoded_city_is_dropped() -> None:
    c = checked(atlanta_candidate(country=ev("Canada", ATLANTA_URL, "NeurIPS 2026 Atlanta")))
    assert "country" not in c.fields
    assert c.dropped == "missing verified required field(s)" and c.dropped_detail == "country"


def test_city_unknown_to_the_geocoder_drops_the_candidate() -> None:
    c = checked(atlanta_candidate(), geocoder=FakeGeocoder())
    assert not c.dropped
    c = checked(atlanta_candidate(), geocoder=_NoHits())
    assert c.dropped == "city not found by the geocoder in that country"


class _NoHits(FakeGeocoder):
    def __call__(self, city: str, country: str) -> None:
        return None


def test_unreachable_source_drops_field() -> None:
    other = "https://example.org/missing"
    c = checked(atlanta_candidate(access=ev("open", other, "Registration is open to all.")))
    assert "access" not in c.fields
    access = next(chk for chk in c.checks if chk.field == "access")
    assert access.reason == "source page not readable" and access.detail == "HTTP error 404"


def test_source_url_is_vetted_and_stored_canonical() -> None:
    raw = atlanta_candidate(
        venue=ev("Georgia World Congress Center", "http://127.0.0.1/", "x" * 30),
        name=ev(
            "NeurIPS 2026 Atlanta",
            "HTTPS://NeurIPS.cc/Conferences/2026/Atlanta#x",
            "NeurIPS 2026 Atlanta",
        ),
        notes=ev("A note", "https://neurips.cc/a b", "a quote with spaces in it"),
    )
    c = checked(raw)
    by_field = {chk.field: chk for chk in c.checks}
    assert by_field["venue"].reason == "unsafe or malformed source URL"
    assert by_field["notes"].reason == "unsafe or malformed source URL"
    assert by_field["name"].kept and c.sources["name"] == ATLANTA_URL


def test_invalid_values_are_dropped() -> None:
    c = checked(
        atlanta_candidate(
            access=ev("public", ATLANTA_URL, "Registration is open to all."),
            official=ev("yes", ATLANTA_URL, "The official NeurIPS satellite"),
            end=ev("2026-13-40", ATLANTA_URL, "December 9–13, 2026"),
        )
    )
    failed = {chk.field: (chk.reason, chk.detail) for chk in c.checks if not chk.kept}
    assert failed["access"][0] == "invalid value"
    assert failed["official"] == ("invalid value", "not a boolean")
    assert failed["end"] == ("invalid value", "not a YYYY-MM-DD date")
    assert c.dropped_detail.startswith("end")


def test_start_after_end_drops_candidate() -> None:
    page_text = ATLANTA_PAGE + " Closing on December 1, 2026."
    c = checked(
        atlanta_candidate(end=ev("2026-12-01", ATLANTA_URL, "Closing on December 1, 2026")),
        {ATLANTA_URL: page_text},
    )
    assert c.dropped == "start is after end"


def test_dates_far_from_the_parent_edition_drop_the_candidate() -> None:
    far = {**CONF, "start": "2027-06-01", "end": "2027-06-05"}
    c = checked(atlanta_candidate(), conference=far)
    assert c.dropped == "dates not within 60 days of the parent edition"
    near = {**CONF, "start": "2026-10-11", "end": "2026-10-14"}  # 56 days before the satellite
    assert not checked(atlanta_candidate(), conference=near).dropped


def test_wrong_parent_and_main_city_are_dropped() -> None:
    assert checked(atlanta_candidate(parent="icml26")).dropped == (
        "parent is not the researched conference"
    )
    in_atlanta = {**CONF, "main_location": {"city": "atlanta"}}
    assert checked(atlanta_candidate(), conference=in_atlanta).dropped == (
        "same city as the parent's main venue"
    )


@pytest.mark.parametrize(
    "raw",
    [
        "not an object",
        {"parent": "neurips26", "city": {"value": "Atlanta", "source_url": 42, "quote": None}},
        {"parent": "neurips26", "city": {"value": ["x"], "source_url": ATLANTA_URL, "quote": "q"}},
    ],
)
def test_malformed_candidates_never_raise(raw: Any) -> None:
    c = check_candidate_safely(raw, CONF, FakeFetcher({}).get, FakeGeocoder())
    assert c.dropped


def test_check_candidate_safely_turns_crashes_into_drops() -> None:
    def boom(url: str) -> Page:
        raise RuntimeError("kaboom | @team")

    c = check_candidate_safely(atlanta_candidate(), CONF, boom, FakeGeocoder())
    assert c.dropped == "internal error while checking the candidate"
    assert c.dropped_detail == "RuntimeError: kaboom | @team"


def test_fetch_limit_per_conference() -> None:
    fetcher = FakeFetcher({"https://a.org/1": "x", "https://a.org/2": "y"})
    pages = LimitedPages(fetcher.get, 1)
    assert pages("https://a.org/1").text == "x"
    assert pages("https://a.org/1").text == "x"  # same URL again is free
    assert pages("https://a.org/2").error == "fetch limit per conference reached"
    assert fetcher.requested == ["https://a.org/1", "https://a.org/1"]


# --- sites ---------------------------------------------------------------------------------


def test_registrable_domain_heuristic() -> None:
    assert registrable_domain("2026.emnlp.org") == "emnlp.org"
    assert registrable_domain("www.cs.ox.ac.uk") == "ox.ac.uk"
    assert registrable_domain("event.github.io") == "event.github.io"
    assert same_site("https://neurips-europe.cc/x", "https://www.neurips-europe.cc/")
    assert not same_site("https://a.github.io/", "https://b.github.io/")
    assert not same_site("https://bbc.co.uk/", "https://itv.co.uk/")


def test_canonical_url() -> None:
    assert canonical_url("HTTPS://Bücher.Example:443/a?b=1#frag") == (
        "https://xn--bcher-kva.example/a?b=1"
    )
    assert canonical_url("http://neurips.cc") == "http://neurips.cc/"


# --- URL safety (SSRF) -------------------------------------------------------------------------


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "ftp://example.org/",
        "http://localhost/",
        "http://metadata.google.internal/",
        "http://169.254.169.254/latest/meta-data/",
        "http://10.0.0.1/",
        "http://[::1]/",
        "http://[::ffff:127.0.0.1]/",
        "http://[fec0::1]/",  # deprecated site-local
        "http://192.88.99.1/",  # 6to4 relay anycast
        "http://2130706433/",  # decimal 127.0.0.1
        "http://0x7f000001/",
        "http://0x7f.0.0.1/",
        "http://127.1/",
        "http://017700000001/",
        "https://example.org:8443/",
        "https://user:pw@example.org/",
        "https://example.org/a b",
        "https://example.org/\x00",
        "https://exa\u200bmple.org/",  # zero-width space
        " https://example.org/",
        "https://" + "a" * 64 + ".org/",  # label too long for IDNA
        "https://xn--.org/",
    ],
)
def test_unsafe_urls_rejected_statically(url: str) -> None:
    assert unsafe_url_reason(url)


@pytest.mark.parametrize(
    "url",
    ["https://neurips.cc/", "http://cafe.de:80/x", "https://1.1.1.1/", "https://bücher.example/"],
)
def test_public_urls_pass_static_check(url: str) -> None:
    assert unsafe_url_reason(url) is None


def resolver(table: dict[str, list[str]]):
    calls: list[str] = []

    def resolve(host: str, port: int) -> list[str]:
        calls.append(host)
        return table[host]

    resolve.calls = calls  # type: ignore[attr-defined]
    return resolve


def test_hostname_resolving_to_private_ip_rejected() -> None:
    with pytest.raises(UnsafeURL, match="non-public"):
        vet_url("https://evil.example/", resolver({"evil.example": ["192.168.1.5"]}))


def test_hostname_with_mixed_public_and_private_addresses_rejected() -> None:
    table = {"mixed.example": ["93.184.215.14", "169.254.169.254"]}
    with pytest.raises(UnsafeURL, match="link-local|private"):
        vet_url("https://mixed.example/", resolver(table))


def test_vet_url_pins_all_public_addresses_and_idna_encodes() -> None:
    pinned = vet_url("https://neurips.cc/x", resolver({"neurips.cc": ["198.202.70.92", "1.2.3.4"]}))
    assert (pinned.host, pinned.port, pinned.ips) == (
        "neurips.cc",
        443,
        ("198.202.70.92", "1.2.3.4"),
    )
    assert pinned.ip == "198.202.70.92"
    idn = vet_url("https://Bücher.example/", resolver({"xn--bcher-kva.example": ["1.2.3.4"]}))
    assert idn.host == "xn--bcher-kva.example"


def fetcher_with(
    handler, table: dict[str, list[str]], now=None
) -> tuple[PageFetcher, list[httpx.Request]]:
    seen: list[httpx.Request] = []

    def record(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return handler(request)

    client = httpx.Client(transport=httpx.MockTransport(record), headers={"User-Agent": USER_AGENT})
    kwargs = {"now": now} if now else {}
    return PageFetcher(client, resolver(table), **kwargs), seen


def streamed(status: int, headers: dict[str, str], body: bytes) -> httpx.Response:
    """A response with a streamed body, as real transports return (raw bytes are readable)."""
    return httpx.Response(status, headers=headers, content=iter([body]))


def html_response(text: str, **headers: str) -> httpx.Response:
    return streamed(200, {"content-type": "text/html; charset=utf-8", **headers}, text.encode())


def test_fetch_connects_to_pinned_ip_with_host_sni_user_agent_and_identity() -> None:
    f, seen = fetcher_with(lambda r: html_response("<p>Atlanta</p>"), {"neurips.cc": ["1.2.3.4"]})
    result = f.get("https://neurips.cc/Conferences/2026")
    assert result.text == "atlanta"
    (req,) = seen
    assert req.url.host == "1.2.3.4" and req.url.path == "/Conferences/2026"
    assert req.headers["host"] == "neurips.cc"
    assert req.extensions["sni_hostname"] == "neurips.cc"
    assert req.headers["user-agent"] == USER_AGENT
    assert req.headers["accept-encoding"] == "identity"


def test_fetch_tries_each_address_on_connect_errors() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "1.1.1.1":
            raise httpx.ConnectError("refused")
        return html_response("<p>ok</p>")

    f, seen = fetcher_with(handler, {"x.example": ["1.1.1.1", "2.2.2.2"]})
    assert f.get("https://x.example/").text == "ok"
    assert [r.url.host for r in seen] == ["1.1.1.1", "2.2.2.2"]


def test_dns_rebind_cannot_change_the_target() -> None:
    answers = iter([["93.184.215.14"], ["127.0.0.1"]])
    calls: list[str] = []

    def rebinding(host: str, port: int) -> list[str]:
        calls.append(host)
        return next(answers)

    seen: list[httpx.Request] = []
    client = httpx.Client(
        transport=httpx.MockTransport(lambda r: seen.append(r) or html_response("<p>ok</p>"))
    )
    result = PageFetcher(client, rebinding).get("https://rebind.example/")
    assert result.text == "ok"
    assert calls == ["rebind.example"]  # resolved once, then connected to that address
    assert seen[0].url.host == "93.184.215.14"


def test_redirect_to_metadata_endpoint_is_refused() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"location": "http://169.254.169.254/latest/"})

    f, seen = fetcher_with(handler, {"neurips.cc": ["1.2.3.4"]})
    result = f.get("https://neurips.cc/")
    assert result.text is None and result.error == "unsafe URL"
    assert len(seen) == 1  # the metadata address was never requested


def test_redirect_to_host_resolving_privately_is_refused() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.headers["host"] == "neurips.cc":
            return httpx.Response(301, headers={"location": "https://inner.example/x"})
        return html_response("<p>secret</p>")

    f, seen = fetcher_with(handler, {"neurips.cc": ["1.2.3.4"], "inner.example": ["10.1.2.3"]})
    assert "non-public" in f.get("https://neurips.cc/").detail
    assert len(seen) == 1


def test_public_redirect_is_followed_and_revetted() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.headers["host"] == "neurips.cc":
            return httpx.Response(301, headers={"location": "https://www.neurips.cc/2026"})
        return html_response('<p>Atlanta</p><a href="/x">x</a>')

    table = {"neurips.cc": ["1.2.3.4"], "www.neurips.cc": ["5.6.7.8"]}
    f, seen = fetcher_with(handler, table)
    result = f.get("https://neurips.cc/")
    assert result.text == "atlanta x"
    assert result.links == {"https://www.neurips.cc/x"}  # resolved against the final URL
    assert [r.url.host for r in seen] == ["1.2.3.4", "5.6.7.8"]


def test_fetch_errors_and_content_types() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/pdf":
            return streamed(200, {"content-type": "application/pdf"}, b"%")
        return httpx.Response(403)

    f, _ = fetcher_with(handler, {"x.example": ["1.2.3.4"]})
    pdf = f.get("https://x.example/pdf")
    assert (pdf.error, pdf.detail) == ("unsupported content type", "application/pdf")
    forbidden = f.get("https://x.example/")
    assert (forbidden.error, forbidden.detail) == ("HTTP error", "403")


@pytest.mark.parametrize(
    ("url", "location", "error"),
    [
        ("https://bad\udcff.example/", None, "unsafe URL"),  # unencodable host
        ("https://x.example/", "https://[::1", "fetch failed"),  # malformed redirect
        ("https://x.example/", "https://exa mple.org/", "unsafe URL"),
    ],
)
def test_bad_urls_never_raise(url: str, location: str | None, error: str) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"location": location or "/"})

    f, _ = fetcher_with(handler, {"x.example": ["1.2.3.4"]})
    assert f.get(url).error == error


def test_unexpected_errors_become_pages() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise RuntimeError("transport bug")

    f, _ = fetcher_with(handler, {"x.example": ["1.2.3.4"]})
    p = f.get("https://x.example/")
    assert p.text is None and p.error == "unexpected fetch error"
    assert "transport bug" in p.detail


def test_resolver_unicode_error_is_unsafe() -> None:
    def bad(host: str, port: int) -> list[str]:
        raise UnicodeError("label empty or too long")

    p = PageFetcher(httpx.Client(transport=httpx.MockTransport(html_response)), bad)
    assert p.get("https://x.example/").error == "unsafe URL"


def test_fetch_caps_size(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("discover.verify.MAX_BYTES", 10)
    f, _ = fetcher_with(
        lambda r: streamed(200, {"content-type": "text/plain"}, b"a" * 50),
        {"x.example": ["1.2.3.4"]},
    )
    assert f.get("https://x.example/").text == "a" * 10


def test_gzip_response_is_inflated_with_a_cap(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("discover.verify.MAX_BYTES", 1000)
    bomb = gzip.compress(b"a" * 10_000_000)  # ~10 KB that inflates to 10 MB

    def handler(request: httpx.Request) -> httpx.Response:
        body = bomb if request.url.path == "/bomb" else gzip.compress(b"held in Atlanta")
        return streamed(200, {"content-type": "text/plain", "content-encoding": "gzip"}, body)

    f, _ = fetcher_with(handler, {"x.example": ["1.2.3.4"]})
    assert f.get("https://x.example/ok").text == "held in atlanta"
    assert f.get("https://x.example/bomb").text == "a" * 1000


def test_unsupported_content_encoding() -> None:
    f, _ = fetcher_with(
        lambda r: html_response("x", **{"content-encoding": "br"}), {"x.example": ["1.2.3.4"]}
    )
    p = f.get("https://x.example/")
    assert (p.error, p.detail) == ("unsupported content encoding", "br")


def test_unknown_charset_falls_back_to_utf8() -> None:
    f, _ = fetcher_with(
        lambda r: streamed(200, {"content-type": "text/plain; charset=evil"}, "Zürich".encode()),
        {"x.example": ["1.2.3.4"]},
    )
    assert f.get("https://x.example/").text == "zürich"


def test_fetch_deadline() -> None:
    clock = iter([0.0, 1.0, 1.0, 999.0, 999.0])

    def chunks(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, headers={"content-type": "text/plain"}, content=iter([b"a", b"b", b"c"])
        )

    f, _ = fetcher_with(chunks, {"x.example": ["1.2.3.4"]}, now=lambda: next(clock))
    assert f.get("https://x.example/").error == "fetch deadline exceeded"
