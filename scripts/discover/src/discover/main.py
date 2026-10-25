"""CLI: ``uv run --project scripts/discover discover [options]`` (from the repository root).

Satellites (``data/satellites.yml``):

--mode upcoming            conferences starting within the next 12 months (default)
--mode backfill --since Y  past editions (ended before today) of year >= Y, virtual editions
                           excluded. Every past edition counts (≈345 more once the PwC import
                           lands), so restrict it with --only: one API call per conference.
--only ID[,ID...]          restrict to these conference ids

Past main editions (``data/past_conferences.yml``, docs/backfill-spec.md §5):

--mode past --series S[,S...] --since Y [--until Y2] [--recheck]
                           years Y..Y2 (default: last year) of each series with no recorded
                           edition; one API call per series and batch of up to 6 years.
                           --recheck also re-verifies recorded `source: pwc` editions in the
                           range (the COVID pass). Dry-run one series first to measure cost.

Common:

--dry-run                  write nothing; print evidence, cost, tool calls and the diff
--max-usd N                no further API calls once the estimated cost exceeds N (default 5)
--workers N                research up to N conferences (or past batches) at once (default 4).
                           A request starts only if the cost so far, plus the average cost of a
                           finished request for each one in flight, stays under --max-usd; the
                           requests in flight can still take the final cost past it.
--results-dir DIR          save each request's API result there (default: a new temp dir)
--from-results DIR         re-run checks, merge and report on saved results (no API calls;
                           with --mode past for past-mode results)
--out-dir DIR              (CI) also write pr.json and pr-body.md there for the PR job

Without ``--dry-run``, the curated file is written, the generated files are rebuilt
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
import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any, Self, TextIO

import anthropic
from rich.console import Console
from rich.markup import escape
from rich.progress import (
    BarColumn,
    Progress,
    SpinnerColumn,
    TaskID,
    TextColumn,
    TimeElapsedColumn,
)
from rich.text import Text

from . import agent, past_agent
from .cost import Usage
from .geo import Geocoder, cached_hit
from .merge import Plan, apply_plan, load_satellites, plan_changes, unified_diff
from .past import check_and_plan, plan_batches
from .report import PAST_INTRO, ConferenceRun, build_body, tool_log
from .verify import MAX_FETCHES_PER_CONFERENCE, LimitedPages, PageFetcher, check_candidate_safely
from .yamlio import load_entries

REPO_ROOT = Path(__file__).resolve().parents[4]
SATELLITES = Path("data/satellites.yml")
PAST = Path("data/past_conferences.yml")
GEOCACHE = Path("data/geocache.json")
DATA_JSON = Path("data/build/data.json")
ARCHIVE = Path("data/archive")
UPCOMING_DAYS = 365
MAX_PR_BODY = 60000  # GitHub limit is 65,536 characters
DEFAULT_MAX_USD = 5.0
DEFAULT_WORKERS = 4
SERIES_RE = re.compile(r"^[a-z0-9-]+$")
MIN_YEAR, MAX_YEAR = 1950, 2100  # PastConferenceSchema year range
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
    once, under the shortest id. Virtual editions (no city, so no satellites) are skipped.

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
        main = mains.get(c["id"], {})
        if key in picked or main.get("format") == "virtual":
            continue
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
    return [p for p in (SATELLITES, PAST, GEOCACHE, DATA_JSON, *archive) if (repo / p).is_file()]


def _result_path(results_dir: Path, conference_id: str) -> Path:
    return results_dir / f"{re.sub(r'[^A-Za-z0-9._-]', '_', conference_id)}.json"


def save_result(
    results_dir: Path, conference: dict[str, Any], research: agent.Research, mode: str
) -> None:
    """Persist one request's (paid) API result as soon as it arrives."""
    results_dir.mkdir(parents=True, exist_ok=True)
    payload = {"mode": mode, "conference": conference, "research": research.to_dict()}
    _result_path(results_dir, conference["id"]).write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
    )


