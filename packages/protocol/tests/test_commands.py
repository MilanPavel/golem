import pytest
from pydantic import ValidationError

from golem_protocol.commands import (
    AgentInfo,
    AgentLimits,
    AgentRegistryChanged,
    AgentsGetParams,
    AgentsGetResult,
    AgentsListParams,
    AgentsListResult,
    DaemonStatus,
    HelloParams,
    HelloResult,
    InspectMessage,
    ListedProvider,
    LocalServer,
    ModelOptionsSaved,
    ModelServerStatus,
    PendingItem,
    PingParams,
    SessionInspectResult,
    SessionSummary,
    TraceContextPart,
    TraceSpanResult,
)
from golem_protocol.events import Ping
from golem_protocol.rpc import (
    AgentRegistryChangedNotification,
    ModelOptionsSavedNotification,
    ModelServerStatusNotification,
    RpcErrorBody,
    RpcFailure,
    RpcRequest,
    RpcSuccess,
)


def test_hello_round_trip() -> None:
    params = HelloParams(protocol_major=1, protocol_minor=0, client="tui")
    assert HelloParams.model_validate_json(params.model_dump_json()) == params
    result = HelloResult(protocol_major=1, protocol_minor=0, daemon_version="0.0.0")
    assert HelloResult.model_validate_json(result.model_dump_json()) == result


def test_hello_rejects_long_client_name() -> None:
    with pytest.raises(ValidationError):
        HelloParams(protocol_major=1, protocol_minor=0, client="x" * 33)


def test_daemon_status_state() -> None:
    status = DaemonStatus(
        pid=1,
        version="0.0.0",
        protocol_major=1,
        protocol_minor=0,
        uptime_seconds=1.5,
        state="running",
        model_profile="remote",
        model_provider="openai_compat",
        model_name="qwen3.5:4b",
    )
    assert DaemonStatus.model_validate_json(status.model_dump_json()) == status
    with pytest.raises(ValidationError):
        DaemonStatus.model_validate(
            {**status.model_dump(), "state": "asleep"},
        )
    with pytest.raises(ValidationError):
        DaemonStatus.model_validate({**status.model_dump(), "model_name": ""})


def test_daemon_status_lists_local_servers() -> None:
    bare = DaemonStatus.model_validate(
        {
            "pid": 1,
            "version": "0.0.0",
            "protocol_major": 2,
            "protocol_minor": 23,
            "uptime_seconds": 1,
            "state": "running",
        }
    )
    assert bare.local_servers == []
    ours = LocalServer(
        provider="ollama",
        base_url="http://127.0.0.1:11434",
        owner="golem",
        pid=49080,
        memory_mb=5324.8,
    )
    status = bare.model_copy(update={"local_servers": [ours]})
    assert DaemonStatus.model_validate_json(status.model_dump_json()) == status
    with pytest.raises(ValidationError):
        LocalServer.model_validate({**ours.model_dump(), "owner": "someone"})


def test_model_options_saved_notification_round_trip() -> None:
    saved = ModelOptionsSavedNotification(
        params=ModelOptionsSaved(model="qwen3:8b", saved={"temperature": 0.3, "keep_alive": "5m"})
    )
    assert saved.method == "model.options.saved"
    assert ModelOptionsSavedNotification.model_validate_json(saved.model_dump_json()) == saved
    with pytest.raises(ValidationError):
        ModelOptionsSaved.model_validate({"model": "", "saved": {}})


def test_model_server_status_notification_round_trip() -> None:
    failed = ModelServerStatusNotification(
        params=ModelServerStatus(
            provider="ollama",
            base_url="http://127.0.0.1:11434",
            state="failed",
            message="ollama serve exited with code 1",
        )
    )
    assert failed.method == "model.server.status"
    assert ModelServerStatusNotification.model_validate_json(failed.model_dump_json()) == failed
    with pytest.raises(ValidationError):
        ModelServerStatus.model_validate({**failed.params.model_dump(), "state": "asleep"})


def test_a_listed_provider_can_be_not_installed() -> None:
    missing = ListedProvider(provider="ollama", status="not_installed")
    assert ListedProvider.model_validate_json(missing.model_dump_json()) == missing
    with pytest.raises(ValidationError):
        ListedProvider.model_validate({"provider": "ollama", "status": "asleep"})


def test_ping_params() -> None:
    params = PingParams(nonce="abc")
    assert PingParams.model_validate_json(params.model_dump_json()) == params


def test_rpc_request_requires_id_and_version() -> None:
    request = RpcRequest(jsonrpc="2.0", method="hello", params={"client": "tui"}, id=1)
    assert RpcRequest.model_validate_json(request.model_dump_json()) == request
    with pytest.raises(ValidationError):
        RpcRequest.model_validate({"jsonrpc": "2.0", "method": "hello", "params": {}})
    with pytest.raises(ValidationError):
        RpcRequest.model_validate({"jsonrpc": "2.0", "method": "hello", "id": True})


