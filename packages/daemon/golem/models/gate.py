"""One generation at a time on a local model server.

A local Ollama serves one generation per model at a time. A second request would
queue inside it in an order golem does not control, so golem keeps the line itself:
the chat goes ahead of internal jobs such as titles.
"""

from __future__ import annotations

import asyncio
from collections import deque
from collections.abc import AsyncGenerator
from contextlib import AbstractAsyncContextManager, asynccontextmanager, suppress
from typing import Literal

Priority = Literal["chat", "job"]


class _Line:
    def __init__(self) -> None:
        self.running = 0
        self.waiters: dict[Priority, deque[asyncio.Future[None]]] = {
            "chat": deque(),
            "job": deque(),
        }

    def count(self) -> int:
        return len(self.waiters["chat"]) + len(self.waiters["job"])

    def next(self) -> asyncio.Future[None] | None:
        for priority in ("chat", "job"):
            line = self.waiters[priority]
            while line:
                waiter = line.popleft()
                if not waiter.done():
                    return waiter
        return None


class ServerGate:
    """One at a time per local server. Chat waits ahead of jobs."""

    def __init__(self, slots: int = 1) -> None:
        if slots < 1:
            raise ValueError("slots must be at least 1")
        self._slots = slots
        self._lines: dict[str, _Line] = {}

    def hold(
        self, server: str | None, priority: Priority = "chat"
    ) -> AbstractAsyncContextManager[None]:
        """Hold one slot of ``server`` (its base URL). None, a hosted model, never waits."""
        return self._hold(server, priority)

    def waiting(self, server: str) -> int:
        """How many calls wait for a slot of ``server``."""
        line = self._lines.get(server)
        return 0 if line is None else line.count()

    @asynccontextmanager
    async def _hold(self, server: str | None, priority: Priority) -> AsyncGenerator[None]:
        if server is None:
            yield
            return
        line = self._lines.setdefault(server, _Line())
        await self._acquire(line, priority)
        try:
            yield
        finally:
            self._release(line)

    async def _acquire(self, line: _Line, priority: Priority) -> None:
        if line.running < self._slots and line.count() == 0:
            line.running += 1
            return
        waiter: asyncio.Future[None] = asyncio.get_running_loop().create_future()
        line.waiters[priority].append(waiter)
        try:
            await waiter
        except BaseException:
            if waiter.done() and not waiter.cancelled():
                # The slot was handed over as the wait was cancelled. Pass it on.
                self._release(line)
            else:
                with suppress(ValueError):
                    line.waiters[priority].remove(waiter)
            raise

    def _release(self, line: _Line) -> None:
        waiter = line.next()
        if waiter is None:
            line.running -= 1
        else:
            # The slot passes to the waiter, so ``running`` stays.
            waiter.set_result(None)


__all__ = ["Priority", "ServerGate"]