def load_results(results_dir: Path, mode: str = "satellites") -> list[ConferenceRun]:
    """Saved results of one mode (``satellites`` or ``past``, from :func:`save_result`), sorted
    like :func:`select_conferences` (past batches: by id, i.e. series then first year)."""
    runs = []
    for path in sorted(results_dir.glob("*.json")):
        d = json.loads(path.read_text())
        if d.get("mode", "satellites") == mode:
            runs.append(ConferenceRun(d["conference"], agent.Research.from_dict(d["research"])))
    return sorted(runs, key=lambda r: (r.conference.get("start", ""), r.conference["id"]))


class ResearchProgress:
    """Live progress of :func:`research_all`, safe to call from worker threads.

    On a terminal: a rich display with one bar for the whole run (requests done, estimated cost
    against the budget) and one row per request in flight (turns, tool calls, cost so far), plus
    one line per finished request. Elsewhere (CI logs, tests): one :func:`say` line when a
    request starts and one when it ends, so every line keeps :data:`LOG_PREFIX`.

    Examples
    --------
    .. code-block:: python

        with ResearchProgress(total=len(targets), max_usd=5.0) as progress:
            progress.start(conf)
            progress.finish(run, spent=0.42)
    """

    def __init__(self, total: int, max_usd: float, console: Console | None = None) -> None:
        self.max_usd = max_usd
        self.console = console or Console(stderr=True)
        self.rows: dict[str, TaskID] = {}
        self.live: Progress | None = None
        if self.console.is_terminal:
            self.live = Progress(
                SpinnerColumn(),
                TextColumn("{task.description}"),
                BarColumn(),
                TextColumn("{task.fields[info]}"),
                TimeElapsedColumn(),
                console=self.console,
            )
            self.overall = self.live.add_task(
                f"[bold]{total} request(s)", total=total, info=self._budget(0.0)
            )

    def __enter__(self) -> Self:
        if self.live:
            self.live.start()
        return self

    def __exit__(self, *exc: object) -> None:
        if self.live:
            self.live.stop()

    def _budget(self, spent: float) -> str:
        return f"~${spent:.2f} of ${self.max_usd:.2f}"

    @staticmethod
    def _label(conf: dict[str, Any]) -> str:
        return f"{conf['id']} ({conf['title']} {conf['year']})"

    def start(self, conf: dict[str, Any]) -> None:
        """A request is about to be sent."""
        if not self.live:
            say(f"Researching {self._label(conf)}…", file=sys.stderr)
            return
        # Titles come from upstream data: never read them as rich markup.
        self.rows[conf["id"]] = self.live.add_task(
            escape(self._label(conf)), total=None, info="waiting for the first response"
        )

    def update(self, conf: dict[str, Any], research: agent.Research) -> None:
        """An API response arrived for ``conf`` (a request can take several turns)."""
        if self.live and conf["id"] in self.rows:
            info = (
                f"{research.usage.requests} turn(s) · {len(research.tool_calls)} tool call(s)"
                f" · ~${research.usage.usd:.2f}"
            )
            self.live.update(self.rows[conf["id"]], info=info)

    def finish(self, run: ConferenceRun, spent: float) -> None:
        """``run`` is done (researched, failed or skipped); ``spent`` is the run's total."""
        r, cid = run.research, run.conference["id"]
        if run.error or r is None:
            line = f"✗ {cid}: {run.error}"
        elif r.status == "ok":
            line = (
                f"✓ {cid}: {len(r.candidates)} candidate(s), {r.usage.requests} turn(s), "
                f"{len(r.tool_calls)} tool call(s), ~${r.usage.usd:.2f}"
            )
        else:
            line = f"✗ {cid}: {r.status} ({r.detail})"
        if not self.live:
            say(f"{line} (total ~${spent:.2f})", file=sys.stderr)
            return
        row = self.rows.pop(cid, None)
        if row is not None:
            self.live.remove_task(row)
        self.live.console.print(Text(line))  # Text: no markup or highlighting of model output
        self.live.update(self.overall, advance=1, info=self._budget(spent))


