"""The ``[routing] local_only = true`` flag of a project's ``.golem/config.toml``.

A project file may make a chat more private and never less, so the flag is read whether or
not the project is trusted. Only the literal ``true`` counts. The user's own file keeps a list
under the same key; a list there is not a flag.
"""

from __future__ import annotations

import tomllib
from functools import lru_cache
from pathlib import Path
from typing import Any, cast


@lru_cache(maxsize=256)
def _flag_at(path: str, mtime_ns: int, size: int) -> bool:
    del mtime_ns, size  # they only key the cache
    try:
        with open(path, "rb") as handle:
            data = tomllib.load(handle)
    except (OSError, tomllib.TOMLDecodeError):
        return False
    routing: Any = data.get("routing")
    if not isinstance(routing, dict):
        return False
    return cast(dict[str, Any], routing).get("local_only") is True


def project_local_only(cwd: str | None) -> bool:
    """Whether ``cwd`` or a folder above it has a ``.golem/config.toml`` with the flag."""
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
        if _flag_at(str(file), info.st_mtime_ns, info.st_size):
            return True
    return False


__all__ = ["project_local_only"]
