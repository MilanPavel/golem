"""Helpers for daemon process tests."""

from __future__ import annotations

import os
import socket
import subprocess
import sys
import time
from pathlib import Path


def serve_env(home: Path) -> dict[str, str]:
    env = os.environ.copy()
    env["GOLEM_HOME"] = str(home)
    env.pop("GOLEM_LOG_LEVEL", None)
    return env


class ServeProcess:
    """A ``python -m golem serve`` child, with stderr in a file so the pipe cannot fill."""

    def __init__(self, home: Path) -> None:
        self.home = home
        self.stderr_path = home / "serve.stderr"
        self._handle = self.stderr_path.open("w", encoding="utf-8")
        self.proc = subprocess.Popen(
            [sys.executable, "-m", "golem", "serve"],
            env=serve_env(home),
            stdout=subprocess.DEVNULL,
            stderr=self._handle,
        )

    def wait_listening(self, socket_path: Path, timeout: float = 5) -> None:
        deadline = time.monotonic() + timeout
        last_error = "socket was not created"
        while time.monotonic() < deadline:
            if self.proc.poll() is not None:
                raise RuntimeError(
                    f"serve exited {self.proc.returncode}: {self.output()}",
                )
            if socket_path.exists():
                try:
                    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                        client.settimeout(0.2)
                        client.connect(os.fspath(socket_path))
                    return
                except OSError as exc:
                    last_error = str(exc)
            time.sleep(0.02)
        raise TimeoutError(f"{last_error}; stderr={self.output()}")

    def output(self) -> str:
        self._handle.flush()
        if not self.stderr_path.is_file():
            return ""
        return self.stderr_path.read_text(encoding="utf-8")

    def stop(self) -> None:
        if self.proc.poll() is None:
            self.proc.kill()
            self.proc.wait(timeout=5)
        self._handle.close()
