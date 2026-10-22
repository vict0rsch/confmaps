"""Offline test doubles for the Anthropic client, API responses and page fetches."""

import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Self

import pytest

from discover.verify import Page, normalize

REPO = Path(__file__).resolve().parents[3]


def block(type_: str, **kw: Any) -> SimpleNamespace:
    return SimpleNamespace(type=type_, **kw)


def usage(
    inp: int = 1000,
    out: int = 200,
    searches: int = 0,
    fetches: int = 0,
    iterations: list[Any] | None = None,
) -> SimpleNamespace:
    return SimpleNamespace(
        input_tokens=inp,
        output_tokens=out,
        cache_creation_input_tokens=0,
        cache_read_input_tokens=0,
        server_tool_use=SimpleNamespace(web_search_requests=searches, web_fetch_requests=fetches),
        iterations=iterations,
    )


def message(
    content: list[Any],
    stop_reason: str = "end_turn",
    model: str = "claude-opus-5-5",
    usage_: SimpleNamespace | None = None,
    stop_details: Any = None,
) -> SimpleNamespace:
    return SimpleNamespace(
        content=content,
        stop_reason=stop_reason,
        stop_details=stop_details,
        model=model,
        usage=usage_ or usage(),
    )


def json_message(payload: dict[str, Any], **kw: Any) -> SimpleNamespace:
    return message(
        [
            block("server_tool_use", id="s1", name="web_search", input={"query": "q"}),
            block("web_search_tool_result", tool_use_id="s1", content=[]),
            block("thinking", thinking=""),
            block("text", text=json.dumps(payload)),
        ],
        **kw,
    )


class _Stream:
    def __init__(self, msg: Any) -> None:
        self.msg = msg

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *exc: object) -> None:
        return None

    def get_final_message(self) -> Any:
        return self.msg


class FakeClient:
    """Mimics ``client.beta.messages.stream(...)``; returns queued messages in order."""

    def __init__(self, *responses: Any) -> None:
        self.responses = list(responses)
        self.calls: list[dict[str, Any]] = []
        self.beta = SimpleNamespace(messages=SimpleNamespace(stream=self._stream))

    def _stream(self, **kwargs: Any) -> _Stream:
        # Snapshot messages: the caller mutates the list after the call.
        self.calls.append({**kwargs, "messages": list(kwargs["messages"])})
        return _Stream(self.responses.pop(0))


class FakeFetcher:
    """``url -> Page`` from a dict of raw page texts; unknown URLs are unreachable."""

    def __init__(self, pages: dict[str, str]) -> None:
        self.pages = pages
        self.requested: list[str] = []

    def get(self, url: str) -> Page:
        self.requested.append(url)
        if url not in self.pages:
            return Page(None, "HTTP 404")
        return Page(normalize(self.pages[url]))


def ev(value: Any, url: str, quote: str) -> dict[str, Any]:
    return {"value": value, "source_url": url, "quote": quote}


ATLANTA_URL = "https://neurips.cc/Conferences/2026/Atlanta"
ATLANTA_PAGE = (
    "NeurIPS 2026 Atlanta. The official NeurIPS satellite in Atlanta, Georgia, United States "
    "takes place December 9–13, 2026 at the Georgia World Congress Center. "
    "Accepted papers may be presented in Atlanta. Registration is open to all."
)


def atlanta_candidate(**overrides: Any) -> dict[str, Any]:
    c = {
        "parent": "neurips26",
        "rationale": "Official second location of NeurIPS 2026.",
        "name": ev("NeurIPS 2026 Atlanta", ATLANTA_URL, "NeurIPS 2026 Atlanta"),
        "link": ev(ATLANTA_URL, ATLANTA_URL, "NeurIPS 2026 Atlanta"),
        "city": ev("Atlanta", ATLANTA_URL, "satellite in Atlanta, Georgia"),
        "country": ev("United States", ATLANTA_URL, "Georgia, United States"),
        "venue": ev("Georgia World Congress Center", ATLANTA_URL, "Georgia World Congress Center"),
        "start": ev("2026-12-09", ATLANTA_URL, "December 9–13, 2026"),
        "end": ev("2026-12-13", ATLANTA_URL, "December 9–13, 2026"),
        "official": ev(True, ATLANTA_URL, "The official NeurIPS satellite"),
        "presents_papers": ev(True, ATLANTA_URL, "Accepted papers may be presented"),
        "access": ev("registration", ATLANTA_URL, "Registration is open to all."),
    }
    c.update(overrides)
    return {k: v for k, v in c.items() if v is not None}


@pytest.fixture
def satellites_text() -> str:
    return (REPO / "data" / "satellites.yml").read_text()


@pytest.fixture
def data_json() -> dict[str, Any]:
    return {
        "generatedAt": "2026-10-22T00:00:00Z",
        "conferences": [
            {"id": "neurips26", "title": "NeurIPS", "year": 2026, "start": "2026-12-06",
             "end": "2026-12-12", "link": "https://neurips.cc/"},
            {"id": "emnlp26", "title": "EMNLP", "year": 2026, "start": "2026-10-24",
             "end": "2026-10-29", "link": "https://2026.emnlp.org/"},
            {"id": "emnlp26ind", "title": "EMNLP (Industry Track)", "year": 2026,
             "start": "2026-10-24", "end": "2026-10-29", "link": "https://2026.emnlp.org/"},
            {"id": "neurips25", "title": "NeurIPS", "year": 2025, "start": "2025-12-02",
             "end": "2025-12-07", "link": "https://neurips.cc/"},
            {"id": "icml24", "title": "ICML", "year": 2024, "start": "2024-07-21",
             "end": "2024-07-27", "link": "https://icml.cc/"},
            {"id": "cvpr28", "title": "CVPR", "year": 2028, "start": "2028-06-01",
             "end": "2028-06-05", "link": "https://cvpr.thecvf.com/"},
        ],
        "locations": [
            {"id": "neurips26@main", "conferenceId": "neurips26", "role": "main",
             "city": "Sydney", "country": "Australia"},
            {"id": "emnlp26@main", "conferenceId": "emnlp26", "role": "main",
             "city": "Budapest", "country": "Hungary"},
        ],
    }  # fmt: skip
