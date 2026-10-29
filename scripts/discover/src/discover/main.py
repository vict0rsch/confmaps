"""CLI: ``uv run --project scripts/discover discover [options]`` (from the repository root).

Satellites (``data/satellites.yml``):

--mode upcoming            conferences starting within the next 12 months (default)
--mode backfill --since Y  past editions (ended before today) of year >= Y, virtual editions
                           excluded. Every past edition counts (≈345 more once the PwC import
                           lands), so restrict it with --only: one API call per conference.
--only ID[,ID...]          restrict to these conference ids

Past main editions (``data/past_conferences.yml``, DESIGN.md §3):

--mode past --series S[,S...] --since Y [--until Y2] [--recheck]
                           years Y..Y2 (default: last year) of each series with no recorded
                           edition and not listed as not held in data/series.yml; one API
                           call per series and batch of up to 6 years. Years the model reports
                           as not held, and that pass the checks, are added to that list.
                           --recheck also re-verifies recorded `source: pwc` editions in the
                           range (the COVID pass). Dry-run one series first to measure cost.
--mode past [--series S[,S...]] --since-creation [--until Y2]
                           instead of --since, start each series at its `first_year` in
                           data/series.yml. Without --series, every series in that file runs;
                           a named series with no entry is skipped with a warning.
--random-order             (--mode past) research the batches in random order, so that runs
                           cut short by --max-usd do not always spend it on the same series.

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

Without ``--dry-run``, the curated file (and, in past mode, ``data/series.yml`` when years are
recorded as not held) is written, the generated files are rebuilt
(``pnpm data:build``: geocodes new cities, refreshes ``data/build/data.json`` and the archive)
and the result is validated (``pnpm data:validate``). With ``--out-dir``, the data files a PR
carries (:func:`proposed_files`) are copied under ``<out-dir>/data/``. This script never commits,
pushes or opens PRs: ``.github/workflows/discover.yml`` does that in a separate job.
"""

import argparse
import io
import json
import os
import random
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from collections.abc import Callable, Sequence
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any, Self, TextIO

import anthropic
from rich.console import Console
from rich.markup import escape
from rich.progress import (
    BarColumn,
    MofNCompleteColumn,
    Progress,
    SpinnerColumn,
    TaskID,
    TextColumn,
    TimeElapsedColumn,
)
from rich.text import Text
from ruamel.yaml.comments import CommentedMap, CommentedSeq

from . import agent, past_agent
from .cost import Usage
from .dblp import TIMEOUT_S, DblpTitles, default_cache_path
from .geo import Geocoder, cached_hit
from .merge import Plan, apply_plan, load_satellites, plan_changes, unified_diff
from .past import check_and_plan, plan_batches
from .past_merge import WIDTH
from .report import PAST_INTRO, ConferenceRun, build_body, tool_log
from .verify import MAX_FETCHES_PER_CONFERENCE, LimitedPages, PageFetcher, check_candidate_safely
from .wayback import NO_SNAPSHOT_FLAG, Snapshots
from .yamlio import load_entries, make_yaml

REPO_ROOT = Path(__file__).resolve().parents[4]
SATELLITES = Path("data/satellites.yml")
PAST = Path("data/past_conferences.yml")
SERIES = Path("data/series.yml")
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


def step(text: str) -> None:
    """Announce one high-level step of the run on stderr (stdout carries the report).

    Examples
    --------
    .. code-block:: python

        step("Checking evidence")  # "> ▸ Checking evidence"
    """
    say(f"▸ {text}", file=sys.stderr)


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
    # Stream the output line by line (data:build takes minutes), each line prefixed.
    with subprocess.Popen(
        cmd,
        cwd=cwd,
        env=scrubbed_env(),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        errors="replace",
    ) as proc:
        assert proc.stdout is not None
        for line in proc.stdout:
            say(line.rstrip("\n"), prefix="pnpm> ", file=sys.stderr)
    return proc.returncode


