"""Where the agent types that ship with golem live."""

from __future__ import annotations

from pathlib import Path


def bundled_agents_dir() -> Path:
    """The folder of bundled agent files, inside this package.

    The release build copies it with the package data (``golem-daemon.spec``).
    """
    return Path(__file__).resolve().parent / "bundled"


__all__ = ["bundled_agents_dir"]
