from langchain_core.messages import (
    AIMessage,
    AIMessageChunk,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)

from golem.graphs.adapter import (
    ModelRequested,
    ModelStarted,
    PlainMessage,
    RequestedCall,
    TextCompleted,
    TextDelta,
    ThinkingDelta,
    ToolErrored,
    ToolFinished,
    ToolStarted,
    Translator,
    plain_messages,
    split_think,
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
    assert translate(
        custom(kind="tool.completed", call_id="c_1", summary="exit 1", preview="", failed=True)
    ) == ToolFinished("c_1", "exit 1", "", False, failed=True)
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


def _completed_update(message: AIMessage) -> dict[str, object]:
    return {"type": "updates", "data": {"call_model": {"messages": [message]}}}


def test_completed_reads_usage_and_anthropic_stop_reason() -> None:
    message = AIMessage(
        content="hi",
        id="m1",
        usage_metadata={
            "input_tokens": 10,
            "output_tokens": 4,
            "total_tokens": 14,
            "input_token_details": {"cache_read": 6, "cache_creation": 2},
        },
        response_metadata={"stop_reason": "tool_use"},
    )
    fact = translate(_completed_update(message))
    assert isinstance(fact, TextCompleted)
    assert fact.usage == {"input": 10, "output": 4, "cache_read": 6, "cache_write": 2}
    assert fact.stop_reason == "tool_use"


def test_completed_reads_openai_finish_reason_and_no_usage() -> None:
    message = AIMessage(content="hi", id="m1", response_metadata={"finish_reason": "stop"})
    fact = translate(_completed_update(message))
    assert isinstance(fact, TextCompleted)
    assert fact.usage is None
    assert fact.stop_reason == "stop"


def test_a_model_request_item_becomes_a_fact() -> None:
    part = {"type": "custom", "data": {"golem": "model.request", "message_id": "m1"}}
    assert translate(part) == ModelRequested("m1")


def test_a_model_request_carries_the_window_and_sections() -> None:
    item: dict[str, object] = {
        "golem": "model.request",
        "message_id": "m1",
        "context_window": 8192,
        "num_ctx": 4096,
        "system_sections": [{"name": "rules", "chars": 9}, {"name": "", "chars": 1}],
    }
    fact = translate({"type": "custom", "data": item})
    assert fact == ModelRequested(
        "m1",
        context_window=8192,
        num_ctx=4096,
        system_sections=(("rules", 9),),
    )


def test_a_bad_window_or_section_is_dropped() -> None:
    item: dict[str, object] = {
        "golem": "model.request",
        "message_id": "m1",
        "context_window": True,
        "num_ctx": -3,
        "system_sections": [
            {"chars": 4},
            {"name": "a", "chars": -1},
            "x",
            {"name": "b", "chars": "x"},
        ],
    }
    assert translate({"type": "custom", "data": item}) == ModelRequested("m1")
    item["context_window"] = "x"
    assert translate({"type": "custom", "data": item}) == ModelRequested("m1")


def _chunk(content: str = "", thinking: str = "") -> dict[str, object]:
    kwargs = {"reasoning_content": thinking} if thinking else {}
    return {
        "type": "messages",
        "data": (
            AIMessageChunk(content=content, additional_kwargs=kwargs),
            {"langgraph_node": "call_model"},
        ),
    }


def _run(*parts: dict[str, object]) -> list[object]:
    translator = Translator()
    facts: list[object] = []
    for part in parts:
        facts.extend(translator(part))
    return facts


def _done(content: str, **kwargs: object) -> dict[str, object]:
    message = AIMessage(content=content, id="m1", additional_kwargs=dict(kwargs))
    return {"type": "updates", "data": {"call_model": {"messages": [message]}}}


def test_reasoning_content_becomes_thinking_fragments_and_no_text() -> None:
    facts = _run(_chunk(thinking="Let me "), _chunk(thinking="see"))
    assert facts == [ThinkingDelta("Let me "), ThinkingDelta("see")]


def test_a_chunk_with_both_gives_the_thinking_first() -> None:
    assert _run(_chunk("a", "b")) == [ThinkingDelta("b"), TextDelta("a")]


def test_think_tags_split_over_three_chunks() -> None:
    facts = _run(_chunk("<thi"), _chunk("nk>a</th"), _chunk("ink>b"))
    assert facts == [ThinkingDelta("a"), TextDelta("b")]


def test_think_tags_in_one_chunk_and_blank_lines_after_the_close_tag() -> None:
    facts = _run(_chunk("<think>a</think>\n\n"), _chunk("b"))
    assert facts == [ThinkingDelta("a"), TextDelta("b")]


def test_an_unclosed_think_is_only_thinking() -> None:
    translator = Translator()
    facts = [*translator(_chunk("<think>abc")), *translator(_chunk("</thi"))]
    facts += translator(_done("<think>abc</thi"))
    assert facts[0] == ThinkingDelta("abc")
    assert all(not isinstance(f, TextDelta) for f in facts)
    done = facts[-1]
    assert isinstance(done, TextCompleted)
    assert done.text == ""
    assert done.thinking == "abc</thi"
    assert "".join(f.text for f in facts if isinstance(f, ThinkingDelta)) == "abc</thi"


def test_a_think_tag_later_in_the_content_stays_text() -> None:
    facts = _run(_chunk("Answer "), _chunk("<think>not thinking</think>"))
    assert facts == [TextDelta("Answer "), TextDelta("<think>not thinking</think>")]


def test_content_that_only_starts_like_the_tag_is_text_when_the_call_ends() -> None:
    translator = Translator()
    assert translator(_chunk("<thi")) == []
    facts = translator(_done("<thi"))
    assert facts[0] == TextDelta("<thi")


def test_content_that_diverges_from_the_tag_is_text() -> None:
    assert _run(_chunk("<th"), _chunk("e end")) == [TextDelta("<the end")]


def test_completed_carries_the_whole_thinking() -> None:
    facts = _run(_done("391", reasoning_content="17 times 23"))
    assert facts == [TextCompleted("391", "m1", (), None, None, "17 times 23")]
    assert _run(_done("391"))[0].thinking is None  # type: ignore[attr-defined]


def test_completed_splits_think_tags_out_of_the_text() -> None:
    (done,) = _run(_done("<think>a</think>\nb"))
    assert isinstance(done, TextCompleted)
    assert (done.thinking, done.text) == ("a", "b")


def test_a_new_model_call_starts_the_splitter_over() -> None:
    translator = Translator()
    translator(_chunk("<think>a"))
    translator({"type": "custom", "data": {"golem": "model.started", "message_id": "m2"}})
    assert translator(_chunk("plain")) == [TextDelta("plain")]


def test_split_think_of_a_whole_answer() -> None:
    assert split_think("plain") == ("", "plain")
    assert split_think("<think>a</think>b") == ("a", "b")
    assert split_think("<think>a") == ("a", "")
    assert split_think("x<think>a</think>b") == ("", "x<think>a</think>b")
