"""Files a shell command changed in a folder that is not a git repository.

With no git, golem cannot ask what a file held before a command ran, so it looks first:
before the command it keeps the size, the modification time and, for a small text file,
the text of each file in the folder; after it, it compares. A folder with too many files is
not watched. Folders in ``SKIPPED_DIRS`` and ``.golem`` are left out, and there is no ignore
file: the snapshot cannot tell build output from source.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from golem.coding import shell_changes
from golem.tools import sandbox
from golem.tools.fs import walk_files
from golem.tools.registry import FileEdit

MAX_KEPT_BYTES = 64_000
MAX_KEPT_TOTAL = 4_000_000
MAX_FILES = 2_000
MAX_FILES_REPORTED = 200
_SKIPPED = ".golem"


@dataclass(frozen=True, slots=True)
class Plain:
    """The folder before a command: each file's ``(size, mtime_ns)``, and its text if small."""

    root: Path
    stats: dict[str, tuple[int, int]]
    texts: dict[str, str]


def look(root: Path) -> Plain | None:
    """The folder now, or None when it holds more than ``MAX_FILES`` files."""
    stats: dict[str, tuple[int, int]] = {}
    texts: dict[str, str] = {}
    kept = 0
    for shown, path in _files(root):
        if len(stats) >= MAX_FILES:
            return None
        stat = _stat(path)
        if stat is None:
            continue
        stats[shown] = stat
        if stat[0] <= MAX_KEPT_BYTES and kept + stat[0] <= MAX_KEPT_TOTAL:
            text = _text(path)
            if text is not None:
                texts[shown] = text
                kept += stat[0]
    return Plain(root, stats, texts)


def changed(before: Plain) -> list[FileEdit]:
    """The files that differ now from ``before``, by path, at most ``MAX_FILES_REPORTED``.

    A kept file is compared by its text, so two writes in one instant are not missed. A
    changed or deleted file whose text was not kept is not reported.
    """
    edits: list[FileEdit] = []
    seen: set[str] = set()
    for shown, path in _files(before.root):
        seen.add(shown)
        stat = _stat(path)
        if stat is None or stat[0] > shell_changes.MAX_BYTES:
            continue
        if shown in before.stats and shown not in before.texts:
            continue
        old = before.texts.get(shown)
        text = _text(path)
        if text is not None and text != old:
            edits.append(FileEdit(shown, old, text))
    edits.extend(
        FileEdit(shown, old, None) for shown, old in before.texts.items() if shown not in seen
    )
    edits.sort(key=lambda edit: edit.path)
    return edits[:MAX_FILES_REPORTED]


def tracking(root: Path | None) -> Literal["git", "files", "off"]:
    """How shell changes are found in ``root``: with git, with a snapshot of the files, or not."""
    if root is None:
        return "git"
    if sandbox.git_dirs(root):
        return "git" if sandbox.available() else "off"
    for count, _ in enumerate(_files(root), start=1):
        if count > MAX_FILES:
            return "off"
    return "files"


def _files(root: Path) -> Iterator[tuple[str, Path]]:
    """Each file below ``root`` with its path relative to it, POSIX style. Links are left out."""
    for path in walk_files(root):
        if path.is_symlink():
            continue
        shown = path.relative_to(root).as_posix()
        if shown.split("/", 1)[0] != _SKIPPED:
            yield shown, path


def _stat(path: Path) -> tuple[int, int] | None:
    try:
        stat = path.stat()
    except OSError:
        return None
    return stat.st_size, stat.st_mtime_ns


def _text(path: Path) -> str | None:
    """The file's text, None when it cannot be read or is not UTF-8."""
    try:
        return path.read_bytes().decode("utf-8")
    except (OSError, UnicodeDecodeError):
        return None
