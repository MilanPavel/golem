"""Copies of a SQLite file, taken before an upgrade changes it.

A copy is ``<file>.bak-<version>``, where the version is what wrote the
original: the schema for ``golem.db``, the LangGraph release for
``checkpoints.db``. A daemon that can read that version can open the copy.
"""

from __future__ import annotations

import os
import sqlite3
from contextlib import closing
from pathlib import Path


def backup_path(path: Path, version: str) -> Path:
    return path.with_name(f"{path.name}.bak-{version}")


def backup_sqlite(source: Path, destination: Path) -> None:
    """Copy ``source`` with SQLite's backup API, then move it into place.

    The copy is consistent even while another connection has the file open in
    WAL mode. It replaces an older copy with the same name only once it is
    complete, and it keeps the original's permissions.
    """
    partial = destination.with_name(f"{destination.name}.partial")
    partial.unlink(missing_ok=True)
    try:
        # Create it with the original's mode, so chat history is never readable by others.
        os.close(
            os.open(partial, os.O_WRONLY | os.O_CREAT | os.O_EXCL, source.stat().st_mode & 0o777)
        )
        with (
            closing(sqlite3.connect(source)) as reader,
            closing(sqlite3.connect(partial)) as writer,
        ):
            reader.backup(writer)
        os.replace(partial, destination)
    except BaseException:
        partial.unlink(missing_ok=True)
        raise


__all__ = ["backup_path", "backup_sqlite"]
