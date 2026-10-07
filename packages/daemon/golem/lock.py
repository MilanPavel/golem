"""PID lockfile for the daemon process.

``fcntl.flock`` on ``run/golem.pid`` is the lock. The file also stores the pid
so a second start can name the holder. The flock decides whether anyone is
alive: a pid check would mistake a reused pid for the old daemon.
"""

from __future__ import annotations

import fcntl
import os
from pathlib import Path

from golem.paths import GolemPaths


class DaemonAlreadyRunning(Exception):
    """Another process holds the pid lock."""

    def __init__(self, pid: int | None) -> None:
        self.pid = pid
        message = "daemon already running" if pid is None else f"daemon already running (pid {pid})"
        super().__init__(message)


class DaemonLock:
    """Exclusive lock held for the life of the daemon process."""

    def __init__(self, paths: GolemPaths) -> None:
        self._path = paths.pid_file
        self._fd: int | None = None

    @property
    def path(self) -> Path:
        return self._path

    def acquire(self) -> None:
        """Take the lock and write this process's pid.

        Raises :class:`DaemonAlreadyRunning` when another process holds it.
        """
        if self._fd is not None:
            return
        self._path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(self._path, os.O_CREAT | os.O_RDWR | os.O_CLOEXEC, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            os.close(fd)
            raise DaemonAlreadyRunning(_read_pid(self._path)) from None
        os.ftruncate(fd, 0)
        os.write(fd, f"{os.getpid()}\n".encode())
        os.fsync(fd)
        os.chmod(self._path, 0o600)
        self._fd = fd

    def release(self) -> None:
        """Drop the lock. A crash does this when the process exits."""
        fd = self._fd
        if fd is None:
            return
        self._fd = None
        try:
            fcntl.flock(fd, fcntl.LOCK_UN)
        finally:
            os.close(fd)


def _read_pid(path: Path) -> int | None:
    try:
        text = path.read_text(encoding="utf-8").strip()
    except OSError:
        return None
    try:
        return int(text)
    except ValueError:
        return None
