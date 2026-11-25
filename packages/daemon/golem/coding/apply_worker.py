"""Take a worker's diff into the lead's folder (ADR-059, step 15.10.6).

:func:`plan` reads, for each file the worker changed, the lead's current bytes, the bytes the
copy started from (the baseline) and the worker's bytes. A file whose current bytes are not the
baseline's changed in the project since the copy was made: :class:`ApplyConflict` names the first
one, and nothing is written. :func:`write` then puts the files in the folder. No model and no
session is involved here.
"""

from __future__ import annotations

import os
import stat
import tempfile
from dataclasses import dataclass
from pathlib import Path

from golem.coding import copies
from golem.tools.paths import writable
from golem.tools.registry import ToolError

_NEW_FILE_MODE = 0o644


class ApplyConflict(Exception):
    """A file changed in the project since the worker's copy was made."""

    def __init__(self, path: str) -> None:
        super().__init__(
            f"{path} changed in the project since the worker started, so nothing was applied"
        )
        self.path = path


@dataclass(frozen=True, slots=True)
class Planned:
    """One file of the diff. ``before`` is what the folder holds now, ``after`` what the worker
    left. None is "no file"."""

    path: str
    target: Path
    before: bytes | None
    after: bytes | None
    mode: int | None
    """The mode of the worker's file, for a file the folder does not have yet."""


def _read(path: Path) -> bytes | None:
    try:
        return path.read_bytes()
    except FileNotFoundError:
        return None
    except IsADirectoryError as exc:
        raise ToolError(f"{path.name} is a folder") from exc


def _read_for_check(path: Path) -> bytes | Exception | None:
    try:
        return _read(path)
    except (OSError, ToolError) as exc:
        return exc


async def plan(copy: copies.Copy, lead_root: Path) -> list[Planned]:
    """The files of the worker's diff, checked against the lead's folder.

    Raises :class:`ApplyConflict` for the first file (in path order) the project changed, and
    :class:`~golem.tools.registry.ToolError` for a path golem does not write.
    """
    paths = await copies.changed_paths(copy)
    found: list[Planned] = []
    for path in paths:
        target = writable(lead_root, path)
        baseline = await copies.baseline_bytes(copy, path)
        current = _read_for_check(target)
        if isinstance(current, Exception) or current != baseline:
            raise ApplyConflict(path)
        theirs = copy.path / path
        after: bytes | None = None
        mode: int | None = None
        if theirs.is_file() or theirs.is_symlink():
            after = theirs.read_bytes()
            mode = stat.S_IMODE(theirs.stat().st_mode)
        if after == current:
            continue
        found.append(Planned(path, target, current, after, mode))
    return found


def write(item: Planned) -> None:
    """Create, change or delete one file. Whole files, as bytes, through a temp file."""
    target = item.target
    try:
        if item.after is None:
            target.unlink(missing_ok=True)
            return
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            mode = stat.S_IMODE(target.stat().st_mode)
        else:
            mode = item.mode if item.mode is not None else _NEW_FILE_MODE
        fd, temp = tempfile.mkstemp(dir=target.parent, prefix=".golem-", suffix=".tmp")
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(item.after)
                handle.flush()
                os.fsync(handle.fileno())
            os.chmod(temp, mode)
            os.replace(temp, target)
        except BaseException:
            Path(temp).unlink(missing_ok=True)
            raise
    except OSError as exc:
        raise ToolError(f"cannot write {item.path}: {exc.strerror or exc}") from exc


def text_of(data: bytes | None) -> str | None:
    """The text of ``data``, None for no file. Raises ``UnicodeDecodeError`` for a binary file."""
    return None if data is None else data.decode("utf-8")


__all__ = ["ApplyConflict", "Planned", "plan", "text_of", "write"]
