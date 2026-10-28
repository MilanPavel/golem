from typing import get_args

import pytest
from pydantic import TypeAdapter, ValidationError

from golem_protocol.commands import (
    MessageSendParams,
    MessageSendResult,
    SessionCreateParams,
    SessionCreateResult,
)
from golem_protocol.events import (
    ChatEvent,
    EmptyEventData,
    EventType,
    MessageCompletedData,
    MessageCompletedEvent,
    MessageDeltaData,
    MessageDeltaEvent,
    RunFailedData,
    RunFailedEvent,
    SessionCreatedData,
    SessionCreatedEvent,
    SessionUpdatedData,
    ToolCompletedData,
    ToolCompletedEvent,
    ToolFailedData,
    ToolRequestedData,
    ToolRequestedEvent,
)
from golem_protocol.rpc import RpcNotification

_ADAPTER: TypeAdapter[ChatEvent] = TypeAdapter(ChatEvent)


def test_session_and_message_commands_round_trip() -> None:
    created = SessionCreateParams()
    assert SessionCreateParams.model_validate_json(created.model_dump_json()) == created
    named = SessionCreateParams(model_profile="remote")
    assert SessionCreateResult(session_id="s_abc").session_id == "s_abc"
    assert named.model_profile == "remote"
    sent = MessageSendParams(session_id="s_abc", text="hello")
    assert MessageSendParams.model_validate_json(sent.model_dump_json()) == sent
    assert MessageSendResult(run_id="r_abc").run_id == "r_abc"
    with pytest.raises(ValidationError):
        MessageSendParams(session_id="s_abc", text="")
    with pytest.raises(ValidationError):
        MessageSendParams(session_id="s_abc", text="x" * 100_001)


def test_chat_event_union_round_trip() -> None:
    created = SessionCreatedEvent(
        seq=1,
        session_id="s_abc",
        run_id=None,
        ts="2026-10-07T10:00:00+00:00",
        type="session.created",
        data=SessionCreatedData(model_profile="remote"),
    )
    notice = RpcNotification(params=created)
    restored = RpcNotification.model_validate_json(notice.model_dump_json())
    assert restored.method == "event"
    assert restored.params == created
    assert "id" not in notice.model_dump()

    delta = MessageDeltaEvent(
        seq=2,
        session_id="s_abc",
        run_id="r_abc",
        ts="2026-10-07T10:00:01+00:00",
        type="message.delta",
        data=MessageDeltaData(message_id="m_abc", text="Hel"),
    )
    assert _ADAPTER.validate_python(delta.model_dump()) == delta

    done = MessageCompletedEvent(
        seq=3,
        session_id="s_abc",
        run_id="r_abc",
        ts="2026-10-07T10:00:02+00:00",
        type="message.completed",
        data=MessageCompletedData(message_id="m_user", role="user", text="hello"),
    )
    failed = RunFailedEvent(
        seq=4,
        session_id="s_abc",
        run_id="r_abc",
        ts="2026-10-07T10:00:03+00:00",
        type="run.failed",
        data=RunFailedData(message="boom"),
    )
    assert _ADAPTER.validate_python(done.model_dump()) == done
    assert _ADAPTER.validate_python(failed.model_dump()) == failed
    assert EmptyEventData().model_dump() == {}


def test_run_failed_says_which_server_did_not_answer() -> None:
    plain = RunFailedData.model_validate({"message": "boom"})
    assert (plain.code, plain.provider, plain.hint) == (None, None, None)
    down = RunFailedData(
        message="Ollama isn't running",
        code="model_unreachable",
        provider="ollama",
        hint="run ollama serve",
    )
    assert RunFailedData.model_validate_json(down.model_dump_json()) == down
    missing = down.model_copy(update={"code": "not_installed"})
    assert RunFailedData.model_validate_json(missing.model_dump_json()) == missing
    with pytest.raises(ValidationError):
        RunFailedData.model_validate({"message": "boom", "code": "teapot"})
    with pytest.raises(ValidationError):
        RunFailedData(message="boom", hint="")


def test_session_created_names_the_configured_model() -> None:
    data = SessionCreatedData(
        model_profile="remote",
        model_provider="openai_compat",
        model_name="qwen3.5:4b",
    )
    assert SessionCreatedData.model_validate_json(data.model_dump_json()) == data
    with pytest.raises(ValidationError):
        SessionCreatedData(model_profile="remote", model_name="")


def test_event_type_lists_every_chat_event() -> None:
    members = get_args(get_args(ChatEvent)[0])
    declared = {get_args(member.model_fields["type"].annotation)[0] for member in members}
    assert declared == set(get_args(EventType))


def test_chat_event_rejects_the_wrong_payload() -> None:
    with pytest.raises(ValidationError):
        _ADAPTER.validate_python(
            {
                "seq": 1,
                "session_id": "s_abc",
                "run_id": "r_abc",
                "ts": "2026-10-07T10:00:00+00:00",
                "type": "message.delta",
                "data": {"message_id": "m_abc"},
            }
        )


def test_tool_events_round_trip() -> None:
    requested = ToolRequestedEvent(
        seq=5,
        session_id="s_abc",
        run_id="r_abc",
        ts="2026-10-07T10:00:04+00:00",
        type="tool.requested",
        data=ToolRequestedData(
            call_id="c_1", message_id="m_abc", name="read_file", args={"path": "a.txt"}
        ),
    )
    completed = ToolCompletedEvent(
        seq=6,
        session_id="s_abc",
        run_id="r_abc",
        ts="2026-10-07T10:00:05+00:00",
        type="tool.completed",
        data=ToolCompletedData(call_id="c_1", summary="1 line", preview="hi"),
    )
    assert _ADAPTER.validate_python(requested.model_dump()) == requested
    assert _ADAPTER.validate_json(completed.model_dump_json()) == completed
    assert completed.data.truncated is False
    with pytest.raises(ValidationError):
        ToolFailedData(call_id="c_1", message="")


def test_session_create_carries_a_folder() -> None:
    params = SessionCreateParams(cwd="/Users/me/code")
    assert SessionCreateParams.model_validate_json(params.model_dump_json()) == params
    assert SessionCreatedData(model_profile="remote", cwd="/Users/me/code").cwd == "/Users/me/code"
    with pytest.raises(ValidationError):
        SessionCreateParams(cwd="")


def test_session_updated_names_what_changed() -> None:
    assert SessionUpdatedData(cwd="/Users/me/code").title is None
    assert SessionUpdatedData(title="Named").cwd is None
    with pytest.raises(ValidationError):
        SessionUpdatedData()
