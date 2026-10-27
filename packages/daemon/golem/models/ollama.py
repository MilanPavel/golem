"""Ollama on this machine: whether it is installed, what to say when it does not
answer, and the ``ollama serve`` that golem starts when nothing answers.

The daemon runs under launchd with no ``PATH`` of the user's, so ``which``
alone can miss a Homebrew or app install. The known paths cover those.

A :class:`LocalServer` owns at most one ``ollama serve``: the one it started.
A server that answered before golem looked is ``external`` and is never
stopped. The started server's pid goes into a file, so a daemon that restarts
takes it back. Two daemons need no lock between them, because the port is the
lock: a second ``ollama serve`` exits, and its daemon then finds the first one
answering.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import shutil
import signal
import subprocess
import time
from collections.abc import AsyncGenerator, Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, NoReturn, Protocol
from urllib.parse import urlparse

import httpx

from golem.config import OllamaSettings
from golem.models.errors import ModelUnreachable

log = logging.getLogger(__name__)

BINARIES = (
    "/opt/homebrew/bin/ollama",
    "/usr/local/bin/ollama",
    "/Applications/Ollama.app/Contents/Resources/ollama",
)

_LOCAL_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})
_DEFAULT_PORT = 11434
_PROBE_TIMEOUT = 1.0
_START_TIMEOUT = 15.0
_POLL_SECONDS = 0.25
_STOP_GRACE = 5.0

Owner = Literal["golem", "external"]
ServerState = Literal["starting", "ready", "failed", "stopped"]
Listener = Callable[[ServerState, str | None], None]


def binary() -> str | None:
    """The ``ollama`` binary on ``PATH`` or at a known install path, or None."""
    found = shutil.which("ollama")
    if found is not None:
        return found
    return next((path for path in BINARIES if Path(path).exists()), None)


def installed() -> bool:
    """True when an ``ollama`` binary is on ``PATH`` or at a known install path."""
    return binary() is not None


def is_local(base_url: str) -> bool:
    """True when ``base_url`` points at this machine."""
    return urlparse(base_url).hostname in _LOCAL_HOSTS


def down(is_installed: bool) -> tuple[str, str]:
    """``(message, hint)`` for a local Ollama that does not answer."""
    if is_installed:
        return "Ollama is not running", "run ollama serve"
    return "Ollama is not installed", "run brew install ollama"


def down_text(is_installed: bool) -> str:
    """The message and the hint as one line, for errors that have no separate hint."""
    message, hint = down(is_installed)
    return f"{message}: {hint}"


class Process(Protocol):
    """What :class:`LocalServer` needs of the process it started."""

    @property
    def pid(self) -> int: ...

    @property
    def returncode(self) -> int | None: ...

    async def wait(self) -> int: ...

    def terminate(self) -> None: ...

    def kill(self) -> None: ...


Spawn = Callable[[str, dict[str, str], Path], Awaitable[Process]]


@dataclass(frozen=True, slots=True)
class LocalServerStatus:
    """Who runs the server at ``base_url``. ``pid`` is known only for one golem started."""

    provider: str
    base_url: str
    owner: Owner
    pid: int | None


class LocalServer:
    """One local Ollama URL: probe it, start ``ollama serve`` for it, and stop that again.

    :meth:`hold` wraps each use, so :meth:`stop_if_idle` never stops a server
    in use. ``listener`` hears ``starting``, ``ready``, ``failed`` (with why),
    and ``stopped``.
    """

    def __init__(
        self,
        base_url: str,
        *,
        provider: str = "ollama",
        settings: OllamaSettings | None = None,
        log_file: Path,
        pid_file: Path,
        transport: httpx.AsyncBaseTransport | None = None,
        spawn: Spawn | None = None,
        find_binary: Callable[[], str | None] = binary,
        is_ollama: Callable[[int], bool] | None = None,
        kill: Callable[[int, int], None] = os.kill,
        clock: Callable[[], float] = time.monotonic,
        start_timeout: float = _START_TIMEOUT,
        poll_seconds: float = _POLL_SECONDS,
        stop_grace: float = _STOP_GRACE,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.provider = provider
        self.settings = settings or OllamaSettings()
        self.listener: Listener = lambda _state, _message: None
        self._log_file = log_file
        self._pid_file = pid_file
        self._transport = transport
        self._spawn = spawn or _spawn
        self._find_binary = find_binary
        self._is_ollama = is_ollama or _is_ollama
        self._kill = kill
        self._clock = clock
        self._start_timeout = start_timeout
        self._poll = poll_seconds
        self._grace = stop_grace
        self._lock = asyncio.Lock()
        self._client: httpx.AsyncClient | None = None
        self._process: Process | None = None
        self._owner: Owner | None = None
        self._pid: int | None = None
        self._users = 0
        self._used = clock()

    @property
    def owner(self) -> Owner | None:
        """``golem`` for a server golem started, ``external`` for another, None before a probe."""
        return self._owner

    def status(self) -> LocalServerStatus | None:
        if self._owner is None:
            return None
        return LocalServerStatus(self.provider, self.base_url, self._owner, self._pid)

    async def ensure_running(self) -> bool:
        """True when the server answers, after starting it if golem may.

        False when nothing answers and golem may not start one: ``start`` is
        off, or there is no ``ollama`` binary. Raises :class:`ModelUnreachable`
        when a start fails.
        """
        self._used = self._clock()
        if self._process is not None and self._process.returncode is None:
            return True
        # Shielded: a caller that goes away mid-start must not leave a server nobody owns.
        return await asyncio.shield(self._ensure())

    async def _ensure(self) -> bool:
        async with self._lock:
            if await self._answers():
                if self._owner is None:
                    self._take_back()
                return True
            self._forget()
            if not self.settings.start:
                return False
            path = self._find_binary()
            if path is None:
                return False
            await self._start(path)
            return True

    @contextlib.asynccontextmanager
    async def hold(self) -> AsyncGenerator[None]:
        """Make sure the server runs, and keep the idle stop away while inside."""
        await self.ensure_running()
        self._users += 1
        try:
            yield
        finally:
            self._users -= 1
            self._used = self._clock()

    async def stop_if_idle(self) -> bool:
        """Stop a server golem started once nothing has held it for ``idle_stop_minutes``."""
        minutes = self.settings.idle_stop_minutes
        if self._owner != "golem" or self._users > 0 or minutes == 0:
            return False
        if self._clock() - self._used < minutes * 60:
            return False
        log.info("stopping ollama at %s: unused for %d minutes", self.base_url, minutes)
        await self.stop()
        return True

    async def stop(self) -> None:
        """Stop the server if golem started it. A server golem did not start keeps running."""
        async with self._lock:
            if self._owner != "golem":
                return
            if self._process is not None:
                await self._stop_child(self._process)
            elif self._pid is not None:
                await self._stop_pid(self._pid)
            self._forget()
            self.listener("stopped", None)

    async def aclose(self) -> None:
        await self.stop()
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def _start(self, path: str) -> None:
        self.listener("starting", None)
        log.info("starting %s serve for %s", path, self.base_url)
        env = {**os.environ, "OLLAMA_HOST": self._host()}
        try:
            self._log_file.parent.mkdir(parents=True, exist_ok=True)
            process = await self._spawn(path, env, self._log_file)
        except OSError as exc:
            self._fail(str(exc))
        deadline = self._clock() + self._start_timeout
        while not await self._answers():
            if process.returncode is not None and not await self._answers():
                self._fail(f"ollama serve exited with code {process.returncode}")
            if self._clock() >= deadline:
                await self._stop_child(process)
                self._fail(f"ollama serve did not answer within {self._start_timeout:g} s")
            await asyncio.sleep(self._poll)
        if process.returncode is not None:
            # Another ollama serve took the port first, so this one gave up.
            self._owner = "external"
            self.listener("ready", None)
            return
        self._process = process
        self._owner = "golem"
        self._pid = process.pid
        with contextlib.suppress(OSError):
            self._pid_file.parent.mkdir(parents=True, exist_ok=True)
            self._pid_file.write_text(f"{process.pid}\n", encoding="utf-8")
        log.info("ollama serve is answering at %s, pid %d", self.base_url, process.pid)
        self.listener("ready", None)

    def _fail(self, reason: str) -> NoReturn:
        log.warning("ollama serve did not start: %s", reason)
        self.listener("failed", reason)
        raise ModelUnreachable(
            f"Ollama did not start: {reason}",
            provider=self.provider,
            hint=f"see {_tilde(self._log_file)}",
        )

    def _take_back(self) -> None:
        """A server answers that this daemon did not start. Did golem start it before?"""
        pid = _read_pid(self._pid_file)
        if pid is not None and self._is_ollama(pid):
            self._owner, self._pid = "golem", pid
            log.info("took back ollama serve at %s, pid %d", self.base_url, pid)
            return
        self._pid_file.unlink(missing_ok=True)
        self._owner = "external"

    def _forget(self) -> None:
        if self._owner == "golem":
            self._pid_file.unlink(missing_ok=True)
        self._process = None
        self._owner = None
        self._pid = None

    async def _stop_child(self, process: Process) -> None:
        if process.returncode is not None:
            return
        process.terminate()
        try:
            await asyncio.wait_for(process.wait(), self._grace)
        except TimeoutError:
            process.kill()
            await process.wait()

    async def _stop_pid(self, pid: int) -> None:
        try:
            self._kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            return
        deadline = self._clock() + self._grace
        while self._clock() < deadline:
            try:
                self._kill(pid, 0)
            except ProcessLookupError:
                return
            await asyncio.sleep(self._poll)
        with contextlib.suppress(ProcessLookupError):
            self._kill(pid, signal.SIGKILL)

    async def _answers(self) -> bool:
        try:
            response = await self._http().get(f"{self.base_url}/api/tags", timeout=_PROBE_TIMEOUT)
            response.raise_for_status()
        except httpx.HTTPError:
            return False
        return True

    def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(transport=self._transport)
        return self._client

    def _host(self) -> str:
        parsed = urlparse(self.base_url)
        host = parsed.hostname or "127.0.0.1"
        if ":" in host:
            host = f"[{host}]"
        return f"{host}:{parsed.port or _DEFAULT_PORT}"


class LocalServers:
    """One :class:`LocalServer` per local Ollama URL, made on first use."""

    def __init__(
        self,
        settings: OllamaSettings,
        *,
        log_file: Path,
        run_dir: Path,
        make: Callable[..., LocalServer] = LocalServer,
    ) -> None:
        self._settings = settings
        self._log_file = log_file
        self._run_dir = run_dir
        self._make = make
        self._servers: dict[str, LocalServer] = {}
        self.listener: Callable[[LocalServer, ServerState, str | None], None] = (
            lambda _server, _state, _message: None
        )

    @property
    def settings(self) -> OllamaSettings:
        return self._settings

    @settings.setter
    def settings(self, value: OllamaSettings) -> None:
        self._settings = value
        for server in self._servers.values():
            server.settings = value

    def get(self, provider: str, base_url: str) -> LocalServer | None:
        """The server for ``base_url``, or None when it is not on this machine."""
        url = base_url.rstrip("/")
        if not is_local(url):
            return None
        server = self._servers.get(url)
        if server is None:
            port = urlparse(url).port or _DEFAULT_PORT
            made = self._make(
                url,
                provider=provider,
                settings=self._settings,
                log_file=self._log_file,
                pid_file=self._run_dir / f"ollama-{port}.pid",
            )
            made.listener = lambda state, message: self.listener(made, state, message)
            self._servers[url] = made
            server = made
        return server

    def statuses(self) -> list[LocalServerStatus]:
        return [status for server in self._servers.values() if (status := server.status())]

    async def stop_idle(self) -> None:
        for server in list(self._servers.values()):
            await server.stop_if_idle()

    async def aclose(self) -> None:
        for server in list(self._servers.values()):
            await server.aclose()


async def _spawn(path: str, env: dict[str, str], log_file: Path) -> Process:
    with log_file.open("ab") as out:
        started = time.strftime("%Y-%m-%d %H:%M:%S")
        out.write(f"--- golem started {path} serve at {started}\n".encode())
        out.flush()
        # Its own session, so Ctrl-C on a daemon in a terminal does not reach it.
        return await asyncio.create_subprocess_exec(
            path,
            "serve",
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=out,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )


def _is_ollama(pid: int) -> bool:
    try:
        result = subprocess.run(
            ["ps", "-o", "comm=", "-p", str(pid)],
            capture_output=True,
            text=True,
            timeout=2,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return Path(result.stdout.strip()).name == "ollama"


def _read_pid(path: Path) -> int | None:
    try:
        text = path.read_text(encoding="utf-8").strip()
    except OSError:
        return None
    return int(text) if text.isdigit() else None


def _tilde(path: Path) -> str:
    home = Path.home()
    return f"~/{path.relative_to(home)}" if path.is_relative_to(home) else str(path)
