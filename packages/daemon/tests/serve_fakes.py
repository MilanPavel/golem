"""A fake local Ollama and fake ``ollama serve`` processes, for the local server tests."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from pathlib import Path

import httpx

from golem.config import OllamaSettings
from golem.models.ollama import LocalServer, LocalServers, Process


class FakeServe:
    """Answers HTTP while ``up``, and fakes ``ollama serve``, which turns ``up`` on by default.

    ``routes`` answers paths other than ``/api/tags``, which lists ``models``.
    """

    def __init__(self) -> None:
        self.up = False
        self.models: list[dict[str, object]] = []
        self.routes: dict[str, Callable[[httpx.Request], httpx.Response]] = {}
        self.spawned: list[tuple[str, dict[str, str]]] = []
        self.processes: list[FakeProcess] = []
        self.on_spawn: Callable[[FakeProcess], None] = lambda _process: setattr(self, "up", True)

    def answer(self, request: httpx.Request) -> httpx.Response:
        if not self.up:
            raise httpx.ConnectError("All connection attempts failed", request=request)
        route = self.routes.get(request.url.path)
        if route is not None:
            return route(request)
        if request.url.path == "/api/tags":
            return httpx.Response(200, json={"models": self.models})
        return httpx.Response(404)

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.answer)

    async def spawn(self, path: str, env: dict[str, str], log_file: Path) -> Process:
        del log_file
        self.spawned.append((path, env))
        process = FakeProcess(4000 + len(self.processes))
        self.processes.append(process)
        self.on_spawn(process)
        return process

    def servers(self, tmp_path: Path, settings: OllamaSettings | None = None) -> LocalServers:
        """``LocalServers`` whose servers talk to this fake and spawn fake processes."""

        def make(base_url: str, **options: object) -> LocalServer:
            return LocalServer(
                base_url,
                transport=self.transport(),
                spawn=self.spawn,
                find_binary=lambda: "/opt/homebrew/bin/ollama",
                poll_seconds=0.01,
                **options,  # pyright: ignore[reportArgumentType]
            )

        return LocalServers(
            settings or OllamaSettings(),
            log_file=tmp_path / "logs" / "ollama.log",
            run_dir=tmp_path / "run",
            make=make,
        )


class FakeProcess:
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
