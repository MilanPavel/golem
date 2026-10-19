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
    candidate = Path(path).expanduser()
    if not candidate.is_absolute():
        candidate = base / candidate
    resolved = candidate.resolve()
    if resolved != base and base not in resolved.parents:
        raise ToolError(f"{path} is outside the project folder {base}")
    return resolved


def relative(root: Path, path: Path) -> str:
    """``path`` as the model should see it: relative to ``root``, or ``.``."""
    rel = path.relative_to(root.resolve())
    return "." if rel == Path() else rel.as_posix()


__all__ = ["NO_FOLDER", "inside", "relative", "session_root"]
