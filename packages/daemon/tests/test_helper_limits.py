"""The limits of a helper: which one it hit, and how far it got (ADR-059, section 10)."""

from __future__ import annotations

import asyncio
import time
from pathlib import Path
from typing import Any

import pytest
from fakes import ToolCallingChatModel
from langchain_core.messages import BaseMessage, HumanMessage, ToolMessage
from langchain_core.outputs import ChatResult
from test_delegate import (  # pyright: ignore
    USAGE,
    _answers,  # pyright: ignore
    _Chat,  # pyright: ignore
    _delegate_result,  # pyright: ignore
    _ended,  # pyright: ignore
    _paid,  # pyright: ignore
    _Recording,  # pyright: ignore
)

from golem.config import AgentSettings, ExplorerSettings, GolemSettings, ModelPrice
from golem.graphs.child import FINAL_REQUEST
from golem.sessions import manager as manager_module
from golem.sessions.helper_limits import (
    Used,
    before_last_call,
    covered_line,
    progress_of,
    reached,
    used_of,
)
from golem.sessions.helpers import files_named, stop_reason
from golem.store.database import Database
from golem_protocol.events import CHAT_EVENT, AgentLimits, AgentSnapshot, ChatEvent


def _event(seq: int, kind: str, data: dict[str, Any], run: str = "r1") -> ChatEvent:
    return CHAT_EVENT.validate_python(
        {
            "seq": seq,
            "session_id": "h1",
            "run_id": run,
            "ts": "2026-11-01T12:00:00+00:00",
            "type": kind,
            "data": data,
        }
    )


def _call(
    seq: int, message_id: str, input_: int, output: int, cost: float | None
) -> list[ChatEvent]:
    started: dict[str, Any] = {
        "message_id": message_id,
        "index": 1,
        "profile": "p",
        "message_ids": [],
    }
    done = {
        "message_id": message_id,
        "latency_ms": 10,
        "usage": {"input": input_, "output": output},
        "cost_usd": cost,
    }
    return [
        _event(seq, "model.call.started", started),
        _event(seq + 1, "model.call.completed", done),
    ]


def _tool(
    seq: int, call_id: str, name: str, args: dict[str, Any], failed: bool = False
) -> list[ChatEvent]:
    return [
        _event(
            seq,
            "tool.requested",
            {"message_id": "m1", "call_id": call_id, "name": name, "args": args},
        ),
        _event(
            seq + 1,
            "tool.completed",
            {"call_id": call_id, "summary": "ok", "preview": "", "failed": failed},
        ),
    ]


def test_the_limit_reached_first_in_the_fixed_order_wins() -> None:
    limits = AgentLimits(max_calls=2, max_seconds=10, max_cost_usd=1.0, max_tokens=100)
    assert reached(limits, Used(calls=1, working_ms=1000, cost_usd=0.1, tokens=10)) is None
    assert reached(limits, Used(calls=2, working_ms=10_000, cost_usd=2.0, tokens=500)) == "calls"
    assert reached(limits, Used(calls=1, working_ms=10_000, cost_usd=2.0, tokens=500)) == "time"
    assert reached(limits, Used(calls=1, working_ms=1000, cost_usd=2.0, tokens=500)) == "cost"
    assert reached(limits, Used(calls=1, working_ms=1000, cost_usd=0.1, tokens=100)) == "tokens"


def test_a_limit_nobody_set_and_a_figure_nobody_gave_are_left_out() -> None:
    assert (
        reached(AgentLimits(), Used(calls=99, working_ms=10**9, cost_usd=9.0, tokens=10**9)) is None
    )
    assert reached(AgentLimits(max_tokens=5), Used(calls=1)) is None
    assert reached(AgentLimits(), Used(calls=15), calls_default=15) == "calls"


def test_a_local_model_has_no_price_so_the_cost_limit_never_fires() -> None:
    events = [*_call(1, "m1", 1000, 500, None), *_call(3, "m2", 1000, 500, None)]
    used = used_of(events)
    assert used.cost_usd == 0
    assert reached(AgentLimits(max_cost_usd=0), used) is None
    assert reached(AgentLimits(max_cost_usd=0.001), used) is None


