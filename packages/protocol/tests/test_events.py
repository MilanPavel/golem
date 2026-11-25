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
    CHAT_EVENT,
    AgentLimits,
    AgentSnapshot,
    ChatEvent,
    EmptyEventData,
    EventType,
    HelperAppliedData,
    HelperAppliedEvent,
    HelperDiscardedData,
    HelperDiscardedEvent,
    HelperEndedData,
    HelperEndedEvent,
    HelperModelData,
    HelperModelEvent,
    HelperStartedData,
    HelperStartedEvent,
    HelperStateData,
    HelperStateEvent,
    HelperStepData,
    HelperStepEvent,
    HelperWaitData,
    HelperWaitEvent,
    MessageCompletedData,
    MessageCompletedEvent,
    MessageDeltaData,
    MessageDeltaEvent,
    MessageThinkingDeltaData,
    MessageThinkingDeltaEvent,
    ModelCallStartedData,
    ModelWaitingData,
    ModelWaitingEvent,
    PromptSectionInfo,
    RouteConsentNeededData,
    RunFailedData,
    RunFailedEvent,
    SessionCreatedData,
    SessionCreatedEvent,
    SessionParent,
    SessionTrimmedData,
    SessionTrimmedEvent,
    SessionUpdatedData,
    ToolCompletedData,
    ToolCompletedEvent,
    ToolFailedData,
    ToolRequestedData,
    ToolRequestedEvent,
    ToolWritingData,
    ToolWritingEvent,
    WorkerFile,
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

    thought = MessageThinkingDeltaEvent(
        seq=2,
        session_id="s_abc",
        run_id="r_abc",
        ts="2026-10-07T10:00:01+00:00",
        type="message.thinking.delta",
        data=MessageThinkingDeltaData(message_id="m_abc", text="Let me see"),
    )
    assert _ADAPTER.validate_python(thought.model_dump()) == thought

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


def test_model_call_started_context_fields_are_optional_and_round_trip() -> None:
    old = ModelCallStartedData.model_validate({"message_id": "m1", "index": 1, "profile": "p"})
    assert (old.context_window, old.num_ctx, old.system_sections) == (None, None, None)
    assert old.window_estimated is False
    data = ModelCallStartedData(
        message_id="m1",
        index=1,
        profile="p",
        context_window=16384,
        num_ctx=16384,
        window_estimated=True,
        system_sections=[PromptSectionInfo(name="rules", chars=9)],
    )
    assert ModelCallStartedData.model_validate_json(data.model_dump_json()) == data
    with pytest.raises(ValidationError):
        PromptSectionInfo(name="rules", chars=-1)
    with pytest.raises(ValidationError):
        ModelCallStartedData(message_id="m1", index=1, profile="p", context_window=0)


def test_a_tool_writing_event_round_trips_and_a_path_may_be_missing() -> None:
    event = ToolWritingEvent(
        seq=5,
        session_id="s_abc",
        run_id="r_abc",
        ts="2026-10-07T10:00:03+00:00",
        type="tool.writing",
        data=ToolWritingData(message_id="m_abc", index=0, name="write_file", lines=12, chars=400),
    )
    assert event.data.path is None
    assert _ADAPTER.validate_python(event.model_dump()) == event
    with pytest.raises(ValidationError):
        ToolWritingData(message_id="m_abc", index=0, name="write_file", lines=-1, chars=0)


def test_a_model_waiting_event_round_trips() -> None:
    event = ModelWaitingEvent(
        seq=5,
        session_id="s_abc",
        run_id="r_abc",
        ts="2026-10-07T10:00:03+00:00",
        type="model.waiting",
        data=ModelWaitingData(message_id="m_abc", waiting=True),
    )
    assert _ADAPTER.validate_python(event.model_dump()) == event
    with pytest.raises(ValidationError):
        ModelWaitingData(message_id="", waiting=True)


def test_a_model_waiting_event_carries_the_wait_fields_and_reads_without_them() -> None:
    old = ModelWaitingData.model_validate({"message_id": "m_abc", "waiting": True})
    assert old.reason is None and old.line is None and old.position is None
    hosted = ModelWaitingData(
        message_id="m_abc",
        waiting=True,
        reason="provider",
        line="anthropic",
        position=1,
        retry_in_ms=2000,
    )
    assert ModelWaitingData.model_validate(hosted.model_dump()) == hosted
    stalled = ModelWaitingData(
        message_id="m_abc",
        waiting=True,
        reason="stalled",
        silent_ms=45000,
        scope="team",
        will_retry=True,
    )
    assert stalled.scope == "team" and stalled.will_retry is True
    with pytest.raises(ValidationError):
        ModelWaitingData.model_validate({"message_id": "m_abc", "waiting": True, "reason": "later"})
    with pytest.raises(ValidationError):
        ModelWaitingData.model_validate({"message_id": "m_abc", "waiting": True, "scope": "batch"})


