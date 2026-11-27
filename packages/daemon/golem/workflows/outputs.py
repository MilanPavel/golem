"""Read a file a workflow run marked with ``run.output`` (``workflow.read_output``).

Only the path a run marked is read, never one the caller names. A file in a secret folder of the
sandbox is refused even when marked, and so is one that is not text.
"""

from __future__ import annotations

import mimetypes
from pathlib import Path

from golem.folders import hidden_folders, is_under

__all__ = ["READ_CHARS", "OutputError", "marked_file", "read_marked_file"]

READ_CHARS = 200_000
"""A read gives at most this many characters; ``truncated`` says the file was longer."""

_TEXT_SUFFIXES = frozenset(
    {
        ".txt", ".md", ".markdown", ".rst", ".csv", ".tsv", ".json", ".jsonl", ".ndjson",
        ".yaml", ".yml", ".toml", ".ini", ".log", ".xml", ".html", ".htm", ".css", ".js",
        ".ts", ".tsx", ".jsx", ".py", ".sh", ".sql", ".diff", ".patch", ".svg",
    }
)  # fmt: skip

_NOT_TEXT = "only text files are shown; open this one from its folder"


class OutputError(Exception):
    """An output that cannot be read. The message is for the person."""


def _is_text_type(path: Path) -> bool:
    if path.suffix.lower() in _TEXT_SUFFIXES:
        return True
    kind, _ = mimetypes.guess_type(path.name)
    return kind is not None and kind.startswith("text/")


def marked_file(marked: object, home: Path) -> Path:
    """The file a run marked with ``run.output``, resolved. Raises :class:`OutputError` unless
    the value is an absolute path to an existing file outside the folders golem keeps private
    (symlinks are resolved first)."""
    if not isinstance(marked, str) or not marked.strip():
        raise OutputError("this output is not a file path")
    if not Path(marked).is_absolute():
        raise OutputError("this output is not an absolute file path")
    root = home.resolve()
    try:
        target = Path(marked).resolve()
    except (OSError, RuntimeError) as exc:
        raise OutputError("this file cannot be opened") from exc
    if any(is_under(target, hidden) for hidden in hidden_folders(root)):
        raise OutputError("golem keeps that folder private, so the file is not opened")
    if not target.is_file():
        raise OutputError(f"there is no file at {marked}")
    return target


def read_marked_file(
    marked: object, home: Path, limit: int = READ_CHARS
) -> tuple[str, str, bool, int]:
    """``(path, text, truncated, size)`` of the file path ``marked`` by a run; size is in bytes.

    ``marked`` is the output's value. It must be an absolute path to a text file that is not in
    a secret folder (symlinks are resolved first). Raises :class:`OutputError` otherwise.
    """
    target = marked_file(marked, home)
    if not _is_text_type(target):
        raise OutputError(_NOT_TEXT)
    try:
        size = target.stat().st_size
        with target.open("rb") as handle:
            raw = handle.read(limit * 4 + 1)
    except OSError as exc:
        raise OutputError(f"golem cannot read {marked}") from exc
    if b"\0" in raw[:8192]:
        raise OutputError(_NOT_TEXT)
    text = raw.decode("utf-8", errors="replace")
    return str(target), text[:limit], len(text) > limit or size > len(raw), size
