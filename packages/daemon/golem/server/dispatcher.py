"""JSON-RPC dispatch. Handlers run as tasks so a later phase can stream events."""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, field
from typing import Any, cast

from pydantic import BaseModel, ValidationError

from golem.server.state import DaemonState
from golem_protocol.rpc import RpcErrorBody, RpcFailure, RpcRequest, RpcSuccess

log = logging.getLogger("golem.server")

PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602
INTERNAL_ERROR = -32603
PROTOCOL_MISMATCH = -32001
HELLO_REQUIRED = -32002

DRAIN_TIMEOUT_SECONDS = 5.0


class RpcCallError(Exception):
    """A handler rejected the call with a JSON-RPC error."""

    def __init__(self, code: int, message: str, data: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.data = data


class ClientConnection:
    """One accepted socket."""

    def __init__(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        self.reader = reader
        self.writer = writer
        self.welcomed = False
        self._write_lock = asyncio.Lock()

    async def send(self, model: BaseModel) -> None:
        payload = model.model_dump_json().encode("utf-8") + b"\n"
        async with self._write_lock:
            self.writer.write(payload)
            await self.writer.drain()


@dataclass(frozen=True, slots=True)
class RequestContext:
    """What a handler may touch."""

    state: DaemonState
    connection: ClientConnection


@dataclass(frozen=True, slots=True)
class Method:
    """A typed command handler."""

    name: str
    params_model: type[BaseModel]
    requires_hello: bool
    call: Callable[..., Awaitable[BaseModel]]


def _empty_tasks() -> set[asyncio.Task[None]]:
    return set()


@dataclass
class Dispatcher:
    """Routes one NDJSON line to a :class:`Method` and writes the response."""

    methods: Mapping[str, Method]
    _tasks: set[asyncio.Task[None]] = field(default_factory=_empty_tasks)

    def spawn(self, state: DaemonState, connection: ClientConnection, raw: bytes) -> None:
        task = asyncio.create_task(self._dispatch(state, connection, raw), name="golem-rpc")
        self._tasks.add(task)
        task.add_done_callback(self._finished)

    async def drain(self, timeout: float = DRAIN_TIMEOUT_SECONDS) -> None:
        """Wait for handler tasks, then cancel anything still running."""
        deadline = asyncio.get_running_loop().time() + timeout
        while self._tasks:
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                break
            await asyncio.wait(set(self._tasks), timeout=remaining)
        for task in list(self._tasks):
            task.cancel()
        if self._tasks:
            await asyncio.wait(set(self._tasks))

    def _finished(self, task: asyncio.Task[None]) -> None:
        self._tasks.discard(task)
        if task.cancelled():
            return
        exc = task.exception()
        if exc is not None:
            log.error("request failed", exc_info=exc)

    async def _dispatch(self, state: DaemonState, connection: ClientConnection, raw: bytes) -> None:
        try:
            await self._handle(state, connection, raw)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("unhandled request error")

    async def _handle(self, state: DaemonState, connection: ClientConnection, raw: bytes) -> None:
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            await send_failure(connection, PARSE_ERROR, "parse error", None)
            return
        request_id = _request_id(payload)
        try:
            request = RpcRequest.model_validate(payload)
        except ValidationError:
            await send_failure(connection, INVALID_REQUEST, "invalid request", request_id)
            return
        method = self.methods.get(request.method)
        if method is None:
            await send_failure(connection, METHOD_NOT_FOUND, "method not found", request.id)
            return
        if method.requires_hello and not connection.welcomed:
            await send_failure(connection, HELLO_REQUIRED, "hello required", request.id)
            return
        raw_params: dict[str, Any] = {} if request.params is None else request.params
        try:
            params = method.params_model.model_validate(raw_params)
        except ValidationError:
            await send_failure(connection, INVALID_PARAMS, "invalid params", request.id)
            return
        ctx = RequestContext(state=state, connection=connection)
        try:
            result = await method.call(ctx, params)
        except RpcCallError as exc:
            await send_failure(connection, exc.code, str(exc), request.id, exc.data)
            return
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("handler %s failed", request.method)
            await send_failure(connection, INTERNAL_ERROR, "internal error", request.id)
            return
        success = RpcSuccess(result=result.model_dump(mode="json"), id=request.id)
        try:
            await connection.send(success)
        except (ConnectionError, OSError):
            log.debug("client went away before the response was written")


def _request_id(payload: object) -> str | int | None:
    if not isinstance(payload, dict):
        return None
    raw = cast(dict[str, object], payload)
    request_id = raw.get("id")
    if isinstance(request_id, bool) or not isinstance(request_id, str | int):
        return None
    return request_id


async def send_failure(
    connection: ClientConnection,
    code: int,
    message: str,
    request_id: str | int | None,
    data: dict[str, Any] | None = None,
) -> None:
    failure = RpcFailure(
        error=RpcErrorBody(code=code, message=message, data=data),
        id=request_id,
    )
    try:
        await connection.send(failure)
    except (ConnectionError, OSError):
        log.debug("client went away before the error was written")
