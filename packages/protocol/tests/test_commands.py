from typing import Any

import pytest
from pydantic import BaseModel, ValidationError

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
    HelperStopParams,
    HelperStopResult,
    InspectMessage,
    ListedProvider,
    LocalServer,
    MemoryChanged,
    MemoryCounts,
    MemoryDeleteParams,
    MemoryDeleteResult,
    MemoryExportParams,
    MemoryExportResult,
    MemoryGetParams,
    MemoryGetResult,
    MemoryItem,
    MemoryListParams,
    MemoryListResult,
    MemorySettings,
    MemorySettingsParams,
    MemorySettingsResult,
    MemorySource,
    MemoryUpdateParams,
    MemoryUpdateResult,
    MemoryWriteParams,
    MemoryWriteResult,
    ModelBenchDone,
    ModelBenchParams,
    ModelBenchProgress,
    ModelBenchResult,
    ModelBenchRow,
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
    MemoryChangedNotification,
    ModelBenchDoneNotification,
    ModelBenchProgressNotification,
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


def test_summary_wait_fields_are_optional_and_round_trip() -> None:
    old = _summary(status="running")
    assert (old.wait_reason, old.wait_line) == (None, None)
    queued = _summary(status="running", wait_reason="slot", wait_line="qwen3:14b")
    assert SessionSummary.model_validate_json(queued.model_dump_json()) == queued
    assert (queued.wait_reason, queued.wait_line) == ("slot", "qwen3:14b")
    with pytest.raises(ValidationError):
        _summary(wait_reason="nonsense")
    with pytest.raises(ValidationError):
        _summary(wait_line="")


def test_summary_helper_fields_are_optional_and_round_trip() -> None:
    old = _summary()
    assert (old.helpers_running, old.helpers_waiting, old.step) == (None, None, None)
    lead = _summary(helpers_running=2, helpers_waiting=1)
    assert SessionSummary.model_validate_json(lead.model_dump_json()) == lead
    assert (lead.helpers_running, lead.helpers_waiting) == (2, 1)
    helper = _summary(parent_session_id="s1", agent="explorer", step="3 lines")
    assert SessionSummary.model_validate_json(helper.model_dump_json()) == helper
    assert _summary(step="x" * 200).step == "x" * 200
    with pytest.raises(ValidationError):
        _summary(step="x" * 201)
    with pytest.raises(ValidationError):
        _summary(step="")
    with pytest.raises(ValidationError):
        _summary(helpers_running=-1)


def test_helper_stop_round_trips_and_refuses_bad_input() -> None:
    params = HelperStopParams(session_id="h1")
    assert HelperStopParams.model_validate_json(params.model_dump_json()) == params
    for stopped in (True, False):
        result = HelperStopResult(stopped=stopped)
        assert HelperStopResult.model_validate_json(result.model_dump_json()) == result
    with pytest.raises(ValidationError):
        HelperStopParams.model_validate({"session_id": ""})
    with pytest.raises(ValidationError):
        HelperStopParams.model_validate({"session_id": "h1", "extra": 1})
    with pytest.raises(ValidationError):
        HelperStopResult.model_validate({})


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


def test_summary_names_its_parent_and_agent() -> None:
    summary = SessionSummary(
        session_id="s_helper",
        model_profile="remote",
        status="idle",
        created_at="t",
        updated_at="t",
        last_seq=3,
        parent_session_id="s_lead",
        agent="explorer",
    )
    assert SessionSummary.model_validate_json(summary.model_dump_json()) == summary


def test_summary_written_before_parent_and_agent_still_validates() -> None:
    old = {
        "session_id": "s_old",
        "model_profile": "remote",
        "status": "idle",
        "created_at": "t",
        "updated_at": "t",
        "last_seq": 1,
    }
    summary = SessionSummary.model_validate(old)
    assert summary.parent_session_id is None and summary.agent is None
    with pytest.raises(ValidationError):
        SessionSummary.model_validate({**old, "agent": ""})


def _memory_item(**changes: Any) -> MemoryItem:
    fields: dict[str, Any] = {
        "id": "m_1",
        "scope": "project",
        "title": "We use pnpm",
        "text": "We use pnpm here.",
        "author": "you",
        "state": "kept",
        "created_at": "2026-11-19T10:00:00+00:00",
        "updated_at": "2026-11-19T10:00:00+00:00",
        "folder": "/repo",
        "kept_by": "you",
        "sources": [
            MemorySource(
                path="package.json",
                sha256="ab" * 32,
                size=120,
                mtime_ns=1,
                checked_at="2026-11-19T10:00:00+00:00",
            )
        ],
    }
    return MemoryItem(**{**fields, **changes})


def _fits_schema(model: BaseModel) -> None:
    """The dump only names properties the model's JSON schema has, and has the required ones."""
    schema = type(model).model_json_schema()
    dumped = model.model_dump(mode="json")
    assert set(dumped) <= set(schema["properties"])
    assert set(schema.get("required", [])) <= set(dumped)
    assert type(model).model_validate_json(model.model_dump_json()) == model


