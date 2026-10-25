import json
import shutil
import sys
import threading
from datetime import date
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import anthropic
import httpx
import pytest
from conftest import (
    ATLANTA_PAGE,
    ATLANTA_URL,
    SATELLITES_FIXTURE,
    FakeClient,
    FakeFetcher,
    FakeGeocoder,
    atlanta_candidate,
    ev,
    json_message,
    message,
    usage,
)

from discover import agent
from discover.main import (
    LOG_PREFIX,
    _run,
    main,
    research_all,
    say,
    scrubbed_env,
    select_conferences,
)

TODAY = date(2026, 10, 22)


def ids(confs: list[dict[str, Any]]) -> list[str]:
    return [c["id"] for c in confs]


def test_upcoming_window_and_shared_edition_dedupe(data_json: dict[str, Any]) -> None:
    confs = select_conferences(data_json, "upcoming", TODAY)
    assert ids(confs) == ["emnlp26", "neurips26"]  # cvpr28 too far, emnlp26ind same edition
    assert confs[1]["main_location"] == {"city": "Sydney", "country": "Australia"}


def test_backfill_and_only(data_json: dict[str, Any]) -> None:
    assert ids(select_conferences(data_json, "backfill", TODAY, since=2025)) == ["neurips25"]
    assert ids(select_conferences(data_json, "backfill", TODAY, since=2020)) == [
        "icml24",
        "neurips25",
    ]
    assert ids(select_conferences(data_json, "upcoming", TODAY, only=["neurips26"])) == [
        "neurips26"
    ]


@pytest.fixture
def repo(tmp_path: Path, data_json: dict[str, Any]) -> Path:
    (tmp_path / "repo" / "data" / "build").mkdir(parents=True)
    root = tmp_path / "repo"
    shutil.copy(SATELLITES_FIXTURE, root / "data" / "satellites.yml")
    (root / "data" / "build" / "data.json").write_text(json.dumps(data_json))
    return root


def run_main(repo: Path, *args: str, client: Any = None, fetcher: Any = None) -> int:
    results = repo.parent / "results"
    argv = ["--repo-root", str(repo), *args]
    if "--from-results" not in args:
        argv += ["--results-dir", str(results)]
    if "--workers" not in args:
        argv += ["--workers", "1"]  # FakeClient answers in call order
    return main(
        argv,
        client or FakeClient(),
        fetcher or FakeFetcher({ATLANTA_URL: ATLANTA_PAGE}),
        FakeGeocoder(),
        today=TODAY,
    )


PARIS_STUB = {
    "parent": "neurips26",
    "rationale": "dup",
    "city": ev("Paris", "https://neurips-europe.cc/", "NeurIPS 2026 in Paris"),
}


def test_dry_run_writes_nothing_and_reports(repo: Path, capsys: pytest.CaptureFixture[str]) -> None:
    before = (repo / "data" / "satellites.yml").read_text()
    client = FakeClient(json_message({"candidates": [atlanta_candidate(), PARIS_STUB]}))
    rc = run_main(repo, "--only", "neurips26", "--dry-run", client=client)
    captured = capsys.readouterr()
    out = captured.out
    assert rc == 0
    assert (repo / "data" / "satellites.yml").read_text() == before
    assert sorted(p.name for p in (repo / "data").iterdir()) == ["build", "satellites.yml"]
    assert "**add** `neurips26-atlanta`" in out
    assert "+- id: neurips26-atlanta" in out
    assert "dropped: missing verified required field(s)" in out  # the Paris stub
    assert "| `neurips26` | 1 |" in out  # cost row
    assert "Est. USD" in out and "projected weekly" in out
    assert "## New cities" in out and "33.7545, -84.3898" in out
    # Every log line carries the static prefix (no untrusted text starts a line).
    assert all(line.startswith(LOG_PREFIX) for line in out.splitlines())
    assert all(line.startswith(LOG_PREFIX) for line in captured.err.splitlines())
    assert (repo.parent / "results" / "neurips26.json").exists()
    assert "--from-results" in captured.err


