"""The folders a page may browse to choose a project folder (``fs.list_dirs``, ADR-040).

The listing is narrow on purpose. It stays under the home folder, shows only
folders, and leaves out dot-folders, ``~/Library``, and the secret folders of
the sandbox. No file name, size, time, or content is ever returned.
"""

from __future__ import annotations

import os
from pathlib import Path

from golem.tools.sandbox import SECRET_DIRS
from golem_protocol.commands import DirEntry, FsListDirsResult

MAX_ENTRIES = 500
"""One call stays small: a longer list is cut, and ``truncated`` says so."""

OUTSIDE = "That folder is outside your home folder."


class FolderError(Exception):
    """A folder that cannot be listed. The message is for the person."""


def _hidden(home: Path) -> list[Path]:
    """The folders under ``home`` that are never listed, nor entered."""
    return [(home / name).resolve() for name in ("Library", *SECRET_DIRS)]


def _under(path: Path, root: Path) -> bool:
    return path == root or root in path.parents


def _browsable(path: Path, home: Path, hidden: list[Path]) -> bool:
    """Whether ``path``, already resolved, is home or a folder below it that may be shown."""
    if not _under(path, home):
        return False
    if any(_under(path, folder) for folder in hidden):
        return False
    return not any(part.startswith(".") for part in path.relative_to(home).parts)


def list_dirs(path: Path | None, home: Path) -> FsListDirsResult:
    """The folders directly under ``path`` (home when None), as ``fs.list_dirs`` returns them.

    Raises :class:`FolderError` for a path outside ``home`` (symlinks and ``..``
    are resolved first), a path that is not a folder, and a folder that cannot
    be read.
    """
    root = home.resolve()
    hidden = _hidden(root)
    try:
        target = root if path is None else path.resolve()
    except (OSError, RuntimeError) as exc:
        raise FolderError(OUTSIDE) from exc
    if not _browsable(target, root, hidden):
        raise FolderError(OUTSIDE)
    if not target.is_dir():
        raise FolderError(f"There is no folder at {path}.")
    entries: list[DirEntry] = []
    try:
        with os.scandir(target) as children:
            for child in children:
                if child.name.startswith("."):
                    continue
                try:
                    if not child.is_dir():
                        continue
                    resolved = Path(child.path).resolve()
                    git = (resolved / ".git").exists()
                except OSError:
                    continue
                if not _browsable(resolved, root, hidden):
                    continue
                entries.append(DirEntry(name=child.name, path=str(resolved), git=git))
    except OSError as exc:
        raise FolderError(f"golem can't read {target}.") from exc
    entries.sort(key=lambda entry: (entry.name.lower(), entry.name))
    return FsListDirsResult(
        path=str(target),
        home=str(root),
        parent=None if target == root else str(target.parent),
        entries=entries[:MAX_ENTRIES],
        truncated=len(entries) > MAX_ENTRIES,
    )
