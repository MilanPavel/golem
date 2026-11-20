"""``golem models check``: the cases, the runner, and the manager, with scripted models."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Mapping
from typing import Any, cast

import pytest
from fakes import Calls, ToolCallingChatModel
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, ToolCall
from pydantic import BaseModel

from golem.config import GolemSettings, ModelPrice
from golem.models.check import (
    CheckError,
    CheckManager,
    run_cases,
    verdict_of,
)
from golem.models.check_cases import CASES, CheckCase, Reply, looks_cut
from golem.models.router import ModelRouter
from golem.models.scores import Scores
from golem.store.database import Database
from golem.tools import default_registry
from golem.tools.registry import ToolScope

REF = "ollama/qwen3:8b"
TOOLS = default_registry()
BY_ID = {case.id: case for case in CASES}


def _call(name: str, **args: object) -> ToolCall:
    return ToolCall(name=name, args=args, id="call_x")


def _verdict(case_id: str, *replies: Reply) -> str | None:
    case = BY_ID[case_id]
    offered = TOOLS if case.tools is None else TOOLS.scoped(ToolScope(only=frozenset(case.tools)))
    return case.check(list(replies), offered)


def _calls(*calls: ToolCall) -> Reply:
    return Reply("", tuple(calls))


def test_there_are_about_ten_cases_with_their_own_ids() -> None:
    assert len(CASES) == 10
    assert len({case.id for case in CASES}) == 10
    for case in CASES:
        names = case.tools or tuple(TOOLS.names)
        assert set(names) <= set(TOOLS.names)


@pytest.mark.parametrize(
    ("case_id", "good", "bad"),
    [
        ("read_file", [_call("read_file", path="notes/todo.txt")], [_call("read_file", path="x")]),
        ("search", [_call("grep", pattern="invoice", path="docs")], [_call("grep", path="docs")]),
        ("list_dir", [_call("list_dir", path="reports")], [_call("read_file", path="reports")]),
        ("long_list", [_call("glob", pattern="**/*.md", path="docs")], [_call("list_dir")]),
        (
            "nested",
            [
                _call(
                    "todo_write",
                    todos=[
                        {"id": "1", "text": "wash", "status": "in_progress"},
                        {"id": "2", "text": "wipe", "status": "pending"},
                        {"id": "3", "text": "sweep", "status": "pending"},
                    ],
                )
            ],
            [_call("todo_write", todos=[{"id": "1", "text": "wash", "status": "soon"}])],
        ),
    ],
)
def test_a_case_passes_a_right_call_and_fails_a_wrong_one(
    case_id: str, good: list[ToolCall], bad: list[ToolCall]
) -> None:
    assert _verdict(case_id, _calls(*good)) is None
    assert _verdict(case_id, _calls(*bad)) is not None
    assert _verdict(case_id, Reply("I cannot do that")) is not None


def test_a_wrong_argument_is_named_with_the_registrys_words() -> None:
    why = _verdict("read_file", _calls(_call("read_file", path="")))
    assert why is not None and why.startswith("invalid arguments for read_file")
    unknown = _verdict("read_file", _calls(_call("shell", command="cat x")))
    assert unknown == "called shell, not read_file"


def test_a_question_without_a_tool_wants_text_and_no_call() -> None:
    assert _verdict("no_tool", Reply("Paris")) is None
    assert _verdict("no_tool", _calls(_call("grep", pattern="France"))) is not None
    assert _verdict("no_tool", Reply("  ")) == "no answer"


def test_two_files_pass_in_one_reply_or_one_after_another() -> None:
    both = _calls(_call("read_file", path="a.txt"), _call("read_file", path="b.txt"))
    assert _verdict("two_files", both) is None
    one = _calls(_call("read_file", path="a.txt"))
    other = _calls(_call("read_file", path="b.txt"))
    assert _verdict("two_files", one, other) is None
    assert _verdict("two_files", one) == "never read b.txt"
    assert _verdict("two_files", _calls(_call("read_file", path="a.txt"), _call("read_file"))) == (
        "invalid arguments for read_file: path: Field required"
    )


def test_a_missing_argument_is_asked_for_or_filled_but_not_invalid() -> None:
    assert _verdict("missing", Reply("Which file?")) is None
    assert _verdict("missing", _calls(_call("read_file", path="README.md"))) is None
    why = _verdict("missing", _calls(_call("read_file")))
    assert why is not None and why.startswith("invalid arguments for read_file")
    assert _verdict("missing", Reply("")) == "no answer"


def test_a_follow_up_uses_the_result_and_does_not_repeat_the_call() -> None:
    assert _verdict("follow_up", Reply("It names port 8431.")) is None
    assert _verdict("follow_up", _calls(_call("list_dir", path="."))) is None
    again = _verdict("follow_up", _calls(_call("read_file", path="settings.txt")))
    assert again == "called read_file again with the same arguments"
    ignored = _verdict("follow_up", Reply("I could not tell."))
    assert ignored is not None and ignored.startswith("the answer does not use the result")


def test_a_reply_cut_in_the_middle_of_a_call_fails() -> None:
    cut = Reply('{"name": "todo_write", "arguments": {"todos": [{"id": "1", "te')
    assert _verdict("short_reply", cut) == "the reply stops in the middle of a call"
    assert _verdict("short_reply", Reply("<tool_call>\n<function=todo_write>")) is not None
    assert _verdict("short_reply", Reply("Here are the steps: dates, flights.")) is None
    assert _verdict("short_reply", Reply("")) == "no reply"
    ok = _calls(
        _call(
            "todo_write",
            todos=[{"id": str(n), "text": "step", "status": "pending"} for n in range(6)],
        )
    )
    assert _verdict("short_reply", ok) is None
    assert BY_ID["short_reply"].num_predict is not None
    assert looks_cut("[{") is False


def test_a_verdict_comes_from_the_share_of_working_cases() -> None:
    assert [verdict_of(n, 10) for n in (10, 9, 8, 7, 6, 0)] == [
        "reliable",
        "reliable",
        "usable",
        "usable",
        "not_recommended",
        "not_recommended",
    ]
    assert verdict_of(0, 0) is None


def _right_reply(case: CheckCase) -> str | Calls:
    """What a good model sends first for each case."""
    return {
        "read_file": [("read_file", {"path": "notes/todo.txt"})],
        "search": [("grep", {"pattern": "invoice", "path": "docs"})],
        "list_dir": [("list_dir", {"path": "reports"})],
        "no_tool": "Paris",
        "two_files": [("read_file", {"path": "a.txt"}), ("read_file", {"path": "b.txt"})],
        "nested": [
            (
                "todo_write",
                {
                    "todos": [
                        {"id": "1", "text": "wash", "status": "in_progress"},
                        {"id": "2", "text": "wipe", "status": "pending"},
                        {"id": "3", "text": "sweep", "status": "pending"},
                    ]
                },
            )
        ],
        "missing": "Which file do you mean?",
        "follow_up": "The port is 8431.",
        "long_list": [("glob", {"pattern": "**/*.md", "path": "docs"})],
        "short_reply": "Here is the plan in words.",
    }[case.id]


class _Scripted:
    """An ``Invoke`` that answers each case from a script of replies, and records the offers."""

    def __init__(self, replies: Mapping[str, list[str | Calls]]) -> None:
        self.replies = {key: list(value) for key, value in replies.items()}
        self.offered: dict[str, list[str]] = {}
        self.sent: dict[str, list[list[BaseMessage]]] = {}

    async def __call__(
        self, case: CheckCase, messages: list[BaseMessage], schemas: list[dict[str, object]]
    ) -> AIMessage:
        model = ToolCallingChatModel(replies=[self.replies[case.id].pop(0)])
        model.bind_tools(schemas)
        self.offered[case.id] = model.bound
        self.sent.setdefault(case.id, []).append(messages)
        return await model.ainvoke(messages)


def _all_right() -> dict[str, list[str | Calls]]:
    return {case.id: [_right_reply(case)] for case in CASES}


async def test_a_model_that_gets_every_case_right_passes_ten_of_ten() -> None:
    invoke = _Scripted(_all_right())
    seen: list[tuple[int, int, str]] = []
    report = await run_cases(
        invoke, TOOLS, on_case=lambda i, n, r: seen.append((i, n, r.outcome)), clock=lambda: 0.0
    )
    assert [case.outcome for case in report.cases] == ["pass"] * 10
    assert (report.passed, report.recovered, report.working) == (10, 0, 10)
    assert seen[0] == (1, 10, "pass") and seen[-1] == (10, 10, "pass")
    assert invoke.offered["read_file"] == ["read_file", "list_dir", "glob", "grep"]
    # The memory tools are offered only to a run that carries memory, which a check does not.
    assert set(invoke.offered["long_list"]) == set(TOOLS.schemas() and TOOLS.names) - {
        "propose_plan",
        "recall",
        "remember",
    }


async def test_the_follow_up_case_sends_a_fake_call_and_its_result() -> None:
    invoke = _Scripted(_all_right())
    await run_cases(invoke, TOOLS, clock=lambda: 0.0)
    (messages,) = invoke.sent["follow_up"]
    assert [type(message).__name__ for message in messages] == [
        "SystemMessage",
        "HumanMessage",
        "AIMessage",
        "ToolMessage",
    ]
    assert "8431" in str(messages[-1].content)


async def test_one_call_then_another_reads_both_files() -> None:
    script = _all_right()
    script["two_files"] = [
        [("read_file", {"path": "a.txt"})],
        [("read_file", {"path": "b.txt"})],
        "They are the same length.",
    ]
    invoke = _Scripted(script)
    report = await run_cases(invoke, TOOLS, clock=lambda: 0.0)
    assert report.cases[4].outcome == "pass"
    assert len(invoke.sent["two_files"]) == 3


async def test_some_cases_fail_and_say_why() -> None:
    script = _all_right()
    script["missing"] = [[("read_file", {})]]
    script["search"] = ["I would search for it."]
    report = await run_cases(_Scripted(script), TOOLS, clock=lambda: 0.0)
    outcomes = {case.id: case for case in report.cases}
    assert outcomes["search"].outcome == "fail"
    assert outcomes["search"].detail == "no tool call; it wrote: I would search for it."
    missing = outcomes["missing"]
    assert missing.outcome == "fail"
    assert missing.detail == "invalid arguments for read_file: path: Field required"
    assert (report.passed, report.working) == (8, 8)
    assert verdict_of(report.working, len(report.cases)) == "usable"


async def test_a_call_written_as_text_that_golem_can_read_is_recovered() -> None:
    script = _all_right()
    script["list_dir"] = [
        "<function=list_dir>\n<parameter=path>\nreports\n</parameter>\n</function>"
    ]
    script["read_file"] = ["<function=read_file>\n<parameter=path>\nnotes/todo"]
    report = await run_cases(_Scripted(script), TOOLS, clock=lambda: 0.0)
    by_id = {case.id: case for case in report.cases}
    assert by_id["list_dir"].outcome == "recovered"
    assert by_id["list_dir"].detail == "written as text, recovered"
    assert by_id["read_file"].outcome == "fail"
    assert by_id["read_file"].detail == "wrote a call as text that golem cannot read"
    assert (report.passed, report.recovered, report.working) == (8, 1, 9)
    assert verdict_of(report.working, 10) == "reliable"


async def test_a_call_written_as_json_text_is_recovered_as_in_a_chat() -> None:
    script = _all_right()
    script["list_dir"] = [
        'I will list it.\n{"name": "list_dir", "parameters": {"path": "reports"}}'
    ]
    report = await run_cases(_Scripted(script), TOOLS, clock=lambda: 0.0)
    by_id = {case.id: case for case in report.cases}
    assert by_id["list_dir"].outcome == "recovered"
    assert (report.passed, report.recovered, report.working) == (9, 1, 10)


async def test_a_case_that_takes_too_long_fails_and_the_next_one_runs() -> None:
    inner = _Scripted(_all_right())

    async def invoke(
        case: CheckCase, messages: list[BaseMessage], schemas: list[dict[str, object]]
    ) -> AIMessage:
        if case.id == "search":
            await asyncio.sleep(10)
        return await inner(case, messages, schemas)

    report = await run_cases(invoke, TOOLS, timeout=0.05, clock=lambda: 0.0)
    assert report.cases[1].outcome == "fail"
    assert report.cases[1].detail == "no answer in 0.05 s"
    assert report.cases[2].outcome == "pass"


async def test_the_tokens_of_each_call_are_summed() -> None:
    inner = _Scripted(_all_right())

    async def invoke(
        case: CheckCase, messages: list[BaseMessage], schemas: list[dict[str, object]]
    ) -> AIMessage:
        reply = await inner(case, messages, schemas)
        reply.usage_metadata = {"input_tokens": 100, "output_tokens": 10, "total_tokens": 110}
        return reply

    report = await run_cases(invoke, TOOLS, clock=lambda: 0.0)
    assert (report.input_tokens, report.output_tokens) == (1000, 100)


class _Ticker:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        self.now += 1.25
        return self.now


async def test_each_case_is_timed() -> None:
    report = await run_cases(_Scripted(_all_right()), TOOLS, clock=_Ticker())
    assert {case.ms for case in report.cases} == {1250}


# The manager, with a router whose models are scripted.


def _router(model: BaseChatModel) -> tuple[ModelRouter, list[Mapping[str, object]]]:
    router = ModelRouter(GolemSettings())
    asked: list[Mapping[str, object]] = []

    def chat_model(
        profile: str, overrides: Mapping[str, float | str] | None = None, **_: object
    ) -> BaseChatModel:
        asked.append({"profile": profile, **(overrides or {})})
        return model

    router.chat_model = chat_model  # type: ignore[method-assign]
    return router, asked


def _model(replies: list[str | Calls]) -> ToolCallingChatModel:
    return ToolCallingChatModel(replies=replies)


def _flat() -> list[str | Calls]:
    """The first replies of a good model, case after case. The two-file case needs one more."""
    return [_right_reply(case) for case in CASES]


async def _ended(sent: list[BaseModel], manager: CheckManager, ref: str) -> dict[str, Any]:
    await manager.wait(ref)
    notes = [cast(dict[str, Any], json.loads(item.model_dump_json())) for item in sent]
    done = notes[-1]
    assert done["method"] == "model.check.done"
    return done["params"]


async def test_a_check_streams_each_case_and_ends_with_a_verdict(database: Database) -> None:
    router, asked = _router(_model(_flat()))
    sent: list[BaseModel] = []
    scores = Scores(database)
    manager = CheckManager(router, scores, broadcast=sent.append)
    ref, started = manager.start("qwen3:8b")
    assert (ref, started) == (REF, True)
    done = await _ended(sent, manager, ref)
    notes = [json.loads(item.model_dump_json()) for item in sent]
    progress = [n["params"] for n in notes if n["method"] == "model.check.progress"]
    assert [p["index"] for p in progress] == list(range(1, 11))
    assert all(p["total"] == 10 and p["ref"] == REF for p in progress)
    assert done["ok"] is True and done["passed"] == 10 and done["total"] == 10
    assert done["verdict"] == "reliable" and done["cost_usd"] is None
    assert [case["outcome"] for case in done["cases"]] == ["pass"] * 10
    assert all(call["temperature"] == 0.0 for call in asked)
    assert [call.get("num_predict") for call in asked][-1] == 96
    assert sum("num_predict" in call for call in asked) == 1


async def test_the_result_seeds_the_scoreboard(database: Database) -> None:
    replies = _flat()
    replies[2] = "I think the folder is empty."
    replies[3] = [("grep", {"pattern": "x"})]
    router, _ = _router(_model(replies))
    sent: list[BaseModel] = []
    scores = Scores(database)
    manager = CheckManager(router, scores, broadcast=sent.append)
    ref, _ = manager.start(REF)
    done = await _ended(sent, manager, ref)
    assert done["passed"] == 8 and done["verdict"] == "usable"
    found = await Scores(database).of(REF)
    assert found is not None and found.tool_score == 0.8 and found.seeded


async def test_a_model_that_does_not_take_tools_ends_the_check_with_an_error(
    database: Database,
) -> None:
    class Refusing(ToolCallingChatModel):
        def bind_tools(self, tools: Any, **kwargs: Any) -> Any:
            raise NotImplementedError

    router, _ = _router(Refusing(replies=[]))
    sent: list[BaseModel] = []
    manager = CheckManager(router, Scores(database), broadcast=sent.append)
    ref, _ = manager.start(REF)
    done = await _ended(sent, manager, ref)
    assert done["ok"] is False and "cannot be offered tools" in done["error"]
    assert done["cases"] == [] and done["verdict"] is None
    assert await Scores(database).of(REF) is None


async def test_a_hosted_model_reports_its_cost_from_the_usage(database: Database) -> None:
    model = _model(_flat())
    model.usage = {"input_tokens": 1000, "output_tokens": 100, "total_tokens": 1100}
    router, asked = _router(model)
    sent: list[BaseModel] = []
    price = ModelPrice(input=3.0, output=15.0)
    manager = CheckManager(
        router, Scores(database), broadcast=sent.append, price_of=lambda profile: price
    )
    ref, _ = manager.start("anthropic/claude-sonnet-4-5")
    done = await _ended(sent, manager, ref)
    assert done["cost_usd"] == round((10_000 * 3.0 + 1000 * 15.0) / 1_000_000, 6)
    assert asked[0]["profile"] == "anthropic/claude-sonnet-4-5"


async def test_a_second_start_for_the_same_model_does_not_run_twice(database: Database) -> None:
    router, _ = _router(_model(_flat()))
    manager = CheckManager(router, Scores(database))
    first = manager.start(REF)
    second = manager.start("qwen3:8b")
    assert first == (REF, True) and second == (REF, False)
    assert manager.checking() == [REF]
    await manager.wait(REF)
    assert manager.checking() == []


async def test_a_name_that_is_no_model_is_refused(database: Database) -> None:
    router, _ = _router(_model([]))
    manager = CheckManager(router, Scores(database))
    with pytest.raises(CheckError):
        manager.start("nowhere/qwen3")


async def test_closing_stops_a_running_check(database: Database) -> None:
    class Slow(ToolCallingChatModel):
        async def _agenerate(self, *args: Any, **kwargs: Any) -> Any:
            await asyncio.sleep(30)

    router, _ = _router(Slow(replies=[]))
    sent: list[BaseModel] = []
    manager = CheckManager(router, Scores(database), broadcast=sent.append)
    manager.start(REF)
    await asyncio.sleep(0.05)
    await manager.aclose()
    done = json.loads(sent[-1].model_dump_json())["params"]
    assert done["ok"] is False and done["error"] == "cancelled"