def research_all(
    targets: list[dict[str, Any]],
    ask_one: Callable[[dict[str, Any], float, Callable[[agent.Research], None]], agent.Research],
    results_dir: Path,
    max_usd: float,
    mode: str = "satellites",
    workers: int = 1,
    console: Console | None = None,
) -> list[ConferenceRun]:
    """One API call (plus continuations) per target, up to ``workers`` at once, within budget.

    ``ask_one(target, usd_limit, on_response)`` makes the call (conference → satellites, batch →
    editions) and calls ``on_response`` after each API response. A request starts only while the
    estimated cost so far, plus the average cost of a finished request for each request still in
    flight, is below ``max_usd``. Results keep the order of ``targets``. An authentication,
    permission or bad-request error stops the run: queued requests are cancelled and requests in
    flight finish (their results are saved).

    Examples
    --------
    .. code-block:: python

        runs = research_all(confs, ask_one, Path("results"), max_usd=5.0, workers=4)
    """
    runs = [ConferenceRun(t) for t in targets]
    usage: dict[int, Usage] = {}  # latest usage per request (by index), finished or in flight
    in_flight: set[int] = set()
    finished: set[int] = set()
    lock = threading.Lock()

    def spent() -> float:
        with lock:
            return sum(u.usd for u in usage.values())

    def reserve(i: int) -> float | None:
        """Start request ``i`` if the projected cost allows it; return the cost so far."""
        with lock:
            used = sum(u.usd for u in usage.values())
            # Requests in flight will likely cost about as much as the finished ones did.
            done = [usage[j].usd for j in finished if j in usage]
            projected = used + (sum(done) / len(done) if done else 0.0) * len(in_flight)
            if projected >= max_usd:
                return None
            in_flight.add(i)
            return used

    def research_one(i: int, run: ConferenceRun, progress: ResearchProgress) -> None:
        conf = run.conference
        used = reserve(i)
        if used is None:
            run.error = f"not researched: --max-usd budget (${max_usd:.2f}) reached"
            progress.finish(run, spent())
            return
        progress.start(conf)

        def on_response(research: agent.Research) -> None:
            with lock:
                usage[i] = research.usage
            progress.update(conf, research)

        try:
            run.research = ask_one(conf, max_usd - used, on_response)
        except (
            anthropic.AuthenticationError,
            anthropic.PermissionDeniedError,
            anthropic.BadRequestError,
        ):
            raise  # affects every conference: stop the run
        except (anthropic.APIStatusError, anthropic.APIConnectionError) as e:
            run.error = f"{type(e).__name__}: {e}"
        else:
            with lock:
                usage[i] = run.research.usage
            save_result(results_dir, conf, run.research, mode)
        finally:
            with lock:
                in_flight.discard(i)
                finished.add(i)
        progress.finish(run, spent())

    with (
        ResearchProgress(len(runs), max_usd, console) as progress,
        ThreadPoolExecutor(max_workers=workers) as pool,
    ):
        futures = [pool.submit(research_one, i, run, progress) for i, run in enumerate(runs)]
        try:
            for future in as_completed(futures):
                future.result()
        except BaseException:
            pool.shutdown(wait=False, cancel_futures=True)
            raise
    return runs


