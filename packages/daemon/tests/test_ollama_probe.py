"""The overlap probe: an external Ollama gets one slot unless two calls overlap."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from pathlib import Path

import httpx
from serve_fakes import FakeServe

from golem.config import OllamaSettings
from golem.models.ollama import LocalServer, LocalServers
from golem.models.ollama_probe import OverlapResult

URL = "http://127.0.0.1:11434"


class _Generate:
    """``/api/generate`` that runs ``slots`` calls at once and queues the rest."""

    def __init__(self, slots: int) -> None:
        self.calls = 0
        self._slots = asyncio.Semaphore(slots)
        self._started = 0
        self._both = asyncio.Event()

    def __call__(self, request: httpx.Request) -> httpx.Response:
        del request
        self.calls += 1
        return httpx.Response(200, content=self._stream())

    async def _stream(self) -> AsyncIterator[bytes]:
        async with self._slots:
            self._started += 1
            if self._started >= 2:
                self._both.set()
            yield b'{"response":"o"}\n'
            # A server with two slots has both calls running by now. One with one slot
            # never gets here with a second call, so the wait ends by its timeout.
            with_timeout = asyncio.timeout(0.05)
            try:
                async with with_timeout:
                    await self._both.wait()
            except TimeoutError:
                pass
            yield b'{"response":"k","done":true}\n'


def _external(tmp_path: Path, generate: _Generate | None) -> tuple[LocalServers, FakeServe]:
    serve = FakeServe()
    serve.up = True
    if generate is not None:
        serve.routes["/api/generate"] = generate
    return serve.servers(tmp_path, OllamaSettings(parallel=3)), serve


async def _seen(local: LocalServers) -> LocalServer:
    server = local.get("ollama", URL)
    assert server is not None
    await server.ensure_running()
    assert server.owner == "external"
    return server


async def test_a_server_that_overlaps_gives_the_setting(tmp_path: Path) -> None:
    local, _ = _external(tmp_path, _Generate(slots=2))
    server = await _seen(local)

    result = await local.probe(URL, "qwen3:8b")

    assert result == OverlapResult(True, None, None)
    assert server.overlap == result


async def test_a_server_that_does_not_overlap_gives_one_slot_and_a_line(tmp_path: Path) -> None:
    local, _ = _external(tmp_path, _Generate(slots=1))
    server = await _seen(local)
    heard: list[OverlapResult] = []
    local.on_probe = lambda _server, result: heard.append(result)

    result = await local.probe(URL, "qwen3:8b")

    assert result == OverlapResult(False, 1, "OLLAMA_NUM_PARALLEL=3 ollama serve")
    assert server.overlap == result
    assert heard == [result]


async def test_the_probe_runs_once_per_server_and_again_when_asked(tmp_path: Path) -> None:
    generate = _Generate(slots=2)
    local, _ = _external(tmp_path, generate)
    await _seen(local)

    await local.probe(URL, "qwen3:8b")
    await local.probe(URL, "qwen3:8b")
    assert generate.calls == 2

    await local.probe(URL, "qwen3:8b", again=True)
    assert generate.calls == 4


async def test_a_failed_probe_stores_nothing(tmp_path: Path) -> None:
    local, serve = _external(tmp_path, None)
    server = await _seen(local)
    serve.routes["/api/generate"] = lambda _request: httpx.Response(500)

    assert await local.probe(URL, "qwen3:8b") is None
    assert server.overlap is None


async def test_a_server_golem_started_is_not_probed(tmp_path: Path) -> None:
    serve = FakeServe()
    generate = _Generate(slots=1)
    serve.routes["/api/generate"] = generate
    local = serve.servers(tmp_path)
    server = local.get("ollama", URL)
    assert server is not None
    await server.ensure_running()
    assert server.owner == "golem"

    assert await local.probe(URL, "qwen3:8b") is None
    assert generate.calls == 0


async def test_with_no_local_model_no_probe_and_no_call(tmp_path: Path) -> None:
    # A cloud-only setup never makes a local server, so a probe has nothing to ask.
    local, serve = _external(tmp_path, None)
    seen: list[str] = []
    serve.routes["/api/generate"] = lambda request: (
        seen.append(request.url.path) or httpx.Response(200)
    )

    assert await local.probe(URL, "qwen3:8b") is None
    assert seen == []
    assert local.statuses() == []
