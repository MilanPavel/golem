"""Keep file tools inside the session folder."""

from __future__ import annotations

from pathlib import Path

from golem.tools.registry import ToolContext, ToolError

NO_FOLDER = (
    "this session has no project folder, so file tools are off. "
    "The user can start a new session with /new from the folder to work in."
)


def session_root(ctx: ToolContext) -> Path:
    """The resolved session folder. Raises :class:`ToolError` without one."""
    if ctx.root is None:
        raise ToolError(NO_FOLDER)
    return ctx.root.resolve()


def inside(root: Path, path: str) -> Path:
    """Resolve ``path`` against ``root``, following symlinks.

    A relative path is relative to ``root``. Raises :class:`ToolError` when
    the result is outside ``root``, including through a symlink or ``..``.
    """
    base = root.resolve()
    try:
        candidate = Path(path).expanduser()
        if not candidate.is_absolute():
            candidate = base / candidate
        resolved = candidate.resolve()
    except (OSError, RuntimeError, ValueError) as exc:
        raise ToolError(f"{path!r} is not a usable path: {exc}") from exc
    if resolved != base and base not in resolved.parents:
        raise ToolError(f"{path} is outside the project folder {base}")
    return resolved


def relative(root: Path, path: Path) -> str:
    """``path`` as the model should see it: relative to ``root``, or ``.``."""
    rel = path.relative_to(root.resolve())
    return "." if rel == Path() else rel.as_posix()


PROTECTED_DIRS = (".golem", ".git")
"""Folders no tool writes into: the project's rules are the user's, and so is its history.

Matched without case, because the default macOS file system ignores it.
"""


def writable(root: Path, path: str) -> Path:
    """:func:`inside`, and not the folder itself or under a :data:`PROTECTED_DIRS` folder."""
    resolved = inside(root, path)
    base = root.resolve()
    if resolved == base:
        raise ToolError(f"{path} is the project folder, not a file")
    parts = resolved.relative_to(base).parts
    protected = next((part for part in parts if part.casefold() in PROTECTED_DIRS), None)
    if protected is not None:
        raise ToolError(f"{path} is inside a {protected}/ folder, which golem does not change")
    return resolved


__all__ = ["NO_FOLDER", "PROTECTED_DIRS", "inside", "relative", "session_root", "writable"]