def _load_geocache(repo: Path) -> dict[str, Any]:
    path = repo / GEOCACHE
    return json.loads(path.read_text()) if path.exists() else {}


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="discover", description=__doc__.split("\n")[0])
    p.add_argument("--mode", choices=["upcoming", "backfill", "past"], default="upcoming")
    p.add_argument("--since", type=int, help="first year for --mode backfill / past")
    p.add_argument("--until", type=int, help="last year for --mode past (default: last year)")
    p.add_argument("--only", action="append", default=[], help="conference id(s), comma-separated")
    p.add_argument("--series", action="append", default=[], help="series key(s), comma-separated")
    p.add_argument("--recheck", action="store_true", help="also re-verify source: pwc editions")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--max-usd", type=float, default=DEFAULT_MAX_USD)
    p.add_argument("--workers", type=int, default=DEFAULT_WORKERS)
    p.add_argument("--results-dir", type=Path)
    p.add_argument("--from-results", type=Path)
    p.add_argument("--out-dir", type=Path)
    p.add_argument("--repo-root", type=Path, default=REPO_ROOT)
    args = p.parse_args(argv)
    args.only = [i.strip() for chunk in args.only for i in chunk.split(",") if i.strip()]
    args.series = [s.strip() for chunk in args.series for s in chunk.split(",") if s.strip()]
    if args.mode == "backfill" and args.since is None and not args.from_results:
        p.error("--mode backfill needs --since YYYY")
    if args.mode == "past":
        if args.only:
            p.error("--only applies to satellite modes; use --series with --mode past")
        if not args.from_results and (not args.series or args.since is None):
            p.error("--mode past needs --series S[,S...] and --since YYYY")
        for s in args.series:
            if not SERIES_RE.fullmatch(s):
                p.error(f"--series {s!r}: series keys are lowercase letters, digits and dashes")
        for name in ("since", "until"):
            year = getattr(args, name)
            if year is not None and not MIN_YEAR <= year <= MAX_YEAR:
                p.error(f"--{name} {year}: not a year in {MIN_YEAR}..{MAX_YEAR}")
        if args.since is not None and args.until is not None and args.until < args.since:
            p.error("--until is before --since")
    else:
        for flag, used in (("--series", args.series), ("--until", args.until is not None),
                           ("--recheck", args.recheck)):  # fmt: skip
            if used:
                p.error(f"{flag} only applies to --mode past")
    if args.max_usd < 0:
        p.error("--max-usd must not be negative")
    if args.workers < 1:
        p.error("--workers must be at least 1")
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
    if args.mode == "past":
        return _main_past(args, repo, today, data, client, fetcher, geocoder)
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
        results_dir = _results_dir(args)
        client = client or anthropic.Anthropic()

        def ask_one(
            conf: dict[str, Any],
            usd_limit: float,
            on_response: Callable[[agent.Research], None],
        ) -> agent.Research:
            mine = [s for s in existing if s["parent"] == conf["id"]]
            return agent.research(
                client, conf, mine, today.isoformat(), usd_limit=usd_limit, on_response=on_response
            )

        runs = research_all(confs, ask_one, results_dir, args.max_usd, workers=args.workers)
        mode = f"`--mode {args.mode}`"
    try:
        return _process(args, repo, today, data, sat_text, existing, runs, mode, fetcher, geocoder)
    finally:
        _results_hint(results_dir)


def _results_dir(args: argparse.Namespace) -> Path:
    results_dir = args.results_dir or Path(tempfile.mkdtemp(prefix="discover-results-"))
    say(f"Saving API results in {results_dir}", file=sys.stderr)
    return results_dir


def _results_hint(results_dir: Path | None) -> None:
    if results_dir is not None:
        say(
            f"API results saved in {results_dir}; re-run without API calls with "
            f"--from-results {results_dir}",
            file=sys.stderr,
        )


