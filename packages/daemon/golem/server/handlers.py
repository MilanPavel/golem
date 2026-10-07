"""Phase 1 commands: ``hello``, ``daemon.status``, and ``ping``."""

from __future__ import annotations

import logging
import os
import time

from pydantic import BaseModel, ConfigDict

from golem import __version__
from golem.server.dispatcher import PROTOCOL_MISMATCH, Method, RequestContext, RpcCallError
from golem_protocol.commands import DaemonStatus, HelloParams, HelloResult, PingParams
from golem_protocol.events import Ping
from golem_protocol.version import PROTOCOL_MAJOR, PROTOCOL_MINOR

log = logging.getLogger("golem.server")


class _EmptyParams(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


async def _hello(ctx: RequestContext, params: HelloParams) -> HelloResult:
    if params.protocol_major != PROTOCOL_MAJOR:
        raise RpcCallError(
            PROTOCOL_MISMATCH,
            (f"protocol major mismatch: client {params.protocol_major}, daemon {PROTOCOL_MAJOR}"),
            {"client_major": params.protocol_major, "daemon_major": PROTOCOL_MAJOR},
        )
    ctx.connection.welcomed = True
    log.info("hello client=%s minor=%s", params.client, params.protocol_minor)
    return HelloResult(
        protocol_major=PROTOCOL_MAJOR,
        protocol_minor=PROTOCOL_MINOR,
        daemon_version=__version__,
    )


async def _status(ctx: RequestContext, params: _EmptyParams) -> DaemonStatus:
    del params
    return DaemonStatus(
        pid=os.getpid(),
        version=__version__,
        protocol_major=PROTOCOL_MAJOR,
        protocol_minor=PROTOCOL_MINOR,
        uptime_seconds=time.monotonic() - ctx.state.started_at,
        state=ctx.state.state,
    )


async def _ping(ctx: RequestContext, params: PingParams) -> Ping:
    del ctx
    return Ping(type="system.ping", nonce=params.nonce)


def standard_methods() -> dict[str, Method]:
    """The commands a Phase 1 daemon answers."""
    return {
        "hello": Method("hello", HelloParams, False, _hello),
        "daemon.status": Method("daemon.status", _EmptyParams, True, _status),
        "ping": Method("ping", PingParams, True, _ping),
    }
