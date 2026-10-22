import json
import shutil
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import pytest
from conftest import (
    ATLANTA_PAGE,
    ATLANTA_URL,
    REPO,
    FakeClient,
    FakeFetcher,
    atlanta_candidate,
    ev,
    json_message,
)

from discover.main import main, select_conferences
from discover.report import code, link

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
    (tmp_path / "data" / "build").mkdir(parents=True)
    shutil.copy(REPO / "data" / "satellites.yml", tmp_path / "data" / "satellites.yml")
    # main() uses the real date: keep neurips26 upcoming whenever the test runs.
    soon = date.today() + timedelta(days=30)
    data_json["conferences"][0]["start"] = soon.isoformat()
    data_json["conferences"][0]["end"] = (soon + timedelta(days=4)).isoformat()
    (tmp_path / "data" / "build" / "data.json").write_text(json.dumps(data_json))
    return tmp_path


def test_dry_run_writes_nothing_and_reports(repo: Path, capsys: pytest.CaptureFixture[str]) -> None:
    before = (repo / "data" / "satellites.yml").read_text()
    paris = {
        "parent": "neurips26",
        "rationale": "dup",
        "city": ev("Paris", "https://neurips-europe.cc/", "in Paris"),
    }
    client = FakeClient(json_message({"candidates": [atlanta_candidate(), paris]}))
    fetcher = FakeFetcher({ATLANTA_URL: ATLANTA_PAGE})
    rc = main(["--only", "neurips26", "--dry-run", "--repo-root", str(repo)], client, fetcher)
    out = capsys.readouterr().out
    assert rc == 0
    assert (repo / "data" / "satellites.yml").read_text() == before
    assert sorted(p.name for p in (repo / "data").iterdir()) == ["build", "satellites.yml"]
    assert "**add** `neurips26-atlanta`" in out
    assert "+- id: neurips26-atlanta" in out
    assert "dropped: missing verified required field(s)" in out  # the Paris stub
    assert "| `neurips26` | 1 |" in out  # cost row
    assert "Est. USD" in out and "projected weekly" in out


def test_open_pr_refused_outside_ci(repo: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GITHUB_ACTIONS", raising=False)
    with pytest.raises(SystemExit):
        main(["--open-pr", "--repo-root", str(repo)], FakeClient(), FakeFetcher({}))


def test_markdown_escaping() -> None:
    assert code("a | b `c`\n@team") == "`a \\| b 'c' @team`"
    assert code(True) == "`true`"
    assert link("https://x.org/a b|c>") == "<https://x.org/a%20b%7Cc%3E>"


def test_write_mode_validates_and_fails_on_invalid_data(
    repo: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    commands: list[list[str]] = []

    def fake_run(cmd: list[str], cwd: Path) -> int:
        commands.append(cmd)
        return 1  # data:validate (and data:build) fail

    monkeypatch.setattr("discover.main._run", fake_run)
    client = FakeClient(json_message({"candidates": [atlanta_candidate()]}))
    fetcher = FakeFetcher({ATLANTA_URL: ATLANTA_PAGE})
    rc = main(["--only", "neurips26", "--repo-root", str(repo)], client, fetcher)
    assert rc == 1
    assert commands == [["pnpm", "data:validate"], ["pnpm", "data:build"]]
    assert "id: neurips26-atlanta" in (repo / "data" / "satellites.yml").read_text()