def test_a_scripted_price_reaches_the_cost_limit() -> None:
    events = [*_call(1, "m1", 1000, 500, 0.2), *_call(3, "m2", 1000, 500, 0.2)]
    assert reached(AgentLimits(max_cost_usd=0.5), used_of(events)) is None
    assert reached(AgentLimits(max_cost_usd=0.4), used_of(events)) == "cost"


def test_tokens_are_input_and_output_of_every_call_summed() -> None:
    events = [*_call(1, "m1", 1000, 500, None), *_call(3, "m2", 300, 200, None)]
    assert used_of(events).tokens == 2000
    assert used_of(events).calls == 2


def test_the_events_before_the_last_call_leave_that_call_out() -> None:
    events = [*_call(1, "m1", 10, 5, 0.1), *_call(3, "m2", 10, 5, 0.1)]
    assert used_of(before_last_call(events)).calls == 1


def test_progress_names_what_was_read_and_what_was_not_named() -> None:
    events = [
        *_tool(1, "c1", "read_file", {"path": "a.py"}),
        *_tool(3, "c2", "read_file", {"path": "./a.py"}),
        *_tool(5, "c3", "read_file", {"path": "b.py"}),
        *_tool(7, "c4", "grep", {"pattern": "x"}),
        *_tool(9, "c5", "glob", {"pattern": "*.py"}),
        *_tool(11, "c6", "read_file", {"path": "gone.py"}, failed=True),
    ]
    assert progress_of(events) == "read 2 files, ran 2 searches"
    assert progress_of(events, ["a.py", "b.py", "c.py"]) == "read 2 of 3 files, ran 2 searches"
    assert progress_of([]) == ""


def test_the_covered_line_says_the_limit_and_how_far_it_got() -> None:
    events = [
        *_tool(1, "c1", "read_file", {"path": "a.py"}),
        *_tool(3, "c2", "grep", {"pattern": "x"}),
    ]
    limits = AgentLimits(max_calls=25, max_seconds=120, max_cost_usd=0.5, max_tokens=50_000)
    named = ["a.py", "b.py"]
    assert (
        covered_line(limits, "calls", events, named)
        == "stopped at 25 calls, read 1 of 2 files, ran 1 search (a.py, grep x)"
    )
    assert (
        covered_line(limits, "time", events)
        == "stopped at 120 s of working time, read 1 file, ran 1 search (a.py, grep x)"
    )
    assert (
        covered_line(limits, "cost", events)
        == "stopped at $0.50 of cost, read 1 file, ran 1 search (a.py, grep x)"
    )
    assert covered_line(limits, "tokens", []) == "stopped at 50000 tokens, no tools used"
    assert covered_line(limits, "failed", []) == "stopped: a model call failed, no tools used"
    assert covered_line(limits, "done", events) == ""


def test_files_named_leaves_out_folders_and_missing_paths(tmp_path: Path) -> None:
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "a.py").write_text("x", encoding="utf-8")
    brief = "read src/a.py and src and gone/b.py"
    assert files_named(brief, str(tmp_path)) == ["src/a.py"]
    assert files_named(brief, None) == []


def test_the_reason_of_an_answer_after_the_cost_or_token_limit_is_that_limit() -> None:
    agent = AgentSnapshot(
        name="explorer",
        source="bundled",
        tools=[],
        limits=AgentLimits(max_calls=9, max_cost_usd=0.3, max_tokens=5000),
        wish="same",
        asks=False,
    )
    two = [*_call(1, "m1", 10, 5, 0.2), *_call(3, "m2", 10, 5, 0.2), *_call(5, "m3", 10, 5, 0.2)]
    assert stop_reason("completed", two, agent) == "cost"
    assert stop_reason("completed", two[:4], agent) == "done"
    big = [*_call(1, "m1", 4000, 1500, None), *_call(3, "m2", 10, 5, None)]
    assert stop_reason("completed", big, agent) == "tokens"
    assert stop_reason("failed", [], agent) == "failed"


@pytest.fixture
def project(tmp_path: Path) -> Path:
    root = tmp_path / "project"
    root.mkdir()
    (root / "a.py").write_text("def a():\n    return 1\n", encoding="utf-8")
    (root / "b.py").write_text("def b():\n    return 2\n", encoding="utf-8")
    return root


