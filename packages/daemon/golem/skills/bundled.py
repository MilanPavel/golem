"""Where the skills that ship with golem live."""

from __future__ import annotations

import sys
from pathlib import Path

BUNDLED_DIR = "skills"
"""The folder name, in the repository root and in a release tree's ``libexec/golem-daemon``."""


def bundled_skills_dir(
    *, frozen: bool | None = None, executable: Path | None = None
) -> Path | None:
    """The folder of bundled skills, or ``None`` when this install has none.

    A release build has it next to the frozen daemon, copied there by
    ``scripts/dist.sh``. A checkout uses ``skills/`` in the repository root.
    """
    is_frozen = bool(getattr(sys, "frozen", False)) if frozen is None else frozen
    if is_frozen:
        program = executable if executable is not None else Path(sys.executable)
        folder = program.resolve().parent / BUNDLED_DIR
    else:
        folder = Path(__file__).resolve().parents[4] / BUNDLED_DIR
    return folder if folder.is_dir() else None


__all__ = ["BUNDLED_DIR", "bundled_skills_dir"]
