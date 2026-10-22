import re

from conftest import (
    ATLANTA_PAGE,
    ATLANTA_URL,
    CONF,
    FakeFetcher,
    FakeGeocoder,
    atlanta_candidate,
    ev,
)

from discover.agent import Research
from discover.merge import plan_changes
from discover.report import ConferenceRun, build_body, code, link
from discover.verify import Page, check_candidate_safely

HOSTILE = "x | @team [click](http://evil.example) ![i](http://evil.example/i.png) <img src=x>"
MARKERS = ["@team", "@admin", "@everyone", "](", "<img", "<script", "evil.example"]


def hostile_fetcher(url: str) -> Page:
    if url == ATLANTA_URL:
        return FakeFetcher({ATLANTA_URL: ATLANTA_PAGE}).get(url)
    if "ctype" in url:
        return Page(None, "unsupported content type", f"text/x\n## pwned {HOSTILE}")
    return Page(None, "fetch failed", f"ConnectError: <script>@admin</script> {HOSTILE}")


def body_with_hostile_content() -> str:
    candidates = [
        # Hostile parent (dropped, its value shown as detail).
        atlanta_candidate(parent=f"neurips26 @admin | {HOSTILE}"),
        # Hostile content-type and URL error on two fields; hostile quote, value and rationale.
        {
            **atlanta_candidate(
                venue=ev("Hall", "https://a.example/ctype", "a quote"),
                notes=ev(f"note {HOSTILE}", "https://b.example/err", f"quote {HOSTILE}"),
                name=ev(f"NeurIPS 2026 Atlanta {HOSTILE}", ATLANTA_URL, "NeurIPS 2026 Atlanta"),
            ),
            "rationale": f"because\n\n# heading\n{HOSTILE}",
        },
        # Hostile, unsafe source URL.
        atlanta_candidate(access=ev("open", f"javascript:alert(1)//{HOSTILE}", HOSTILE)),
    ]
    conf = {**CONF, "title": "NeurIPS @everyone | <img src=x>"}
    research = Research("neurips26", "ok", candidates=candidates)
    run = ConferenceRun(conf, research)
    run.checked = [
        check_candidate_safely(raw, conf, hostile_fetcher, FakeGeocoder()) for raw in candidates
    ]
    failed = ConferenceRun(
        {**conf, "id": "x @admin"}, Research("x", "error", detail=f"stop {HOSTILE}")
    )
    plan = plan_changes([], run.checked)
    return build_body([run, failed], plan, "summary", 3, {})


def _strip_safe_spans(text: str) -> str:
    """Remove code spans and encoded autolinks: the only places dynamic text may appear."""
    text = re.sub(r"`[^`\n]*`", "", text)
    return re.sub(r"<https?://[^\s<>|]*>", "", text)


def test_hostile_strings_cannot_inject_markdown() -> None:
    body = body_with_hostile_content()
    assert "@admin" in body and "evil.example" in body  # the content is shown…
    outside = _strip_safe_spans(body)
    for marker in MARKERS:  # …but only inside code spans / encoded autolinks
        assert marker not in outside, marker
    # No injected headings: every heading line is one of ours.
    headings = [line for line in body.splitlines() if line.startswith("#")]
    for h in headings:
        assert re.fullmatch(r"#{2,4} (`[^`]*`|[A-Z][\w ()]*)( .*)?", h), h
    assert not any(h.startswith(("## pwned", "# heading")) for h in headings)


def test_hostile_strings_cannot_add_table_cells() -> None:
    body = body_with_hostile_content()
    expected = None
    for line in body.splitlines():
        if not line.startswith("|"):
            expected = None
            continue
        cells = len(re.findall(r"(?<!\\)\|", line))
        expected = expected or cells  # header row of this table
        assert cells == expected, line


def test_code_strips_control_and_bidi_characters() -> None:
    assert code("a\u202eb\x00c\nd") == "`abc d`"
    assert code("`x` | y") == "`'x' \\| y`"


def test_link_only_for_safe_urls() -> None:
    assert link("https://x.org/a|c>`") == "<https://x.org/a%7Cc%3E%60>"
    assert link("https://x.org/a b") == "`https://x.org/a b`"  # unsafe: shown as code
    assert link("javascript:alert(1)") == "`javascript:alert(1)`"
    assert link("") == "—"
