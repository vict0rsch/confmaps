"""Wayback Machine copies of past-edition links (AGENTS.md: past links are archived copies).

Old conference domains get hijacked, so a past edition's ``link`` is a Wayback snapshot. New
editions from the discovery agent come with the live page; :class:`Snapshots` finds the copy
archived closest to the edition's end through the Wayback Machine availability API, taken from
18 months before the end to 6 months after (DESIGN.md "Links of past editions"): a later capture
may already show a hijacked domain.
"""

import math
import re
import time
from collections.abc import Callable
from typing import Any
from urllib.parse import urlsplit

import httpx

from .geo import USER_AGENT

AVAILABLE_URL = "https://archive.org/wayback/available"
TIMEOUT_S = 20.0
# The archive answers "429 Too Many Requests" to quick successive lookups: pause between them,
# and once more after a 429.
MIN_INTERVAL_S = 2.0
RETRY_AFTER_429_S = 30.0
# What the API returns for a capture: web.archive.org/web/<timestamp>/<original URL>.
SNAPSHOT_RE = re.compile(r"^https://web\.archive\.org/web/(\d{6})\d{0,8}/https?://\S+$")
MONTHS_BEFORE, MONTHS_AFTER = 18, 6
NO_SNAPSHOT_FLAG = (
    "no Wayback snapshot of its link was found: the live page is written, replace it with an "
    "archived copy before merging"
)


def is_wayback(url: str) -> bool:
    """Whether ``url`` is a Wayback Machine copy.

    Examples
    --------
    .. code-block:: python

        is_wayback("https://web.archive.org/web/2018/https://neurips.cc/")  # True
    """
    return urlsplit(url).hostname in {"web.archive.org", "wayback.archive.org"}


class Snapshots:
    """``(url, day) -> snapshot URL | None``: the capture of ``url`` closest to ``day``.

    ``day`` is the edition's end (``YYYY-MM-DD``), or ``""`` for the latest capture with no
    window (an archived copy of an evidence page). Network or parsing problems, no successful
    capture, or one outside the window around ``day`` give ``None``.

    Examples
    --------
    .. code-block:: python

        Snapshots()("https://neurips.cc/Conferences/2018", "2018-12-08")
        # "https://web.archive.org/web/20181208…/https://neurips.cc/Conferences/2018"
    """

    def __init__(
        self,
        client: httpx.Client | None = None,
        sleep: Callable[[float], None] = time.sleep,
        now: Callable[[], float] = time.monotonic,
    ) -> None:
        self.client = client or httpx.Client(timeout=TIMEOUT_S, trust_env=False)
        self.sleep = sleep
        self.now = now
        self.last = -math.inf

    def _get(self, url: str, day: str) -> httpx.Response:
        wait = self.last + MIN_INTERVAL_S - self.now()
        if wait > 0:
            self.sleep(wait)
        self.last = self.now()
        return self.client.get(
            AVAILABLE_URL,
            params={"url": url, **({"timestamp": day.replace("-", "")} if day else {})},
            headers={"User-Agent": USER_AGENT},
        )

    def __call__(self, url: str, day: str) -> str | None:
        try:
            response = self._get(url, day)
            if response.status_code == 429:
                self.sleep(RETRY_AFTER_429_S)
                response = self._get(url, day)
            response.raise_for_status()
            closest: Any = response.json()["archived_snapshots"].get("closest") or {}
        except (httpx.HTTPError, ValueError, KeyError, TypeError, AttributeError):
            return None
        if not isinstance(closest, dict) or not closest.get("available"):
            return None
        if str(closest.get("status")) != "200":
            return None
        # The API answers with http://; the archive serves the same capture over https.
        snapshot = re.sub(r"^http://", "https://", str(closest.get("url", "")))
        m = SNAPSHOT_RE.match(snapshot)
        if not m:
            return None
        if not day:
            return snapshot
        # Months from the capture to the edition's end: positive when taken before it.
        taken = int(m[1][:4]) * 12 + int(m[1][4:6])
        months = int(day[:4]) * 12 + int(day[5:7]) - taken
        return snapshot if -MONTHS_AFTER <= months <= MONTHS_BEFORE else None
