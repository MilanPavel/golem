import os
import subprocess
import sys
from pathlib import Path

from support import serve_env

from golem.lock import DaemonLock
from golem.paths import resolve_paths

_ACQUIRE = """
from golem.lock import DaemonAlreadyRunning, DaemonLock
from golem.paths import resolve_paths
import sys

lock = DaemonLock(resolve_paths())
try:
    lock.acquire()
except DaemonAlreadyRunning as exc:
    print(exc, file=sys.stderr)
    raise SystemExit(1)
raise SystemExit(0)
"""


def test_acquire_writes_pid_and_mode(short_home: Path) -> None:
    paths = resolve_paths(short_home)
    lock = DaemonLock(paths)
    lock.acquire()
    try:
        assert paths.pid_file.read_text(encoding="utf-8").strip() == str(os.getpid())
        assert paths.pid_file.stat().st_mode & 0o777 == 0o600
    finally:
        lock.release()


def test_release_allows_another_acquire(short_home: Path) -> None:
    paths = resolve_paths(short_home)
    lock = DaemonLock(paths)
    lock.acquire()
    lock.release()
    lock.acquire()
    lock.release()


def test_other_process_cannot_take_the_lock(short_home: Path) -> None:
    paths = resolve_paths(short_home)
    lock = DaemonLock(paths)
    lock.acquire()
    try:
        completed = subprocess.run(
            [sys.executable, "-c", _ACQUIRE],
            env=serve_env(short_home),
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    finally:
        lock.release()
    assert completed.returncode == 1
    assert f"daemon already running (pid {os.getpid()})" in completed.stderr
