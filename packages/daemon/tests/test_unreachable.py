"""A model server that does not answer ends the run with ``model_unreachable`` and a hint."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

import httpx
import httpx2
import openai
import pytest
from fakes import ToolCallingChatModel
from langchain_core.callbacks import CallbackManagerForLLMRun
from langchain_core.messages import BaseMessage
from langchain_core.outputs import ChatResult
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import InMemorySaver
from pydantic import BaseModel, SecretStr

from golem.config import GolemSettings, ModelSettings, ProviderSettings
from golem.graphs.chat import open_chat
from golem.models import ollama
from golem.models.router import ModelRouter
from golem.permissions.policy import Policy
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.manager import SessionManager
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem.tools.registry import Tool, ToolContext, ToolRegistry, ToolResult
from golem_protocol.events import ApprovalNeededEvent, ChatEvent, RunFailedEvent

_REQUEST = httpx.Request("POST", "http://127.0.0.1:11434/api/chat")


def _connect_error() -> httpx.ConnectError:
    return httpx.ConnectError("All connection attempts failed", request=_REQUEST)


async def _openai_connect_error() -> Exception:
    """What ChatOpenAI raises for a server with nothing listening, from its own httpx copy."""
    model = ChatOpenAI(
        model="x", base_url="http://127.0.0.1:9/v1", api_key=SecretStr("none"), max_retries=0
    )
    try:
        await model.ainvoke("hi")
    except Exception as exc:
        return exc
    raise AssertionError("nothing should listen on port 9")


def _settings(**models: str) -> GolemSettings:
    return GolemSettings(
        default_model="ollama/qwen3:8b",
        models={name: ModelSettings(model=ref) for name, ref in models.items()},
        providers={
            "far": ProviderSettings(kind="ollama", base_url="http://gpu-box:11434"),
            "lan": ProviderSettings(kind="openai_compat", base_url="http://localhost:1234/v1"),
        },
    )


@pytest.fixture
def installed(monkeypatch: pytest.MonkeyPatch) -> Callable[[bool], None]:
    def set_installed(value: bool) -> None:
        monkeypatch.setattr(ollama, "installed", lambda: value)

    set_installed(True)
    return set_installed


@pytest.mark.parametrize(
    "error",
    [
        _connect_error(),
        httpx.ConnectTimeout("timed out", request=_REQUEST),
        ConnectionError("Failed to connect to Ollama."),
        ConnectionRefusedError(61, "Connection refused"),
    ],
    ids=["httpx", "connect-timeout", "ollama-client", "refused"],
)
def test_a_failed_connect_is_unreachable(
    error: Exception, installed: Callable[[bool], None]
) -> None:
    del installed
    down = ModelRouter(_settings()).unreachable("ollama/qwen3:8b", error)
    assert down is not None
    assert (down.message, down.provider, down.hint) == (
        "Ollama is not running",
        "ollama",
        "run ollama serve",
    )


@pytest.mark.parametrize(
    "error",
    [
        httpx.ReadTimeout("read timed out", request=_REQUEST),
        ConnectionResetError(54, "Connection reset by peer"),
        RuntimeError("model 'qwen3:8b' not found"),
        openai.APITimeoutError(request=httpx2.Request("POST", "http://127.0.0.1:1234/v1")),
    ],
    ids=["read-timeout", "reset", "other", "openai-timeout"],
)
def test_other_failures_are_not_unreachable(error: Exception) -> None:
    assert ModelRouter(_settings()).unreachable("ollama/qwen3:8b", error) is None


async def test_an_openai_compatible_server_that_is_down_is_unreachable() -> None:
    down = ModelRouter(_settings(studio="lan/qwen")).unreachable(
        "studio", await _openai_connect_error()
    )
    assert down is not None and down.provider == "lan"


def test_the_hint_fits_where_the_server_is(installed: Callable[[bool], None]) -> None:
    router = ModelRouter(_settings(gpu="far/llama3", studio="lan/qwen", gpt="openai/gpt-5"))

    def says(profile: str) -> tuple[str, str | None, str]:
        down = router.unreachable(profile, _connect_error())
        assert down is not None
        return down.message, down.provider, down.hint

    installed(False)
    assert says("ollama/qwen3:8b") == (
        "Ollama is not installed",
        "ollama",
        "run brew install ollama",
    )
    assert says("gpu") == (
        "Ollama at http://gpu-box:11434 is not answering",
        "far",
        "check that it is running",
    )
    assert says("studio") == (
        "lan at http://localhost:1234/v1 is not answering",
        "lan",
        "check that it is running",
    )
    assert says("gpt") == ("openai is not answering", "openai", "check your network connection")
    assert says("nope/") == (
        "the model's server did not answer",
        None,
        "check that it is running",
    )


class _Down(ToolCallingChatModel):
    """Answers ``replies`` in order, then fails to connect."""

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        if not self.replies:
            raise _connect_error()
        return super()._generate(messages, stop, run_manager, **kwargs)


class _NoArgs(BaseModel):
    pass


def _risky() -> ToolRegistry:
    async def run(args: _NoArgs, ctx: ToolContext) -> ToolResult:
        del args, ctx
        return ToolResult(output="ran", summary="ran")

    return ToolRegistry(
        [Tool(name="risky", description="risky", args=_NoArgs, run=run, read_only=False)]
    )


class _Daemon:
    def __init__(self, database: Database, model: ToolCallingChatModel, home: Path) -> None:
        router = ModelRouter(_settings(), model=model)
        runtime = open_chat(router, InMemorySaver(), _risky(), Policy(None, home=home))
        self.events = EventLog(database)
        self.runs = RunRecords(database)
        records = SessionRecords(database)
        self.manager = SessionManager(
            runtime, SessionLog(self.events, EventBus(), records), records, self.runs
        )

    async def settled(self, run_id: str) -> list[ChatEvent]:
        async def done() -> bool:
            run = await self.runs.get(run_id)
            if run is None or run.status == "running":
                return False
            live = self.manager._runs.get(run_id)  # pyright: ignore[reportPrivateUsage]
            return live is None or live.task.done()

        await _until(done)
        return await self.events.for_run(run_id)


async def _until(check: Callable[[], Awaitable[bool]], timeout: float = 3) -> None:
    async with asyncio.timeout(timeout):
        while not await check():
            await asyncio.sleep(0.01)


def _failed(events: list[ChatEvent]) -> RunFailedEvent:
    last = events[-1]
    assert isinstance(last, RunFailedEvent)
    return last


async def test_a_turn_with_ollama_down_says_how_to_start_it(
    database: Database, tmp_path: Path, installed: Callable[[bool], None]
) -> None:
    del installed
    daemon = _Daemon(database, _Down(replies=[]), tmp_path)
    session_id = await daemon.manager.create(None)
    failed = _failed(await daemon.settled(await daemon.manager.send(session_id, "hi")))
    assert failed.data.model_dump() == {
        "message": "Ollama is not running",
        "code": "model_unreachable",
        "provider": "ollama",
        "hint": "run ollama serve",
    }


async def test_a_resumed_run_with_ollama_down_says_so_too(
    database: Database, tmp_path: Path, installed: Callable[[bool], None]
) -> None:
    installed(False)
    daemon = _Daemon(database, _Down(replies=[[("risky", {})]]), tmp_path)
    session_id = await daemon.manager.create(None)
    run_id = await daemon.manager.send(session_id, "go")
    asked = [e for e in await daemon.settled(run_id) if isinstance(e, ApprovalNeededEvent)]
    assert len(asked) == 1

    await daemon.manager.respond(session_id, asked[0].data.call_id, "allow")
    failed = _failed(await daemon.settled(run_id))
    assert (failed.data.code, failed.data.message, failed.data.hint) == (
        "model_unreachable",
        "Ollama is not installed",
        "run brew install ollama",
    )


async def test_any_other_failure_stays_a_plain_message(database: Database, tmp_path: Path) -> None:
    class Broken(ToolCallingChatModel):
        def _generate(self, *args: Any, **kwargs: Any) -> ChatResult:
            del args, kwargs
            raise RuntimeError("model 'qwen3:8b' not found")

    daemon = _Daemon(database, Broken(replies=[]), tmp_path)
    session_id = await daemon.manager.create(None)
    failed = _failed(await daemon.settled(await daemon.manager.send(session_id, "hi")))
    assert failed.data.model_dump() == {
        "message": "model 'qwen3:8b' not found",
        "code": None,
        "provider": None,
        "hint": None,
    }
