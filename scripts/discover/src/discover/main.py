"""CLI: ``uv run --project scripts/discover discover [options]`` (from the repository root).

--mode upcoming            conferences starting within the next 12 months (default)
--mode backfill --since Y  past editions (ended before today) of year >= Y
--only ID[,ID...]          restrict to these conference ids
--dry-run                  write nothing; print evidence, cost, tool calls and the diff
--max-usd N                no further API calls once the estimated cost exceeds N (default 5)
--results-dir DIR          save each conference's API result there (default: a new temp dir)
--from-results DIR         re-run checks, merge and report on saved results (no API calls)
--out-dir DIR              (CI) also write pr.json and pr-body.md there for the PR job

Without ``--dry-run``, ``data/satellites.yml`` is written, the generated files are rebuilt
(``pnpm data:build``: geocodes new cities, refreshes ``data/build/data.json`` and the archive)
and the result is validated (``pnpm data:validate``). With ``--out-dir``, the data files a PR
carries (:func:`proposed_files`) are copied under ``<out-dir>/data/``. This script never commits,
pushes or opens PRs: ``.github/workflows/discover.yml`` does that in a separate job.
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any, TextIO

import anthropic

from . import agent
from .geo import Geocoder, cached_hit
from .merge import apply_plan, load_satellites, plan_changes, unified_diff
from .report import ConferenceRun, build_body, tool_log, total_usage
from .verify import MAX_FETCHES_PER_CONFERENCE, LimitedPages, PageFetcher, check_candidate_safely

REPO_ROOT = Path(__file__).resolve().parents[4]
SATELLITES = Path("data/satellites.yml")
GEOCACHE = Path("data/geocache.json")
DATA_JSON = Path("data/build/data.json")
ARCHIVE = Path("data/archive")
UPCOMING_DAYS = 365
MAX_PR_BODY = 60000  # GitHub limit is 65,536 characters
DEFAULT_MAX_USD = 5.0
# Every log line starts with this, so no untrusted text can start a line (GitHub Actions reads
# `::command` lines as workflow commands, after trimming leading whitespace).
LOG_PREFIX = "> "
# Never passed to subprocesses: pnpm (and its npm dependencies) needs no credentials.
SECRET_ENV = {"GH_TOKEN", "GITHUB_TOKEN"}


def say(text: Any = "", prefix: str = LOG_PREFIX, file: TextIO | None = None) -> None:
    """Print ``text`` with ``prefix`` on every line (see :data:`LOG_PREFIX`).

    Examples
    --------
    .. code-block:: python

        say("Researching neurips26", file=sys.stderr)  # "> Researching neurips26"
    """
    for line in str(text).splitlines() or [""]:
        print(prefix + line, file=file or sys.stdout)


def scrubbed_env() -> dict[str, str]:
    """The environment without Anthropic settings or GitHub tokens, for ``pnpm``.

    Examples
    --------
    .. code-block:: python

        subprocess.run(["pnpm", "data:validate"], env=scrubbed_env())
    """
    return {
        k: v
        for k, v in os.environ.items()
        if not k.startswith("ANTHROPIC_") and k not in SECRET_ENV
    }


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
    say(f"$ {' '.join(cmd)}", file=sys.stderr)
    proc = subprocess.run(
        cmd,
        cwd=cwd,
        env=scrubbed_env(),
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        errors="replace",
    )
    say(proc.stdout, prefix="pnpm> ", file=sys.stderr)
    return proc.returncode


def rebuild_and_validate(repo: Path) -> bool:
    """``pnpm data:build`` then ``pnpm data:validate``.

    ``data:validate`` checks ``data/build/data.json`` against ``satellites.yml`` (any added or
    updated satellite makes it stale) and requires every satellite city in
    ``data/geocache.json``; ``data:build`` geocodes new cities (Nominatim) and regenerates
    ``data.json`` and ``data/archive/`` from a fresh upstream clone.
    """
    return _run(["pnpm", "data:build"], repo) == 0 and _run(["pnpm", "data:validate"], repo) == 0


def proposed_files(repo: Path) -> list[Path]:
    """Data files a discovery PR carries, relative to ``repo``.

    The curated file and everything ``data:build`` writes; ``discover.yml`` commits exactly
    these paths.
    """
    archive = sorted(
        p.relative_to(repo) for p in (repo / ARCHIVE).glob("[0-9][0-9][0-9][0-9].json")
    )
    return [p for p in (SATELLITES, GEOCACHE, DATA_JSON, *archive) if (repo / p).is_file()]


def _result_path(results_dir: Path, conference_id: str) -> Path:
    return results_dir / f"{re.sub(r'[^A-Za-z0-9._-]', '_', conference_id)}.json"


def save_result(results_dir: Path, conference: dict[str, Any], research: agent.Research) -> None:
    """Persist one conference's (paid) API result as soon as it arrives."""
    results_dir.mkdir(parents=True, exist_ok=True)
    payload = {"conference": conference, "research": research.to_dict()}
    _result_path(results_dir, conference["id"]).write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
    )