class _Failing(ToolCallingChatModel):
    """Answers as scripted, except a call whose history holds a ``boom`` message: that fails."""

    def _generate(
        self, messages: list[BaseMessage], stop: Any = None, run_manager: Any = None, **kwargs: Any
    ) -> ChatResult:
        if any(m.text == "boom" for m in messages if isinstance(m, HumanMessage)):
            raise RuntimeError("the model broke")
        return super()._generate(messages, stop, run_manager, **kwargs)


def _scripted_price(profile: str) -> ModelPrice | None:
    del profile
    return ModelPrice(input=100.0, output=200.0)


def _no_price(profile: str) -> ModelPrice | None:
    del profile
    return None


def _delegate(brief: str = "look") -> list[Any]:
    return [("delegate", {"agent": "explorer", "brief": brief})]


async def test_calls_end_a_helper_with_its_last_call_and_the_result_says_how_far(
    database: Database, project: Path
) -> None:
    model = _Recording(
        replies=[
            _delegate("look at a.py and b.py"),
            [("read_file", {"path": "a.py"})],
            [("list_dir", {"path": "."})],
            "what I know",
            "ok",
        ]
    )
    settings = GolemSettings(
        default_model="ollama/qwen3:8b",
        agents=AgentSettings(explorer=ExplorerSettings(max_calls=2)),
    )
    chat = _Chat(database, model, settings=settings)
    _, _, events = await chat.run(project)

    assert _delegate_result(events) == (
        "explorer finished: calls\n\n"
        "stopped at 2 calls, read 1 of 2 files, listed 1 folder (a.py)\n\n"
        "what I know"
    )
    assert _ended(events).data.stopped == "calls"
    last = model.seen[3]
    assert isinstance(last[-1], HumanMessage) and last[-1].content == FINAL_REQUEST