def test_every_memory_params_and_result_round_trips_and_fits_its_schema() -> None:
    item = _memory_item()
    models: list[BaseModel] = [
        MemoryListParams(
            scope="project", folder="/repo", state="kept", query="pnpm", limit=20, after="mem_1"
        ),
        MemoryListResult(
            items=[item],
            total=1,
            counts=MemoryCounts(project=1, kept=1),
            settings=MemorySettings(history="local", auto_keep=["/repo"]),
        ),
        MemoryGetParams(id="m_1"),
        MemoryGetResult(item=item),
        MemoryWriteParams(
            scope="project", text="We use pnpm.", folder="/repo", sources=["package.json"]
        ),
        MemoryWriteResult(item=item),
        MemoryUpdateParams(id="m_1", always=True),
        MemoryUpdateParams(id="m_1", accept_sources=True),
        MemoryUpdateResult(item=item),
        MemoryDeleteParams(ids=["m_1", "m_2"]),
        MemoryDeleteResult(deleted=["m_1"], missing=["m_2"]),
        MemoryExportParams(format="markdown", scope="you"),
        MemoryExportResult(format="json", text="[]", count=0),
        MemorySettingsParams(),
        MemorySettingsParams(scope="you", privacy="local"),
        MemorySettingsResult(settings=MemorySettings()),
        MemoryChanged(id="m_1", change="stale", scope="project", folder="/repo"),
    ]
    for model in models:
        _fits_schema(model)


def test_a_local_memory_says_whether_a_local_model_can_use_it() -> None:
    assert _memory_item().usable is None
    assert _memory_item(privacy="local", usable=False).usable is False


def test_memory_write_needs_a_folder_for_a_project_note_and_only_then() -> None:
    with pytest.raises(ValidationError):
        MemoryWriteParams(scope="project", text="x")
    with pytest.raises(ValidationError):
        MemoryWriteParams(scope="you", text="x", folder="/repo")
    with pytest.raises(ValidationError):
        MemoryWriteParams(scope="history", text="x")  # type: ignore[arg-type]
    with pytest.raises(ValidationError):
        MemoryWriteParams(scope="you", text="x" * 2001)
    with pytest.raises(ValidationError):
        MemoryWriteParams(scope="you", text="x", sources=["a"] * 21)


def test_memory_update_and_settings_refuse_empty_or_half_requests() -> None:
    with pytest.raises(ValidationError):
        MemoryUpdateParams(id="m_1")
    with pytest.raises(ValidationError):
        MemorySettingsParams(scope="you")
    with pytest.raises(ValidationError):
        MemorySettingsParams(privacy="local")
    with pytest.raises(ValidationError):
        MemorySettingsParams.model_validate({"scope": "you", "privacy": "local", "auto_keep": []})


def test_memory_changed_is_a_notification_with_the_five_changes() -> None:
    for change in ("created", "updated", "deleted", "stale", "resolved"):
        note = MemoryChangedNotification(params=MemoryChanged(id="m_1", change=change, scope="you"))  # type: ignore[arg-type]
        assert note.method == "memory.changed"
        assert MemoryChangedNotification.model_validate_json(note.model_dump_json()) == note
        assert note.params.folder is None
    with pytest.raises(ValidationError):
        MemoryChanged(id="m_1", change="moved", scope="you")  # type: ignore[arg-type]


def test_model_bench_types_round_trip() -> None:
    params = ModelBenchParams(ref="ollama/qwen3:8b", engine="ollama")
    assert ModelBenchParams.model_validate_json(params.model_dump_json()) == params
    assert ModelBenchParams(ref="ollama/qwen3:8b").engine is None
    result = ModelBenchResult(ref="ollama/qwen3:8b", started=True)
    assert ModelBenchResult.model_validate_json(result.model_dump_json()) == result
    row = ModelBenchRow(shape="tools", at_once=2, each=[31.5, 29.0], total=60.5, window=8.2)
    assert ModelBenchRow.model_validate_json(row.model_dump_json()) == row
    progress = ModelBenchProgress(ref="ollama/qwen3:8b", index=1, total=8, row=row)
    assert ModelBenchProgress.model_validate_json(progress.model_dump_json()) == progress
    done = ModelBenchDone(ref="ollama/qwen3:8b", ok=True, rows=[row])
    assert ModelBenchDone.model_validate_json(done.model_dump_json()) == done
    assert ModelBenchDone(ref="ollama/qwen3:8b", ok=False, error="hosted model").rows == []


def test_model_bench_refuses_a_bad_row_or_params() -> None:
    with pytest.raises(ValidationError):
        ModelBenchRow(shape="chat", at_once=1, each=[1.0], total=1.0, window=1.0)  # type: ignore[arg-type]
    with pytest.raises(ValidationError):
        ModelBenchRow(shape="tools", at_once=0, each=[], total=0, window=0)
    with pytest.raises(ValidationError):
        ModelBenchParams(ref="ab")
    with pytest.raises(ValidationError):
        ModelBenchParams(ref="ollama/qwen3:8b", engine="")


def test_model_bench_notifications() -> None:
    row = ModelBenchRow(shape="prompt", at_once=1, each=[40.0], total=40.0, window=3.0)
    progress = ModelBenchProgressNotification(
        params=ModelBenchProgress(ref="ollama/qwen3:8b", index=1, total=8, row=row)
    )
    assert progress.method == "model.bench.progress"
    assert (
        ModelBenchProgressNotification.model_validate_json(progress.model_dump_json()) == progress
    )
    done = ModelBenchDoneNotification(
        params=ModelBenchDone(ref="ollama/qwen3:8b", ok=True, rows=[row])
    )
    assert done.method == "model.bench.done"
    assert ModelBenchDoneNotification.model_validate_json(done.model_dump_json()) == done