def _main_past(
    args: argparse.Namespace,
    repo: Path,
    today: date,
    data: dict[str, Any],
    client: Any,
    fetcher: Any,
    geocoder: Any,
) -> int:
    """``--mode past``: research (or replay), check, merge and propose past editions."""
    past_path = repo / PAST
    past_text = past_path.read_text() if past_path.exists() else ""
    past = load_entries(past_text)
    results_dir: Path | None = None
    if args.from_results:
        runs = load_results(args.from_results, "past")
        if args.series:
            runs = [r for r in runs if r.conference["series"] in args.series]
        mode = "from saved results"
    else:
        until = args.until if args.until is not None else today.year - 1
        batches, unknown = plan_batches(data, past, args.series, args.since, until, args.recheck)
        if unknown:
            say(
                "error: no recorded edition for series " + ", ".join(unknown) + " (series keys "
                "come from data/build/data.json `series` or seriesOf(title) of a past entry)",
                file=sys.stderr,
            )
            return 1
        if not batches:
            say("No editions to research.")
            return 0
        results_dir = _results_dir(args)
        client = client or anthropic.Anthropic()

        def ask_one(
            batch: dict[str, Any],
            usd_limit: float,
            on_response: Callable[[agent.Research], None],
        ) -> agent.Research:
            return past_agent.research(
                client, batch, today.isoformat(), usd_limit=usd_limit, on_response=on_response
            )

        runs = research_all(
            batches, ask_one, results_dir, args.max_usd, mode="past", workers=args.workers
        )
        mode = f"`--mode past{' --recheck' if args.recheck else ''}`"
    try:
        fetcher = fetcher or PageFetcher()
        geocache = _load_geocache(repo)
        geocoder = geocoder or Geocoder(geocache)
        plan, new_text = check_and_plan(runs, data, past, past_text, fetcher.get, geocoder, today)
        counts = f"{len(plan.additions)} addition(s), {len(plan.applied)} update(s)"
        summary = (
            f"{counts}, {len(plan.suggestions)} suggestion(s) not applied, "
            f"{len(plan.removals)} reported cancellation(s) to remove by hand, from "
            f"{len(runs)} request(s) ({mode})."
        )
        return _propose(
            args,
            repo,
            PAST,
            past_text,
            new_text,
            runs,
            plan,
            summary,
            lambda cache: build_body(runs, plan, summary, None, cache, PAST_INTRO),
            {
                "title": f"Past editions: {counts}",
                # Unverified defaults and cancellations need a human before the PR can merge.
                "draft": any(a.defaulted for a in plan.additions) or bool(plan.removals),
            },
        )
    finally:
        _results_hint(results_dir)


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
    return _propose(
        args,
        repo,
        SATELLITES,
        sat_text,
        new_text,
        runs,
        plan,
        summary,
        lambda cache: build_body(runs, plan, summary, weekly, cache),
        {
            "title": f"Satellite discovery: {counts}",
            # Unverified defaults must be checked by a human before the PR can be merged.
            "draft": any(a.defaulted for a in plan.additions),
        },
    )


def _propose(
    args: argparse.Namespace,
    repo: Path,
    rel: Path,
    old_text: str,
    new_text: str,
    runs: list[ConferenceRun],
    plan: Plan,
    summary: str,
    body_for: Callable[[dict[str, Any]], str],
    pr: dict[str, Any],
) -> int:
    """Report, then (unless dry run) write ``rel``, rebuild, validate and stage the PR files.

    ``body_for(geocache)`` builds the PR body; ``pr`` is the ``pr.json`` (title, draft).
    """
    rc = 1 if any(r.failed for r in runs) else 0
    geocache = _load_geocache(repo)
    if args.dry_run:
        say(body_for(geocache))
        say("\n## Server tool calls\n\n" + (tool_log(runs) or "(none)"))
        diff = unified_diff(old_text, new_text, str(rel))
        say("\n## Proposed diff (not written)\n\n```diff\n" + (diff or "(no changes)\n") + "```")
        return rc

    if plan.empty:
        say(body_for(geocache))
        say(f"No changes to write. {summary}")
        return rc
    (repo / rel).write_text(new_text)
    say(f"Wrote {rel}: {summary}")
    if not rebuild_and_validate(repo):
        say("data:build or data:validate failed; not proposing a PR.", file=sys.stderr)
        return 1
    # data:build may have geocoded the new cities: show the coordinates the map will use.
    body = body_for(_load_geocache(repo))
    say(body)
    if args.out_dir:
        if len(body) > MAX_PR_BODY:
            body = body[:MAX_PR_BODY] + "\n\n…(truncated; see the workflow log)"
        args.out_dir.mkdir(parents=True, exist_ok=True)
        (args.out_dir / "pr-body.md").write_text(body)
        for path in proposed_files(repo):
            (args.out_dir / path).parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(repo / path, args.out_dir / path)
        (args.out_dir / "pr.json").write_text(json.dumps(pr) + "\n")
        say(f"Wrote PR title and body to {args.out_dir}")
    return rc
