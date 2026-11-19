"""A true/false flag in a project's ``.golem/config.toml``, found at or above a folder.

``[routing] local_only = true`` makes a chat local only, and ``[memory] private = true`` makes
the project's memory local. A project file may make things more private and never less, so a
flag is read whether or not the project is trusted. Only the literal ``true`` counts. The
user's own file keeps a list under ``local_only``; a list there is not a flag.
"""

from __future__ import annotations

import tomllib
from functools import lru_cache
from pathlib import Path
from typing import Any, cast


@lru_cache(maxsize=256)
def _flag_at(path: str, mtime_ns: int, size: int, table: str, key: str) -> bool:
    del mtime_ns, size  # they only key the cache
    try:
        with open(path, "rb") as handle:
            data = tomllib.load(handle)
    except (OSError, tomllib.TOMLDecodeError):
        return False
    found: Any = data.get(table)
    if not isinstance(found, dict):
        return False
    return cast(dict[str, Any], found).get(key) is True


def project_flag(cwd: str | None, table: str, key: str) -> bool:
    """Whether ``cwd`` or a folder above it has a project file with ``[table] key = true``."""
    if cwd is None or cwd == "":
        return False
    here = Path(cwd).expanduser()
    if not here.is_absolute():
        return False
    real = here.resolve()
    for folder in (real, *real.parents):
        file = folder / ".golem" / "config.toml"
        try:
            info = file.stat()
        except OSError:
            continue
        if _flag_at(str(file), info.st_mtime_ns, info.st_size, table, key):
            return True
    return False


def project_local_only(cwd: str | None) -> bool:
    """Whether ``cwd`` or a folder above it has a ``.golem/config.toml`` with the flag."""
    return project_flag(cwd, "routing", "local_only")


__all__ = ["project_flag", "project_local_only"]
