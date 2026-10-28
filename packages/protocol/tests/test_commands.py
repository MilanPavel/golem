import pytest
from pydantic import ValidationError

from golem_protocol.commands import (
    DaemonStatus,
    HelloParams,
    HelloResult,
    InspectMessage,
    ListedProvider,
    LocalServer,
    ModelServerStatus,
    PingParams,
    SessionInspectResult,
)
from golem_protocol.events import Ping
from golem_protocol.rpc import (
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
