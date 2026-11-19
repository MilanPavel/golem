"""The dispatcher: one order decides how many model calls run at once.

It keeps a line for each local model, one for each hosted provider and one for
heavy shell commands. A call holds one slot of one line for one model call
(ADR-060). Waiting calls are served by class, then by arrival, and a call that
has waited long moves up a class. The module holds no engine code. It reads an
engine profile (data) for ``max_loaded`` and nothing else, and it never asks an
engine anything, so a setup with no local model makes only provider lines.

The clock and the sleep are passed in, so a test runs on a fake clock.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import AsyncGenerator, Awaitable, Callable, Mapping
from contextlib import asynccontextmanager, suppress
from dataclasses import dataclass, field
from typing import Literal

from golem.models.engine import OLLAMA, EngineProfile

log = logging.getLogger(__name__)

Role = Literal["chat", "helper", "job"]
Kind = Literal["local", "provider", "shell"]
Reason = Literal["slot", "provider"]

CLASSES = 5  # 0 a chat you look at ... 4 a job
AGE_STEP = 60.0  # seconds of waiting that move a call up one class
NOTICE_AFTER = 1.0  # a wait shorter than this tells nobody
NOTICE_EVERY = 1.0  # position changes are told at most this often
BACKOFF_BASE = 2.0
BACKOFF_MAX = 60.0


@dataclass(frozen=True, slots=True)
class LineKey:
    """Which line a call uses. Build one with ``local``, ``provider`` or ``shell``."""

    kind: Kind
    name: str = ""  # the model for a local line, the provider name for a provider line
    engine: str = ""
    server: str = ""

    @classmethod
    def local(cls, engine: str, server: str, model: str) -> LineKey:
        return cls("local", model, engine, server)

    @classmethod
    def provider(cls, name: str) -> LineKey:
        return cls("provider", name)

    @classmethod
    def shell(cls) -> LineKey:
        return cls("shell")

    def __str__(self) -> str:
        if self.kind == "local":
            return f"local:{self.engine}:{self.server}:{self.name}"
        if self.kind == "provider":
            return f"provider:{self.name}"
        return "shell"


@dataclass(frozen=True, slots=True)
class Call:
    """One model call, or one shell command, that wants a slot.

    ``arrived`` is kept by a retry, so the call does not lose its place.
    """

    line: LineKey
    session_id: str | None
    role: Role
    label: str
    arrived: float | None = None


@dataclass(frozen=True, slots=True)
class Wait:
    """What a waiting call is told. ``position`` 1 is next."""

    reason: Reason
    position: int
    holder: str | None
    line: str
    retry_in: float | None = None


@dataclass(frozen=True, slots=True)
class Grant:
    """A slot. ``waited`` is the seconds the call waited for it; ``arrived`` is for a retry."""

    call: Call
    waited: float
    arrived: float


@dataclass(frozen=True, slots=True)
class Holder:
    label: str
    session_id: str | None
    role: Role


@dataclass(frozen=True, slots=True)
class Waiting:
    label: str
    session_id: str | None
    role: Role
    position: int
    effective_class: int


@dataclass(frozen=True, slots=True)
class LineState:
    """One line as the Activity panel shows it."""

    line: str
    kind: Kind
    slots: int
    holders: tuple[Holder, ...]
    waiting: tuple[Waiting, ...]
    retry_in: float | None


@dataclass(eq=False)
class _Entry:
    """A call that waits or runs."""

    call: Call
    arrived: float
    started: float  # when this hold began, for ``Grant.waited``
    future: asyncio.Future[None]
    changed: asyncio.Event = field(default_factory=asyncio.Event)
    granted_at: float = 0.0
    told: bool = False  # the watcher has called ``on_wait``, so the end needs a None


class _Line:
    def __init__(self, key: LineKey, slots: int) -> None:
        self.key = key
        self.slots = slots
        self.running: list[_Entry] = []
        self.backoff_until = 0.0
        self.refusals = 0


class Dispatcher:
    """Lines, one order, aging and a live slot count. See ADR-060, sections 1, 2, 3, 5 and 9."""

    def __init__(
        self,
        rank_of: Callable[[Call], int],
        *,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        local_slots: int = 1,
        provider_slots: int = 4,
        shell_slots: int = 1,
        profiles: Mapping[str, EngineProfile] | None = None,
    ) -> None:
        self._rank_of = rank_of
        self._clock = clock
        self._sleep = sleep
        self._default_slots: dict[Kind, int] = {
            "local": local_slots,
            "provider": provider_slots,
            "shell": shell_slots,
        }
        if min(self._default_slots.values()) < 1:
            raise ValueError("slots must be at least 1")
        self._profiles = {OLLAMA.id: OLLAMA} if profiles is None else dict(profiles)
        self._lines: dict[LineKey, _Line] = {}
        self._waiting: list[_Entry] = []
        self._timers: dict[LineKey, asyncio.Task[None]] = {}

    # --- the public surface -------------------------------------------------

    @asynccontextmanager
    async def hold(
        self, call: Call, on_wait: Callable[[Wait | None], None] | None = None
    ) -> AsyncGenerator[Grant]:
        """Wait for a slot of ``call.line``, hold it for the block, give it back after.

        ``on_wait`` gets a ``Wait`` once the call has waited 1 s, again when its
        position changes (at most once a second), and ``None`` when it has its turn
        or leaves. A wait of 1 s or less calls nothing.
        """
        now = self._clock()
        entry = _Entry(
            call,
            now if call.arrived is None else call.arrived,
            now,
            asyncio.get_running_loop().create_future(),
        )
        self._line(call.line)
        self._waiting.append(entry)
        self._dispatch()
        watcher = None
        if not entry.future.done() and on_wait is not None:
            watcher = asyncio.create_task(self._watch(entry, on_wait))
        try:
            await entry.future
        except BaseException:
            if entry.future.done() and not entry.future.cancelled():
                # The slot was handed over as the wait was cancelled. Pass it on.
                self._release(entry)
            else:
                with suppress(ValueError):
                    self._waiting.remove(entry)
                self._dispatch()
            raise
        finally:
            if watcher is not None:
                watcher.cancel()  # not awaited: that would swallow a cancel of this task
            if entry.told and on_wait is not None:
                on_wait(None)
        try:
            yield Grant(call, self._clock() - entry.started, entry.arrived)
        finally:
            self._release(entry)

    def set_slots(self, line: LineKey, n: int) -> None:
        """A new slot count, live. A higher count takes effect at once.

        A running call keeps its slot, so a lower count takes effect as calls end.
        """
        if n < 1:
            raise ValueError("slots must be at least 1")
        self._line(line).slots = n
        self._dispatch()

    def refused(self, line: LineKey, retry_after: float | None = None) -> None:
        """A provider refused a call: the line backs off.

        The wait is max(retry-after, 2 s x 2^(n-1)), at most 60 s, with n the
        refusals in a row. A refusal that lands while the line is already backing
        off belongs to the same burst and does not count again.
        """
        state = self._line(line)
        now = self._clock()
        if now >= state.backoff_until:
            state.refusals += 1
            wait = max(retry_after or 0.0, BACKOFF_BASE * 2 ** (state.refusals - 1))
            state.backoff_until = now + min(wait, BACKOFF_MAX)
        elif retry_after:
            state.backoff_until = max(
                state.backoff_until, min(now + retry_after, now + BACKOFF_MAX)
            )
        self._dispatch()

    def succeeded(self, line: LineKey) -> None:
        """A call on the line went through: the run of refusals ends."""
        self._line(line).refusals = 0

    def snapshot(self) -> list[LineState]:
        """Every line made so far: its slots, who holds them and who waits."""
        now = self._clock()
        order = self._ordered(now)
        states: list[LineState] = []
        for key, state in self._lines.items():
            waiting = [e for e in order if e.call.line == key]
            states.append(
                LineState(
                    str(key),
                    key.kind,
                    self._capacity(state),
                    tuple(
                        Holder(e.call.label, e.call.session_id, e.call.role) for e in state.running
                    ),
                    tuple(
                        Waiting(
                            e.call.label,
                            e.call.session_id,
                            e.call.role,
                            i,
                            self._effective(e, now),
                        )
                        for i, e in enumerate(waiting, 1)
                    ),
                    _remaining(state, now),
                )
            )
        return states

    # --- lines and capacity -------------------------------------------------

    def _line(self, key: LineKey) -> _Line:
        line = self._lines.get(key)
        if line is None:
            line = self._lines[key] = _Line(key, self._default_slots[key.kind])
        return line

    def _profile(self, key: LineKey) -> EngineProfile | None:
        return self._profiles.get(key.engine) if key.kind == "local" else None

    def _capacity(self, line: _Line) -> int:
        profile = self._profile(line.key)
        return 1 if profile is not None and profile.at_once == "serial" else line.slots

    def _server_lines(self, key: LineKey) -> list[_Line]:
        return [
            line
            for k, line in self._lines.items()
            if k.kind == "local" and k.engine == key.engine and k.server == key.server
        ]

    def _admissible(self, entry: _Entry, now: float) -> bool:
        """Does the line, and for a local model the server, have room for this call?"""
        key = entry.call.line
        line = self._lines[key]
        if len(line.running) >= self._capacity(line) or now < line.backoff_until:
            return False
        if key.kind != "local":
            return True
        profile = self._profile(key)
        max_loaded = 1 if profile is None else profile.max_loaded
        siblings = self._server_lines(key)
        running = sum(len(s.running) for s in siblings)
        if running >= max_loaded * max(self._capacity(s) for s in siblings):
            return False
        return self._is_loaded(key) or sum(1 for s in siblings if s.running) < max_loaded

    def _is_loaded(self, key: LineKey) -> bool:
        """A model counts as loaded while a call of it runs. The dispatcher asks no engine."""
        return bool(self._lines[key].running)

    # --- the order ----------------------------------------------------------

    def _effective(self, entry: _Entry, now: float) -> int:
        rank = min(max(self._rank_of(entry.call), 0), CLASSES - 1)
        return max(0, rank - int((now - entry.arrived) // AGE_STEP))

    def _ordered(self, now: float) -> list[_Entry]:
        """The waiters in the order they would be served: class, loaded before swap, arrival.

        A swap steps behind calls for a loaded model only for its first ``AGE_STEP``
        seconds. After that it goes by arrival, so a steady stream of calls for the
        loaded model cannot keep it waiting for ever.
        """
        keyed = [
            (self._effective(e, now), self._swap_penalty(e, now), e.arrived, i, e)
            for i, e in enumerate(self._waiting)
        ]
        keyed.sort(key=lambda k: k[:4])
        return [k[4] for k in keyed]

    def _swap_penalty(self, entry: _Entry, now: float) -> int:
        if self._is_loaded(entry.call.line) or now - entry.arrived >= AGE_STEP:
            return 0
        return 1

    def _dispatch(self) -> None:
        """Give a slot to every waiter that can have one, best first."""
        now = self._clock()
        # A waiter cancelled a moment ago has not left the list yet. It must not get a slot.
        self._waiting = [e for e in self._waiting if not e.future.done()]
        granted = True
        while granted:
            granted = False
            draining: set[tuple[str, str]] = set()  # servers where a swap is waiting its turn
            for entry in self._ordered(now):
                key = entry.call.line
                server = (key.engine, key.server)
                if key.kind == "local" and server in draining:
                    continue
                if self._admissible(entry, now):
                    self._grant(entry, now)
                    granted = True
                    break
                if key.kind == "local" and not self._is_loaded(key):
                    # A swap waits for a loaded model to run dry. No later call may keep
                    # that model busy, or the swap never comes.
                    draining.add(server)
        for line in self._lines.values():
            waits = any(e.call.line == line.key for e in self._waiting)
            if waits and now < line.backoff_until and line.key not in self._timers:
                self._timers[line.key] = asyncio.create_task(self._wake(line.key, line))
        for entry in self._waiting:
            entry.changed.set()

    def _grant(self, entry: _Entry, now: float) -> None:
        self._waiting.remove(entry)
        entry.granted_at = now
        self._lines[entry.call.line].running.append(entry)
        entry.future.set_result(None)

    def _release(self, entry: _Entry) -> None:
        self._lines[entry.call.line].running.remove(entry)
        self._dispatch()

    async def _wake(self, key: LineKey, line: _Line) -> None:
        """Look at the line again when its backoff ends."""
        try:
            await self._sleep(max(0.0, line.backoff_until - self._clock()))
        finally:
            self._timers.pop(key, None)
        self._dispatch()

    # --- telling a waiter ---------------------------------------------------

    def _wait_of(self, entry: _Entry) -> Wait:
        now = self._clock()
        key = entry.call.line
        line = self._lines[key]
        ahead = [e for e in self._ordered(now) if e.call.line == key]
        holder = min(line.running, key=lambda e: e.granted_at).call.label if line.running else None
        return Wait(
            "provider" if key.kind == "provider" else "slot",
            ahead.index(entry) + 1,
            holder,
            key.name if key.kind != "shell" else "shell",
            _remaining(line, now),
        )

    async def _watch(self, entry: _Entry, on_wait: Callable[[Wait | None], None]) -> None:
        """Tell ``on_wait`` after 1 s, then on a position change, once a second at most."""
        await self._sleep(NOTICE_AFTER)
        last: tuple[object, ...] | None = None
        last_at = 0.0
        while True:
            entry.changed.clear()
            if entry.future.done():
                return  # it got its turn, or left, while this task slept
            wait = self._wait_of(entry)
            seen = (wait.reason, wait.position, wait.holder)
            if seen != last:
                gap = self._clock() - last_at
                if last is not None and gap < NOTICE_EVERY:
                    await self._sleep(NOTICE_EVERY - gap)
                    continue
                last, last_at = seen, self._clock()
                entry.told = True
                try:
                    on_wait(wait)
                except Exception:
                    log.exception("on_wait failed")
            await entry.changed.wait()


def _remaining(line: _Line, now: float) -> float | None:
    return line.backoff_until - now if now < line.backoff_until else None


__all__ = [
    "BACKOFF_MAX",
    "Call",
    "Dispatcher",
    "Grant",
    "Holder",
    "LineKey",
    "LineState",
    "Role",
    "Wait",
    "Waiting",
]
