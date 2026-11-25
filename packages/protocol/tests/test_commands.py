from typing import Any

import pytest
from pydantic import BaseModel, ValidationError

from golem_protocol.commands import (
    AgentInfo,
    AgentLimits,
    AgentRegistryChanged,
    AgentsGetParams,
    AgentsGetResult,
    AgentsKeepParams,
    AgentsKeepResult,
    AgentsKeepValues,
    AgentsListParams,
    AgentsListResult,
    AgentsSetDefaultLimitsParams,
    AgentsSetLimitsParams,
    AgentsSetLimitsResult,
    AgentsSetWishParams,
    AgentsSetWishResult,
    ApprovalRespondParams,
    DaemonStatus,
    HelloParams,
    HelloResult,
    HelpersRespondParams,
    HelpersRespondResult,
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
    PendingHelper,
    PendingItem,
    PingParams,
    SessionInspectResult,
    SessionSummary,
    TraceContextPart,
    TraceSpanResult,
    WishResolution,
    WorkflowCancelParams,
    WorkflowEntryInfo,
    WorkflowGetResult,
    WorkflowOutlineStep,
    WorkflowRunEvent,
    WorkflowRunInfo,
    WorkflowStartParams,
    WorkflowStartResult,
    WorkflowStatusParams,
    WorkflowStatusResult,
    WorkflowStepEvent,
    WorkflowStepInfo,
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
    WorkflowRunDoneNotification,
    WorkflowRunResumedNotification,
    WorkflowStepInDoubtNotification,
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


def test_helpers_respond_round_trips_and_refuses_bad_input() -> None:
    params = HelpersRespondParams(session_id="s1", call_id="call_1", run=False)
    assert HelpersRespondParams.model_validate_json(params.model_dump_json()) == params
    result = HelpersRespondResult(run_id="r1")
    assert HelpersRespondResult.model_validate_json(result.model_dump_json()) == result
    with pytest.raises(ValidationError):
        HelpersRespondParams.model_validate({"session_id": "s1", "call_id": "call_1"})
    with pytest.raises(ValidationError):
        HelpersRespondParams.model_validate({"session_id": "s1", "call_id": "", "run": True})
    with pytest.raises(ValidationError):
        HelpersRespondParams.model_validate(
            {"session_id": "s1", "call_id": "c", "run": True, "extra": 1}
        )
    with pytest.raises(ValidationError):
        HelpersRespondResult.model_validate({})


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
    got = AgentsGetResult.model_validate({**info.model_dump(), "prompt": "Find it."})
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


def test_agent_wish_resolution_round_trip_and_optional() -> None:
    plain = AgentInfo.model_validate(
        {"name": "worker", "description": "", "origin": "user", "wish": "same"}
    )
    assert plain.resolves_to is None
    res = WishResolution(
        model="qwen3:8b", tier="local", reason="Cheapest model you have.", fresh_window=True
    )
    info = AgentInfo(name="w", description="", origin="user", wish="cheapest", resolves_to=res)
    assert AgentInfo.model_validate_json(info.model_dump_json()) == info
    assert WishResolution.model_validate({}) == WishResolution()
    with pytest.raises(ValidationError):
        WishResolution.model_validate({"tier": "free"})
    with pytest.raises(ValidationError):
        WishResolution.model_validate({"reason": "x" * 201})
    with pytest.raises(ValidationError):
        WishResolution.model_validate({"model": ""})


def test_agents_set_wish_round_trip_and_limits() -> None:
    params = AgentsSetWishParams(name="explorer", wish="qwen3:8b", cwd="/work")
    assert AgentsSetWishParams.model_validate_json(params.model_dump_json()) == params
    assert AgentsSetWishParams(name="a", wish="stronger").cwd is None
    result = AgentsSetWishResult(name="a", description="", origin="user", wish="stronger")
    assert AgentsSetWishResult.model_validate_json(result.model_dump_json()) == result
    for bad in (
        {"name": "", "wish": "same"},
        {"name": "a", "wish": ""},
        {"name": "a", "wish": "x" * 201},
        {"name": "a", "wish": "same", "extra": 1},
    ):
        with pytest.raises(ValidationError):
            AgentsSetWishParams.model_validate(bad)


def test_agents_set_limits_round_trip_and_clear() -> None:
    params = AgentsSetLimitsParams(name="worker", max_calls=5, max_cost=0.5, clear=["max_tokens"])
    assert AgentsSetLimitsParams.model_validate_json(params.model_dump_json()) == params
    bare = AgentsSetLimitsParams(name="worker")
    assert (bare.max_calls, bare.clear, bare.cwd) == (None, [], None)
    for bad in ({"name": ""}, {"name": "a", "clear": ["max_seconds"]}, {"name": "a", "x": 1}):
        with pytest.raises(ValidationError):
            AgentsSetLimitsParams.model_validate(bad)
    both = AgentsSetDefaultLimitsParams(working_seconds=60, clear=["max_calls"])
    assert AgentsSetDefaultLimitsParams.model_validate_json(both.model_dump_json()) == both
    info = AgentsSetLimitsResult(
        name="a", description="", origin="user", wish="same", limits_from_config=["max_calls"]
    )
    assert AgentsSetLimitsResult.model_validate_json(info.model_dump_json()) == info
    assert AgentInfo(name="a", description="", origin="user", wish="same").limits_from_config == []
    values = AgentsKeepValues(keep_days=7, keep_problem_days=30, max_calls=4)
    assert (values.max_calls, values.max_tokens) == (4, None)


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


def test_pending_consent_helper_fields_round_trip_and_are_bounded() -> None:
    item = PendingItem(
        kind="consent",
        since="t",
        alternatives=2,
        helper_id="h1",
        agent="reviewer",
        label="Review",
        sent=["the brief"],
        not_sent=["this chat"],
    )
    assert PendingItem.model_validate_json(item.model_dump_json()) == item
    assert PendingItem(kind="consent", since="t").sent is None
    with pytest.raises(ValidationError):
        PendingItem(kind="consent", since="t", sent=["x"] * 11)
    with pytest.raises(ValidationError):
        PendingItem(kind="consent", since="t", not_sent=["x" * 121])


def test_pending_items_plain_helper_and_grouped_round_trip() -> None:
    plain = PendingItem(kind="approval", since="t1", call_id="c1", name="shell", subject="ls")
    helper = PendingItem(
        kind="approval",
        since="t2",
        call_id="c2",
        name="shell",
        subject="uv lock",
        helper=PendingHelper(session_id="h1", agent="worker", label="lock", index=0),
    )
    grouped = helper.model_copy(update={"count": 5})
    summary = _summary(
        pending=plain.model_dump(), pending_items=[i.model_dump() for i in (plain, helper, grouped)]
    )
    again = SessionSummary.model_validate_json(summary.model_dump_json())
    assert again == summary
    assert again.pending_items == [plain, helper, grouped]
    assert again.pending_items[2].count == 5
    assert again.pending_items[1].helper is not None
    assert again.pending_items[1].helper.agent == "worker"


def test_summary_without_pending_items_validates() -> None:
    summary = _summary(pending=PendingItem(kind="consent", since="t").model_dump())
    assert summary.pending_items == []
    assert SessionSummary.model_validate_json(summary.model_dump_json()) == summary


def test_pending_item_new_field_limits() -> None:
    with pytest.raises(ValidationError):
        PendingItem.model_validate({"kind": "approval", "since": "t", "count": 1})
    with pytest.raises(ValidationError):
        PendingHelper.model_validate({"session_id": "h", "agent": "a", "index": -1})
    with pytest.raises(ValidationError):
        PendingHelper.model_validate(
            {"session_id": "h", "agent": "a", "index": 0, "label": "x" * 121}
        )
    with pytest.raises(ValidationError):
        PendingHelper.model_validate({"session_id": "h", "agent": "a", "index": 0, "extra": 1})
    with pytest.raises(ValidationError):
        _summary(pending_items=[{"kind": "other", "since": "t"}])


def test_approval_respond_scope() -> None:
    base = {"session_id": "s", "call_id": "c"}
    assert ApprovalRespondParams.model_validate({**base, "decision": "allow"}).scope is None
    for decision in ("allow", "allow_session", "deny"):
        params = ApprovalRespondParams.model_validate(
            {**base, "decision": decision, "scope": "batch"}
        )
        assert params.scope == "batch"
        assert ApprovalRespondParams.model_validate_json(params.model_dump_json()) == params
    with pytest.raises(ValidationError):
        ApprovalRespondParams.model_validate({**base, "decision": "allow", "scope": "all"})
    with pytest.raises(ValidationError):
        ApprovalRespondParams.model_validate(
            {**base, "decision": "allow", "scope": "batch", "args": {}}
        )


def test_batch_pending_item_round_trips_in_pending_items() -> None:
    batch = PendingItem(
        kind="batch",
        since="t3",
        call_id="c9",
        helper_count=3,
        agents=["explorer", "explorer", "worker"],
    )
    own = PendingItem(kind="approval", since="t4", call_id="c1", name="shell", subject="ls")
    summary = _summary(
        pending=own.model_dump(), pending_items=[batch.model_dump(), own.model_dump()]
    )
    again = SessionSummary.model_validate_json(summary.model_dump_json())
    assert again == summary
    assert again.pending_items[0].helper_count == 3
    assert again.pending_items[0].agents == ["explorer", "explorer", "worker"]
    assert PendingItem(kind="approval", since="t").helper_count is None


def test_old_pending_field_never_holds_a_batch() -> None:
    batch = PendingItem(kind="batch", since="t", call_id="c9", helper_count=2, agents=["a", "b"])
    with pytest.raises(ValidationError):
        _summary(pending=batch.model_dump())
    summary = _summary(pending_items=[batch.model_dump()])
    assert summary.pending is None
    # what an older client reads is `pending`, and it holds no batch
    assert summary.model_dump(mode="json")["pending"] is None
    with pytest.raises(ValidationError):
        PendingItem.model_validate({"kind": "batch", "since": "t", "helper_count": 0})


def test_use_helpers_setting_values() -> None:
    assert AgentsKeepParams().use_helpers is None
    assert AgentsKeepParams(use_helpers="ask").use_helpers == "ask"
    with pytest.raises(ValidationError):
        AgentsKeepParams.model_validate({"use_helpers": "always"})
    values = AgentsKeepValues(keep_days=7, keep_problem_days=30)
    assert values.use_helpers == "when_needed"
    never = AgentsKeepValues(keep_days=7, keep_problem_days=30, use_helpers="never")
    assert AgentsKeepValues.model_validate_json(never.model_dump_json()) == never
    result = AgentsKeepResult(ok=True, values=never)
    assert AgentsKeepResult.model_validate_json(result.model_dump_json()) == result


def test_workflow_commands_name_the_run_workflow_run_id() -> None:
    assert WorkflowStartParams(id="/w/a.py::pr_digest").trigger == "manual"
    assert WorkflowStartResult(workflow_run_id="wr1").workflow_run_id == "wr1"
    for model in (WorkflowStatusParams, WorkflowCancelParams):
        assert model(workflow_run_id="wr1").workflow_run_id == "wr1"
        with pytest.raises(ValidationError):
            model.model_validate({"run_id": "wr1"})
    with pytest.raises(ValidationError):
        WorkflowStartParams.model_validate({"id": "x", "trigger": "file"})


def test_workflow_status_round_trips_with_its_steps() -> None:
    run = WorkflowRunInfo(
        workflow_run_id="wr1", workflow_id="a::b", name="b", status="waiting", trigger="manual"
    )
    step = WorkflowStepInfo(
        key="review#1", kind="review", title="Open these?", status="in_doubt", attempts=2
    )
    result = WorkflowStatusResult(run=run, steps=[step])
    assert WorkflowStatusResult.model_validate_json(result.model_dump_json()) == result
    with pytest.raises(ValidationError):
        WorkflowRunInfo.model_validate({**run.model_dump(), "status": "queued"})
    with pytest.raises(ValidationError):
        WorkflowStepInfo.model_validate({**step.model_dump(), "kind": "shell"})


def test_workflow_get_carries_the_outline() -> None:
    entry = WorkflowEntryInfo(id="p::b", name="b", path="p", state="broken", error="Traceback")
    outline = WorkflowOutlineStep(
        id="s1", kind="agent", title="Review", agent="reviewer", lines=(3, 5)
    )
    result = WorkflowGetResult(workflow=entry, steps=[outline])
    again = WorkflowGetResult.model_validate_json(result.model_dump_json())
    assert again.steps[0].lines == (3, 5)
    assert again.workflow.inputs == []


def test_workflow_events_never_use_the_run_words() -> None:
    done = WorkflowRunDoneNotification(
        params=WorkflowRunEvent(workflow_run_id="wr1", workflow_id="a::b", name="b", status="done")
    )
    assert done.method == "workflow.run.done"
    assert (
        "run_id" not in done.model_dump()["params"]
        or "workflow_run_id" in done.model_dump()["params"]
    )
    assert WorkflowRunResumedNotification.model_fields["method"].default == "workflow.run.resumed"
    doubt = WorkflowStepInDoubtNotification(
        params=WorkflowStepEvent(
            workflow_run_id="wr1",
            key="k",
            kind="tool",
            title="Open PR",
            status="in_doubt",
            group="g",
            attempts=1,
        )
    )
    assert doubt.method == "workflow.step.in_doubt"
    assert doubt.params.child_session_id is None


def test_batch_estimate_fields_are_optional_and_round_trip() -> None:
    plain = PendingItem(kind="batch", since="t", call_id="c1", helper_count=5)
    assert plain.estimate_usd is None and plain.cheaper_model is None
    card = PendingItem(
        kind="batch",
        since="t",
        call_id="c1",
        helper_count=5,
        estimate_usd=0.6,
        allowed_usd=2.0,
        ask_over_usd=0.5,
        model="claude-sonnet",
        cheaper_model="claude-haiku",
    )
    assert PendingItem.model_validate_json(card.model_dump_json()) == card
    with pytest.raises(ValidationError):
        PendingItem.model_validate({"kind": "batch", "since": "t", "estimate_usd": -1})
    with pytest.raises(ValidationError):
        PendingItem.model_validate({"kind": "batch", "since": "t", "model": ""})


def test_helpers_respond_cheaper_needs_run() -> None:
    assert HelpersRespondParams(session_id="s", call_id="c", run=True).cheaper is False
    cheaper = HelpersRespondParams(session_id="s", call_id="c", run=True, cheaper=True)
    assert HelpersRespondParams.model_validate_json(cheaper.model_dump_json()) == cheaper
    with pytest.raises(ValidationError):
        HelpersRespondParams(session_id="s", call_id="c", run=False, cheaper=True)
