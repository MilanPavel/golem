from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, ToolMessage

from golem.coding.checks import decide, edited_this_turn


def _result(name: str, content: str = "ok", *, error: bool = False) -> ToolMessage:
    return ToolMessage(
        content=content, tool_call_id=f"c_{name}", name=name, status="error" if error else "success"
    )


def test_a_turn_without_tools_changed_nothing() -> None:
    messages: list[BaseMessage] = [HumanMessage(content="hi"), AIMessage(content="hello")]
    assert not edited_this_turn(messages)
    assert not edited_this_turn([])


def test_a_read_only_turn_changed_nothing() -> None:
    messages: list[BaseMessage] = [HumanMessage(content="look"), _result("read_file")]
    assert not edited_this_turn(messages)


def test_a_failed_edit_changed_nothing() -> None:
    messages: list[BaseMessage] = [
        HumanMessage(content="fix"),
        _result("edit_file", "error: no match", error=True),
    ]
    assert not edited_this_turn(messages)


def test_a_successful_write_or_edit_changed_files() -> None:
    for name in ("write_file", "edit_file"):
        assert edited_this_turn([HumanMessage(content="fix"), _result(name)])


def test_a_shell_command_that_exited_zero_counts() -> None:
    done = _result("shell", "formatted\n[exit code 0]")
    failed = _result("shell", "boom\n[exit code 2]")
    assert edited_this_turn([HumanMessage(content="x"), done])
    assert not edited_this_turn([HumanMessage(content="x"), failed])


def test_an_edit_in_the_previous_turn_only_does_not_count() -> None:
    messages: list[BaseMessage] = [
        HumanMessage(content="one"),
        _result("write_file"),
        AIMessage(content="done"),
        HumanMessage(content="two"),
        AIMessage(content="no change"),
    ]
    assert not edited_this_turn(messages)


def test_off_never_runs_and_auto_runs_unless_the_session_said_no() -> None:
    assert decide("off", True, "autopilot") == "skip"
    assert decide("auto", None, "careful") == "run"
    assert decide("auto", True, "careful") == "run"
    assert decide("auto", False, "autopilot") == "skip"


def test_ask_follows_the_session_and_offers_without_an_answer() -> None:
    assert decide("ask", True, "balanced") == "run"
    assert decide("ask", False, "autopilot") == "skip"
    assert decide("ask", None, "balanced") == "offer"
    assert decide("ask", None, "careful") == "offer"
    assert decide("ask", None, "autopilot") == "run"