def rebuild_and_validate(repo: Path) -> bool:
    """``pnpm data:build`` then ``pnpm data:validate``.

    ``data:validate`` checks ``data/build/data.json`` against ``satellites.yml`` (any added or
    updated satellite makes it stale) and requires every satellite city in
    ``data/geocache.json``; ``data:build`` geocodes new cities (Nominatim) and regenerates
    ``data.json`` and ``data/archive/`` from a fresh upstream clone.
    """
    step("Rebuilding generated data (pnpm data:build: upstream clone, geocoding new cities)")
    if _run(["pnpm", "data:build"], repo) != 0:
        return False
    step("Validating the data (pnpm data:validate)")
    return _run(["pnpm", "data:validate"], repo) == 0


def proposed_files(repo: Path) -> list[Path]:
    """Data files a discovery PR carries, relative to ``repo``.

    The curated files and everything ``data:build`` writes; ``discover.yml`` commits exactly
    these paths.
    """
    archive = sorted(
        p.relative_to(repo) for p in (repo / ARCHIVE).glob("[0-9][0-9][0-9][0-9].json")
    )
    files = (SATELLITES, PAST, SERIES, GEOCACHE, DATA_JSON, *archive)
    return [p for p in files if (repo / p).is_file()]


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


class DblpProgress:
    """Progress of listing each series' dblp proceedings in ``--mode past``: one query at a time,
    each often 10-45 s, so this can take an hour on a first run.

    Call :meth:`cached`, then :meth:`started` and :meth:`listed` around each query. On a
    terminal, a rich bar shows the series listed and the one being queried now; elsewhere, one
    :func:`say` line per series.

    Examples
    --------
    .. code-block:: python

        with DblpProgress(len(series)) as progress:
            failed = list_dblp_volumes(dblp, series, progress)
    """

    def __init__(self, total: int, console: Console | None = None) -> None:
        self.console = console or Console(stderr=True)
        self.live: Progress | None = None
        if self.console.is_terminal:
            self.live = Progress(
                SpinnerColumn(),
                TextColumn("{task.description}"),
                BarColumn(),
                MofNCompleteColumn(),
                TextColumn("{task.fields[activity]}"),
                TimeElapsedColumn(),
                console=self.console,
            )
            self.task = self.live.add_task("Listing dblp proceedings", total=total, activity="")

    def __enter__(self) -> Self:
        if self.live:
            self.live.start()
        return self

    def __exit__(self, *exc: object) -> None:
        if self.live:
            self.live.stop()

    def _print(self, line: str, advance: int) -> None:
        if not self.live:
            say(line, file=sys.stderr)
            return
        self.live.console.print(Text(line))
        self.live.update(self.task, advance=advance, activity="")

    def cached(self, series: list[str], path: Path | None) -> None:
        """``series`` were listed from the cache file at ``path``: no query for them."""
        if series:
            self._print(f"{len(series)} series listed from the dblp cache ({path})", len(series))

    def started(self, series: str) -> None:
        """The query for ``series`` starts."""
        if self.live:
            self.live.update(self.task, activity=f"querying {series}")

    def listed(self, series: str, count: int | None, seconds: float, final: bool) -> None:
        """The query for ``series`` ended: ``count`` volumes, or ``None`` if it failed. A failure
        that is not ``final`` is retried later, so it does not advance the bar."""
        if count is not None:
            line = f"listed {series}: {count} dblp volume(s) in {seconds:.1f}s"
        elif final:
            line = (
                f"dblp listing failed again for {series} after {seconds:.1f}s: its batches get "
                "no dblp titles"
            )
        else:
            line = f"dblp listing failed for {series} after {seconds:.1f}s: retried at the end"
        self._print(line, 1 if count is not None or final else 0)

    def retrying(self, series: list[str]) -> None:
        """The failed ``series`` are queried once more."""
        self._print(f"retrying {len(series)} failed listing(s): {', '.join(series)}", 0)


