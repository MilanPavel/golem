from langchain_core.messages import AIMessage, AIMessageChunk, HumanMessage

from golem.graphs.adapter import TextCompleted, TextDelta, translate


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


def test_updates_without_call_model_are_ignored() -> None:
    part = {"type": "updates", "data": {"other": {"messages": [AIMessage(content="no")]}}}
    assert translate(part) is None
