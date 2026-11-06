"""Installing with Homebrew, run by the daemon so every client can ask for it.

:class:`BrewInstaller` runs one ``brew install <formula>``. Ollama, Node, and
uv use it: Ollama sends ``ollama.install.output`` and ``ollama.install.done``,
and the two runtimes MCP servers need send ``runtime.install.output`` and
``runtime.install.done``. Neither is stored.

launchd gives the daemon no ``PATH`` of the user's, so brew is called by its
absolute path, with a ``PATH`` that has Homebrew's own tools and the system's.
Auto-update and analytics are off: an install from a setup screen should do
one thing. ADR-035 is the reference.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import shutil
from collections.abc import Awaitable, Callable, Mapping
from pathlib import Path
from typing import Literal, Protocol

from pydantic import BaseModel

from golem.mcp.launch import find_command
from golem.models import ollama
from golem_protocol.commands import (
    OllamaInstallDone,
    OllamaInstallOutput,
    RuntimeInstallDone,
    RuntimeInstallOutput,
    RuntimeName,
)
from golem_protocol.rpc import (
    OllamaInstallDoneNotification,
    OllamaInstallOutputNotification,
    RuntimeInstallDoneNotification,
    RuntimeInstallOutputNotification,
)

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


Outcome = Literal["installed", "failed", "stopped"]


class BrewInstaller:
    """At most one ``brew install <formula>`` at a time. ``spawn`` and ``find`` are for tests.

    ``output`` and ``done`` make the notifications a client gets, so one class
    serves every formula. ``installed`` says whether the program is there after brew ends.
    """

    def __init__(
        self,
        formula: str,
        *,
        output: Callable[[str], BaseModel],
        done: Callable[[Outcome, str | None], BaseModel],
        installed: Callable[[], bool],
        no_brew: str,
        broadcast: Broadcast | None = None,
        find: Callable[[], str | None] = find_brew,
        spawn: Spawn = _spawn,
        env: Mapping[str, str] | None = None,
        stop_grace: float = _STOP_GRACE,
    ) -> None:
        self.formula = formula
        self.broadcast: Broadcast = broadcast or (lambda _model: None)
        self._output = output
        self._done = done
        self._no_brew = no_brew
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
            raise InstallError(self._no_brew, no_brew=True)
        self._stopping = False
        try:
            self._process = await self._spawn(brew, ["install", self.formula], brew_env(self._env))
        except OSError as exc:
            raise InstallError(f"could not run {brew}: {exc}") from exc
        log.info("installing %s with %s", self.formula, brew)
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
                self._send(self._output(text))
        code = await process.wait()
        self._process = None
        reason: str | None = None
        if self._stopping:
            outcome: Outcome = "stopped"
        elif code == 0 and self._installed():
            outcome = "installed"
        else:
            outcome = "failed"
            last = next((line for line in reversed(tail.splitlines()) if line.strip()), "")
            reason = f"brew install {self.formula} exited with code {code}"
            reason = f"{reason}: {last}" if last else reason
        log.info("%s install ended outcome=%s", self.formula, outcome)
        self._send(self._done(outcome, reason))

    def _send(self, notification: BaseModel) -> None:
        try:
            self.broadcast(notification)
        except Exception:
            log.exception("could not send %s", type(notification).__name__)


class OllamaInstaller(BrewInstaller):
    """``brew install ollama``, reported as ``ollama.install.output`` and ``.done``."""

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
        super().__init__(
            "ollama",
            output=lambda text: OllamaInstallOutputNotification(
                params=OllamaInstallOutput(text=text)
            ),
            done=lambda outcome, reason: OllamaInstallDoneNotification(
                params=OllamaInstallDone(outcome=outcome, reason=reason)
            ),
            installed=installed,
            no_brew="Homebrew isn't installed. Download Ollama from https://ollama.com/download",
            broadcast=broadcast,
            find=find,
            spawn=spawn,
            env=env,
            stop_grace=stop_grace,
        )


RUNTIMES: dict[RuntimeName, tuple[str, str, str]] = {
    "node": ("node", "npx", "Download Node from https://nodejs.org/en/download"),
    "uv": ("uv", "uvx", "Download uv from https://docs.astral.sh/uv/getting-started/installation/"),
}
"""Each runtime's formula, the program MCP servers run with, and where to get it without brew."""


def runtime_installer(
    name: RuntimeName,
    *,
    broadcast: Broadcast | None = None,
    find: Callable[[], str | None] = find_brew,
    spawn: Spawn = _spawn,
    env: Mapping[str, str] | None = None,
    stop_grace: float = _STOP_GRACE,
) -> BrewInstaller:
    """``brew install node`` or ``uv``, reported as ``runtime.install.output`` and ``.done``."""
    formula, program, download = RUNTIMES[name]
    environ = env if env is not None else os.environ

    def done(outcome: Outcome, reason: str | None) -> BaseModel:
        ok = outcome == "installed"
        return RuntimeInstallDoneNotification(
            params=RuntimeInstallDone(name=name, ok=ok, error=reason)
        )

    return BrewInstaller(
        formula,
        output=lambda text: RuntimeInstallOutputNotification(
            params=RuntimeInstallOutput(name=name, text=text)
        ),
        done=done,
        installed=lambda: find_command(program, environ) is not None,
        no_brew=f"Homebrew isn't installed. {download}",
        broadcast=broadcast,
        find=find,
        spawn=spawn,
        env=env,
        stop_grace=stop_grace,
    )
