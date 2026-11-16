"""Keep file tools inside the session folder.

The read tools may also read the folders of the skills the session ran. Those
are read roots only: no tool writes there.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from golem.tools.registry import ToolContext, ToolError
from golem.tools.sandbox import SECRET_DIRS, SKILL_DIRS

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


@dataclass(frozen=True, slots=True)
class Readable:
    """Where the read tools may look: the session folder, then each skill folder.

    ``root`` is None in a session without a project folder. A relative path is
    relative to ``root``, so a skill file needs its absolute path.
    """

    root: Path | None
    skills: tuple[Path, ...] = ()
    home: Path = field(default_factory=Path.home)

    def resolve(self, path: str) -> Path:
        """``path`` resolved, following symlinks. Raises :class:`ToolError` outside every root."""
        if self.root is not None:
            try:
                inner = inside(self.root, path)
            except ToolError:
                if not self.skills:
                    raise
            else:
                if in_secret_dir(inner, self.home):
                    raise ToolError(CREDENTIALS.format(path=path))
                return inner
        resolved = _resolve(path)
        if resolved is None:
            if self.root is None:
                raise ToolError(NO_FOLDER)
            raise ToolError(f"{path!r} is not a usable path")
        for folder in self.skills:
            if _within(resolved, folder):
                if in_secret_dir(resolved, self.home):
                    raise ToolError(CREDENTIALS.format(path=path))
                return resolved
        where = f"the project folder {self.root}" if self.root is not None else "every folder"
        raise ToolError(f"{path} is outside {where} and the folders of the skills this session ran")

    def show(self, path: Path) -> str:
        """``path`` relative to the session folder, or absolute inside a skill folder."""
        if self.root is not None:
            base = self.root
            if _within(path, base):
                return relative(base, path)
        return path.as_posix()


def readable(ctx: ToolContext) -> Readable:
    """The read roots of ``ctx``. Raises :class:`ToolError` when there are none."""
    skills = tuple(folder.resolve() for folder in ctx.read_roots)
    if ctx.root is None and not skills:
        raise ToolError(NO_FOLDER)
    return Readable(root=None if ctx.root is None else ctx.root.resolve(), skills=skills)


CREDENTIALS = "{path} is in a folder that holds credentials"


def secret_folders(home: Path | None = None) -> list[Path]:
    """The resolved :data:`SECRET_DIRS` folders under ``home``."""
    base = (Path.home() if home is None else home).resolve()
    return [(base / name).resolve() for name in SECRET_DIRS]


def in_secret_dir(path: Path, home: Path | None = None, folders: list[Path] | None = None) -> bool:
    """Whether resolved ``path`` is in a folder the sandbox keeps from commands too.

    ``folders`` is :func:`secret_folders` when a walk checks many paths.
    """
    base = (Path.home() if home is None else home).resolve()
    if any(_within(path, (base / name).resolve()) for name in SKILL_DIRS):
        return False
    found = secret_folders(base) if folders is None else folders
    return any(_within(path, folder) for folder in found)


def is_secret_tree(path: Path, home: Path | None = None, folders: list[Path] | None = None) -> bool:
    """Whether a walk should not enter folder ``path``: it is secret and holds no skill folder."""
    base = (Path.home() if home is None else home).resolve()
    if not in_secret_dir(path, base, folders):
        return False
    return not any(_within((base / name).resolve(), path) for name in SKILL_DIRS)


def _within(path: Path, folder: Path) -> bool:
    return path == folder or folder in path.parents


def _resolve(path: str) -> Path | None:
    """An absolute ``path`` resolved, or None for a relative or unusable one."""
    try:
        candidate = Path(path).expanduser()
        if not candidate.is_absolute():
            return None
        return candidate.resolve()
    except (OSError, RuntimeError, ValueError):
        return None


def relative(root: Path, path: Path) -> str:
    """``path`` as the model should see it: relative to ``root``, or ``.``."""
    rel = path.relative_to(root.resolve())
    return "." if rel == Path() else rel.as_posix()


PROTECTED_DIRS = (".golem", ".git")
"""Folders no tool writes into: the project's rules are the user's, and so is its history.

Matched without case, because the default macOS file system ignores it.
"""


def writable(root: Path, path: str, home: Path | None = None) -> Path:
    """:func:`inside`, and not the folder itself, a credentials folder or a protected one."""
    resolved = inside(root, path)
    if in_secret_dir(resolved, home):
        raise ToolError(CREDENTIALS.format(path=path))
    base = root.resolve()
    if resolved == base:
        raise ToolError(f"{path} is the project folder, not a file")
    parts = resolved.relative_to(base).parts
    protected = next((part for part in parts if part.casefold() in PROTECTED_DIRS), None)
    if protected is not None:
        raise ToolError(f"{path} is inside a {protected}/ folder, which golem does not change")
    return resolved


__all__ = [
    "CREDENTIALS",
    "NO_FOLDER",
    "PROTECTED_DIRS",
    "Readable",
    "in_secret_dir",
    "inside",
    "is_secret_tree",
    "readable",
    "relative",
    "secret_folders",
    "session_root",
    "writable",
]
