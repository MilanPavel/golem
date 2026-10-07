import pytest
from pydantic import ValidationError

from golem_protocol.commands import DaemonStatus, HelloParams, HelloResult, PingParams
from golem_protocol.events import Ping
from golem_protocol.rpc import RpcErrorBody, RpcFailure, RpcRequest, RpcSuccess


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
    )
    assert DaemonStatus.model_validate_json(status.model_dump_json()) == status
    with pytest.raises(ValidationError):
        DaemonStatus.model_validate(
            {**status.model_dump(), "state": "asleep"},
        )


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


def test_rpc_success_carries_ping_result() -> None:
    ping = Ping(type="system.ping", nonce="abc")
    success = RpcSuccess(result=ping.model_dump(mode="json"), id="req-1")
    restored = RpcSuccess.model_validate_json(success.model_dump_json())
    assert restored.result == {"type": "system.ping", "nonce": "abc"}