def load_results(results_dir: Path) -> list[ConferenceRun]:
    """Saved results (from :func:`save_result`), sorted like :func:`select_conferences`."""
    runs = []
    for path in sorted(results_dir.glob("*.json")):
        d = json.loads(path.read_text())
        runs.append(ConferenceRun(d["conference"], agent.Research.from_dict(d["research"])))
    return sorted(runs, key=lambda r: (r.conference["start"], r.conference["id"]))


def research_all(
    client: Any,
    confs: list[dict[str, Any]],
    existing: list[dict[str, Any]],
    today: date,
    results_dir: Path,
    max_usd: float,
) -> list[ConferenceRun]:
    """One API call (plus continuations) per conference, within the ``max_usd`` budget."""
    runs: list[ConferenceRun] = []
    for conf in confs:
        run = ConferenceRun(conf)
        runs.append(run)
        spent = total_usage(runs).usd
        if spent >= max_usd:
            run.error = f"not researched: --max-usd budget (${max_usd:.2f}) reached"
            continue
        say(f"Researching {conf['id']} ({conf['title']} {conf['year']})…", file=sys.stderr)
        mine = [s for s in existing if s["parent"] == conf["id"]]
        try:
            run.research = agent.research(
                client, conf, mine, today.isoformat(), usd_limit=max_usd - spent
            )
        except (
            anthropic.AuthenticationError,
            anthropic.PermissionDeniedError,
            anthropic.BadRequestError,
        ):
            raise  # affects every conference: stop the run
        except (anthropic.APIStatusError, anthropic.APIConnectionError) as e:
            run.error = f"{type(e).__name__}: {e}"
            continue
        save_result(results_dir, conf, run.research)
    return runs


def _load_geocache(repo: Path) -> dict[str, Any]:
    path = repo / GEOCACHE
    return json.loads(path.read_text()) if path.exists() else {}


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="discover", description=__doc__.split("\n")[0])
    p.add_argument("--mode", choices=["upcoming", "backfill"], default="upcoming")
    p.add_argument("--since", type=int, help="first year for --mode backfill")
    p.add_argument("--only", action="append", default=[], help="conference id(s), comma-separated")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--max-usd", type=float, default=DEFAULT_MAX_USD)
    p.add_argument("--results-dir", type=Path)
    p.add_argument("--from-results", type=Path)
    p.add_argument("--out-dir", type=Path)
    p.add_argument("--repo-root", type=Path, default=REPO_ROOT)
    args = p.parse_args(argv)
    args.only = [i.strip() for chunk in args.only for i in chunk.split(",") if i.strip()]
    if args.mode == "backfill" and args.since is None and not args.from_results:
        p.error("--mode backfill needs --since YYYY")
    if args.out_dir and args.dry_run:
        p.error("--out-dir cannot be combined with --dry-run")
    if args.from_results and not args.from_results.is_dir():
        p.error(f"--from-results {args.from_results}: not a directory")
    return args