def test_a_helper_state_carries_the_wait_fields_and_reads_without_them() -> None:
    old = HelperStateData.model_validate(
        {"call_id": "call_1", "index": 0, "state": "queued", "reason": "team"}
    )
    assert old.line is None and old.position is None and old.spent_usd is None
    waiting = HelperStateData(
        call_id="call_1",
        index=1,
        state="queued",
        reason="provider",
        line="anthropic",
        position=1,
        holder="explorer 1",
        retry_in_ms=8000,
    )
    assert HelperStateData.model_validate_json(waiting.model_dump_json()) == waiting
    budget = HelperStateData(
        call_id="call_1", index=2, state="waiting", reason="budget", spent_usd=0.62, cap_usd=0.5
    )
    assert HelperStateData.model_validate(budget.model_dump()) == budget
    for bad in ({"position": 0}, {"retry_in_ms": -1}, {"spent_usd": -0.1}, {"cap_usd": -1}):
        with pytest.raises(ValidationError):
            HelperStateData.model_validate(
                {"call_id": "call_1", "index": 0, "state": "waiting", **bad}
            )


def test_session_created_names_its_parent_and_agent() -> None:
    data = SessionCreatedData(
        model_profile="remote",
        parent=SessionParent(session_id="s_lead", call_id="call_1", index=2),
        agent=AgentSnapshot(
            name="explorer",
            source="bundled",
            tools=["read_file", "grep"],
            limits=AgentLimits(max_calls=15, max_seconds=300),
            wish="cheapest",
        ),
    )
    restored = SessionCreatedData.model_validate_json(data.model_dump_json())
    assert restored == data
    assert restored.agent is not None and restored.agent.asks is False


def test_session_created_without_parent_or_agent_leaves_them_none() -> None:
    data = SessionCreatedData(model_profile="remote")
    assert data.parent is None and data.agent is None


def test_session_created_refuses_a_bad_parent_or_agent() -> None:
    base = {"model_profile": "remote"}
    with pytest.raises(ValidationError):
        SessionCreatedData.model_validate(
            {**base, "parent": {"session_id": "s", "call_id": "c", "index": -1}}
        )
    with pytest.raises(ValidationError):
        SessionCreatedData.model_validate({**base, "parent": {"session_id": "s", "call_id": "c"}})
    with pytest.raises(ValidationError):
        SessionCreatedData.model_validate(
            {**base, "agent": {"name": "x", "source": "plugin", "wish": "same"}}
        )


def test_a_session_created_event_written_before_parent_and_agent_still_validates() -> None:
    old = {
        "seq": 1,
        "session_id": "s_old",
        "run_id": None,
        "ts": "2026-01-01T00:00:00Z",
        "type": "session.created",
        "data": {
            "cwd": "/tmp/golem-golden",
            "forked_from": None,
            "model_name": None,
            "model_profile": "remote",
            "model_provider": None,
            "origin": None,
            "route": "pinned",
        },
    }
    event = CHAT_EVENT.validate_python(old)
    assert isinstance(event, SessionCreatedEvent)
    assert event.data.parent is None and event.data.agent is None


def _helper_event(cls: type, type_: str, data: object) -> object:
    return cls(
        seq=7,
        session_id="s_lead",
        run_id="r_1",
        ts="2026-11-19T10:00:00+00:00",
        type=type_,
        data=data,
    )


