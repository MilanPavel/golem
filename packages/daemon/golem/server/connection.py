"""One accepted socket and its outbound queue.

Responses and events share the queue, so the wire order is the order they
were queued in. A writer task drains it. A client that falls too far behind
is dropped: it reconnects and attaches again from the last ``seq`` it saw.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from typing import Protocol

from pydantic import BaseModel

from golem_protocol.commands import SessionSummary
from golem_protocol.events import ChatEvent
from golem_protocol.rpc import RpcNotification, SessionSummaryNotification

log = logging.getLogger("golem.server")

MAX_PENDING_FRAMES = 20_000


class _Abortable(Protocol):
    def abort(self) -> None: ...


class StreamOut(Protocol):
    """The part of :class:`asyncio.StreamWriter` a connection writes through."""

    @property
    def transport(self) -> _Abortable: ...

    def write(self, data: bytes) -> None: ...

    async def drain(self) -> None: ...


class ClientConnection:
    """Queues frames for one client. Never blocks the caller on the socket."""

    def __init__(self, writer: StreamOut, *, max_pending: int = MAX_PENDING_FRAMES) -> None:
        self.welcomed = False
        self._writer = writer
        self._max_pending = max_pending
        self._queue: asyncio.Queue[bytes] = asyncio.Queue()
        self._closed = False
        self._pump = asyncio.create_task(self._write_loop(), name="golem-client-writer")

    @property
    def closed(self) -> bool:
        return self._closed

    async def send(self, model: BaseModel) -> None:
        """Queue one response. Raises :class:`ConnectionResetError` once closed."""
        self.enqueue(model)

    def deliver(self, event: ChatEvent) -> None:
        """Queue one event notification. Same errors as :meth:`enqueue`."""
        self.enqueue(RpcNotification(params=event))

    def deliver_summary(self, summary: SessionSummary) -> None:
        """Queue one ``session.summary`` notification. Same errors as :meth:`enqueue`."""
        self.enqueue(SessionSummaryNotification(params=summary))

    def enqueue(self, model: BaseModel) -> None:
        """Queue one frame.

        Raises :class:`ConnectionResetError` when the connection is closed,
        or when the queue is full. A full queue also aborts the socket.
        """
        if self._closed:
            raise ConnectionResetError("connection closed")
        if self._queue.qsize() >= self._max_pending:
            log.warning("client fell %d frames behind; dropping it", self._max_pending)
            self.abort()
            raise ConnectionResetError("outbound queue overflow")
        self._queue.put_nowait(model.model_dump_json().encode("utf-8") + b"\n")

    async def flush(self, timeout: float) -> None:
        """Wait until every queued frame is written, or ``timeout`` passes."""
        if self._pump.done():
            return
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(self._queue.join(), timeout=timeout)

    def abort(self) -> None:
        """Close now. Queued frames are dropped."""
        self._closed = True
        self._pump.cancel()
        self._writer.transport.abort()

    def close(self) -> None:
        """Stop the writer. Frames still queued are dropped."""
        self._closed = True
        self._pump.cancel()

    async def _write_loop(self) -> None:
        try:
            while True:
                payload = await self._queue.get()
                try:
                    self._writer.write(payload)
                    await self._writer.drain()
                finally:
                    self._queue.task_done()
        except (ConnectionError, OSError):
            log.debug("client went away while writing")
            self._closed = True
            _drop_queued(self._queue)


def _drop_queued(queue: asyncio.Queue[bytes]) -> None:
    while not queue.empty():
        queue.get_nowait()
        queue.task_done()


__all__ = ["MAX_PENDING_FRAMES", "ClientConnection", "StreamOut"]
