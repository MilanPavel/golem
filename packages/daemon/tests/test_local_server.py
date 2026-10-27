"""LocalServer: probe a local Ollama, start ``ollama serve`` for it, and stop only that one."""

from __future__ import annotations

import asyncio
import signal
from collections.abc import Callable
from pathlib import Path

import httpx
import pytest

from golem.config import OllamaSettings
from golem.models.errors import ModelUnreachable
from golem.models.ollama import LocalServer, LocalServers, Process, ServerState

URL = "http://127.0.0.1:11434"


class _Ollama:
    """A fake server that answers ``/api/tags`` while ``up``, and fake ``ollama serve``."""

    def __init__(self) -> None:
        self.up = False
        self.spawned: list[tuple[str, dict[str, str]]] = []
        self.processes: list[_Process] = []
        self.on_spawn: Callable[[_Process], None] = lambda _process: setattr(self, "up", True)

    def transport(self) -> httpx.MockTransport:
        def answer(request: httpx.Request) -> httpx.Response:
            if not self.up:
                raise httpx.ConnectError("All connection attempts failed", request=request)
            return httpx.Response(200, json={"models": []})

        return httpx.MockTransport(answer)

    async def spawn(self, path: str, env: dict[str, str], log_file: Path) -> Process:
        del log_file
        self.spawned.append((path, env))
        process = _Process(4000 + len(self.processes))
        self.processes.append(process)
        self.on_spawn(process)
        return process


class _Process:
    def __init__(self, pid: int) -> None:
        self.pid = pid
        self.returncode: int | None = None
        self.signals: list[str] = []
        self._done = asyncio.Event()

    def exit(self, code: int) -> None:
        self.returncode = code
        self._done.set()

    async def wait(self) -> int:
        await self._done.wait()
        assert self.returncode is not None
        return self.returncode

    def terminate(self) -> None:
        self.signals.append("term")
        self.exit(-15)

    def kill(self) -> None:
        self.signals.append("kill")
        self.exit(-9)


class _Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


@pytest.fixture
def ollama() -> _Ollama:
    return _Ollama()


def _server(
    ollama: _Ollama,
    tmp_path: Path,
    *,
    settings: OllamaSettings | None = None,
    binary: str | None = "/opt/homebrew/bin/ollama",
    **options: object,
) -> tuple[LocalServer, list[tuple[ServerState, str | None]]]:
    server = LocalServer(
        URL,
        settings=settings,
        log_file=tmp_path / "logs" / "ollama.log",
        pid_file=tmp_path / "run" / "ollama-11434.pid",
        transport=ollama.transport(),
        spawn=ollama.spawn,
        find_binary=lambda: binary,
        poll_seconds=0.01,
        **options,  # pyright: ignore[reportArgumentType]
    )
    heard: list[tuple[ServerState, str | None]] = []
    server.listener = lambda state, message: heard.append((state, message))
    return server, heard


async def test_a_server_that_already_answers_is_used_and_never_stopped(
    ollama: _Ollama, tmp_path: Path
) -> None:
    ollama.up = True
    server, heard = _server(ollama, tmp_path)
    assert await server.ensure_running() is True
    assert server.owner == "external"
    assert ollama.spawned == []

    await server.stop()
    assert server.owner == "external"
    assert heard == []


async def test_nothing_answers_so_golem_starts_ollama_serve(
    ollama: _Ollama, tmp_path: Path
) -> None:
    server, heard = _server(ollama, tmp_path)
    assert await server.ensure_running() is True

    [(path, env)] = ollama.spawned
    assert (path, env["OLLAMA_HOST"]) == ("/opt/homebrew/bin/ollama", "127.0.0.1:11434")
    status = server.status()
    assert status is not None and (status.owner, status.pid) == ("golem", 4000)
    assert (tmp_path / "run" / "ollama-11434.pid").read_text() == "4000\n"
    assert heard == [("starting", None), ("ready", None)]


async def test_two_callers_at_once_start_one_server(ollama: _Ollama, tmp_path: Path) -> None:
    server, _ = _server(ollama, tmp_path)
    assert await asyncio.gather(server.ensure_running(), server.ensure_running()) == [True, True]
    assert len(ollama.spawned) == 1


async def test_a_server_that_exits_says_where_its_log_is(ollama: _Ollama, tmp_path: Path) -> None:
    ollama.on_spawn = lambda process: process.exit(1)
    server, heard = _server(ollama, tmp_path)
    with pytest.raises(ModelUnreachable) as caught:
        await server.ensure_running()
    assert caught.value.message == "Ollama did not start: ollama serve exited with code 1"
    assert caught.value.hint == f"see {tmp_path / 'logs' / 'ollama.log'}"
    assert caught.value.provider == "ollama"
    assert heard == [("starting", None), ("failed", "ollama serve exited with code 1")]
    assert server.owner is None


