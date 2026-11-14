"""``detect`` reads the current run's messages and names the way the model struggles."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, ToolMessage

from golem.graphs.struggle import Struggle, detect


def _call(n: int, name: str = "read_file", **args: Any) -> AIMessage:
    return AIMessage("", tool_calls=[{"name": name, "args": args, "id": f"c{n}"}])


def _result(n: int, kind: str | None = None, text: str = "x") -> ToolMessage:
    return ToolMessage(
        text,
        tool_call_id=f"c{n}",
        status="success" if kind is None else "error",
        additional_kwargs={} if kind is None else {"golem_error": kind},
    )


def _old(n: int, text: str) -> ToolMessage:
    """A result from a checkpoint written before the marker."""
    return ToolMessage(text, tool_call_id=f"c{n}", status="error")


def _signal(messages: Sequence[BaseMessage], **kw: Any) -> str | None:
    found = detect(messages, **kw)
    return None if found is None else found.signal


def test_an_empty_list_is_no_struggle() -> None:
    assert detect([]) is None


def test_a_text_call_golem_could_not_read() -> None:
    found = detect([HumanMessage("q"), AIMessage("<tool>")], text_tool_calls="unread")
    assert found is not None
    assert (found.signal, found.count) == ("unread_text_call", 1)
    assert _signal([HumanMessage("q"), AIMessage("hi")], text_tool_calls="read") is None


def test_a_reply_cut_at_the_limit() -> None:
    messages: list[BaseMessage] = [HumanMessage("q"), AIMessage("half an ans")]
    assert _signal(messages, stop_reason="length") == "cut_reply"
    assert _signal(messages, stop_reason="max_tokens") == "cut_reply"
    assert _signal(messages, stop_reason="stop") is None
    assert _signal([HumanMessage("q"), _call(1)], stop_reason="length") is None


def test_an_empty_reply_with_no_tool_call() -> None:
    assert _signal([HumanMessage("q"), AIMessage("  \n")]) == "empty_reply"
    assert _signal([HumanMessage("q"), _call(1)]) is None


def test_two_invalid_calls_in_a_row() -> None:
    messages = [HumanMessage("q"), _call(1), _result(1, "invalid_args"), _call(2)]
    assert _signal([*messages, _result(2, "invalid_args")]) == "invalid_tool_calls"
    assert _signal([*messages, _result(2, "unknown_tool")]) == "invalid_tool_calls"
    found = detect([*messages, _result(2, "invalid_args")])
    assert found is not None and found.count == 2
    assert found.detail == "2 invalid tool calls in a row"


def test_results_of_one_reply_count_one_by_one() -> None:
    reply = AIMessage(
        "",
        tool_calls=[
            {"name": "a", "args": {}, "id": "c1"},
            {"name": "b", "args": {}, "id": "c2"},
        ],
    )
    messages = [HumanMessage("q"), reply, _result(1, "invalid_args"), _result(2, "unknown_tool")]
    assert _signal(messages) == "invalid_tool_calls"


def test_one_invalid_call_is_not_enough() -> None:
    assert _signal([HumanMessage("q"), _call(1), _result(1, "invalid_args")]) is None


def test_a_success_between_invalid_calls_resets_the_count() -> None:
    messages = [
        HumanMessage("q"),
        _call(1),
        _result(1, "invalid_args"),
        _call(2, path="a"),
        _result(2),
        _call(3),
        _result(3, "invalid_args"),
    ]
    assert _signal(messages) is None


def test_a_tool_that_fails_for_its_own_reasons_is_not_a_struggle() -> None:
    for kind in ("tool_error", "denied", "cancelled"):
        messages: list[BaseMessage] = [HumanMessage("q")]
        for n in range(1, 4):
            messages += [_call(n, path=str(n)), _result(n, kind)]
        assert _signal(messages) is None


def test_an_old_checkpoint_is_read_from_the_text() -> None:
    messages = [
        HumanMessage("q"),
        _call(1),
        _old(1, "error: invalid arguments for read_file: x"),
        _call(2),
        _old(2, "error: unknown tool 'nope'; the tools are a"),
    ]
    assert _signal(messages) == "invalid_tool_calls"
    other = [
        HumanMessage("q"),
        _call(1),
        _old(1, "error: boom"),
        _call(2),
        _old(2, "error: boom"),
    ]
    assert _signal(other) is None


def test_the_same_call_three_times() -> None:
    messages: list[BaseMessage] = [HumanMessage("q")]
    for n in (1, 2):
        messages += [_call(n, path="a", limit=1), _result(n)]
    messages.append(
        AIMessage(
            "", tool_calls=[{"name": "read_file", "args": {"limit": 1, "path": "a"}, "id": "c3"}]
        )
    )
    assert detect(messages) == Struggle("repeated_call", "the same tool call 3 times", 3)


def test_two_identical_calls_are_not_enough() -> None:
    messages = [HumanMessage("q"), _call(1, path="a"), _result(1), _call(2, path="a")]
    assert _signal(messages) is None


def test_three_identical_calls_of_which_the_newest_is_not_in_the_last_reply() -> None:
    messages = [
        HumanMessage("q"),
        _call(1, path="a"),
        _result(1),
        _call(2, path="a"),
        _result(2),
        _call(3, path="a"),
        _result(3),
        _call(4, path="b"),
    ]
    assert _signal(messages) is None


def test_a_reply_with_a_tool_call_and_no_text_is_not_empty() -> None:
    assert _signal([HumanMessage("q"), _call(1)]) is None


def test_messages_before_the_last_human_message_are_ignored() -> None:
    old = [
        HumanMessage("old"),
        _call(1),
        _result(1, "invalid_args"),
        _call(2),
        _result(2, "invalid_args"),
    ]
    assert _signal(old) == "invalid_tool_calls"
    assert _signal([*old, HumanMessage("new"), _call(3), _result(3, "invalid_args")]) is None
    repeats: list[BaseMessage] = [HumanMessage("old")]
    for n in (1, 2, 3):
        repeats += [_call(n, path="a"), _result(n)]
    assert _signal([*repeats, HumanMessage("new"), _call(4, path="a")]) is None
