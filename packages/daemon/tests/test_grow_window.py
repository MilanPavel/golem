"""Growing the planned window of a local model between turns (ticket 9.6.4, ADR-056)."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

import pytest
from fakes import ToolCallingChatModel
from langgraph.checkpoint.memory import InMemorySaver

from golem.config import ContextSettings, GolemSettings
from golem.graphs.chat import open_chat
from golem.models.discovery import Loaded
from golem.models.router import ModelRouter
from golem.models.window import resolve_window
from golem.models.window_plans import WindowPlans
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.manager import GROW_EVERY, GrowRefusedError, SessionManager
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem.tools import default_registry
from golem_protocol.events import (
    ContextChangedData,
    ContextChangedEvent,
    EventType,
)

MODEL = "qwen3:8b"
BIG: tuple[int | None, float | None] = (131072, 5.2)
SMALL: tuple[int | None, float | None] = (40960, 5.2)
LOAD = {"load_duration": 8_200_000_000}


class _Facts:
    def __init__(self, facts: tuple[int | None, float | None]) -> None:
        self.facts = facts

    def ollama_facts(self, model_id: str) -> tuple[int | None, float | None]:
        return self.facts


class _Router(ModelRouter):
    """An Ollama router whose chat model is a fake, and that records each num_ctx."""

    def __init__(self, fake: ToolCallingChatModel, settings: ContextSettings) -> None:
        super().__init__(GolemSettings(default_model=f"ollama/{MODEL}", context=settings))
        self.fake = fake
        self.sent: list[object] = []

    def chat_model(self, profile: str, overrides: Any = None, *, local_only: bool = False) -> Any:
        self.sent.append(super().chat_model(profile, overrides).num_ctx)  # type: ignore[attr-defined]
        return self.fake


class _Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


class _Harness:
    def __init__(
        self,
        database: Database,
        *,
        facts: tuple[int | None, float | None] = BIG,
        ram_gb: float = 20.0,
        settings: ContextSettings | None = None,
        note: Callable[[str, int | None], Awaitable[Loaded]] | None = None,
    ) -> None:
        held = settings or ContextSettings()
        self.database = database
        self.router = _Router(
            ToolCallingChatModel(replies=["ok"] * 6, response_metadata=LOAD), held
        )
        self.router.plans = WindowPlans(
            settings=lambda: held, discovery=_Facts(facts), ram_gb=ram_gb, cache_dir=None
        )
        runtime = open_chat(
            self.router,
            InMemorySaver(),
            default_registry(),
            window_of=lambda profile, overrides: resolve_window(
                self.router, profile, None, overrides=overrides
            ),
            note_loaded=note,
        )
        self.events = EventLog(database)
        self.log = SessionLog(self.events, EventBus(), SessionRecords(database))
        self.manager = SessionManager(
            runtime, self.log, SessionRecords(database), RunRecords(database)
        )
        self.clock = _Clock()
        self.manager.clock = self.clock
        self.calls = 0
        self.loading: list[tuple[str | None, int | None]] = []
        emit = self.log.emit

        async def spy(session_id: str, run_id: str | None, kind: EventType, data: Any) -> Any:
            # A model.waiting event is dropped from the log once its reply completes.
            if kind == "model.waiting" and data.window is not None:
                self.loading.append((data.model, data.window))
            return await emit(session_id, run_id, kind, data)

        self.log.emit = spy  # type: ignore[method-assign]

    async def session(self, *, used: int | None, clears: int = 2, summaries: int = 0) -> str:
        """A session whose last call used ``used`` tokens, after some clears and summaries."""
        session_id = await self.manager.create(None)
        if used is not None:
            await self.seed(session_id, used)
        for _ in range(clears):
            await self.changed(session_id, "cleared")
        for _ in range(summaries):
            await self.changed(session_id, "summarised")
        return session_id

    async def seed(self, session_id: str, used: int) -> None:
        self.calls += 1
        async with self.database.transaction() as tx:
            await tx.execute(
                "INSERT INTO model_calls (call_id, session_id, run_id, role, started_at, day,"
                " input) VALUES (?, ?, 'r_seed', 'chat', ?, '2999-01-01', ?)",
                (
                    f"c_{session_id}_{self.calls}",
                    session_id,
                    f"2999-01-01T00:00:0{self.calls}Z",
                    used,
                ),
            )

    async def changed(self, session_id: str, action: str) -> None:
        data = ContextChangedData(action=action, before_tokens=900, after_tokens=300, count=3)  # type: ignore[arg-type]
        await self.log.emit(session_id, None, "context.changed", data)

    async def turn(self, session_id: str) -> None:
        run_id = await self.manager.send(session_id, "hello")

        async def done() -> bool:
            run = await RunRecords(self.database).get(run_id)
            return run is not None and run.status != "running"

        async with asyncio.timeout(5):
            while not await done():
                await asyncio.sleep(0.01)

    async def grew(self, session_id: str) -> list[ContextChangedData]:
        stored = await self.events.after(session_id, 0)
        return [
            e.data for e in stored if isinstance(e, ContextChangedEvent) and e.data.action == "grew"
        ]


async def test_a_full_session_after_two_clears_grows_once_and_says_how_long(
    database: Database,
) -> None:
    h = _Harness(database)
    session_id = await h.session(used=25000)
    await h.turn(session_id)
    assert h.router.sent[-1] == 65536
    (grew,) = await h.grew(session_id)
    assert (grew.window_from, grew.window_to, grew.reload_ms) == (32768, 65536, 8200)
    assert h.loading == [(MODEL, 65536)]
    await h.manager.cancel_all()


async def test_one_summary_is_enough(database: Database) -> None:
    h = _Harness(database)
    session_id = await h.session(used=25000, clears=0, summaries=1)
    await h.turn(session_id)
    assert len(await h.grew(session_id)) == 1
    await h.manager.cancel_all()


async def test_it_does_not_grow_without_the_cheap_means_or_a_full_window(
    database: Database,
) -> None:
    h = _Harness(database)
    few = await h.session(used=25000, clears=1)
    await h.turn(few)
    roomy = await h.session(used=5000)
    await h.turn(roomy)
    unknown = await h.session(used=None)
    await h.turn(unknown)
    assert [await h.grew(s) for s in (few, roomy, unknown)] == [[], [], []]
    assert set(h.router.sent) == {32768}
    await h.manager.cancel_all()


async def test_it_does_not_grow_twice_within_ten_minutes(database: Database) -> None:
    h = _Harness(database)
    session_id = await h.session(used=60000)
    await h.turn(session_id)
    assert h.router.sent[-1] == 65536
    await h.seed(session_id, 60000)
    h.clock.now += GROW_EVERY - 1
    await h.turn(session_id)
    assert len(await h.grew(session_id)) == 1
    assert h.router.sent[-1] == 65536
    await h.seed(session_id, 60000)
    h.clock.now += 2
    await h.turn(session_id)
    assert len(await h.grew(session_id)) == 2
    assert h.router.sent[-1] == 131072
    await h.manager.cancel_all()


async def test_it_never_grows_a_window_the_user_set(database: Database) -> None:
    number = _Harness(database, settings=ContextSettings(window=32768))
    first = await number.session(used=25000)
    await number.turn(first)
    assert await number.grew(first) == []
    assert set(number.router.sent) == {32768}

    saved = _Harness(database)
    second = await saved.session(used=25000)
    await saved.manager.set_options(second, {"num_ctx": 32768})
    await saved.turn(second)
    assert await saved.grew(second) == []
    assert set(saved.router.sent) == {32768}
    await number.manager.cancel_all()
    await saved.manager.cancel_all()


async def test_it_never_grows_when_there_is_no_next_step(database: Database) -> None:
    h = _Harness(database, facts=SMALL, ram_gb=16.0)
    session_id = await h.session(used=25000)
    await h.turn(session_id)
    assert await h.grew(session_id) == []
    assert set(h.router.sent) == {32768}
    await h.manager.cancel_all()


async def test_a_spill_after_growing_goes_back_and_does_not_grow_again(
    database: Database,
) -> None:
    async def note(profile: str, num_ctx: int | None) -> Loaded:
        return Loaded(num_ctx, 1000, 500 if num_ctx == 65536 else 1000)

    h = _Harness(database, note=note)
    session_id = await h.session(used=25000)
    await h.turn(session_id)
    assert h.router.sent[-1] == 65536
    assert h.router.plans is not None and h.router.plans.planned(MODEL) == 32768
    # A full session again, long after: the lowered window is a limit.
    await h.seed(session_id, 25000)
    h.clock.now += 3 * GROW_EVERY
    await h.turn(session_id)
    assert h.router.sent[-1] == 32768
    assert len(await h.grew(session_id)) == 1
    await h.manager.cancel_all()


async def test_grow_by_hand_needs_no_full_window_and_the_next_turn_reports_it(
    database: Database,
) -> None:
    h = _Harness(database)
    session_id = await h.session(used=1000, clears=0)
    result = await h.manager.compact(session_id, "grow", None)
    assert (result.window_from, result.window_to) == (32768, 65536)
    assert result.window == 65536 - ContextSettings().reply_reserve
    assert result.count == 0 and result.model == MODEL
    assert await h.grew(session_id) == []
    await h.turn(session_id)
    assert h.router.sent[-1] == 65536
    (grew,) = await h.grew(session_id)
    assert (grew.window_from, grew.window_to, grew.reload_ms) == (32768, 65536, 8200)
    await h.manager.cancel_all()


async def test_grow_by_hand_says_why_it_cannot(database: Database) -> None:
    mine = _Harness(database, settings=ContextSettings(window=16384))
    with pytest.raises(GrowRefusedError, match="the window is set by you"):
        await mine.manager.compact(await mine.session(used=None, clears=0), "grow", None)

    small = _Harness(database, facts=SMALL, ram_gb=16.0)
    with pytest.raises(GrowRefusedError, match=f"this Mac cannot hold a larger window for {MODEL}"):
        await small.manager.compact(await small.session(used=None, clears=0), "grow", None)
