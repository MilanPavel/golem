"""Whether a folder keeps its chats on this Mac. Pure apart from resolving paths."""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

LOCAL_ONLY_HINT = "Pick a local model with /model."
LOCAL_ONLY_REFUSAL = f"This folder is local only. {LOCAL_ONLY_HINT}"


def _real(path: str) -> Path | None:
    """The absolute, ``~``-expanded, symlink-free path, or None for a blank or relative one."""
    if path.strip() == "":
        return None
    expanded = Path(path).expanduser()
    if not expanded.is_absolute():
        return None
    return expanded.resolve()


def is_local_only(cwd: str | None, user_folders: Sequence[str], project_flag: bool) -> bool:
    """True when the project says so, or ``cwd`` is one of ``user_folders`` or inside one.

    Paths are compared by their real path, so a symlink into a private folder counts.
    ``/a/work2`` is not inside ``/a/work``. A ``cwd`` of None is never local only.
    """
    if project_flag:
        return True
    if cwd is None:
        return False
    here = _real(cwd)
    if here is None:
        return False
    for folder in user_folders:
        root = _real(folder)
        if root is not None and (here == root or root in here.parents):
            return True
    return False


__all__ = ["LOCAL_ONLY_HINT", "LOCAL_ONLY_REFUSAL", "is_local_only"]
