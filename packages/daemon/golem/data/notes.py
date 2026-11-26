"""The notes of a data source: ``DATA.md``, written by a person and read by the model.

A user's source keeps them in ``<home>/data/<name>/DATA.md``, a project's in
``<project>/.golem/data/<name>/DATA.md``. The built-in source reads the user's file when it
exists and its own default otherwise. Removing a source leaves the file alone, so adding the
same name again finds the notes again. The model reads at most :data:`MAX_BYTES` of them.
"""

from __future__ import annotations

import contextlib
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path

NOTES_FILE = "DATA.md"
MAX_BYTES = 16 * 1024
"""The most of a notes file the model reads. A longer file is cut."""
CUT_NOTE = "(The notes are longer than 16 KB, so the rest is cut.)"
TOO_LONG = "The notes are longer than 16 KB. Shorten them: the model reads only the first 16 KB."


@dataclass(frozen=True, slots=True)
class Notes:
    """The text of a notes file. ``cut`` is true when the file was longer than the cap."""

    text: str
    cut: bool = False


def notes_file(data_dir: Path, project: Path | None, name: str) -> Path:
    """Where the notes of source ``name`` live: the project's folder, else the user's."""
    base = data_dir if project is None else project / ".golem" / "data"
    return base / name / NOTES_FILE


def read_notes(path: Path, limit: int | None = MAX_BYTES) -> Notes | None:
    """The notes in ``path``, cut at ``limit`` bytes. None when there is no file or it is empty."""
    try:
        with path.open("rb") as handle:
            raw = handle.read() if limit is None else handle.read(limit + 1)
    except OSError:
        return None
    cut = limit is not None and len(raw) > limit
    text = (raw[:limit] if cut else raw).decode("utf-8", errors="ignore")
    return Notes(text, cut) if text.strip() else None


def write_notes(path: Path, text: str) -> None:
    """Save ``text`` so a reader sees the old file or the new one. Empty text deletes the file."""
    if not text.strip():
        with contextlib.suppress(FileNotFoundError):
            path.unlink()
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, name = tempfile.mkstemp(dir=path.parent, prefix=".notes-", suffix=".tmp")
    try:
        with os.fdopen(handle, "w", encoding="utf-8", newline="\n") as out:
            out.write(text if text.endswith("\n") else text + "\n")
        os.replace(name, path)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(name)
        raise


__all__ = [
    "CUT_NOTE",
    "MAX_BYTES",
    "NOTES_FILE",
    "TOO_LONG",
    "Notes",
    "notes_file",
    "read_notes",
    "write_notes",
]
