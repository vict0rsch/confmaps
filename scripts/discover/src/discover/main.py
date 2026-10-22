"""CLI: ``uv run --project scripts/discover discover [options]`` (from the repository root).

--mode upcoming            conferences starting within the next 12 months (default)
--mode backfill --since Y  past editions (ended before today) of year >= Y
--only ID[,ID...]          restrict to these conference ids
--dry-run                  write nothing, open no PR; print diff, evidence and cost
--open-pr                  (CI only) commit satellites.yml (+ geocache.json), push, open a PR
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

import anthropic

from . import agent
from .merge import apply_plan, load_satellites, plan_changes, unified_diff
from .report import ConferenceRun, code, cost_section, evidence_section, tool_log
from .verify import PageFetcher, check_candidate

REPO_ROOT = Path(__file__).resolve().parents[4]
SATELLITES = Path("data/satellites.yml")
GEOCACHE = Path("data/geocache.json")
DATA_JSON = Path("data/build/data.json")
UPCOMING_DAYS = 365
MAX_PR_BODY = 60000  # GitHub limit is 65,536 characters


def select_conferences(
    data: dict[str, Any],
    mode: str,
    today: date,
    since: int | None = None,
    only: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Conferences to research, with their main location, as given to the model.

    Editions sharing link and dates (e.g. EMNLP and its Industry / Demo tracks) are researched
    once, under the shortest id.

    Parameters
    ----------
    data : dict
        Parsed ``data/build/data.json``.
    mode : {"upcoming", "backfill"}
        ``upcoming``: start within the next 12 months. ``backfill``: ended before ``today``
        and ``year >= since``.
    today : date
        Reference date.
    since : int, optional
        First year for ``backfill``.
    only : list of str, optional
        Restrict to these conference ids.

    Returns
    -------
    list of dict
        Prompt-ready conference records, sorted by start date.

    Examples
    --------
    .. code-block:: python

        confs = select_conferences(data, "upcoming", date.today(), only=["neurips26"])
    """
    mains = {loc["conferenceId"]: loc for loc in data["locations"] if loc["role"] == "main"}
    horizon = (today + timedelta(days=UPCOMING_DAYS)).isoformat()
    iso_today = today.isoformat()
    picked: dict[tuple[str, str, str], dict[str, Any]] = {}
    for c in sorted(data["conferences"], key=lambda c: (len(c["id"]), c["id"])):
        if mode == "upcoming":
            keep = iso_today <= c["start"] <= horizon
        else:
            keep = c["end"] < iso_today and since is not None and c["year"] >= since
        if not keep or (only and c["id"] not in only):
            continue
        key = (c["link"].rstrip("/"), c["start"], c["end"])
        if key in picked:
            continue
        main = mains.get(c["id"], {})
        picked[key] = {
            "id": c["id"],
            "title": c["title"],
            **({"fullName": c["fullName"]} if c.get("fullName") else {}),
            "year": c["year"],
            "start": c["start"],
            "end": c["end"],
            "link": c["link"],
            "main_location": {k: main[k] for k in ("city", "country", "venue") if main.get(k)},
        }
    return sorted(picked.values(), key=lambda c: (c["start"], c["id"]))


def _run(cmd: list[str], cwd: Path) -> int:
    print(f"$ {' '.join(cmd)}", file=sys.stderr)
    # The pipeline (and its npm dependencies) never needs the API key.
    env = {k: v for k, v in os.environ.items() if not k.startswith("ANTHROPIC_")}
    return subprocess.run(cmd, cwd=cwd, env=env, check=False).returncode


def validate(repo: Path, has_additions: bool) -> bool:
    """``pnpm data:validate``; if it fails and cities were added, geocode them and retry.

    ``data:validate`` requires every satellite city in ``data/geocache.json``; ``data:build``
    is the pipeline step that geocodes new cities (Nominatim) and refreshes ``data.json``.
    """
    if _run(["pnpm", "data:validate"], repo) == 0:
        return True
    if not has_additions:
        return False
    print("Validation failed; running data:build to geocode new satellite cities.", file=sys.stderr)
    if _run(["pnpm", "data:build"], repo) != 0:
        return False
    return _run(["pnpm", "data:validate"], repo) == 0