def list_dblp_volumes(dblp: DblpTitles, series: list[str], progress: DblpProgress) -> list[str]:
    """List the dblp proceedings of each series, one query at a time, and retry the failed ones
    once at the end. The cache file is saved after each new listing, so an interrupted run
    keeps them. Returns the series whose query failed twice.

    Examples
    --------
    .. code-block:: python

        with DblpProgress(len(series)) as progress:
            failed = list_dblp_volumes(dblp, series, progress)
    """
    cached = [s for s in series if dblp.is_cached(s)]
    progress.cached(cached, dblp.cache)

    def ok(s: str, retry: bool = False) -> bool:
        progress.started(s)
        start = time.monotonic()
        count = dblp.list_volumes(s, retry=retry)
        progress.listed(s, count, time.monotonic() - start, final=retry)
        if count is not None:
            dblp.save_cache()
        return count is not None

    # dblp works through queries roughly one at a time: parallel ones only time out more.
    failed = [s for s in series if s not in cached and not ok(s)]
    if failed:
        progress.retrying(failed)
    return [s for s in failed if not ok(s, retry=True)]


def _list_dblp(dblp: DblpTitles, series: list[str]) -> None:
    """:func:`list_dblp_volumes` with its step line, progress bar and final warning."""
    step(
        f"Listing the dblp proceedings of {len(series)} series, one at a time "
        f"(up to {TIMEOUT_S:.0f}s each)"
    )
    with DblpProgress(len(series)) as progress:
        failed = list_dblp_volumes(dblp, series, progress)
    if failed:
        say(f"warning: no dblp titles for {', '.join(failed)}", file=sys.stderr)