def test_from_results_reruns_without_api_calls(
    repo: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    client = FakeClient(json_message({"candidates": [atlanta_candidate()]}))
    assert run_main(repo, "--only", "neurips26", "--dry-run", client=client) == 0
    first = capsys.readouterr().out
    no_api = FakeClient()  # any call would fail: no queued responses
    rc = run_main(repo, "--from-results", str(repo.parent / "results"), "--dry-run", client=no_api)
    second = capsys.readouterr().out
    assert rc == 0 and no_api.calls == []
    assert "**add** `neurips26-atlanta`" in first and "**add** `neurips26-atlanta`" in second


def _auth_error() -> anthropic.AuthenticationError:
    request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    return anthropic.AuthenticationError(
        "bad key", response=httpx.Response(401, request=request), body=None
    )


def test_paid_results_survive_a_crash(repo: Path) -> None:
    client = FakeClient(json_message({"candidates": []}), _auth_error())
    with pytest.raises(anthropic.AuthenticationError):
        run_main(repo, "--dry-run", client=client)  # emnlp26 then neurips26
    saved = json.loads((repo.parent / "results" / "emnlp26.json").read_text())
    assert saved["research"]["status"] == "ok" and saved["conference"]["id"] == "emnlp26"


def test_non_ok_results_count_as_failures(repo: Path, capsys: pytest.CaptureFixture[str]) -> None:
    refused = message([], stop_reason="refusal", stop_details=SimpleNamespace(category="cyber"))
    truncated = json_message({"candidates": []}, stop_reason="max_tokens")
    rc = run_main(repo, "--dry-run", client=FakeClient(refused, truncated))
    out = capsys.readouterr().out
    assert rc == 1
    assert "No result: `refusal`" in out and "No result: `error`" in out
    assert "Conferences without a usable result" in out


def test_max_usd_stops_further_calls(repo: Path, capsys: pytest.CaptureFixture[str]) -> None:
    costly = json_message({"candidates": []}, usage_=usage(1_000_000, 0))  # $4
    client = FakeClient(costly)
    rc = run_main(repo, "--dry-run", "--max-usd", "1", client=client)
    out = capsys.readouterr().out
    assert rc == 1 and len(client.calls) == 1
    assert "--max-usd budget ($1.00) reached" in out


def test_workers_research_conferences_concurrently(tmp_path: Path) -> None:
    # Both calls must be in flight at once to pass the barrier; results keep the target order.
    barrier = threading.Barrier(2, timeout=5)

    def ask_one(conf: dict[str, Any], usd_limit: float, on_response: Any) -> agent.Research:
        barrier.wait()
        research = agent.Research(conference_id=conf["id"], status="ok")
        on_response(research)
        return research

    targets = [{"id": i, "title": i.upper(), "year": 2026} for i in ("b-conf", "a-conf")]
    runs = research_all(targets, ask_one, tmp_path, max_usd=5.0, workers=2)
    assert [r.conference["id"] for r in runs] == ["b-conf", "a-conf"]
    assert all(r.research and r.research.status == "ok" for r in runs)
    assert sorted(p.name for p in tmp_path.glob("*.json")) == ["a-conf.json", "b-conf.json"]


def test_progress_lines_in_logs_keep_the_prefix(
    repo: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    empty = json_message({"candidates": []})
    run_main(repo, "--dry-run", "--workers", "2", client=FakeClient(empty, empty))
    err = capsys.readouterr().err.splitlines()
    assert all(line.startswith(LOG_PREFIX) for line in err)
    assert any("✓ emnlp26: 0 candidate(s), 1 turn(s)" in line for line in err)
    assert any("✓ neurips26: 0 candidate(s)" in line for line in err)
    # High-level steps, then one line per request whose evidence was checked.
    assert "> ▸ Checking evidence: fetching cited pages and geocoding cities" in err
    assert any(line.startswith("> checked emnlp26: kept 0 of 0 item(s)") for line in err)
    assert err[-1].startswith("> ▸ Finished in ")


def test_workers_must_be_positive(repo: Path) -> None:
    with pytest.raises(SystemExit):
        run_main(repo, "--dry-run", "--workers", "0")


def test_out_dir_cannot_be_combined_with_dry_run(repo: Path) -> None:
    with pytest.raises(SystemExit):
        run_main(repo, "--dry-run", "--out-dir", str(repo.parent / "out"))


def test_write_mode_validates_and_fails_on_invalid_data(
    repo: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    commands: list[list[str]] = []

    def fake_run(cmd: list[str], cwd: Path) -> int:
        commands.append(cmd)
        return 1  # data:build fails

    monkeypatch.setattr("discover.main._run", fake_run)
    client = FakeClient(json_message({"candidates": [atlanta_candidate()]}))
    out_dir = repo.parent / "out"
    rc = run_main(repo, "--only", "neurips26", "--out-dir", str(out_dir), client=client)
    assert rc == 1
    assert commands == [["pnpm", "data:build"]]  # nothing to validate without a rebuild
    assert "id: neurips26-atlanta" in (repo / "data" / "satellites.yml").read_text()
    assert not (out_dir / "pr.json").exists()  # no PR for invalid data


def test_write_mode_produces_a_draft_pr_when_defaults_were_used(
    repo: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("discover.main._run", lambda cmd, cwd: 0)
    raw = atlanta_candidate(access=None)
    client = FakeClient(json_message({"candidates": [raw]}))
    out_dir = repo.parent / "out"
    assert run_main(repo, "--only", "neurips26", "--out-dir", str(out_dir), client=client) == 0
    pr = json.loads((out_dir / "pr.json").read_text())
    assert pr == {"title": "Satellite discovery: 1 addition(s), 0 update(s)", "draft": True}
    body = (out_dir / "pr-body.md").read_text()
    top = body.index("## Needs human verification")
    assert top < body.index("## Evidence")
    assert "`neurips26-atlanta` `access`: UNVERIFIED default `authors_only`" in body
    assert "`official` = `true`: model judgement" in body


def test_write_mode_ready_pr_when_everything_has_evidence(
    repo: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("discover.main._run", lambda cmd, cwd: 0)
    client = FakeClient(json_message({"candidates": [atlanta_candidate()]}))
    out_dir = repo.parent / "out"
    assert run_main(repo, "--only", "neurips26", "--out-dir", str(out_dir), client=client) == 0
    assert json.loads((out_dir / "pr.json").read_text())["draft"] is False


def test_scrubbed_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for k in ("ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "GH_TOKEN", "GITHUB_TOKEN"):
        monkeypatch.setenv(k, "secret")
    monkeypatch.setenv("KEEP_ME", "1")
    env = scrubbed_env()
    assert env["KEEP_ME"] == "1"
    assert not any(k.startswith("ANTHROPIC_") or k in ("GH_TOKEN", "GITHUB_TOKEN") for k in env)


def test_say_prefixes_every_line(capsys: pytest.CaptureFixture[str]) -> None:
    say("first\n::set-output name=x::y\r\n  ::warning::z")
    assert capsys.readouterr().out.splitlines() == [
        "> first",
        "> ::set-output name=x::y",
        ">   ::warning::z",
    ]


def test_subprocess_output_is_prefixed_and_env_scrubbed(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("GH_TOKEN", "secret")
    code = "import os; print('::error::x'); print(os.environ.get('GH_TOKEN'))"
    assert _run([sys.executable, "-c", code], tmp_path) == 0
    err = capsys.readouterr().err.splitlines()
    assert "pnpm> ::error::x" in err and "pnpm> None" in err


PARIS_URL = "https://neurips-europe.cc/"
PARIS_PAGE = "NeurIPS 2026 Paris runs December 9–14, 2026 in Paris, France."


def test_update_only_proposal_is_rebuilt_and_carries_the_generated_files(
    repo: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # A verified date change alone makes data.json stale: data:build must run before
    # data:validate, and the PR must carry every file it rewrites.
    commands: list[list[str]] = []

    def fake_run(cmd: list[str], cwd: Path) -> int:
        commands.append(cmd)
        if cmd == ["pnpm", "data:build"]:
            (cwd / "data" / "build" / "data.json").write_text('{"rebuilt": true}')
            (cwd / "data" / "archive").mkdir(exist_ok=True)
            (cwd / "data" / "archive" / "2026.json").write_text("{}")
            (cwd / "data" / "archive" / "notes.txt").write_text("not a year file")
            (cwd / "data" / "geocache.json").write_text("{}")
        return 0

    monkeypatch.setattr("discover.main._run", fake_run)
    paris = {
        "parent": "neurips26",
        "rationale": "Existing satellite; the end date moved.",
        "name": ev("NeurIPS 2026 Paris", PARIS_URL, "NeurIPS 2026 Paris"),
        "link": ev(PARIS_URL, PARIS_URL, "NeurIPS 2026 Paris"),
        "city": ev("Paris", PARIS_URL, "NeurIPS 2026 Paris"),
        "country": ev("France", PARIS_URL, "NeurIPS 2026 Paris"),
        "start": ev("2026-12-09", PARIS_URL, "December 9–14, 2026"),
        "end": ev("2026-12-14", PARIS_URL, "December 9–14, 2026"),
    }
    client = FakeClient(json_message({"candidates": [paris]}))
    out_dir = repo.parent / "out"
    rc = run_main(
        repo,
        "--only",
        "neurips26",
        "--out-dir",
        str(out_dir),
        client=client,
        fetcher=FakeFetcher({PARIS_URL: PARIS_PAGE}),
    )
    assert rc == 0
    assert commands == [["pnpm", "data:build"], ["pnpm", "data:validate"]]
    pr = json.loads((out_dir / "pr.json").read_text())
    assert pr["title"] == "Satellite discovery: 0 addition(s), 1 update(s)"
    copied = sorted(str(p.relative_to(out_dir)) for p in (out_dir / "data").rglob("*"))
    assert copied == [
        "data/archive",
        "data/archive/2026.json",
        "data/build",
        "data/build/data.json",
        "data/geocache.json",
        "data/satellites.yml",
    ]
    assert (out_dir / "data" / "build" / "data.json").read_text() == '{"rebuilt": true}'
    assert "end: '2026-12-14'" in (out_dir / "data" / "satellites.yml").read_text()
