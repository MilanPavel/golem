"""A local model call, the model list, a download, and daemon shutdown start or stop Ollama."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

import httpx
from fakes import ToolCallingChatModel
from langchain_core.callbacks import CallbackManagerForLLMRun
from langchain_core.messages import BaseMessage
from langchain_core.outputs import ChatResult
from langgraph.checkpoint.memory import InMemorySaver
from pydantic import Field
from serve_fakes import FakeServe
from test_server import start_daemon, stop_daemon

from golem.config import GolemSettings
from golem.graphs.chat import open_chat
from golem.models.discovery import ModelDiscovery
from golem.models.ollama import LocalServers
from golem.models.pulls import PullManager
from golem.models.router import ModelRouter
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.manager import SessionManager
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem_protocol.events import ChatEvent

URL = "http://127.0.0.1:11434"


class _Watching(ToolCallingChatModel):
    """Records how many calls hold the local server while it answers."""

    servers: Any = None
    holders: list[int] = Field(default_factory=list[int])

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        server = self.servers.get("ollama", URL)
        self.holders.append(server._users)  # pyright: ignore[reportPrivateUsage]
        return super()._generate(messages, stop, run_manager, **kwargs)


class _Chat:
    def __init__(self, database: Database, router: ModelRouter, local: LocalServers) -> None:
        self.events = EventLog(database)
        self.runs = RunRecords(database)
        records = SessionRecords(database)
        runtime = open_chat(router, InMemorySaver(), local=local)
        self.manager = SessionManager(
            runtime, SessionLog(self.events, EventBus(), records), records, self.runs
        )

    async def turn(self, session_id: str, text: str) -> list[ChatEvent]:
        run_id = await self.manager.send(session_id, text)

        async def done() -> bool:
            run = await self.runs.get(run_id)
            return run is not None and run.status != "running"

        await _until(done)
        return await self.events.for_run(run_id)


async def _until(check: Callable[[], Awaitable[bool]], timeout: float = 3) -> None:
    async with asyncio.timeout(timeout):
        while not await check():
            await asyncio.sleep(0.01)


async def test_a_local_model_call_starts_ollama_once_and_holds_it(
    database: Database, tmp_path: Path
) -> None:
    serve = FakeServe()
    local = serve.servers(tmp_path)
    model = _Watching(replies=["one", "two"], servers=local, holders=[])
    router = ModelRouter(GolemSettings(default_model="ollama/qwen3:8b"), model=model)
    chat = _Chat(database, router, local)
    session_id = await chat.manager.create(None)

    first = await chat.turn(session_id, "hi")
    second = await chat.turn(session_id, "again")

    assert [first[-1].type, second[-1].type] == ["run.completed", "run.completed"]
    assert len(serve.spawned) == 1
    assert model.holders == [1, 1]
    server = local.get("ollama", URL)
    assert server is not None and server._users == 0  # pyright: ignore[reportPrivateUsage]


async def test_a_hosted_model_call_leaves_ollama_alone(database: Database, tmp_path: Path) -> None:
    serve = FakeServe()
    local = serve.servers(tmp_path)
    model = ToolCallingChatModel(replies=["hello"])
    router = ModelRouter(GolemSettings(default_model="openai/gpt-5"), model=model)
    chat = _Chat(database, router, local)
    events = await chat.turn(await chat.manager.create(None), "hi")
    assert events[-1].type == "run.completed"
    assert serve.spawned == []


async def test_the_model_list_starts_ollama_and_lists_its_models(tmp_path: Path) -> None:
    serve = FakeServe()
    serve.models = [{"name": "qwen3:8b", "details": {"context_length": 40960}}]
    discovery = ModelDiscovery(
        ModelRouter(GolemSettings(default_model="ollama/qwen3:8b")),
        tmp_path / "cache",
        transport=serve.transport(),
        ram_gb=36.0,
        fetch_prices=False,
        catalog=[],
    )
    discovery.local = serve.servers(tmp_path)
    listing = await discovery.list()
    await discovery.aclose()

    assert len(serve.spawned) == 1
    states = {provider.provider: provider.status for provider in listing.providers}
    assert states["ollama"] == "ready"
    assert any(
        model.ref == "ollama/qwen3:8b" and model.status == "ready" for model in listing.models
    )


async def test_removing_a_model_starts_ollama_first(tmp_path: Path) -> None:
    serve = FakeServe()
    serve.routes["/api/delete"] = lambda _request: httpx.Response(200, json={})
    pulls = PullManager(
        ModelRouter(GolemSettings()), transport=serve.transport(), models_dir=tmp_path
    )
    pulls.local = serve.servers(tmp_path)
    assert await pulls.delete("qwen3:8b") == ("ollama/qwen3:8b", True)
    assert len(serve.spawned) == 1
    await pulls.aclose()


async def test_the_daemon_stops_the_ollama_it_started(short_home: Path, tmp_path: Path) -> None:
    serve = FakeServe()
    app, task = await start_daemon(short_home, local_servers=serve.servers(tmp_path))
    try:
        local = app.state.local_servers
        assert local is not None
        server = local.get("ollama", URL)
        assert server is not None and await server.ensure_running()
    finally:
        await stop_daemon(app, task)
    assert serve.processes[0].signals == ["term"]