class CheckProgress:
    """Live progress of the evidence checks (cited pages fetched, cities geocoded).

    Wrap the page getter and the geocoder with :meth:`get_page` and :meth:`geocoder`, and call
    :meth:`checked` once a request's items are checked. On a terminal, a rich bar shows the
    requests checked and what is being fetched or geocoded right now; elsewhere, one
    :func:`say` line per request.

    Examples
    --------
    .. code-block:: python

        with CheckProgress(runs) as progress:
            get_page, geocode = progress.get_page(fetcher.get), progress.geocoder(geocoder)
            ...
            progress.checked(run)
    """

    def __init__(self, runs: list[ConferenceRun], console: Console | None = None) -> None:
        self.pages = self.lookups = 0  # for the request being checked
        self.console = console or Console(stderr=True)
        self.live: Progress | None = None
        if self.console.is_terminal:
            total = sum(1 for r in runs if r.research and r.research.status == "ok")
            self.live = Progress(
                SpinnerColumn(),
                TextColumn("{task.description}"),
                BarColumn(),
                MofNCompleteColumn(),
                TextColumn("{task.fields[activity]}"),
                TimeElapsedColumn(),
                console=self.console,
            )
            self.task = self.live.add_task("Checking evidence", total=total, activity="")

    def __enter__(self) -> Self:
        if self.live:
            self.live.start()
        return self

    def __exit__(self, *exc: object) -> None:
        if self.live:
            self.live.stop()

    def _activity(self, text: str) -> None:
        if self.live:
            text = text if len(text) <= 70 else text[:69] + "…"
            # URLs and cities come from model output: never read them as rich markup.
            self.live.update(self.task, activity=escape(text))

    def get_page(self, get: Callable[[str], Any]) -> Callable[[str], Any]:
        """``get`` that counts and shows each page fetch."""

        def wrapped(url: str) -> Any:
            self.pages += 1
            self._activity(f"fetching {url}")
            return get(url)

        return wrapped

    def geocoder(self, geocode: Callable[[str, str], Any]) -> Callable[[str, str], Any]:
        """``geocode`` that counts and shows each city lookup."""

        def wrapped(city: str, country: str) -> Any:
            self.lookups += 1
            self._activity(f"geocoding {city}, {country}")
            return geocode(city, country)

        return wrapped

    def checked(self, run: ConferenceRun) -> None:
        """``run``'s items are checked: report what was kept and what it took."""
        kept = sum(1 for c in run.checked if not c.dropped)
        line = (
            f"checked {run.conference['id']}: kept {kept} of {len(run.checked)} item(s), "
            f"{self.pages} page fetch(es), {self.lookups} geocoding lookup(s)"
        )
        self.pages = self.lookups = 0
        if not self.live:
            say(line, file=sys.stderr)
            return
        self.live.console.print(Text(line))  # Text: no markup or highlighting of model output
        self.live.update(self.task, advance=1, activity="")


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
    p.add_argument(
        "--since-creation",
        action="store_true",
        help="--mode past: start each series at its first_year in data/series.yml "
        "(instead of --since; --series then defaults to every series in that file)",
    )
    p.add_argument("--until", type=int, help="last year for --mode past (default: last year)")
    p.add_argument("--only", action="append", default=[], help="conference id(s), comma-separated")
    p.add_argument("--series", action="append", default=[], help="series key(s), comma-separated")
    p.add_argument("--recheck", action="store_true", help="also re-verify source: pwc editions")
    p.add_argument(
        "--random-order",
        action="store_true",
        help="--mode past: research the batches in random order (a run cut short by --max-usd "
        "then covers different series each time)",
    )
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
        if args.since_creation and args.since is not None:
            p.error("--since-creation cannot be combined with --since")
        if not args.from_results:
            if not args.since_creation and args.since is None:
                p.error("--mode past needs --since YYYY or --since-creation")
            if not args.since_creation and not args.series:
                p.error("--mode past needs --series S[,S...] (optional with --since-creation)")
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
                           ("--recheck", args.recheck),
                           ("--since-creation", args.since_creation),
                           ("--random-order", args.random_order)):  # fmt: skip
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
    snapshots: Any = None,
    dblp: Any = None,
) -> int:
    """Entry point. ``client``, ``fetcher``, ``geocoder``, ``today``, ``snapshots`` (Wayback
    lookups for past-mode links) and ``dblp`` (dblp titles for past-mode prompts and checks)
    are injectable for tests.

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
    start = time.monotonic()
    try:
        return _main(args, client, fetcher, geocoder, today, snapshots, dblp)
    finally:
        minutes, seconds = divmod(round(time.monotonic() - start), 60)
        step(f"Finished in {minutes}m{seconds:02d}s")


def _main(
    args: argparse.Namespace,
    client: Any,
    fetcher: Any,
    geocoder: Any,
    today: date | None,
    snapshots: Any = None,
    dblp: Any = None,
) -> int:
    """:func:`main` after argument parsing: route to a mode, research or replay, then propose."""
    repo: Path = args.repo_root
    today = today or datetime.now(UTC).date()
    data = json.loads((repo / DATA_JSON).read_text())
    if args.mode == "past":
        return _main_past(args, repo, today, data, client, fetcher, geocoder, snapshots, dblp)
    sat_text = (repo / SATELLITES).read_text()
    existing = load_satellites(sat_text)

    results_dir: Path | None = None
    if args.from_results:
        runs = [
            r
            for r in load_results(args.from_results)
            if not args.only or r.conference["id"] in args.only
        ]
        step(f"Loaded {len(runs)} saved result(s) from {args.from_results}")
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

        step(
            f"Researching {len(confs)} conference(s), {args.workers} at a time, "
            f"budget ${args.max_usd:.2f}"
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


def _series_entries(repo: Path) -> dict[str, dict[str, Any]]:
    """Series key → entry of ``data/series.yml`` (``{}`` if the file is missing).

    Raises ``TypeError`` when the file is not a mapping and ``ValueError`` when an entry has no
    usable ``first_year``.

    Examples
    --------
    .. code-block:: python

        _series_entries(repo)["aaai"]["first_year"]  # 1980
    """
    path = repo / SERIES
    data = (make_yaml().load(path.read_text()) or {}) if path.exists() else {}
    if not isinstance(data, dict):
        raise TypeError(f"{SERIES}: expected a mapping of series key to entry")
    entries: dict[str, dict[str, Any]] = {}
    for key, entry in data.items():
        year = entry.get("first_year") if isinstance(entry, dict) else None
        if isinstance(year, bool) or not isinstance(year, int) or not MIN_YEAR <= year <= MAX_YEAR:
            raise ValueError(
                f"{SERIES}: {key}: first_year {year!r} is not a year in {MIN_YEAR}..{MAX_YEAR}"
            )
        entries[str(key)] = entry
    return entries


def apply_not_held(text: str, recorded: list[dict[str, Any]]) -> str:
    """``data/series.yml`` text with the years recorded as not held added to their entries.

    Each ``{year, source}`` goes into its entry's ``not_held`` list, created as the entry's
    last key and sorted by year; a year already listed is skipped. The rest of the file keeps
    its text (round trip without folding long lines).

    Parameters
    ----------
    text : str
        Current content of ``data/series.yml``.
    recorded : list of dict
        ``PastPlan.not_held`` items (``series``, ``year``, ``source``, ``reason``); each series
        has an entry in the file.

    Returns
    -------
    str
        The new content; ``text`` itself when there is nothing to record.

    Examples
    --------
    .. code-block:: python

        apply_not_held(text, [{"series": "aaai", "year": 1989, "source": url, "reason": why}])
    """
    if not recorded:
        return text
    yaml = make_yaml(WIDTH)
    data = yaml.load(text)
    for item in recorded:
        entry = data[item["series"]]
        if "not_held" not in entry:
            entry["not_held"] = CommentedSeq()
        listed = entry["not_held"]
        if any(y["year"] == item["year"] for y in listed):
            continue
        listed.append(CommentedMap([("year", item["year"]), ("source", item["source"])]))
        listed.sort(key=lambda y: y["year"])
    out = io.StringIO()
    yaml.dump(data, out)
    return out.getvalue()


def _main_past(
    args: argparse.Namespace,
    repo: Path,
    today: date,
    data: dict[str, Any],
    client: Any,
    fetcher: Any,
    geocoder: Any,
    snapshots: Any = None,
    dblp: Any = None,
) -> int:
    """``--mode past``: research (or replay), check, merge and propose past editions."""
    past_path = repo / PAST
    past_text = past_path.read_text() if past_path.exists() else ""
    past = load_entries(past_text)
    series_path = repo / SERIES
    series_text = series_path.read_text() if series_path.exists() else ""
    try:
        series_entries = _series_entries(repo)
    except (ValueError, TypeError) as e:
        say(f"error: {e}", file=sys.stderr)
        return 1
    dblp = dblp or DblpTitles(cache=default_cache_path())
    results_dir: Path | None = None
    if args.from_results:
        runs = load_results(args.from_results, "past")
        if args.series:
            runs = [r for r in runs if r.conference["series"] in args.series]
        step(f"Loaded {len(runs)} saved result(s) from {args.from_results}")
        # The evidence check reads cited dblp pages from these listings (no query per page).
        _list_dblp(dblp, list(dict.fromkeys(r.conference["series"] for r in runs)))
        mode = "from saved results"
    else:
        until = args.until if args.until is not None else today.year - 1
        series_list, since = args.series, args.since
        if args.since_creation:
            series_list = args.series or list(series_entries)
            for s in series_list:
                if s not in series_entries:
                    say(
                        f"warning: --series {s}: no first_year in {SERIES}, skipped",
                        file=sys.stderr,
                    )
            series_list = [s for s in series_list if s in series_entries]
            since = {s: series_entries[s]["first_year"] for s in series_list}
            step("Starting at first_year: " + ", ".join(f"{s} {y}" for s, y in since.items()))
        # Years recorded as not held are never researched again.
        not_held = {
            key: {y["year"] for y in entry.get("not_held", [])}
            for key, entry in series_entries.items()
        }
        # Without dblp first: which series have years to research (and which are unknown).
        batches, unknown = plan_batches(
            data, past, series_list, since, until, args.recheck, None, not_held
        )
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
        _list_dblp(dblp, list(dict.fromkeys(b["series"] for b in batches)))
        # The same batches, now with each one's dblp titles (listed above, so no query).
        batches, _ = plan_batches(
            data, past, series_list, since, until, args.recheck, dblp, not_held
        )
        if args.random_order:
            # Requests start in list order and stop at --max-usd: shuffle so that a capped run
            # does not always spend the budget on the same series (and the same dead ends).
            random.shuffle(batches)
            step("Researching the batches in random order")
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

        step(
            f"Researching {len(batches)} batch(es) of years, {args.workers} at a time, "
            f"budget ${args.max_usd:.2f}"
        )
        runs = research_all(
            batches, ask_one, results_dir, args.max_usd, mode="past", workers=args.workers
        )
        mode = f"`--mode past{' --recheck' if args.recheck else ''}`"
    try:
        fetcher = fetcher or PageFetcher()
        geocache = _load_geocache(repo)
        geocoder = geocoder or Geocoder(geocache)
        step(
            "Checking evidence: fetching cited pages and geocoding cities, then planning "
            "changes and archiving new links"
        )
        with CheckProgress(runs) as progress:
            plan, new_text = check_and_plan(
                runs,
                data,
                past,
                past_text,
                progress.get_page(fetcher.get),
                progress.geocoder(geocoder),
                today,
                series_entries,
                on_checked=progress.checked,
                snapshot=snapshots or Snapshots(),
                dblp=dblp,
            )
        new_series_text = apply_not_held(series_text, plan.not_held)
        counts = f"{len(plan.additions)} addition(s), {len(plan.applied)} update(s)"
        summary = (
            f"{counts}, {len(plan.suggestions)} suggestion(s) not applied, "
            f"{len(plan.removals)} reported cancellation(s) to remove by hand, "
            f"{len(plan.not_held)} year(s) recorded as not held, from "
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
            lambda cache: build_body(
                runs, plan, summary, None, cache, PAST_INTRO, past_agent.PAST_MODEL
            ),
            {
                "title": f"Past editions: {counts}",
                # Unverified defaults and cancellations need a human before the PR can merge.
                "draft": any(a.defaulted for a in plan.additions)
                or bool(plan.removals)
                or any(NO_SNAPSHOT_FLAG in a.candidate.flags for a in plan.additions),
            },
            extra=[(SERIES, series_text, new_series_text)],
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
    step("Checking evidence: fetching cited pages and geocoding cities")
    with CheckProgress(runs) as progress:
        get_page, geocode = progress.get_page(fetcher.get), progress.geocoder(geocoder)
        for run in runs:
            if run.research and run.research.status == "ok":
                pages = LimitedPages(get_page, MAX_FETCHES_PER_CONFERENCE)
                run.checked = [
                    check_candidate_safely(raw, run.conference, pages, geocode)
                    for raw in run.research.candidates
                ]
                progress.checked(run)
    step("Planning changes")

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
    extra: Sequence[tuple[Path, str, str]] = (),
) -> int:
    """Report, then (unless dry run) write ``rel``, rebuild, validate and stage the PR files.

    ``body_for(geocache)`` builds the PR body; ``pr`` is the ``pr.json`` (title, draft).
    ``extra`` holds other files the run changes, as ``(rel, old text, new text)``: a dry run
    shows their diff too, and each one that changed is written with ``rel``.
    """
    rc = 1 if any(r.failed for r in runs) else 0
    geocache = _load_geocache(repo)
    step(f"Planned: {summary}")
    if args.dry_run:
        say(body_for(geocache))
        say("\n## Server tool calls\n\n" + (tool_log(runs) or "(none)"))
        diff = "".join(
            unified_diff(old, new, str(path))
            for path, old, new in [(rel, old_text, new_text), *extra]
        )
        say("\n## Proposed diff (not written)\n\n```diff\n" + (diff or "(no changes)\n") + "```")
        return rc

    if plan.empty:
        say(body_for(geocache))
        say(f"No changes to write. {summary}")
        return rc
    step(f"Writing {rel}")
    (repo / rel).write_text(new_text)
    for path, old, new in extra:
        if new != old:
            step(f"Writing {path}")
            (repo / path).write_text(new)
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