async def test_a_server_that_never_answers_is_stopped(ollama: _Ollama, tmp_path: Path) -> None:
    ollama.on_spawn = lambda _process: None
    server, _ = _server(ollama, tmp_path, start_timeout=0.05)
    with pytest.raises(ModelUnreachable, match=r"did not answer within 0\.05 s"):
        await server.ensure_running()
    assert ollama.processes[0].signals == ["term"]


async def test_losing_the_port_to_another_daemon_uses_its_server(
    ollama: _Ollama, tmp_path: Path
) -> None:
    def lost(process: _Process) -> None:
        process.exit(1)
        ollama.up = True

    ollama.on_spawn = lost
    server, _ = _server(ollama, tmp_path)
    assert await server.ensure_running() is True
    assert server.owner == "external"


async def test_without_a_binary_or_with_start_off_nothing_starts(
    ollama: _Ollama, tmp_path: Path
) -> None:
    missing, _ = _server(ollama, tmp_path, binary=None)
    assert await missing.ensure_running() is False
    off, _ = _server(ollama, tmp_path, settings=OllamaSettings(start=False))
    assert await off.ensure_running() is False
    assert ollama.spawned == []


async def test_stop_ends_the_server_golem_started(ollama: _Ollama, tmp_path: Path) -> None:
    server, heard = _server(ollama, tmp_path)
    await server.ensure_running()
    await server.stop()
    assert ollama.processes[0].signals == ["term"]
    assert not (tmp_path / "run" / "ollama-11434.pid").exists()
    assert server.owner is None
    assert heard[-1] == ("stopped", None)


async def test_a_restarted_daemon_takes_back_the_server_it_started(
    ollama: _Ollama, tmp_path: Path
) -> None:
    ollama.up = True
    pid_file = tmp_path / "run" / "ollama-11434.pid"
    pid_file.parent.mkdir()
    pid_file.write_text("4242\n")
    sent: list[tuple[int, int]] = []

    def kill(pid: int, sig: int) -> None:
        sent.append((pid, sig))
        if sig == 0:
            raise ProcessLookupError

    def is_ollama(pid: int) -> bool:
        return pid == 4242

    server, _ = _server(ollama, tmp_path, is_ollama=is_ollama, kill=kill)
    assert await server.ensure_running() is True
    status = server.status()
    assert status is not None and (status.owner, status.pid) == ("golem", 4242)

    await server.stop()
    assert sent == [(4242, signal.SIGTERM), (4242, 0)]
    assert not pid_file.exists()


async def test_a_pid_file_for_another_process_is_not_golems(
    ollama: _Ollama, tmp_path: Path
) -> None:
    ollama.up = True
    pid_file = tmp_path / "run" / "ollama-11434.pid"
    pid_file.parent.mkdir()
    pid_file.write_text("4242\n")

    def not_ollama(pid: int) -> bool:
        del pid
        return False

    server, _ = _server(ollama, tmp_path, is_ollama=not_ollama)
    await server.ensure_running()
    assert server.owner == "external"
    assert not pid_file.exists()


async def test_the_idle_stop_waits_until_nothing_holds_the_server(
    ollama: _Ollama, tmp_path: Path
) -> None:
    clock = _Clock()
    server, _ = _server(
        ollama, tmp_path, clock=clock, settings=OllamaSettings(idle_stop_minutes=30)
    )
    async with server.hold():
        clock.now += 31 * 60
        assert await server.stop_if_idle() is False
    clock.now += 29 * 60
    assert await server.stop_if_idle() is False
    clock.now += 2 * 60
    assert await server.stop_if_idle() is True
    assert server.owner is None


async def test_idle_stop_minutes_0_keeps_it_running(ollama: _Ollama, tmp_path: Path) -> None:
    clock = _Clock()
    server, _ = _server(ollama, tmp_path, clock=clock, settings=OllamaSettings(idle_stop_minutes=0))
    await server.ensure_running()
    clock.now += 24 * 3600
    assert await server.stop_if_idle() is False


def test_only_a_url_on_this_machine_gets_a_server(tmp_path: Path) -> None:
    servers = LocalServers(OllamaSettings(), log_file=tmp_path / "ollama.log", run_dir=tmp_path)
    assert servers.get("far", "http://gpu-box:11434") is None
    local = servers.get("ollama", "http://127.0.0.1:11434/")
    assert local is not None and local is servers.get("ollama", URL)
    other = servers.get("second", "http://localhost:11500")
    assert other is not None and other is not local
    assert other._pid_file.name == "ollama-11500.pid"  # pyright: ignore[reportPrivateUsage]
