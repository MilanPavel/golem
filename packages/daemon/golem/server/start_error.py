"""``run/last-error``: why the daemon could not start, for a client that cannot connect.

The file has two lines, the reason and the next step. A daemon that starts
removes it, so a client reads it only while nothing answers on the socket.
"""

from __future__ import annotations

import logging
import os
import subprocess
from pathlib import Path

from golem import __version__
from golem.lock import DaemonAlreadyRunning
from golem.paths import GolemPaths
from golem.store.database import DatabaseTooNewError

log = logging.getLogger(__name__)

_FILE_NAME = "last-error"
_COMMAND_LIMIT = 200


def start_error_file(paths: GolemPaths) -> Path:
    return paths.run_dir / _FILE_NAME


def write_start_error(paths: GolemPaths, reason: str, next_step: str) -> None:
    """Replace the file in one step, so a client never reads half of it."""
    path = start_error_file(paths)
    temporary = path.with_name(f".{_FILE_NAME}.{os.getpid()}")
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary.write_text(f"{_one_line(reason)}\n{_one_line(next_step)}\n", encoding="utf-8")
        os.chmod(temporary, 0o600)
        temporary.replace(path)
    except OSError:
        log.warning("could not write %s", path, exc_info=True)
        temporary.unlink(missing_ok=True)


def clear_start_error(paths: GolemPaths) -> None:
    try:
        start_error_file(paths).unlink(missing_ok=True)
    except OSError:
        log.warning("could not remove %s", start_error_file(paths), exc_info=True)


def describe_database_too_new(error: DatabaseTooNewError) -> tuple[str, str]:
    if error.needs is not None:
        reason = f"your data is from golem {error.needs}, this is {__version__}"
    else:
        reason = (
            f"golem.db is at schema {error.found}, this golem reads up to schema {error.supported}"
        )
    return reason, "brew upgrade golem"


def describe_socket_path_too_long(path: Path) -> tuple[str, str]:
    size = len(os.fsencode(path))
    return f"the socket path is {size} bytes, more than a Unix socket takes: {path}", (
        "set GOLEM_HOME to a shorter folder"
    )


def describe_lock_held(error: DaemonAlreadyRunning) -> tuple[str, str]:
    """Name the process that holds the lock, so the user can tell which golem it is."""
    if error.pid is None:
        return "another golem daemon holds the lock", "golem daemon restart"
    command = process_command(error.pid)
    holder = f"pid {error.pid}" if command is None else f"pid {error.pid}, {command}"
    return f"another golem daemon holds the lock ({holder})", f"stop it with kill {error.pid}"


def process_command(pid: int) -> str | None:
    """The command line of ``pid``, which shows a checkout's path for a ``uv run`` daemon."""
    try:
        completed = subprocess.run(
            ["/bin/ps", "-o", "command=", "-p", str(pid)],
            capture_output=True,
            text=True,
            timeout=2,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    command = completed.stdout.strip()
    if completed.returncode != 0 or command == "":
        return None
    if len(command) > _COMMAND_LIMIT:
        return command[: _COMMAND_LIMIT - 1] + "…"
    return command


def _one_line(text: str) -> str:
    return " ".join(text.split())