def test_rpc_failure_allows_null_id() -> None:
    failure = RpcFailure(error=RpcErrorBody(code=-32700, message="parse error"), id=None)
    restored = RpcFailure.model_validate_json(failure.model_dump_json())
    assert restored.error.code == -32700
    assert restored.id is None


def test_session_inspect_round_trip() -> None:
    result = SessionInspectResult(
        session_id="s_test",
        model_profile="remote",
        model_provider=None,
        model_name=None,
        message_count=1,
        messages=[InspectMessage(role="user", text="hello")],
    )
    assert SessionInspectResult.model_validate_json(result.model_dump_json()) == result
    with pytest.raises(ValidationError):
        InspectMessage.model_validate({"role": "human", "text": "hello"})


def test_rpc_success_carries_ping_result() -> None:
    ping = Ping(type="system.ping", nonce="abc")
    success = RpcSuccess(result=ping.model_dump(mode="json"), id="req-1")
    restored = RpcSuccess.model_validate_json(success.model_dump_json())
    assert restored.result == {"type": "system.ping", "nonce": "abc"}


def test_trace_span_result_without_the_context_fields_validates() -> None:
    result = TraceSpanResult.model_validate(
        {"span": {"id": "m1", "kind": "model", "name": "model 1", "start": "t", "status": "ok"}}
    )
    assert result.context is None and result.system_sections is None


def test_a_context_part_with_an_unknown_key_is_rejected() -> None:
    with pytest.raises(ValidationError):
        TraceContextPart.model_validate({"key": "memory", "tokens": 1, "chars": 4})


def _summary(**extra: object) -> SessionSummary:
    return SessionSummary.model_validate(
        {
            "session_id": "s1",
            "model_profile": "local",
            "status": "waiting",
            "created_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-01-01T00:00:00Z",
            "last_seq": 3,
            **extra,
        }
    )


def test_pending_item_and_summary_round_trip() -> None:
    item = PendingItem(
        kind="approval",
        since="2026-01-01T00:00:01Z",
        call_id="c1",
        name="edit_file",
        subject="a.py",
        source="built-in default",
        added=2,
        removed=1,
    )
    assert PendingItem.model_validate_json(item.model_dump_json()) == item
    summary = _summary(pending=item.model_dump())
    assert SessionSummary.model_validate_json(summary.model_dump_json()) == summary
    consent = PendingItem(kind="consent", since="t", alternatives=3)
    assert PendingItem.model_validate_json(consent.model_dump_json()) == consent


def test_summary_pending_defaults_to_none() -> None:
    assert _summary().pending is None


def test_pending_item_refuses_unknown_fields_and_negative_counts() -> None:
    with pytest.raises(ValidationError):
        PendingItem.model_validate({"kind": "consent", "since": "t", "diff": "x"})
    for field in ("added", "removed", "alternatives"):
        with pytest.raises(ValidationError):
            PendingItem.model_validate({"kind": "approval", "since": "t", field: -1})


def test_agents_list_and_get_round_trip() -> None:
    info = AgentInfo(
        name="explorer",
        description="Reads and searches, returns paths and lines.",
        origin="bundled",
        wish="cheapest",
        tools=["read_file", "grep"],
        limits=AgentLimits(max_calls=15, max_seconds=300),
        shadowed=["user"],
        used=4,
        finished=3,
    )
    listed = AgentsListResult(agents=[info])
    assert AgentsListResult.model_validate_json(listed.model_dump_json()) == listed
    got = AgentsGetResult(**info.model_dump(), prompt="Find it.")
    assert AgentsGetResult.model_validate_json(got.model_dump_json()) == got
    list_params = AgentsListParams(cwd="/work")
    assert AgentsListParams.model_validate_json(list_params.model_dump_json()) == list_params
    get_params = AgentsGetParams(name="explorer")
    assert AgentsGetParams.model_validate_json(get_params.model_dump_json()) == get_params


def test_agent_info_defaults_and_nullable_finished() -> None:
    info = AgentInfo.model_validate(
        {"name": "worker", "description": "", "origin": "project", "wish": "same"}
    )
    assert info.tools == [] and info.errors == [] and info.shadowed == []
    assert info.limits == AgentLimits()
    assert info.trusted is True and info.used == 0 and info.finished is None


def test_agents_reject_bad_input() -> None:
    base = {"name": "x", "description": "", "wish": "same"}
    with pytest.raises(ValidationError):
        AgentInfo.model_validate({**base, "origin": "plugin"})
    with pytest.raises(ValidationError):
        AgentInfo.model_validate({**base, "origin": "user", "used": -1})
    with pytest.raises(ValidationError):
        AgentsGetParams.model_validate({"name": ""})
    with pytest.raises(ValidationError):
        AgentsListParams.model_validate({"cwd": "/w", "extra": 1})


def test_agent_registry_changed_notification() -> None:
    note = AgentRegistryChangedNotification(params=AgentRegistryChanged(root="/work"))
    assert note.method == "agent.registry.changed"
    assert AgentRegistryChangedNotification.model_validate_json(note.model_dump_json()) == note
    assert AgentRegistryChanged().root is None
