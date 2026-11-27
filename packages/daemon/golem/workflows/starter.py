"""The starter workflows: files that do real work, copied into a folder on request (#1906).

The files live in ``starters/`` next to this module. They have no ``__init__.py``, so nothing
imports them as modules. ``add_starter`` copies one to ``<folder>/workflows/<id>.py`` or to the
user's workflows folder, and the registry picks it up.
"""

from __future__ import annotations

import os
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from golem.workflows.registry import PROJECT_DIR

SOURCE = Path(__file__).parent / "starters"


class StarterError(Exception):
    """A starter that cannot be added; the text says why."""


@dataclass(frozen=True, slots=True)
class Starter:
    id: str
    title: str
    line: str
    needs_folder: bool
    """True when the workflow reads a project (it goes in the project's ``workflows/``)."""
    schedule: str | None = None
    """Said before the starter is added when its file starts runs by itself, else None."""


STARTERS: tuple[Starter, ...] = (
    Starter(
        "morning_briefing",
        "Morning briefing",
        "Reads your project folders, logs and feeds since yesterday and leaves one short "
        "briefing in the Inbox.",
        False,
        "Runs every weekday at 07:30",
    ),
)


def get(starter_id: str) -> Starter | None:
    return next((s for s in STARTERS if s.id == starter_id), None)


def add_starter(
    starter_id: str,
    folder: Path | None,
    *,
    user_dir: Path,
    trusted: Callable[[Path], bool],
) -> Path:
    """Write the starter's file and return its path. Raises :class:`StarterError`.

    Refused: an unknown id, a ``needs_folder`` starter with no folder, a folder that is not
    trusted, and a file that exists already (it is never overwritten).
    """
    starter = get(starter_id)
    if starter is None:
        known = ", ".join(s.id for s in STARTERS)
        raise StarterError(f"no starter {starter_id!r} (the starters are: {known})")
    if folder is None and starter.needs_folder:
        raise StarterError(
            f"{starter.id} works on a project folder; choose the folder to add it to"
        )
    if folder is not None and not starter.needs_folder:
        folder = None
    if folder is None:
        target_dir = user_dir
    else:
        if not trusted(folder):
            raise StarterError(
                f"{folder} is not trusted; add it to trusted_projects in config.toml first"
            )
        target_dir = folder / PROJECT_DIR
    target = target_dir / f"{starter.id}.py"
    if target.exists():
        raise StarterError(f"{target} exists already; it was not changed")
    try:
        text = (SOURCE / f"{starter.id}.py").read_bytes()
        target_dir.mkdir(parents=True, exist_ok=True)
        temp = target.with_name(f".{target.name}.{os.getpid()}.tmp")
        try:
            temp.write_bytes(text)
            os.link(temp, target)  # fails when the file appeared meanwhile; never overwrites
        finally:
            temp.unlink(missing_ok=True)
    except FileExistsError as exc:
        raise StarterError(f"{target} exists already; it was not changed") from exc
    except OSError as exc:
        raise StarterError(f"the file cannot be written: {exc}") from exc
    return target