def test_the_six_helper_events_round_trip() -> None:
    events = [
        _helper_event(
            HelperStartedEvent,
            "helper.started",
            HelperStartedData(
                call_id="call_1",
                index=0,
                helper_id="s_helper",
                agent="explorer",
                label="find the parser",
                model="qwen3:14b",
                wish="cheapest",
                pick_reason="the loaded local model",
            ),
        ),
        _helper_event(
            HelperModelEvent,
            "helper.model",
            HelperModelData(
                call_id="call_1",
                index=0,
                helper_id="s_helper",
                model="qwen3:14b",
                pick_reason="you said no, so a local model with a fresh window",
            ),
        ),
        _helper_event(
            HelperStepEvent,
            "helper.step",
            HelperStepData(
                call_id="call_1",
                index=0,
                step_id="t_1",
                name="grep",
                args={"pattern": "parse"},
                status="running",
                calls=1,
            ),
        ),
        _helper_event(
            HelperStateEvent,
            "helper.state",
            HelperStateData(call_id="call_1", index=0, state="waiting", reason="you"),
        ),
        _helper_event(
            HelperWaitEvent,
            "helper.wait",
            HelperWaitData(call_id="call_1", state="parked", helper_ids=["s_helper"]),
        ),
        _helper_event(
            HelperEndedEvent,
            "helper.ended",
            HelperEndedData(
                call_id="call_1",
                index=0,
                stopped="done",
                model_calls=3,
                tokens=1200,
                answer_tokens=80,
                cost_usd=0.0,
                duration_ms=9000,
                working_ms=7000,
            ),
        ),
        _helper_event(
            HelperEndedEvent,
            "helper.ended",
            HelperEndedData(
                call_id="call_1",
                index=0,
                stopped="done",
                model_calls=3,
                tokens=1200,
                answer_tokens=80,
                cost_usd=0.0,
                duration_ms=9000,
                working_ms=7000,
                diff_artifact_id="art_1",
                files=[
                    WorkerFile(path="a.py", status="modified", added=3, removed=1),
                    WorkerFile(path="b.py", status="created", added=10, removed=0),
                ],
                added=13,
                removed=1,
                checks="failed",
                checks_failed=["tests"],
            ),
        ),
        _helper_event(
            HelperAppliedEvent,
            "helper.applied",
            HelperAppliedData(helper_id="s_helper", change_ids=["ch_1", "ch_2"]),
        ),
        _helper_event(
            HelperDiscardedEvent,
            "helper.discarded",
            HelperDiscardedData(helper_id="s_helper"),
        ),
    ]
    for event in events:
        assert _ADAPTER.validate_python(event.model_dump()) == event  # type: ignore[attr-defined]
        assert _ADAPTER.validate_json(event.model_dump_json()) == event  # type: ignore[attr-defined]
    assert {e.type for e in events} <= set(get_args(EventType))  # type: ignore[attr-defined]


def test_session_trimmed_round_trips_and_has_no_run() -> None:
    event = SessionTrimmedEvent(
        seq=9,
        session_id="s_helper",
        ts="2026-11-28T10:00:00+00:00",
        type="session.trimmed",
        data=SessionTrimmedData(removed=41),
    )
    assert event.run_id is None
    assert _ADAPTER.validate_json(event.model_dump_json()) == event  # type: ignore[attr-defined]
    assert "session.trimmed" in get_args(EventType)
    with pytest.raises(ValidationError):
        SessionTrimmedData(removed=-1)


def test_branch_changed_carries_both_branches_and_how_many_files_differ() -> None:
    event = {
        "seq": 3,
        "session_id": "s1",
        "run_id": "r1",
        "ts": "2026-11-22T10:00:00.000Z",
        "type": "branch.changed",
        "data": {"from_branch": "main", "to_branch": "fix-x", "paths_count": 4},
    }
    parsed = _ADAPTER.validate_python(event)  # type: ignore[attr-defined]
    assert parsed.data.to_branch == "fix-x"  # type: ignore[attr-defined]
    assert _ADAPTER.validate_json(parsed.model_dump_json()) == parsed  # type: ignore[attr-defined]
    assert "branch.changed" in get_args(EventType)
    with pytest.raises(ValidationError):
        _ADAPTER.validate_python({**event, "data": {**event["data"], "from_branch": ""}})  # type: ignore[attr-defined,index]


def test_model_routed_has_the_reasons_of_a_helpers_pick_and_still_reads_pinned() -> None:
    for reason in ("pinned", "same", "stronger", "tier", "named", "nearest", "lead"):
        event = {
            "seq": 1,
            "session_id": "s_helper",
            "run_id": "r1",
            "ts": "2026-11-01T10:00:00.000Z",
            "type": "model.routed",
            "data": {
                "model_profile": "qwen3:14b",
                "tier": "local",
                "reason": reason,
                "detail": "same: the lead's model",
            },
        }
        parsed = _ADAPTER.validate_python(event)  # type: ignore[attr-defined]
        assert parsed.data.reason == reason  # type: ignore[attr-defined]
        assert _ADAPTER.validate_json(parsed.model_dump_json()) == parsed  # type: ignore[attr-defined]
    with pytest.raises(ValidationError):
        _ADAPTER.validate_python({**event, "data": {**event["data"], "reason": "whim"}})  # type: ignore[attr-defined,index]


def test_a_helper_state_reason_is_any_word_and_optional() -> None:
    assert HelperStateData(call_id="c", index=0, state="running").reason is None
    assert HelperStateData(call_id="c", index=0, state="queued", reason="slot").reason == "slot"
    assert HelperStateData(call_id="c", index=0, state="waiting", reason="a later word").reason


def test_a_helper_step_summary_is_optional_and_at_most_200_characters() -> None:
    step = {
        "call_id": "c",
        "index": 0,
        "step_id": "t",
        "name": "grep",
        "status": "done",
        "calls": 1,
    }
    assert HelperStepData.model_validate(step).summary is None
    assert HelperStepData.model_validate({**step, "summary": "3 lines"}).summary == "3 lines"
    assert HelperStepData.model_validate({**step, "summary": "x" * 200}).summary
    with pytest.raises(ValidationError):
        HelperStepData.model_validate({**step, "summary": "x" * 201})


