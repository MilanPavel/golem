"""Installing Ollama with Homebrew, run by the daemon so every client can ask for it.

launchd gives the daemon no ``PATH`` of the user's, so brew is called by its
absolute path, with a ``PATH`` that has Homebrew's own tools and the system's.
Auto-update and analytics are off: an install from a setup screen should do
one thing. The output goes to every connection as ``ollama.install.output``
and the end as ``ollama.install.done``. Neither is stored. ADR-035 is the
reference.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import shutil
from collections.abc import Awaitable, Callable, Mapping
from pathlib import Path
from typing import Protocol

from pydantic import BaseModel

from golem.models import ollama
from golem_protocol.commands import OllamaInstallDone, OllamaInstallOutput
from golem_protocol.rpc import OllamaInstallDoneNotification, OllamaInstallOutputNotification

log = logging.getLogger(__name__)

Broadcast = Callable[[BaseModel], None]

BREW = "/opt/homebrew/bin/brew"
_PATH = "/opt/homebrew/bin:/opt/homebrew/sbin:/usr/bin:/bin:/usr/sbin:/sbin"
_READ_BYTES = 4096
_STOP_GRACE = 5.0


class InstallError(Exception):
    """The install cannot start. ``no_brew`` means Homebrew is missing."""

    def __init__(self, message: str, *, no_brew: bool = False) -> None:
        super().__init__(message)
        self.no_brew = no_brew


class Process(Protocol):
    """What the installer needs of the brew process."""

    @property
    def stdout(self) -> asyncio.StreamReader | None: ...

    @property
    def returncode(self) -> int | None: ...

    async def wait(self) -> int: ...

    def terminate(self) -> None: ...

    def kill(self) -> None: ...


Spawn = Callable[[str, list[str], Mapping[str, str]], Awaitable[Process]]


async def _spawn(command: str, args: list[str], env: Mapping[str, str]) -> Process:
    return await asyncio.create_subprocess_exec(
        command,
        *args,
        env=dict(env),
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )


def find_brew() -> str | None:
    """Homebrew's ``brew``, at its install path or on ``PATH``."""
    if Path(BREW).exists():
        return BREW
    return shutil.which("brew")


def brew_env(base: Mapping[str, str]) -> dict[str, str]:
    """The environment brew runs in: the daemon's, with a usable ``PATH`` and the extras off."""
    env = dict(base)
    env["PATH"] = _PATH if not base.get("PATH") else f"{_PATH}:{base['PATH']}"
    env["HOMEBREW_NO_AUTO_UPDATE"] = "1"
    env["HOMEBREW_NO_ANALYTICS"] = "1"
    env["HOMEBREW_NO_ENV_HINTS"] = "1"
    env["NONINTERACTIVE"] = "1"
    return env


class OllamaInstaller:
    """At most one ``brew install ollama`` at a time. ``spawn`` and ``find`` are for tests."""

    def __init__(
        self,
        *,
        broadcast: Broadcast | None = None,
        find: Callable[[], str | None] = find_brew,
        installed: Callable[[], bool] = ollama.installed,
        spawn: Spawn = _spawn,
        env: Mapping[str, str] | None = None,
        stop_grace: float = _STOP_GRACE,
    ) -> None:
        self.broadcast: Broadcast = broadcast or (lambda _model: None)
        self._find = find
        self._installed = installed
        self._spawn = spawn
        self._env = env if env is not None else os.environ
        self._grace = stop_grace
        self._task: asyncio.Task[None] | None = None
        self._process: Process | None = None
        self._stopping = False

    @property
    def running(self) -> bool:
        return self._task is not None and not self._task.done()

    async def start(self) -> bool:
        """Start the install. False when one is already running. Raises :class:`InstallError`."""
        if self.running:
            return False
        brew = self._find()
        if brew is None:
            raise InstallError(
                "Homebrew isn't installed. Download Ollama from https://ollama.com/download",
                no_brew=True,
            )
        self._stopping = False
        try:
            self._process = await self._spawn(brew, ["install", "ollama"], brew_env(self._env))
        except OSError as exc:
            raise InstallError(f"could not run {brew}: {exc}") from exc
        log.info("installing ollama with %s", brew)
        self._task = asyncio.create_task(self._follow(self._process))
        return True

    async def cancel(self) -> bool:
        """Stop a running install. False when none was running."""
        process = self._process
        task = self._task
        if process is None or task is None or task.done():
            return False
        self._stopping = True
        with contextlib.suppress(ProcessLookupError):
            process.terminate()
        try:
            await asyncio.wait_for(asyncio.shield(task), timeout=self._grace)
        except TimeoutError:
            with contextlib.suppress(ProcessLookupError):
                process.kill()
            await asyncio.gather(task, return_exceptions=True)
        return True

    async def aclose(self) -> None:
        await self.cancel()

    async def _follow(self, process: Process) -> None:
        tail = ""
        if process.stdout is not None:
            while chunk := await process.stdout.read(_READ_BYTES):
                text = chunk.decode("utf-8", errors="replace")
                tail = (tail + text)[-400:]
                self._send(OllamaInstallOutputNotification(params=OllamaInstallOutput(text=text)))
        code = await process.wait()
        self._process = None
        if self._stopping:
            done = OllamaInstallDone(outcome="stopped")
        elif code == 0 and self._installed():
            done = OllamaInstallDone(outcome="installed")
        else:
            last = next((line for line in reversed(tail.splitlines()) if line.strip()), "")
            reason = f"brew install ollama exited with code {code}"
            done = OllamaInstallDone(
                outcome="failed", reason=f"{reason}: {last}" if last else reason
            )
        log.info("ollama install ended outcome=%s", done.outcome)
        self._send(OllamaInstallDoneNotification(params=done))

    def _send(self, notification: BaseModel) -> None:
        try:
            self.broadcast(notification)
        except Exception:
            log.exception("could not send %s", type(notification).__name__)
