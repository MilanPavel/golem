"""The routine scheduler (ADR-050): firings on a fake clock, busy and missed runs, sessions."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import pytest
from fakes import ToolCallingChatModel
from langgraph.checkpoint.memory import InMemorySaver
from pydantic import BaseModel

from golem.graphs.chat import open_chat
from golem.models.router import ModelRouter
from golem.permissions.policy import Policy
from golem.routine_scheduler import (
    Planned,
    RoutineBlockedError,
    RoutineBusyError,
    RoutineNotFoundError,
    RoutineScheduler,
)
from golem.server.routine_launch import SessionLauncher, folder_of, skill_of
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.manager import SessionManager
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem.store.routine_runs import RoutineRuns
from golem.tools.registry import Tool, ToolContext, ToolRegistry, ToolResult
from golem_protocol.events import SessionCompletedData, SessionCompletedEvent

ZONE = ZoneInfo("Europe/Prague")
START = datetime(2026, 2, 6, 9, 0, tzinfo=ZONE)  # a Friday


class Clock:
    def __init__(self, now: datetime = START) -> None:
        self.now = now

    def __call__(self) -> datetime:
        return self.now

    def to(self, hour: int, minute: int = 0, second: int = 0) -> None:
        self.now = self.now.replace(hour=hour, minute=minute, second=second)


class FakeLauncher:
    """Makes session ids and remembers what it was asked. Nothing runs."""

    def __init__(self) -> None:
        self.created: list[str] = []
        self.sent: list[tuple[str, str]] = []
        self.fail_create = False

    async def create(self, routine: Planned) -> str:
        if self.fail_create:
            raise RuntimeError("no such model")
        self.created.append(routine.name)
        return f"s_{len(self.created)}"

    async def send(self, routine: Planned, session_id: str) -> None:
        self.sent.append((session_id, routine.settings.prompt))


def _write(home: Path, *tables: str, trusted: list[Path] | None = None) -> Path:
    path = home / "config.toml"
    head = ""
    if trusted is not None:
        head = "trusted_projects = [" + ", ".join(f'"{p}"' for p in trusted) + "]\n"
    path.write_text(head + "\n".join(tables), encoding="utf-8")
    return path


def _routine(name: str, schedule: str, **extra: str) -> str:
    keys = "".join(f'{key} = "{value}"\n' for key, value in extra.items())
    return f'[[routine]]\nname = "{name}"\nschedule = "{schedule}"\nprompt = "Go."\n{keys}'


class Rig:
    def __init__(self, database: Database, home: Path, clock: Clock) -> None:
        self.runs = RoutineRuns(database)
        self.launcher = FakeLauncher()
        self.clock = clock
        self.sent: list[Any] = []
        self.home = home
        self.scheduler = self.new_scheduler()

    def new_scheduler(self) -> RoutineScheduler:
        return RoutineScheduler(
            runs=self.runs,
            launcher=self.launcher,
            user_file=self.home / "config.toml",
            broadcast=self.sent.append,
            now=self.clock,
            zone=ZONE,
        )

    def methods(self) -> list[tuple[str, str]]:
        return [
            (note.method, str(note.params.model_dump().get("status", "")))  # type: ignore[attr-defined]
            for note in self.sent
        ]

    async def rows(self, name: str, scope: str = "user") -> list[Any]:
        return list(reversed(await self.runs.recent(name, scope)))

    def complete(
        self, session_id: str, status: str = "completed", summary: str | None = "ok"
    ) -> None:
        self.scheduler.on_event(
            SessionCompletedEvent(
                seq=1,
                session_id=session_id,
                run_id="r_1",
                ts=self.clock().isoformat(),
                type="session.completed",
                data=SessionCompletedData(run_id="r_1", status=status, summary=summary),  # type: ignore[arg-type]
            )
        )


async def _settle(scheduler: RoutineScheduler) -> None:
    await scheduler.drain()
    await scheduler.aclose()


@pytest.fixture
def rig(database: Database, tmp_path: Path) -> Rig:
    return Rig(database, tmp_path, Clock())


async def test_a_routine_fires_once_at_its_time(rig: Rig) -> None:
    _write(rig.home, _routine("brief", "daily 09:30"))
    await rig.scheduler.tick()
    assert rig.launcher.created == []

    rig.clock.to(9, 30, 5)
    await rig.scheduler.tick()
    await rig.scheduler.tick()  # the same minute again fires nothing more

    assert rig.launcher.created == ["brief"]
    assert rig.launcher.sent == [("s_1", "Go.")]
    (row,) = await rig.rows("brief")
    assert (row.trigger, row.status, row.session_id) == ("schedule", "running", "s_1")
    assert row.due_at == "2026-02-06T08:30:00+00:00"
    assert rig.methods() == [("routine.fired", "")]


async def test_a_session_that_ends_closes_the_firing_and_says_so(rig: Rig) -> None:
    _write(rig.home, _routine("brief", "daily 09:30"))
    await rig.scheduler.tick()
    rig.clock.to(9, 30)
    await rig.scheduler.tick()

    rig.complete("s_1", summary="Three PRs need you.")
    await _settle(rig.scheduler)

    (row,) = await rig.rows("brief")
    assert (row.status, row.summary) == ("succeeded", "Three PRs need you.")
    assert row.ended_at is not None
    assert rig.methods() == [("routine.fired", ""), ("routine.finished", "succeeded")]


async def test_a_failed_session_ends_the_firing_failed(rig: Rig) -> None:
    _write(rig.home, _routine("brief", "daily 09:30"))
    await rig.scheduler.tick()
    rig.clock.to(9, 30)
    await rig.scheduler.tick()
    rig.complete("s_1", status="failed", summary=None)
    await _settle(rig.scheduler)
    (row,) = await rig.rows("brief")
    assert row.status == "failed"


async def test_a_busy_routine_records_a_skip_and_does_not_pile_up(rig: Rig) -> None:
    _write(rig.home, _routine("triage", "every 15m"))
    await rig.scheduler.tick()
    rig.clock.to(9, 15)
    await rig.scheduler.tick()  # fires; nobody answers it
    rig.clock.to(9, 30)
    await rig.scheduler.tick()
    rig.clock.to(9, 45)
    await rig.scheduler.tick()

    assert rig.launcher.created == ["triage"]
    first, second, third = await rig.rows("triage")
    assert first.status == "running"
    assert (second.status, second.reason, second.session_id) == ("skipped", "still running", None)
    assert third.reason == "still running"
    assert rig.methods() == [
        ("routine.fired", ""),
        ("routine.finished", "skipped"),
        ("routine.finished", "skipped"),
    ]

    rig.complete("s_1")
    await rig.scheduler.drain()
    rig.clock.to(10, 0)
    await rig.scheduler.tick()
    assert rig.launcher.created == ["triage", "triage"]
    await _settle(rig.scheduler)


async def test_after_a_gap_skip_records_one_missed_run(rig: Rig) -> None:
    _write(rig.home, _routine("triage", "every 15m"))
    await rig.scheduler.tick()
    rig.clock.to(14, 0, 10)  # the Mac slept for five hours
    await rig.scheduler.tick()

    assert rig.launcher.created == []
    (row,) = await rig.rows("triage")
    assert (row.status, row.reason, row.trigger) == ("skipped", "missed", "schedule")
    assert rig.methods() == [("routine.finished", "skipped")]

    rig.clock.to(14, 15, 3)  # and the next time is on time again
    await rig.scheduler.tick()
    assert rig.launcher.created == ["triage"]


async def test_after_a_gap_run_once_fires_once(rig: Rig) -> None:
    _write(rig.home, _routine("report", "every 15m", missed="run_once"))
    await rig.scheduler.tick()
    rig.clock.to(14, 0, 10)
    await rig.scheduler.tick()
    await rig.scheduler.tick()

    assert rig.launcher.created == ["report"]
    (row,) = await rig.rows("report")
    assert (row.trigger, row.status) == ("schedule", "running")
    assert row.due_at == "2026-02-06T08:15:00+00:00"


async def test_a_restart_finds_the_missed_run_in_the_table(rig: Rig) -> None:
    _write(rig.home, _routine("brief", "every 15m"))
    await rig.scheduler.tick()
    rig.clock.to(9, 15)
    await rig.scheduler.tick()
    rig.complete("s_1")
    await rig.scheduler.drain()
    await rig.scheduler.aclose()

    rig.clock.to(12, 0)  # the daemon was down; a new one starts
    again = rig.new_scheduler()
    await again.tick()
    await again.tick()

    rows = await rig.rows("brief")
    assert [(r.status, r.reason) for r in rows] == [("succeeded", None), ("skipped", "missed")]
    assert rig.launcher.created == ["brief"]


async def test_a_new_routine_does_not_fire_for_times_before_it_existed(rig: Rig) -> None:
    _write(rig.home, _routine("old", "daily 03:00"))
    await rig.scheduler.tick()
    _write(rig.home, _routine("old", "daily 03:00"), _routine("new", "daily 08:00"))
    await rig.scheduler.tick()
    assert await rig.rows("new") == []
    assert rig.launcher.created == []


async def test_a_changed_file_is_planned_again_without_a_restart(rig: Rig) -> None:
    _write(rig.home, _routine("brief", "daily 10:00"))
    await rig.scheduler.tick()
    _write(rig.home, _routine("brief", "daily 09:30"))
    rig.scheduler.reload()
    await rig.scheduler.tick()
    (routine,) = [Planned(r) for r in _loaded(rig)]
    assert rig.scheduler.next_at(routine) == datetime(2026, 2, 6, 9, 30, tzinfo=ZONE)

    _write(rig.home)  # the routine is gone
    await rig.scheduler.tick()
    assert rig.scheduler.next_at(routine) is None


def _loaded(rig: Rig) -> list[Any]:
    from golem.routine_files import read_routines

    return read_routines(rig.home / "config.toml").routines


async def test_a_disabled_routine_does_not_fire(rig: Rig) -> None:
    _write(rig.home, _routine("brief", "daily 09:30") + "enabled = false\n")
    await rig.scheduler.tick()
    rig.clock.to(9, 30)
    await rig.scheduler.tick()
    assert rig.launcher.created == []


async def test_a_project_routine_fires_only_in_a_trusted_folder(rig: Rig, tmp_path: Path) -> None:
    project = (tmp_path / "proj").resolve()
    (project / ".golem").mkdir(parents=True)
    (project / ".golem" / "config.toml").write_text(
        _routine("nightly", "daily 09:30"), encoding="utf-8"
    )
    _write(rig.home)
    await rig.scheduler.tick()
    rig.clock.to(9, 30)
    await rig.scheduler.tick()
    assert rig.launcher.created == []

    rig.clock.to(9, 0)
    _write(rig.home, trusted=[project])
    await rig.scheduler.tick()
    rig.clock.to(9, 30)
    await rig.scheduler.tick()
    assert rig.launcher.created == ["nightly"]
    (row,) = await rig.runs.recent("nightly", str(project))
    assert row.scope == str(project)


async def test_a_manual_run_fires_now_and_obeys_busy_and_trust(rig: Rig, tmp_path: Path) -> None:
    _write(rig.home, _routine("brief", "daily 09:30"))
    run_id, session_id = await rig.scheduler.run("brief")
    assert session_id == "s_1"
    row = await rig.runs.get(run_id)
    assert row is not None and (row.trigger, row.due_at) == ("manual", None)
    assert rig.methods() == [("routine.fired", "")]
    assert rig.sent[0].params.trigger == "manual"  # type: ignore[attr-defined]

    with pytest.raises(RoutineBusyError):
        await rig.scheduler.run("brief")
    with pytest.raises(RoutineNotFoundError):
        await rig.scheduler.run("nope")
    with pytest.raises(RoutineBlockedError):
        await rig.scheduler.run("brief", tmp_path / "elsewhere")


async def test_a_session_that_cannot_start_ends_the_firing_failed(rig: Rig) -> None:
    _write(rig.home, _routine("brief", "daily 09:30"))
    rig.launcher.fail_create = True
    with pytest.raises(RuntimeError):
        await rig.scheduler.run("brief")
    (row,) = await rig.rows("brief")
    assert (row.status, row.reason) == ("failed", "no such model")
    assert rig.methods() == [("routine.finished", "failed")]


async def test_the_loop_sleeps_until_the_next_time_and_fires(rig: Rig) -> None:
    _write(rig.home, _routine("brief", "daily 09:30"))
    naps: list[float] = []
    fired = asyncio.Event()

    async def sleep(seconds: float) -> None:
        naps.append(seconds)
        rig.clock.now += timedelta(seconds=seconds)
        if rig.launcher.created:
            fired.set()
        await asyncio.sleep(0)

    scheduler = RoutineScheduler(
        runs=rig.runs,
        launcher=rig.launcher,
        user_file=rig.home / "config.toml",
        broadcast=rig.sent.append,
        now=rig.clock,
        sleep=sleep,
        zone=ZONE,
    )
    scheduler.start()
    async with asyncio.timeout(3):
        await fired.wait()
    await scheduler.aclose()
    assert naps[0] == 60.0  # never longer than a minute
    assert all(nap <= 60.0 for nap in naps)
    assert rig.launcher.created == ["brief"]


async def test_the_start_ends_a_firing_whose_session_finished_while_down(
    rig: Rig, database: Database
) -> None:
    run_id = await rig.runs.start("brief", "user", "schedule", None, START.isoformat())
    await rig.runs.attach(run_id, "s_x")
    await rig.runs.start("lost", "user", "manual", None, START.isoformat())
    async with database.transaction() as tx:
        await tx.execute(
            "INSERT INTO sessions (session_id, model_profile, created_at, updated_at)"
            " VALUES ('s_x', 'm', 't', 't')"
        )
        await tx.execute(
            "INSERT INTO runs (run_id, session_id, status, started_at) VALUES"
            " ('r_x', 's_x', 'completed', 't')"
        )
    await rig.scheduler.reconcile()
    done = await rig.runs.get(run_id)
    assert done is not None and done.status == "succeeded"
    assert [r.status for r in await rig.runs.recent("lost", "user")] == ["failed"]


# A firing in a real session manager.


class _NoArgs(BaseModel):
    pass


def _registry() -> ToolRegistry:
    async def run(args: _NoArgs, ctx: ToolContext) -> ToolResult:
        del args, ctx
        return ToolResult(output="ran", summary="ran")

    return ToolRegistry(
        [Tool(name="ask_tool", description="asks", args=_NoArgs, run=run, read_only=False)]
    )


class Live:
    """A session manager with fake models, a scheduler over it, and a fake clock."""

    def __init__(self, database: Database, home: Path, replies: list[Any]) -> None:
        router = ModelRouter(model=ToolCallingChatModel(replies=replies))
        runtime = open_chat(router, InMemorySaver(), _registry(), Policy(None, home=home))
        self.router = router
        self.bus = EventBus()
        self.records = SessionRecords(database)
        self.manager = SessionManager(
            runtime,
            SessionLog(EventLog(database), self.bus, self.records),
            self.records,
            RunRecords(database),
        )
        self.runs = RoutineRuns(database)
        self.clock = Clock()
        self.sent: list[Any] = []
        self.home = home
        self.scheduler = RoutineScheduler(
            runs=self.runs,
            launcher=SessionLauncher(self.manager, None),
            user_file=home / "config.toml",
            broadcast=self.sent.append,
            now=self.clock,
            zone=ZONE,
        )
        self.bus.observe(self.scheduler.on_event)

    async def until(self, check: Callable[[], Awaitable[bool]]) -> None:
        async with asyncio.timeout(3):
            while not await check():
                await asyncio.sleep(0.01)


async def test_a_firing_makes_a_session_with_origin_folder_model_and_servers(
    database: Database, tmp_path: Path
) -> None:
    work = tmp_path / "work"
    work.mkdir()
    live = Live(database, tmp_path, ["Three PRs need you."])
    _write(
        tmp_path,
        _routine("brief", "daily 09:30", model=live.router.profile_name, folder=str(work))
        + 'mcp = ["linear"]\n',
    )
    await live.scheduler.tick()
    live.clock.to(9, 30)
    await live.scheduler.tick()

    (row,) = await live.runs.recent("brief", "user")
    assert row.session_id is not None
    record = await live.records.get(row.session_id)
    assert record is not None
    assert record.origin == "routine:brief"
    assert record.cwd == str(work)
    assert record.model_profile == live.router.profile_name
    assert record.mcp_servers == ("linear",)

    async def ended() -> bool:
        got = await live.runs.get(row.routine_run_id)
        return got is not None and got.status != "running"

    await live.until(ended)
    got = await live.runs.get(row.routine_run_id)
    assert got is not None
    assert (got.status, got.summary) == ("succeeded", "Three PRs need you.")
    assert [n.method for n in live.sent] == ["routine.fired", "routine.finished"]
    await live.scheduler.aclose()


async def test_a_firing_that_asks_for_an_approval_reads_as_waiting(
    database: Database, tmp_path: Path
) -> None:
    live = Live(database, tmp_path, [[("ask_tool", {})], "all done"])
    _write(tmp_path, _routine("brief", "daily 09:30"))
    await live.scheduler.tick()
    live.clock.to(9, 30)
    await live.scheduler.tick()
    (row,) = await live.runs.recent("brief", "user")

    async def waiting() -> bool:
        got = await live.runs.get(row.routine_run_id)
        return got is not None and got.status == "waiting"

    await live.until(waiting)
    got = await live.runs.get(row.routine_run_id)
    assert got is not None and got.ended_at is None
    # A waiting firing holds the next one.
    live.clock.to(9, 31)
    with pytest.raises(RoutineBusyError):
        await live.scheduler.run("brief")
    await live.scheduler.aclose()


async def test_a_session_that_cannot_be_made_is_a_failed_firing(
    database: Database, tmp_path: Path
) -> None:
    live = Live(database, tmp_path, ["hi"])
    _write(tmp_path, _routine("brief", "daily 09:30", model="no-such-model"))
    with pytest.raises(Exception, match="no-such-model"):
        await live.scheduler.run("brief")
    (row,) = await live.runs.recent("brief", "user")
    assert row.status == "failed" and "no-such-model" in (row.reason or "")


def test_a_slash_prompt_goes_through_the_skill_path() -> None:
    call = skill_of("/brief the inbox, please")
    assert call is not None and (call.name, call.args) == ("brief", "the inbox, please")
    bare = skill_of("/brief")
    assert bare is not None and (bare.name, bare.args) == ("brief", "")
    assert skill_of("Summarise the inbox.") is None


def test_a_routine_folder_is_its_own_or_the_projects(tmp_path: Path) -> None:
    from golem.config import RoutineSettings

    plain = RoutineSettings(name="a", schedule="daily 08:00", prompt="x")
    inside = RoutineSettings(name="a", schedule="daily 08:00", prompt="x", folder="sub")
    assert folder_of(Planned(plain)) is None
    assert folder_of(Planned(plain, tmp_path)) == str(tmp_path)
    assert folder_of(Planned(inside, tmp_path)) == str(tmp_path / "sub")