def test_helper_events_refuse_values_outside_their_lists() -> None:
    with pytest.raises(ValidationError):
        HelperStateData(call_id="c", index=0, state="sleeping")  # type: ignore[arg-type]
    with pytest.raises(ValidationError):
        HelperWaitData(call_id="c", state="paused", helper_ids=[])  # type: ignore[arg-type]
    with pytest.raises(ValidationError):
        HelperStepData(call_id="c", index=0, step_id="t", name="grep", status="queued", calls=0)  # type: ignore[arg-type]
    ended = {
        "call_id": "c",
        "index": 0,
        "stopped": "done",
        "model_calls": 1,
        "tokens": 1,
        "answer_tokens": 1,
        "cost_usd": 0,
        "duration_ms": 1,
        "working_ms": 1,
    }
    for stopped in ("done", "calls", "time", "budget", "tokens", "cancelled", "failed"):
        assert HelperEndedData.model_validate({**ended, "stopped": stopped}).stopped == stopped
    with pytest.raises(ValidationError):
        HelperEndedData.model_validate({**ended, "stopped": "tired"})
    with pytest.raises(ValidationError):
        HelperEndedData.model_validate({**ended, "working_ms": -1})
    bare = HelperEndedData.model_validate(ended)
    assert (bare.diff_artifact_id, bare.files, bare.added, bare.removed) == (None, None, None, None)
    assert (bare.checks, bare.checks_failed, bare.checks_note) == (None, None, None)
    for checks in ("passed", "failed", "none"):
        assert HelperEndedData.model_validate({**ended, "checks": checks}).checks == checks
    noted = HelperEndedData.model_validate(
        {**ended, "checks": "none", "checks_note": "no checks found"}
    )
    assert HelperEndedData.model_validate_json(noted.model_dump_json()) == noted
    with pytest.raises(ValidationError):
        HelperEndedData.model_validate({**ended, "checks": "maybe"})
    with pytest.raises(ValidationError):
        HelperEndedData.model_validate({**ended, "added": -1})
    file = {"path": "a.py", "status": "modified", "added": 1, "removed": 0}
    for status in ("created", "modified", "deleted"):
        assert WorkerFile.model_validate({**file, "status": status}).status == status
    with pytest.raises(ValidationError):
        WorkerFile.model_validate({**file, "status": "renamed"})
    with pytest.raises(ValidationError):
        WorkerFile.model_validate({**file, "removed": -1})
    with pytest.raises(ValidationError):
        HelperAppliedData.model_validate({"helper_id": "", "change_ids": []})
    with pytest.raises(ValidationError):
        HelperDiscardedData.model_validate({"helper_id": "h", "extra": 1})


def _consent_data(**extra: object) -> dict[str, object]:
    return {
        "model_profile": "p",
        "tier": "frontier",
        "why": "w",
        "alternatives": ["once", "local"],
        **extra,
    }


def test_consent_needed_helper_fields_are_optional() -> None:
    plain = RouteConsentNeededData.model_validate(_consent_data())
    assert plain.helper_id is None and plain.sent is None and plain.not_sent is None
    assert RouteConsentNeededData.model_validate_json(plain.model_dump_json()) == plain
    helper = RouteConsentNeededData.model_validate(
        _consent_data(
            helper_id="h1",
            agent="reviewer",
            label="Review",
            sent=["the brief", "the diff, 212 lines"],
            not_sent=["this chat"],
        )
    )
    assert RouteConsentNeededData.model_validate_json(helper.model_dump_json()) == helper
    assert helper.not_sent == ["this chat"]


def test_consent_needed_refuses_long_lists_and_strings() -> None:
    for bad in (
        {"sent": ["x"] * 11},
        {"not_sent": ["x" * 121]},
        {"sent": [""]},
        {"label": "x" * 121},
        {"helper_id": ""},
    ):
        with pytest.raises(ValidationError):
            RouteConsentNeededData.model_validate(_consent_data(**bad))


def test_consent_needed_brief_and_diff_round_trip() -> None:
    plain = RouteConsentNeededData.model_validate(_consent_data())
    assert plain.brief is None and plain.diff_artifact_id is None
    helper = RouteConsentNeededData.model_validate(
        _consent_data(helper_id="h1", brief="Review the diff.", diff_artifact_id="art-1")
    )
    assert RouteConsentNeededData.model_validate_json(helper.model_dump_json()) == helper
    assert helper.diff_artifact_id == "art-1"
    # An old event without the fields still parses.
    old = RouteConsentNeededData.model_validate_json(plain.model_dump_json(exclude_none=True))
    assert old == plain
    for bad in ({"brief": "x" * 8001}, {"diff_artifact_id": ""}):
        with pytest.raises(ValidationError):
            RouteConsentNeededData.model_validate(_consent_data(**bad))
