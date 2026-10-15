"""``ClientConnection`` queue order, flush, overflow, and a peer that went away."""

from __future__ import annotations

import asyncio
import json

import pytest

from golem.server.connection import ClientConnection
from golem_protocol.rpc import RpcSuccess


class _Transport:
    def __init__(self) -> None:
        self.aborted = False

    def abort(self) -> None:
        self.aborted = True


class _Writer:
    """A stream whose ``drain`` waits on ``open`` and can fail."""

    def __init__(self) -> None:
        self._transport = _Transport()
        self.lines: list[dict[str, object]] = []
        self.open = asyncio.Event()
        self.open.set()
        self.fail = False

    @property
    def transport(self) -> _Transport:
        return self._transport

    def write(self, data: bytes) -> None:
        if self.fail:
            raise BrokenPipeError
        self.lines.append(json.loads(data))

    async def drain(self) -> None:
        await self.open.wait()


def _frame(request_id: int) -> RpcSuccess:
    return RpcSuccess(id=request_id, result={})


async def test_frames_go_out_in_queue_order() -> None:
    writer = _Writer()
    connection = ClientConnection(writer)
    connection.enqueue(_frame(1))
    await connection.send(_frame(2))
    connection.enqueue(_frame(3))
    await connection.flush(1.0)
    assert [line["id"] for line in writer.lines] == [1, 2, 3]
    connection.close()


async def test_flush_gives_up_after_the_timeout() -> None:
    writer = _Writer()
    writer.open.clear()
    connection = ClientConnection(writer)
    connection.enqueue(_frame(1))
    connection.enqueue(_frame(2))
    await connection.flush(0.01)
    assert len(writer.lines) == 1
    connection.close()


async def test_a_full_queue_aborts_the_connection() -> None:
    writer = _Writer()
    writer.open.clear()
    connection = ClientConnection(writer, max_pending=2)
    connection.enqueue(_frame(1))
    await asyncio.sleep(0)
    connection.enqueue(_frame(2))
    connection.enqueue(_frame(3))
    with pytest.raises(ConnectionResetError):
        connection.enqueue(_frame(4))
    assert writer.transport.aborted
    assert connection.closed
    with pytest.raises(ConnectionResetError):
        connection.enqueue(_frame(5))
    connection.close()


async def test_a_peer_that_went_away_closes_the_connection() -> None:
    writer = _Writer()
    writer.fail = True
    connection = ClientConnection(writer)
    connection.enqueue(_frame(1))
    connection.enqueue(_frame(2))
    await connection.flush(1.0)
    assert connection.closed
    with pytest.raises(ConnectionResetError):
        connection.enqueue(_frame(3))
    connection.close()
