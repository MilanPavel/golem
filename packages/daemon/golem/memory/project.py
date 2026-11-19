"""The project a session belongs to, for project memory."""

from __future__ import annotations

from pathlib import Path

MARKERS = (".git", ".golem")


def project_key(cwd: str | None, golem_home: Path | None = None) -> str | None:
    """The nearest folder at or above ``cwd`` with ``.git`` or ``.golem``, as a real path.

    With none, it is the real path of ``cwd`` itself. A ``.git`` file (a worktree) counts as
    well as a folder. A blank or relative ``cwd``, or None, has no key.

    ``golem_home`` is golem's own folder (``~/.golem``). It is not a project marker:
    without this, every folder below your home folder would be one project.
    """
    if cwd is None or cwd.strip() == "":
        return None
    here = Path(cwd).expanduser()
    if not here.is_absolute():
        return None
    real = here.resolve()
    own = golem_home.expanduser().resolve() if golem_home is not None else None
    for folder in (real, *real.parents):
        for marker in MARKERS:
            found = folder / marker
            if found.exists() and (own is None or found.resolve() != own):
                return str(folder)
    return str(real)


__all__ = ["MARKERS", "project_key"]
