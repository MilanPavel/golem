from langchain_core.messages import (
    AIMessage,
    AIMessageChunk,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)

from golem.graphs.adapter import (
    ModelStarted,
    PlainMessage,
    RequestedCall,
    TextCompleted,
    TextDelta,
    ToolErrored,
    ToolFinished,
    ToolStarted,
    plain_messages,
    translate,
)


def test_message_chunk_becomes_a_delta() -> None:
    part = {
        "type": "messages",
        "data": (
            AIMessageChunk(content="Hel"),
            {"langgraph_node": "call_model"},
        ),
    }
    assert translate(part) == TextDelta("Hel")


def test_empty_chunk_and_non_ai_messages_are_ignored() -> None:
    empty = {
        "type": "messages",
        "data": (AIMessageChunk(content=""), {"langgraph_node": "call_model"}),
    }
    human = {
        "type": "messages",
        "data": (HumanMessage(content="hi"), {"langgraph_node": "call_model"}),
    }
    other_node = {
        "type": "messages",
        "data": (AIMessageChunk(content="x"), {"langgraph_node": "tools"}),
    }
    assert translate(empty) is None
    assert translate(human) is None
    assert translate(other_node) is None
    assert translate({"type": "values", "data": {}}) is None


def test_call_model_update_becomes_the_final_text() -> None:
    part = {
        "type": "updates",
        "data": {"call_model": {"messages": [AIMessage(content="Hello")]}},
    }
    assert translate(part) == TextCompleted("Hello")


def test_plain_messages_are_role_and_text() -> None:
    values = {
        "messages": [
            SystemMessage(content="rules"),
            HumanMessage(content="hi"),
            AIMessage(content="hello"),
            ToolMessage(content="file", tool_call_id="call-1"),
            "skip",
        ]
    }
    assert plain_messages(values) == [
        PlainMessage("system", "rules"),
        PlainMessage("user", "hi"),
        PlainMessage("assistant", "hello"),
        PlainMessage("tool", "file"),
    ]
    assert plain_messages({}) == []


def test_updates_without_call_model_are_ignored() -> None:
    part = {"type": "updates", "data": {"other": {"messages": [AIMessage(content="no")]}}}
    assert translate(part) is None


def test_custom_stream_items_become_tool_facts() -> None:
    def custom(**data: object) -> dict[str, object]:
        return {"type": "custom", "data": {"golem": data.pop("kind"), **data}}

    assert translate(custom(kind="model.started", message_id="m_2")) == ModelStarted("m_2")
    assert translate(custom(kind="tool.started", call_id="c_1")) == ToolStarted("c_1")
    assert translate(
        custom(kind="tool.completed", call_id="c_1", summary="2 lines", preview="a", truncated=True)
    ) == ToolFinished("c_1", "2 lines", "a", True)
    assert translate(custom(kind="tool.failed", call_id="c_1", message="no")) == ToolErrored(
        "c_1", "no"
    )
    assert translate({"type": "custom", "data": {"other": 1}}) is None


def test_a_reply_with_tool_calls_lists_them() -> None:
    reply = AIMessage(
        content="",
        id="m_a",
        tool_calls=[{"name": "read_file", "args": {"path": "a.py"}, "id": "c_1"}],
    )
    part = {"type": "updates", "data": {"call_model": {"messages": [reply]}}}
    assert translate(part) == TextCompleted(
        "", "m_a", (RequestedCall("c_1", "read_file", {"path": "a.py"}),)
    )
    assert plain_messages({"messages": [reply]}) == [
        PlainMessage("assistant", '→ read_file(path="a.py")')
    ]
