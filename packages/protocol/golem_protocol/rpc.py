"""JSON-RPC 2.0 envelopes. One object per NDJSON line."""

from typing import Annotated, Any, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field

from golem_protocol.events import ChatEvent


def _reject_bool_id(value: object) -> object:
    if isinstance(value, bool):
        raise ValueError("id must be a string or integer")
    return value


RpcId = Annotated[str | int, BeforeValidator(_reject_bool_id)]


class RpcRequest(BaseModel):
    """Client → daemon request. ``id`` is required; notifications are not accepted."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    jsonrpc: Literal["2.0"]
    method: str = Field(min_length=1)
    params: dict[str, Any] | None = None
    id: RpcId


class RpcErrorBody(BaseModel):
    """JSON-RPC error object."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    code: int
    message: str
    data: dict[str, Any] | None = None


class RpcSuccess(BaseModel):
    """Successful response. ``result`` is the handler model dumped as JSON."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    jsonrpc: Literal["2.0"] = "2.0"
    result: dict[str, Any]
    id: RpcId


class RpcFailure(BaseModel):
    """Error response. ``id`` is null when the request id could not be read."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    jsonrpc: Literal["2.0"] = "2.0"
    error: RpcErrorBody
    id: RpcId | None = None


class RpcNotification(BaseModel):
    """Server → client event. No ``id``; this is not a response to a request."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    jsonrpc: Literal["2.0"] = "2.0"
    method: Literal["event"] = "event"
    params: ChatEvent


__all__ = [
    "RpcErrorBody",
    "RpcFailure",
    "RpcId",
    "RpcNotification",
    "RpcRequest",
    "RpcSuccess",
]