def main(
    argv: list[str] | None = None,
    client: Any = None,
    fetcher: Any = None,
    geocoder: Any = None,
    today: date | None = None,
) -> int:
    """Entry point. ``client``, ``fetcher``, ``geocoder`` and ``today`` are injectable for tests.

    Returns
    -------
    int
        0 on success; 1 if validation failed or any conference has no usable result (API
        error, refusal, stop reason other than ``end_turn``, unparseable output, budget).

    Examples
    --------
    .. code-block:: python

        main(["--only", "neurips26", "--dry-run"])
    """
    args = _parse_args(argv)
    repo: Path = args.repo_root
    today = today or datetime.now(UTC).date()
    data = json.loads((repo / DATA_JSON).read_text())
    sat_text = (repo / SATELLITES).read_text()
    existing = load_satellites(sat_text)

    results_dir: Path | None = None
    if args.from_results:
        runs = [
            r
            for r in load_results(args.from_results)
            if not args.only or r.conference["id"] in args.only
        ]
        mode = "from saved results"
    else:
        confs = select_conferences(data, args.mode, today, args.since, args.only)
        known = {c["id"] for c in data["conferences"]}
        for missing in sorted(set(args.only) - {c["id"] for c in confs}):
            why = "unknown id" if missing not in known else f"not selected by --mode {args.mode}"
            say(f"warning: --only {missing}: {why}", file=sys.stderr)
        if not confs:
            say("No conferences to research.")
            return 0
        results_dir = args.results_dir or Path(tempfile.mkdtemp(prefix="discover-results-"))
        say(f"Saving API results in {results_dir}", file=sys.stderr)
        runs = research_all(
            client or anthropic.Anthropic(), confs, existing, today, results_dir, args.max_usd
        )
        mode = f"`--mode {args.mode}`"
    try:
        return _process(args, repo, today, data, sat_text, existing, runs, mode, fetcher, geocoder)
    finally:
        if results_dir is not None:
            say(
                f"API results saved in {results_dir}; re-run without API calls with "
                f"--from-results {results_dir}",
                file=sys.stderr,
            )


def _process(
    args: argparse.Namespace,
    repo: Path,
    today: date,
    data: dict[str, Any],
    sat_text: str,
    existing: list[dict[str, Any]],
    runs: list[ConferenceRun],
    mode: str,
    fetcher: Any,
    geocoder: Any,
) -> int:
    """Checks, merge, report and (unless dry run) the validated ``satellites.yml`` write."""
    fetcher = fetcher or PageFetcher()
    geocache = _load_geocache(repo)
    geocoder = geocoder or Geocoder(geocache)
    for run in runs:
        if run.research and run.research.status == "ok":
            pages = LimitedPages(fetcher.get, MAX_FETCHES_PER_CONFERENCE)
            run.checked = [
                check_candidate_safely(raw, run.conference, pages, geocoder)
                for raw in run.research.candidates
            ]

    existing_coords = {
        s["id"]: (hit.lat, hit.lng)
        for s in existing
        if (hit := cached_hit(geocache, str(s.get("city", "")), str(s.get("country", ""))))
    }
    plan = plan_changes(existing, [c for run in runs for c in run.checked], existing_coords)
    new_text = apply_plan(sat_text, plan)
    weekly = len(select_conferences(data, "upcoming", today))
    counts = f"{len(plan.additions)} addition(s), {len(plan.applied)} update(s)"
    summary = (
        f"{counts}, {len(plan.suggestions)} suggestion(s) not applied, from {len(runs)} "
        f"conference(s) ({mode})."
    )
    rc = 1 if any(r.failed for r in runs) else 0

    if args.dry_run:
        say(build_body(runs, plan, summary, weekly, geocache))
        say("\n## Server tool calls\n\n" + (tool_log(runs) or "(none)"))
        diff = unified_diff(sat_text, new_text)
        say("\n## Proposed diff (not written)\n\n```diff\n" + (diff or "(no changes)\n") + "```")
        return rc

    if plan.empty:
        say(build_body(runs, plan, summary, weekly, geocache))
        say(f"No changes to write. {summary}")
        return rc
    (repo / SATELLITES).write_text(new_text)
    say(f"Wrote {SATELLITES}: {summary}")
    if not rebuild_and_validate(repo):
        say("data:build or data:validate failed; not proposing a PR.", file=sys.stderr)
        return 1
    # data:build may have geocoded the new cities: show the coordinates the map will use.
    body = build_body(runs, plan, summary, weekly, _load_geocache(repo))
    say(body)
    if args.out_dir:
        if len(body) > MAX_PR_BODY:
            body = body[:MAX_PR_BODY] + "\n\n…(truncated; see the workflow log)"
        args.out_dir.mkdir(parents=True, exist_ok=True)
        (args.out_dir / "pr-body.md").write_text(body)
        pr = {
            "title": f"Satellite discovery: {counts}",
            # Unverified defaults must be checked by a human before the PR can be merged.
            "draft": any(a.defaulted for a in plan.additions),
        }
        for rel in proposed_files(repo):
            (args.out_dir / rel).parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(repo / rel, args.out_dir / rel)
        (args.out_dir / "pr.json").write_text(json.dumps(pr) + "\n")
        say(f"Wrote PR title and body to {args.out_dir}")
    return rc
