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
    MessageCompletedData,
    MessageCompletedEvent,
    MessageDeltaData,
    MessageDeltaEvent,
    RunFailedData,
    RunFailedEvent,
    SessionCreatedData,
    SessionCreatedEvent,
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
