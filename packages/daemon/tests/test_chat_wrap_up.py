"""A run that reaches the model-call limit ends with an answer, not with nothing (#1804).

Scripted models behind a real daemon: the lead is told once when 3 calls are left, makes its last
call without tools, and the run ends ``completed`` with a line that says it stopped at the limit.
"""

# pyright: reportPrivateUsage=false
from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path
from typing import Any, cast

import pytest
from fakes import Calls, ToolCallingChatModel
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import BaseMessage, HumanMessage
from langchain_core.outputs import ChatResult
from pydantic import Field, ValidationError
from test_server import HELLO, RpcClient, rpc_result, start_daemon, stop_daemon
from test_step_up import (
    CHEAP,
    LOCAL,
    _ended,
    _Facts,
    _facts,
    _of,
    _Router,
    _send,
    _types,
)

from golem.config import ChatSettings, GolemSettings, RoutingSettings
from golem.graphs.chat import MAX_MODEL_CALLS, STOP_LINE, WRAP_UP_NOTE

READ: Calls = [("read_file", {"path": "notes.txt"})]


class _Greedy(ToolCallingChatModel):
    """Calls a tool on every call that offers tools, and answers only when none is offered."""

    offered: list[bool] = Field(default_factory=list[bool])
    _pending: bool = False

    def bind_tools(self, tools: Any, **kwargs: Any) -> Any:
        self._pending = True
        return super().bind_tools(tools, **kwargs)

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: Any = None,
        **kwargs: Any,
    ) -> ChatResult:
        self.offered.append(self._pending)
        self._pending = False
        # Always the next scripted reply: a tool call while tools are offered, text without.
        if self.offered[-1]:
            self.replies[:] = [READ]
        else:
            self.replies[:] = ["Here is what I found: notes.txt says 42."]
        return super()._generate(messages, stop, run_manager, **kwargs)


class _Greedy2(_Greedy):
    """Ignores the missing tools: calls one on the last call too."""

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: Any = None,
        **kwargs: Any,
    ) -> ChatResult:
        self.offered.append(self._pending)
        self._pending = False
        self.replies[:] = [READ]
        return ToolCallingChatModel._generate(self, messages, stop, run_manager, **kwargs)


class _GreedyRouter(_Router):
    def __init__(self, settings: GolemSettings, kind: type[_Greedy], *refs: str) -> None:
        super().__init__(settings)
        self.models = {ref: kind(replies=[]) for ref in refs}

    def chat_model(
        self,
        profile: str,
        overrides: Mapping[str, float | str] | None = None,
        *,
        local_only: bool = False,
    ) -> BaseChatModel:
        del overrides, local_only
        return self.models[profile]


def _settings(calls: int | None, *, local_only: bool = False) -> GolemSettings:
    chat = ChatSettings() if calls is None else ChatSettings(max_model_calls=calls)
    routing = RoutingSettings.model_validate({"local_only": ["/"] if local_only else []})
    return GolemSettings(chat=chat, routing=routing)


async def _run(
    home: Path, router: _GreedyRouter, profile: str, tier: str, window: int
) -> RpcClient:
    (home / "notes.txt").write_text("42\n")
    facts = _Facts(_facts(profile, cast(Any, tier), window))
    app, task = await start_daemon(home, router=router, facts=facts)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        created = rpc_result(await client.call("session.create", {"model_profile": profile}))
        session_id = cast(str, created["session_id"])
        rpc_result(await client.call("session.attach", {"session_id": session_id, "after_seq": 0}))
        live = app.state.sessions._sessions[session_id]  # type: ignore[attr-defined]
        live.paid_ok = True
        await _send(client, session_id, cwd=str(home))
        await _ended(client)
    finally:
        await stop_daemon(app, task)
    return client


def _notes(model: ToolCallingChatModel) -> list[int]:
    """The calls (0-based) whose history holds the wrap-up note, counted once per call."""
    return [
        i
        for i, history in enumerate(model.seen)
        if any(isinstance(m, HumanMessage) and WRAP_UP_NOTE in m.text for m in history)
    ]


def _final_text(client: RpcClient) -> str:
    return cast(str, _of(client, "message.completed")[-1]["text"])


async def test_a_lead_that_never_stops_calling_tools_ends_with_an_answer_and_a_stop_line(
    short_home: Path,
) -> None:
    router = _GreedyRouter(_settings(None), _Greedy, LOCAL)
    client = await _run(short_home, router, LOCAL, "local", 32000)
    model = router.models[LOCAL]
    types = _types(client)
    assert "run.completed" in types
    assert "run.failed" not in types
    assert len(model.offered) == MAX_MODEL_CALLS
    assert model.offered == [True] * (MAX_MODEL_CALLS - 1) + [False]
    text = _final_text(client)
    assert text.startswith("Here is what I found")
    assert text.endswith(STOP_LINE.format(limit=MAX_MODEL_CALLS))


async def test_the_note_comes_once_three_calls_before_the_end(short_home: Path) -> None:
    router = _GreedyRouter(_settings(None), _Greedy, LOCAL)
    await _run(short_home, router, LOCAL, "local", 32000)
    model = router.models[LOCAL]
    # Calls 0..24. The note goes in before call 22 (3 left), so calls 22, 23 and 24 see it.
    assert _notes(model) == [MAX_MODEL_CALLS - 3, MAX_MODEL_CALLS - 2, MAX_MODEL_CALLS - 1]
    last = model.seen[-1]
    notes = [m for m in last if isinstance(m, HumanMessage) and WRAP_UP_NOTE in m.text]
    assert len(notes) == 1


async def test_max_model_calls_in_the_settings_is_honoured(short_home: Path) -> None:
    router = _GreedyRouter(_settings(5), _Greedy, LOCAL)
    client = await _run(short_home, router, LOCAL, "local", 32000)
    model = router.models[LOCAL]
    assert "run.completed" in _types(client)
    assert model.offered == [True, True, True, True, False]
    assert _notes(model) == [2, 3, 4]
    assert _final_text(client).endswith(STOP_LINE.format(limit=5))


async def test_a_model_that_calls_a_tool_on_the_last_call_still_ends_the_run(
    short_home: Path,
) -> None:
    router = _GreedyRouter(_settings(5), _Greedy2, LOCAL)
    client = await _run(short_home, router, LOCAL, "local", 32000)
    model = router.models[LOCAL]
    assert "run.completed" in _types(client)
    assert len(model.offered) == 5
    assert model.offered[-1] is False
    assert _final_text(client) == STOP_LINE.format(limit=5)


async def test_local_only_the_run_ends_with_the_stop_line(short_home: Path) -> None:
    router = _GreedyRouter(_settings(6, local_only=True), _Greedy, LOCAL)
    client = await _run(short_home, router, LOCAL, "local", 32000)
    model = router.models[LOCAL]
    assert "run.completed" in _types(client)
    assert model.offered == [True] * 5 + [False]
    assert _final_text(client).endswith(STOP_LINE.format(limit=6))


async def test_cloud_only_the_run_ends_with_the_stop_line(short_home: Path) -> None:
    router = _GreedyRouter(_settings(6), _Greedy, CHEAP)
    client = await _run(short_home, router, CHEAP, "budget", 128000)
    model = router.models[CHEAP]
    assert "run.completed" in _types(client)
    assert model.offered == [True] * 5 + [False]
    assert _final_text(client).endswith(STOP_LINE.format(limit=6))


def test_max_model_calls_is_between_5_and_200() -> None:
    assert ChatSettings().max_model_calls == 25
    for bad in (4, 201):
        with pytest.raises(ValidationError):
            ChatSettings(max_model_calls=bad)