def open_pr(repo: Path, title: str, body: str) -> None:
    """Commit only the curated files on a new branch, push it and open a PR (never merged)."""

    def git(*args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(["git", *args], cwd=repo, check=True, text=True, capture_output=True)

    branch = f"discover/{datetime.now(UTC):%Y-%m-%d-%H%M%S}"
    git("checkout", "-b", branch)
    paths = [str(SATELLITES)]
    if subprocess.run(
        ["git", "diff", "--quiet", "--", str(GEOCACHE)], cwd=repo, check=False
    ).returncode:
        paths.append(str(GEOCACHE))
    git("add", "--", *paths)
    git("commit", "-m", title, "--", *paths)
    git("push", "-u", "origin", branch)
    with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False) as f:
        f.write(body)
    subprocess.run(
        ["gh", "pr", "create", "--title", title, "--body-file", f.name, "--head", branch],
        cwd=repo,
        check=True,
    )


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="discover", description=__doc__.split("\n")[0])
    p.add_argument("--mode", choices=["upcoming", "backfill"], default="upcoming")
    p.add_argument("--since", type=int, help="first year for --mode backfill")
    p.add_argument("--only", action="append", default=[], help="conference id(s), comma-separated")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--open-pr", action="store_true")
    p.add_argument("--repo-root", type=Path, default=REPO_ROOT)
    args = p.parse_args(argv)
    args.only = [i.strip() for chunk in args.only for i in chunk.split(",") if i.strip()]
    if args.mode == "backfill" and args.since is None:
        p.error("--mode backfill needs --since YYYY")
    if args.open_pr and args.dry_run:
        p.error("--open-pr cannot be combined with --dry-run")
    if args.open_pr and os.environ.get("GITHUB_ACTIONS") != "true":
        p.error("--open-pr only runs in GitHub Actions")
    return args


def main(argv: list[str] | None = None, client: Any = None, fetcher: Any = None) -> int:
    """Entry point. ``client`` / ``fetcher`` are injectable for tests.

    Returns
    -------
    int
        0 on success; 1 if validation failed or any conference hit an API error.

    Examples
    --------
    .. code-block:: python

        main(["--only", "neurips26", "--dry-run"])
    """
    args = _parse_args(argv)
    repo: Path = args.repo_root
    today = datetime.now(UTC).date()
    data = json.loads((repo / DATA_JSON).read_text())
    sat_text = (repo / SATELLITES).read_text()
    existing = load_satellites(sat_text)

    confs = select_conferences(data, args.mode, today, args.since, args.only)
    known = {c["id"] for c in data["conferences"]}
    for missing in sorted(set(args.only) - {c["id"] for c in confs}):
        why = "unknown id" if missing not in known else f"not selected by --mode {args.mode}"
        print(f"warning: --only {missing}: {why}", file=sys.stderr)
    if not confs:
        print("No conferences to research.")
        return 0

    client = client or anthropic.Anthropic()
    fetcher = fetcher or PageFetcher()
    runs: list[ConferenceRun] = []
    for conf in confs:
        print(f"Researching {conf['id']} ({conf['title']} {conf['year']})…", file=sys.stderr)
        run = ConferenceRun(conf)
        runs.append(run)
        mine = [s for s in existing if s["parent"] == conf["id"]]
        try:
            run.research = agent.research(client, conf, mine, today.isoformat())
        except (
            anthropic.AuthenticationError,
            anthropic.PermissionDeniedError,
            anthropic.BadRequestError,
        ):
            raise  # affects every conference: stop the run
        except (anthropic.APIStatusError, anthropic.APIConnectionError) as e:
            run.error = f"{type(e).__name__}: {e}"
            continue
        main_city = conf["main_location"].get("city")
        run.checked = [
            check_candidate(raw, conf["id"], main_city, fetcher.get)
            for raw in run.research.candidates
        ]

    plan = plan_changes(existing, [c for run in runs for c in run.checked])
    new_text = apply_plan(sat_text, plan)
    weekly = len(select_conferences(data, "upcoming", today))
    summary = (
        f"{len(plan.additions)} addition(s), {len(plan.updates)} update(s) from "
        f"{len(runs)} conference(s) (`--mode {args.mode}`)."
    )
    body = "\n\n".join(
        [
            (
                "Proposed by the satellite discovery agent (`scripts/discover`, DESIGN.md §4). "
                "**Review before merging**: each kept quote was found on its source page by "
                "this script, but values and the inclusion rule still need a human check."
            ),
            summary,
            "## Evidence",
            evidence_section(runs, plan),
            "## Cost",
            cost_section(runs, weekly),
        ]
    )
    failed = [r.conference["id"] for r in runs if r.error]
    print(body)

    if args.dry_run:
        print("\n## Server tool calls\n\n" + (tool_log(runs) or "(none)"))
        diff = unified_diff(sat_text, new_text)
        print("\n## Proposed diff (not written)\n\n```diff\n" + (diff or "(no changes)\n") + "```")
        return 1 if failed else 0

    if plan.empty:
        print(f"No changes. {summary}")
        return 1 if failed else 0
    (repo / SATELLITES).write_text(new_text)
    print(f"Wrote {SATELLITES}: {summary}")
    if not validate(repo, bool(plan.additions)):
        print("data:validate failed; not opening a PR.", file=sys.stderr)
        return 1
    if args.open_pr:
        if failed:
            body += "\n\nConferences with API errors (not researched): " + ", ".join(
                code(i) for i in failed
            )
        if len(body) > MAX_PR_BODY:
            body = body[:MAX_PR_BODY] + "\n\n…(truncated; see the workflow log)"
        open_pr(repo, f"Satellite discovery: {summary.split(' from ')[0]}", body)
    return 1 if failed else 0
