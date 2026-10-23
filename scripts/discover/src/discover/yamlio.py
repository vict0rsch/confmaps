"""ruamel round-trip helpers shared by ``merge`` (satellites) and ``past_merge`` (past editions).

Comments (``# review:``, blank lines between entries), key order and quoting are preserved;
the curated files are only ever appended to or edited in place.
"""

import copy
import difflib
import io
from typing import Any

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap, CommentedSeq


def make_yaml(width: int = 100) -> YAML:
    """Round-trip loader/dumper configured like the hand-written data files.

    ``width`` is where ruamel folds long scalars: 100 for ``satellites.yml``; the importer
    writes ``past_conferences.yml`` without folding (see ``past_merge.WIDTH``).

    Examples
    --------
    .. code-block:: python

        data = make_yaml().load(Path("data/satellites.yml").read_text())
    """
    y = YAML()
    y.preserve_quotes = True
    y.width = width
    # Nested lists (`sources`) are indented under their key; the top-level list is dedented by
    # `dump` to match the hand-written file.
    y.indent(mapping=2, sequence=4, offset=2)
    return y


def dump(data: Any, width: int = 100) -> str:
    """Dump a top-level sequence with its ``- `` items at column 0 (``width``: see
    :func:`make_yaml`).

    Examples
    --------
    .. code-block:: python

        text = dump(CommentedSeq([CommentedMap(id="x")]))  # "- id: x\\n"
    """
    out = io.StringIO()
    make_yaml(width).dump(data, out)
    return "".join(line.removeprefix("  ") for line in out.getvalue().splitlines(True))


def load_for_edit(text: str) -> Any:
    """Round-trip load of a file that :func:`dump` will write back (``None`` if no data).

    ``dump`` writes everything two columns further right and then dedents it, so the comments
    inside entries (``# review: …``, full-line comments) are moved two columns right here: they
    come out where they were.

    Examples
    --------
    .. code-block:: python

        data = load_for_edit(text)
        data[0]["end"] = "2026-12-14"
        assert dump(data).startswith("- id:")
    """
    data = make_yaml().load(text)
    if data is not None:
        for item in data:
            _shift_comments(item)
        _shift_comments(data, root=True)
    return data


def _shift_comments(node: Any, root: bool = False) -> None:
    ca = getattr(node, "ca", None)
    if ca is not None:
        for tokens in ca.items.values():
            for tok in _tokens(tokens):
                tok.column += 2
                head, *rest = tok.value.split("\n")
                tok.value = "\n".join([head, *(f"  {r}" if r.strip() else r for r in rest)])
    if root:
        return
    children = node.values() if isinstance(node, dict) else node if isinstance(node, list) else []
    for child in children:
        _shift_comments(child)


def _tokens(value: Any) -> list[Any]:
    if isinstance(value, list):
        return [t for v in value for t in _tokens(v)]
    return [value] if value is not None and hasattr(value, "column") else []


def load_entries(text: str) -> list[dict[str, Any]]:
    """A YAML list of mappings → plain dicts (nested lists and mappings become plain too).

    Examples
    --------
    .. code-block:: python

        entries = load_entries("- id: a\\n  sources:\\n    - https://a.org/\\n")
    """
    data = make_yaml().load(text) or []
    return [_plain(entry) for entry in data]


def _plain(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _plain(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_plain(v) for v in value]
    return value


def set_ordered(m: CommentedMap, key: str, value: Any, order: list[str]) -> None:
    """Set ``key`` at its place in ``order``, keeping a trailing blank line at the end.

    Examples
    --------
    .. code-block:: python

        set_ordered(entry, "venue", "Hall A", ["id", "city", "venue", "sources"])
    """
    if key in m:
        m[key] = value
        return
    later = order[order.index(key) + 1 :]
    pos = next((i for i, k in enumerate(m) if k in later), len(m))
    # Blank lines between entries are stored as a comment on the entry's last scalar (possibly
    # inside a nested mapping or list, e.g. `pwc:`): appending moves them to the new key.
    trailing = _take_blank_lines(m) if pos == len(m) else None
    m.insert(pos, key, value)
    if trailing is not None:
        _attach_blank_lines(m, key, trailing)


def _attach_blank_lines(node: Any, key: Any, tok: Any) -> None:
    """Put blank lines after ``node[key]``: on its last scalar when it is a mapping or list."""
    child = node[key]
    if isinstance(child, CommentedMap | CommentedSeq) and len(child):
        last = list(child)[-1] if isinstance(child, dict) else len(child) - 1
        _attach_blank_lines(child, last, tok)
    elif isinstance(node, CommentedSeq):
        node.ca.items[key] = [tok, None, None, None]
    else:
        node.ca.items[key] = [None, None, tok, None]


def _take_blank_lines(node: Any) -> Any:
    """Detach the blank line(s) that follow the last scalar of ``node``; a comment stays."""
    if not len(node):
        return None
    last = list(node)[-1] if isinstance(node, dict) else len(node) - 1
    child = node[last]
    if isinstance(child, CommentedMap | CommentedSeq):
        found = _take_blank_lines(child)
        if found is not None:
            return found
    tokens = _tokens(node.ca.items.get(last))
    if not tokens:
        return None
    tok = tokens[-1]
    body = tok.value.rstrip("\n")
    blank = tok.value[len(body) :]
    if len(blank) < 2:  # no blank line, only the end of this line
        return None
    moved = copy.copy(tok)
    moved.value = blank
    if body.strip():
        tok.value = body + "\n"
    else:
        node.ca.items.pop(last)
    return moved


def delete_key(m: CommentedMap, key: str) -> None:
    """Remove ``key``; its end-of-line comment (e.g. ``# review: …``) moves to the previous key.

    A review marker must never disappear with the value it was written next to: it is the
    merge gate (``pnpm data:validate``) for a human check. When the previous key already has a
    comment, both texts are kept on its line.

    Examples
    --------
    .. code-block:: python

        delete_key(entry, "city")  # `country: X # a` + `city: Y # b` → `country: X # a # b`
    """
    if key not in m:
        return
    keys = list(m)
    comment = m.ca.items.pop(key, None)
    del m[key]
    pos = keys.index(key)
    if comment is None or pos == 0:
        return
    prev = m.ca.items.get(keys[pos - 1])
    if prev is None:
        m.ca.items[keys[pos - 1]] = comment
    elif prev[2] is None:
        prev[2] = comment[2]
    elif comment[2] is not None:
        prev[2].value = _merge_eol(prev[2].value, comment[2].value)


def _merge_eol(first: str, second: str) -> str:
    """Join two end-of-line comment tokens: both comments on one line, then the lines that
    followed each (full-line comments, blank lines) in order."""
    head1, _, rest1 = first.partition("\n")
    head2, _, rest2 = second.partition("\n")
    head = " ".join(h.strip() for h in (head1, head2) if h.strip())
    return f"{head}\n{rest1}{rest2}"


def append_item(seq: CommentedSeq, value: Any) -> None:
    """Append to a list, keeping the comment (blank line) that follows its last item."""
    trailing = seq.ca.items.pop(len(seq) - 1, None)
    seq.append(value)
    if trailing is not None:
        seq.ca.items[len(seq) - 1] = trailing


def unified_diff(old: str, new: str, path: str) -> str:
    """``git diff``-style text of a proposed file change."""
    return "".join(
        difflib.unified_diff(old.splitlines(True), new.splitlines(True), f"a/{path}", f"b/{path}")
    )
