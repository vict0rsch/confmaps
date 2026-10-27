"""Series keys and past-edition ids — the Python twin of ``scripts/lib/normalize.ts``
(``seriesKey``, ``seriesOf``, ``SERIES_ALIASES``) and ``scripts/lib/past-id.ts``
(``pastEditionId``), DESIGN.md §2.4.

Both implementations are tested against ``scripts/__fixtures__/past-id-vectors.json``, and a
test checks that :data:`SERIES_ALIASES` matches the TypeScript table.
"""

import re
import unicodedata
from collections.abc import Iterable
from typing import Any

# Keep in sync with SERIES_ALIASES in scripts/lib/normalize.ts (checked by a test).
SERIES_ALIASES: dict[str, str] = {
    "emnlp-industry-track": "emnlp",
    "emnlp-system-demonstrations-track": "emnlp",
    "nips": "neurips",
    "naacl-hlt": "naacl",
    "emnlp-ijcnlp": "emnlp",
    "ijcai-pricai": "ijcai",
    "ijcai-ecai": "ijcai",
    "aacl-ijcnlp": "ijcnlp-aacl",
    "mm": "acm-mm",
    "automl-conf": "automl",
}
_TRACK = re.compile(r"\(([^)]+)\)\s*$")
_ID_DIGITS = re.compile(r"(.*?)(\d{4}|\d{2})")


def series_key(title: str) -> str:
    """Normalized title: ``"ICML"`` → ``"icml"``, ``"ECML PKDD"`` → ``"ecml-pkdd"``.

    Examples
    --------
    .. code-block:: python

        series_key("Interspeech  2019!")  # "interspeech-2019"
    """
    decomposed = unicodedata.normalize("NFKD", title)
    stripped = re.sub(r"[̀-ͯ]", "", decomposed).lower()
    return re.sub(r"[^a-z0-9]+", "-", stripped).strip("-")


def series_of(title: str) -> str:
    """Series of a title: its :func:`series_key`, rolled up through :data:`SERIES_ALIASES`.

    Examples
    --------
    .. code-block:: python

        series_of("NIPS")  # "neurips"
    """
    key = series_key(title)
    return SERIES_ALIASES.get(key, key)


def is_track(title: str) -> bool:
    """Whether a title names a track (``"EMNLP (Industry Track)"``), as ``trackName`` does."""
    return bool(_TRACK.search(title))


def past_edition_id(series: str, year: int, conferences: Iterable[dict[str, Any]]) -> str:
    """Our id for the ``year`` edition of ``series`` (never suffixed; a clash is an error).

    The stem and digit style (``2025`` or ``25``) come from the series' newest ``hf`` main
    conference in ``conferences`` (``data.json``), when its id ends with its own year in that
    style; otherwise the series without dashes and two digits.

    Parameters
    ----------
    series : str
        Series key (``seriesOf(title)``).
    year : int
        Edition year.
    conferences : iterable of dict
        ``data.json`` conferences (``id``, ``series``, ``title``, ``year``, ``source``).

    Returns
    -------
    str
        The edition id.

    Examples
    --------
    .. code-block:: python

        past_edition_id("icdar", 2019, data["conferences"])  # "icdar2019" (HF: icdar2027)
        past_edition_id("siggraph-asia", 2022, [])  # "siggraphasia22"
    """
    stem, style = series.replace("-", ""), 2
    hf = [
        c
        for c in conferences
        if c.get("source") == "hf" and c.get("series") == series and not is_track(c["title"])
    ]
    newest = min(hf, key=lambda c: (-c["year"], c["id"]), default=None)
    m = _ID_DIGITS.fullmatch(newest["id"]) if newest else None
    if newest and m:
        s, digits = m.groups()
        if len(digits) == 4 and int(digits) == newest["year"]:
            stem, style = s, 4
        elif len(digits) == 2 and int(digits) == newest["year"] % 100:
            stem, style = s, 2
    return stem + (str(year) if style == 4 else f"{year % 100:02d}")