async def test_the_time_limit_is_a_hard_stop_and_the_result_says_so(
    database: Database, project: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from test_delegate import _Hanging  # pyright: ignore

    gate = asyncio.Event()

    async def pause(seconds: float) -> None:
        del seconds
        await gate.wait()

    monkeypatch.setattr(manager_module, "_pause", pause)
    skew = [0.0]
    monkeypatch.setattr(manager_module, "_now", lambda: time.time() + skew[0])
    model = _Hanging(replies=[_delegate("hang"), "after the limit"])
    chat = _Chat(database, model)
    session_id = await chat.manager.create(None, cwd=str(project))
    run_id = await chat.manager.send(session_id, "go")
    async with asyncio.timeout(5):
        await model.waiting.wait()
    skew[0] = 400.0
    gate.set()
    events = await chat.finished(run_id)

    assert _ended(events).data.stopped == "time"
    assert _delegate_result(events).startswith(
        "explorer finished: time\n\nstopped at 300 s of working time, no tools used\n\n"
    )


def test_a_stopped_result_lists_at_most_twenty_paths_and_searches() -> None:
    events: list[ChatEvent] = []
    for i in range(22):
        events += _tool(1 + 2 * i, f"r{i}", "read_file", {"path": f"f{i}.py"})
    for i in range(3):
        events += _tool(100 + 2 * i, f"g{i}", "grep", {"pattern": f"p{i}"})
    limits = AgentLimits(max_calls=25)
    line = covered_line(limits, "cancelled", events)
    assert line.startswith("stopped: cancelled, read 22 files, ran 3 searches (f0.py, f1.py")
    assert line.endswith("f19.py, and 5 more)")
    assert "f20.py" not in line


async def test_a_slow_helper_near_its_time_limit_writes_an_answer_and_ends_time(
    database: Database, project: Path
) -> None:
    class _Slow(_Recording):
        def _generate(
            self,
            messages: list[BaseMessage],
            stop: Any = None,
            run_manager: Any = None,
            **kwargs: Any,
        ) -> ChatResult:
            helper = any(m.text == "slow, a.py" for m in messages if isinstance(m, HumanMessage))
            if helper and not any(isinstance(m, ToolMessage) for m in messages):
                time.sleep(1.7)  # 85% of the 2 s limit, in the helper's first call
            return super()._generate(messages, stop, run_manager, **kwargs)

    model = _Slow(
        replies=[
            _delegate("slow, a.py"),
            [("read_file", {"path": "a.py"})],
            "what I found",
            "ok",
        ]
    )
    settings = GolemSettings(
        default_model="ollama/qwen3:8b",
        agents=AgentSettings(explorer=ExplorerSettings(timeout_seconds=2)),
    )
    chat = _Chat(database, model, settings=settings)
    _, _, events = await chat.run(project)

    assert _ended(events).data.stopped == "time"
    result = _delegate_result(events)
    assert result.startswith("explorer finished: time\n\nstopped at 2 s of working time")
    assert "(a.py)" in result
    assert result.endswith("what I found")
    # parent, helper (slow), helper (the last: no tools), parent.
    assert len(model.seen) == 4
    assert len(model.offered) == 3
    last = model.seen[2]
    assert isinstance(last[-1], HumanMessage) and last[-1].content == FINAL_REQUEST


async def test_the_cost_limit_fires_on_a_scripted_price_cloud_only(
    database: Database, project: Path
) -> None:
    model = _Recording(
        replies=[
            _delegate(),
            [("list_dir", {"path": "."})],
            [("read_file", {"path": "a.py"})],
            "from what I know",
            "ok",
        ],
        usage=USAGE,
    )
    chat = _Chat(
        database,
        model,
        settings=GolemSettings(default_model="anthropic/big", agents=AgentSettings(max_cost=0.25)),
        tier_of=_paid,
        paid_ok=_answers(),
    )
    # 1,000 in and 500 out at $100 and $200 per million tokens: $0.20 a call.
    chat.runtime.price_of = _scripted_price
    _, _, events = await chat.run(project)

    assert _ended(events).data.stopped == "cost"
    assert _delegate_result(events) == (
        "explorer finished: cost\n\n"
        "stopped at $0.25 of cost, read 1 file, listed 1 folder (a.py)\n\n"
        "from what I know"
    )
    # parent, helper, helper (spent $0.20), helper (spent $0.40: the last one), parent.
    assert len(model.seen) == 5
    assert len(model.offered) == 4
    last = model.seen[3]
    assert isinstance(last[-1], HumanMessage) and last[-1].content == FINAL_REQUEST


async def test_the_cost_limit_never_fires_on_a_local_model_local_only(
    database: Database, project: Path
) -> None:
    model = ToolCallingChatModel(
        replies=[
            _delegate(),
            [("list_dir", {"path": "."})],
            [("read_file", {"path": "a.py"})],
            "found it",
            "ok",
        ],
        usage=USAGE,
    )
    chat = _Chat(
        database,
        model,
        settings=GolemSettings(
            default_model="ollama/qwen3:8b", agents=AgentSettings(max_cost=0.000001)
        ),
    )
    chat.runtime.price_of = _no_price
    _, _, events = await chat.run(project)

    assert _ended(events).data.stopped == "done"
    assert _ended(events).data.cost_usd == 0
    assert _delegate_result(events) == "found it"


async def test_the_token_limit_counts_input_and_output_and_gives_a_last_call(
    database: Database, project: Path
) -> None:
    model = _Recording(
        replies=[
            _delegate(),
            [("list_dir", {"path": "."})],
            [("read_file", {"path": "a.py"})],
            "from what I know",
            "ok",
        ],
        usage=USAGE,
    )
    # Each call is 1,500 tokens: after two calls the helper has used 3,000.
    chat = _Chat(
        database,
        model,
        settings=GolemSettings(
            default_model="ollama/qwen3:8b", agents=AgentSettings(max_tokens=3000)
        ),
    )
    _, _, events = await chat.run(project)

    assert _ended(events).data.stopped == "tokens"
    assert _delegate_result(events) == (
        "explorer finished: tokens\n\n"
        "stopped at 3000 tokens, read 1 file, listed 1 folder (a.py)\n\n"
        "from what I know"
    )
    assert len(model.offered) == 4
    last = model.seen[3]
    assert isinstance(last[-1], HumanMessage) and last[-1].content == FINAL_REQUEST


async def test_a_model_call_that_fails_ends_the_helper_with_failed(
    database: Database, project: Path
) -> None:
    model = _Failing(replies=[_delegate("boom"), "the helper failed"])
    chat = _Chat(database, model)
    _, _, events = await chat.run(project)

    assert _ended(events).data.stopped == "failed"
    assert _delegate_result(events) == (
        "explorer finished: failed\n\nstopped: a model call failed, no tools used\n\n"
        "(the helper gave no answer)"
    )
