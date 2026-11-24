"""The helper measurement as a job of the service (step 15.14, ticket #1707).

No test loads a model. A measurement plays through a :class:`FakeDriver` (the harness's own
``play_until_dead`` around a made-up run) or through the real chat graph with the
``ScriptedDriver``. The machine is a made-up :class:`Machine`, so no Ollama and no ``vm_stat``.
"""

from __future__ import annotations

import asyncio
import json
import sys
import tomllib
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from fakes import ToolCallingChatModel
from test_server import HELLO, RpcClient, rpc_result, start_daemon, stop_daemon

from golem.config import DelegateSettings
from golem.evals.helpers import (
    ARMS,
    Arm,
    Ask,
    Driver,
    Machine,
    OnRun,
    OnStart,
    Run,
    ScriptedDriver,
    memory_check,
    not_run,
    play_until_dead,
    serve_command,
)
from golem.evals.job import (
    EvalJobs,
    EvalParts,
    EvalRefused,
    Measurement,
    Slot,
    dump,
    verdict_of,
)
from golem.models.hardware import OVERHEAD_GB, kv_gb
from golem_protocol.commands import EvalMeasurement

GIB = 2**30
USAGE = {"input_tokens": 1_000, "output_tokens": 500, "total_tokens": 1_500}
FITS = Machine(ram_gb=64.0, free_gb=48.0, sizes={"qwen3.5:9b": 6 * GIB})


def _ask(name: str) -> Ask:
    return Ask(
        name=name,
        text=f"Say {name}.",
        facts=(name,),
        size="little",
        reason="none",
        read_tokens=1_000,
    )


ASKS = [_ask("alpha"), _ask("beta")]


class Mac:
    """What the job and the driver may read about the machine, set by the test."""

    def __init__(self) -> None:
        self.machine = FITS
        self.alive = True
        self.low = False
        self.keys = True
        self.reading: tuple[float | None, float | None] = (10.0, 64.0)


class FakeDriver:
    """The harness's ``play_until_dead`` around runs that finish at once, or wait for ``gate``."""

    def __init__(
        self,
        mac: Mac,
        gate: asyncio.Event | None = None,
        *,
        fail: bool = False,
        hold_after: int = 0,
    ) -> None:
        self.mac = mac
        self.gate = gate
        self.hold_after = hold_after
        self.fail = fail
        self.played: list[tuple[str, str, str]] = []
        self.cancelled = False
        self.began = asyncio.Event()

    def unavailable(self, arm: Arm) -> str | None:
        return None

    async def play(
        self,
        arm: Arm,
        mode: Any,
        asks: Sequence[Ask],
        project: Path,
        scratch: Path,
        on_start: OnStart | None = None,
        on_run: OnRun | None = None,
    ) -> list[Run]:
        async def one(ask: Ask) -> Run:
            self.played.append((arm.name, mode, ask.name))
            self.began.set()
            if self.gate is not None and len(self.played) > self.hold_after:
                try:
                    await self.gate.wait()
                except asyncio.CancelledError:
                    self.cancelled = True
                    raise
            base = not_run(arm, mode, ask)
            if self.fail:
                return replace(base, end="failed")
            return replace(
                base,
                end="completed",
                quality=1.0 if mode == "on" else 0.0,
                seconds=2.0,
                window_left=arm.window // 2,
            )

        return await play_until_dead(
            arm, mode, asks, one, lambda: self.mac.alive, lambda: self.mac.low, on_start, on_run
        )


class Notes:
    """The notifications of the job, by method name."""

    def __init__(self, folder: Path | None = None) -> None:
        self.items: list[tuple[str, dict[str, Any]]] = []
        self.files: list[dict[str, Any]] = []
        self.folder = folder

    def __call__(self, note: Any) -> None:
        method = note.method
        params = json.loads(note.params.model_dump_json())
        self.items.append((method, params))
        if self.folder is not None and method == "eval.progress":
            path = self.folder / f"{params['id']}.json"
            self.files.append(json.loads(path.read_text("utf-8")))

    def methods(self) -> list[str]:
        return [method for method, _ in self.items]

    def of(self, method: str) -> list[dict[str, Any]]:
        return [params for name, params in self.items if name == method]


def _jobs(
    tmp_path: Path,
    mac: Mac,
    driver: Driver,
    *,
    notes: Notes | None = None,
    delegate: DelegateSettings | None = None,
    interval: float = 60.0,
    local_model: Callable[[], Awaitable[str | None]] | None = None,
) -> EvalJobs:
    parts = EvalParts(
        driver=lambda _tight: driver,
        machine=lambda: mac.machine,
        key_found=lambda _provider: mac.keys,
        memory=lambda: mac.reading,
        alive=lambda: mac.alive,
        low=lambda: mac.low,
        asks=lambda: ASKS,
        interval=interval,
        project=tmp_path,
        local_model=local_model,
    )
    return EvalJobs(
        tmp_path / "evals",
        delegate=lambda: delegate or DelegateSettings(),
        broadcast=notes,
        clock=lambda: datetime(2026, 11, 23, 12, 0, tzinfo=UTC),
        parts=parts,
    )


def _runs(got: EvalMeasurement) -> list[tuple[str, str, str, str]]:
    return [(r.arm, r.mode, r.ask, r.end) for r in got.runs]


# --- the plan -------------------------------------------------------------------------------------


def _local(name: str = "local-32k") -> Arm:
    return next(arm for arm in ARMS if arm.name == name)


def _need_gb(arm: Arm, size_gb: float) -> float:
    return size_gb + kv_gb(arm.window, slots=1) + OVERHEAD_GB


async def test_the_plan_gives_a_verdict_to_each_local_arm(tmp_path: Path) -> None:
    mac = Mac()
    jobs = _jobs(tmp_path, mac, FakeDriver(mac))
    arm = _local()
    need = _need_gb(arm, 6.0)

    planned, running = await jobs.plan(["local-32k"])
    assert running is None
    only = planned[0]
    assert (only.verdict, only.kind, only.asks) == ("fits", "local", 2)
    assert only.needed_gb == pytest.approx(need, abs=0.01)
    assert (only.ram_gb, only.free_gb) == (64.0, 48.0)
    assert [(c.ref, c.size_gb) for c in only.choices] == [("ollama/qwen3.5:9b", 6.0)]
    assert only.minutes == pytest.approx(8.0)  # 2 asks x 2 modes x 120 s
    assert only.reason.startswith("Fits:")

    cases = {
        "tight": Machine(need / 0.6, 100.0, {"qwen3.5:9b": 6 * GIB}),
        "too_big": Machine(need / 2, 100.0, {"qwen3.5:9b": 6 * GIB}),
        "no_room": Machine(64.0, need + 1.0, {"qwen3.5:9b": 6 * GIB}),
        "unknown": Machine(64.0, 48.0, None),
    }
    for verdict, machine in cases.items():
        mac.machine = machine
        found = (await jobs.plan(["local-32k"]))[0][0]
        assert found.verdict == verdict, found.reason
        assert found.reason
    mac.machine = Machine(64.0, 48.0, {"other:1b": GIB})  # Ollama has no such model
    missing = (await jobs.plan(["local-32k"]))[0][0]
    assert missing.verdict == "unknown"
    assert "does not have qwen3.5:9b" in missing.reason


async def test_the_plan_prices_a_cloud_arm_and_notes_a_missing_key(tmp_path: Path) -> None:
    mac = Mac()
    jobs = _jobs(tmp_path, mac, FakeDriver(mac))

    planned, _ = await jobs.plan(["budget-cloud"])
    arm = planned[0]
    assert (arm.kind, arm.verdict, arm.choices, arm.needed_gb) == ("cloud", None, [], None)
    # 2 asks x (40k in x $1 + 3k out x $5) / 1M = $0.11 folding; helpers on cost 1.25x that.
    assert arm.cost_usd == pytest.approx(0.25)
    assert arm.minutes == pytest.approx(3.0)
    mac.keys = False
    reason = (await jobs.plan(["budget-cloud"]))[0][0].reason
    assert reason == "No key for anthropic. Add it in Settings \u203a Models."
    swapped = await jobs.plan(["budget-cloud"], {"budget-cloud": "anthropic/claude-sonnet-5"})
    assert swapped[0][0].model == "anthropic/claude-sonnet-5"
    assert swapped[0][0].cost_usd is None


async def test_the_plan_refuses_an_unknown_arm_or_a_model_of_the_wrong_kind(tmp_path: Path) -> None:
    mac = Mac()
    jobs = _jobs(tmp_path, mac, FakeDriver(mac))
    with pytest.raises(EvalRefused, match="no arm named nope"):
        await jobs.plan(["nope"])
    with pytest.raises(EvalRefused, match="local-32k needs an Ollama model"):
        await jobs.plan([], {"local-32k": "anthropic/claude-haiku-5-5"})
    with pytest.raises(EvalRefused, match="budget-cloud needs a hosted model"):
        await jobs.plan([], {"budget-cloud": "ollama/qwen3.5:9b"})


def test_the_verdict_has_five_values() -> None:
    arm = _local()
    assert verdict_of(memory_check(arm, Machine(64.0, 48.0, {"qwen3.5:9b": 6 * GIB}))) == "fits"
    assert verdict_of(memory_check(arm, Machine(None, 48.0, {"qwen3.5:9b": 6 * GIB}))) == "unknown"


# --- start and the events -------------------------------------------------------------------------


async def test_a_measurement_runs_in_order_and_ends_with_a_proposal(tmp_path: Path) -> None:
    mac = Mac()
    notes = Notes(tmp_path / "evals")
    driver = FakeDriver(mac)
    jobs = _jobs(tmp_path, mac, driver, notes=notes)

    started = await jobs.start(["local-32k"])
    first = jobs.get(started)
    assert first is not None and first.state == "running"
    assert {r.end for r in first.runs} <= {"pending", "running"}
    await jobs.wait()

    assert notes.methods() == [
        "eval.started",
        *["eval.progress"] * 8,
        "eval.ended",
    ]
    progress = notes.of("eval.progress")
    assert [(p["state"], p["mode"], p["ask"], p["index"]) for p in progress] == [
        ("running", "off", "alpha", 1),
        ("completed", "off", "alpha", 1),
        ("running", "off", "beta", 2),
        ("completed", "off", "beta", 2),
        ("running", "on", "alpha", 3),
        ("completed", "on", "alpha", 3),
        ("running", "on", "beta", 4),
        ("completed", "on", "beta", 4),
    ]
    assert {p["total"] for p in progress} == {4}
    assert notes.of("eval.started")[0]["total"] == 4
    assert notes.of("eval.ended") == [{"id": started, "state": "done", "stop_reason": None}]

    # The file holds each run as soon as its progress is sent: after the n-th end, n runs.
    ends = [i for i, p in enumerate(progress) if p["state"] == "completed"]
    for count, index in enumerate(ends, start=1):
        slots = notes.files[index]["slots"]
        assert sum(1 for s in slots if s["run"] is not None) == count
    assert notes.files[0]["state"] == "running"

    done = jobs.get(started)
    assert done is not None and done.state == "done" and done.ended_at is not None
    assert [r.end for r in done.runs] == ["completed"] * 4
    assert done.runs[0].quality == 0.0 and done.runs[2].quality == 1.0
    assert done.runs[0].window_left == pytest.approx(0.5)
    assert done.proposal is not None and done.proposal.pairs == 2
    numbers = {n.key: n for n in done.proposal.numbers}
    assert numbers["fill_share"].measured and numbers["fill_share"].proposed == 0.05
    assert not numbers["read_share"].measured
    assert numbers["read_share"].current == DelegateSettings().read_share
    assert done.cost_usd is None and done.in_use is False
    assert [s.proposes for s in jobs.summaries()] == [1]


async def test_a_local_run_sends_the_memory_every_few_seconds(tmp_path: Path) -> None:
    mac = Mac()
    notes = Notes()
    gate = asyncio.Event()
    driver = FakeDriver(mac, gate)
    jobs = _jobs(tmp_path, mac, driver, notes=notes, interval=0.01)

    await jobs.start(["local-32k"])
    await driver.began.wait()
    readings: list[dict[str, Any]] = []
    for _ in range(100):
        readings = [p for p in notes.of("eval.progress") if p["memory_used_gb"] is not None]
        if len(readings) >= 2:
            break
        await asyncio.sleep(0.01)
    assert len(readings) >= 2
    assert (readings[0]["memory_used_gb"], readings[0]["memory_total_gb"]) == (10.0, 64.0)
    assert {(p["state"], p["ask"], p["mode"]) for p in readings} == {("running", "alpha", "off")}
    gate.set()
    await jobs.wait()
    after = len(notes.of("eval.progress"))
    await asyncio.sleep(0.05)
    assert len(notes.of("eval.progress")) == after  # the readings stopped with the run


async def test_low_memory_in_the_middle_of_a_run_stops_the_measurement(tmp_path: Path) -> None:
    mac = Mac()
    driver = FakeDriver(mac, asyncio.Event())  # the first run never ends by itself
    jobs = _jobs(tmp_path, mac, driver, interval=0.01)
    started = await jobs.start(["local-32k"])
    await driver.began.wait()
    mac.low = True
    await asyncio.wait_for(jobs.wait(), 5)
    got = jobs.get(started)
    assert got is not None and got.state == "stopped"
    assert got.stop_reason == "The Mac is running low on memory."
    assert driver.cancelled
    assert {r.end for r in got.runs} == {"not_run"}


def test_without_a_project_the_asks_about_a_repo_are_left_out(tmp_path: Path) -> None:
    about_repo = replace(ASKS[0], name="repo-x", needs_project=True)
    jobs = EvalJobs(
        tmp_path / "evals",
        delegate=DelegateSettings,
        broadcast=None,
        parts=EvalParts(asks=lambda: [*ASKS, about_repo]),
    )
    assert [ask.name for ask in jobs._asks()] == [ask.name for ask in ASKS]  # pyright: ignore[reportPrivateUsage]


async def test_a_cloud_run_sends_no_memory(tmp_path: Path) -> None:
    mac = Mac()
    notes = Notes()
    gate = asyncio.Event()
    driver = FakeDriver(mac, gate)
    jobs = _jobs(tmp_path, mac, driver, notes=notes, interval=0.01)
    await jobs.start(["budget-cloud"])
    await driver.began.wait()
    await asyncio.sleep(0.08)
    gate.set()
    await jobs.wait()
    assert all(p["memory_used_gb"] is None for p in notes.of("eval.progress"))


async def test_a_second_start_is_refused_while_one_runs(tmp_path: Path) -> None:
    mac = Mac()
    gate = asyncio.Event()
    driver = FakeDriver(mac, gate)
    jobs = _jobs(tmp_path, mac, driver)
    running = await jobs.start(["budget-cloud"])
    await driver.began.wait()

    with pytest.raises(EvalRefused, match="already running"):
        await jobs.start(["frontier-cloud"])
    assert (await jobs.plan(["budget-cloud"]))[1] == running
    assert len(jobs.summaries()) == 1
    gate.set()
    await jobs.wait()
    assert (await jobs.plan(["budget-cloud"]))[1] is None
    await jobs.start(["frontier-cloud"])  # allowed once the first ended
    await jobs.wait()


async def test_a_refused_arm_starts_nothing(tmp_path: Path) -> None:
    mac = Mac()
    driver = FakeDriver(mac)
    jobs = _jobs(tmp_path, mac, driver)
    need = _need_gb(_local(), 6.0)

    mac.machine = Machine(need / 2, 100.0, {"qwen3.5:9b": 6 * GIB})
    with pytest.raises(EvalRefused, match="local-32k cannot run: Too big for this Mac"):
        await jobs.start(["budget-cloud", "local-32k"])
    mac.machine = Machine(64.0, need + 1.0, {"qwen3.5:9b": 6 * GIB})
    with pytest.raises(EvalRefused, match="Not enough free memory"):
        await jobs.start(["local-32k"])
    mac.machine = Machine(64.0, 48.0, None)
    with pytest.raises(EvalRefused, match="Ollama is not reachable"):
        await jobs.start(["local-32k"])
    mac.machine = Machine(need / 0.6, 100.0, {"qwen3.5:9b": 6 * GIB})
    with pytest.raises(EvalRefused, match="needs your yes"):
        await jobs.start(["local-32k"])
    mac.keys = False
    with pytest.raises(
        EvalRefused,
        match=r"budget-cloud cannot run: No key for anthropic\. Add it in Settings \u203a Models\.",
    ):
        await jobs.start(["budget-cloud"])

    assert driver.played == [] and jobs.summaries() == []
    assert list((tmp_path / "evals").glob("*.json")) == []

    mac.keys = True
    await jobs.start(["local-32k"], allow_tight=True)  # a tight arm runs when you allow it
    await jobs.wait()
    assert driver.played


# --- stop, a dead server, resume ------------------------------------------------------------------


async def test_stop_cancels_the_run_and_marks_the_rest_not_run(tmp_path: Path) -> None:
    mac = Mac()
    notes = Notes()
    gate = asyncio.Event()
    driver = FakeDriver(mac, gate)
    jobs = _jobs(tmp_path, mac, driver, notes=notes)
    started = await jobs.start(["budget-cloud"])
    await driver.began.wait()

    assert await jobs.stop(started) is True
    assert driver.cancelled  # the driver saw the cancel, so its throwaway daemon is stopped
    got = jobs.get(started)
    assert got is not None and got.state == "stopped"
    assert got.stop_reason == "You stopped it."
    assert [r.end for r in got.runs] == ["not_run"] * 4
    assert notes.of("eval.ended") == [
        {"id": started, "state": "stopped", "stop_reason": "You stopped it."}
    ]
    assert jobs.running_id() is None
    assert await jobs.stop(started) is False
    assert await jobs.stop("nothing") is False
    on_disk = json.loads((tmp_path / "evals" / f"{started}.json").read_text("utf-8"))
    assert on_disk["state"] == "stopped"


async def test_a_dead_server_stops_the_measurement_and_leaves_the_rest_not_run(
    tmp_path: Path,
) -> None:
    mac = Mac()
    notes = Notes()
    driver = FakeDriver(mac, fail=True)
    mac.alive = False
    jobs = _jobs(tmp_path, mac, driver, notes=notes)

    started = await jobs.start(["local-32k", "local-128k"])
    await jobs.wait()

    got = jobs.get(started)
    assert got is not None and got.state == "stopped"
    assert got.stop_reason == "Ollama stopped answering."
    assert [r.end for r in got.runs] == ["not_run"] * 8  # the run that died is not counted
    assert got.proposal is None
    assert driver.played == [("local-32k", "off", "alpha")]  # nothing after the dead run
    assert notes.of("eval.ended")[0]["stop_reason"] == "Ollama stopped answering."


async def test_low_memory_stops_it_before_the_next_ask(tmp_path: Path) -> None:
    mac = Mac()
    driver = FakeDriver(mac)
    jobs = _jobs(tmp_path, mac, driver)
    mac.low = True
    started = await jobs.start(["local-32k"])
    await jobs.wait()
    got = jobs.get(started)
    assert got is not None and got.state == "stopped"
    assert got.stop_reason == "The Mac is running low on memory."
    assert driver.played == []


async def test_resume_plays_only_the_runs_that_did_not_run(tmp_path: Path) -> None:
    mac = Mac()
    driver = FakeDriver(mac, asyncio.Event(), hold_after=2)  # the third run waits
    jobs = _jobs(tmp_path, mac, driver)
    started = await jobs.start(["budget-cloud"])
    for _ in range(400):
        if len(driver.played) == 3:
            break
        await asyncio.sleep(0.005)
    await jobs.stop(started)
    stopped = jobs.get(started)
    assert stopped is not None and stopped.state == "stopped"
    played = [(r.mode, r.ask, r.quality) for r in stopped.runs if r.end == "completed"]
    assert len(played) == 2

    with pytest.raises(EvalRefused, match="no measurement"):
        await jobs.resume("nope")
    driver.played.clear()
    driver.gate = None
    await jobs.resume(started)
    await jobs.wait()

    done = jobs.get(started)
    assert done is not None and done.state == "done" and done.stop_reason is None
    assert [r.end for r in done.runs] == ["completed"] * 4
    assert [(r.mode, r.ask, r.quality) for r in done.runs[: len(played)]] == played
    assert len(driver.played) == 4 - len(played)  # only the runs that were not run
    with pytest.raises(EvalRefused, match="Only a stopped"):
        await jobs.resume(started)


async def test_resume_asks_the_guard_again(tmp_path: Path) -> None:
    mac = Mac()
    driver = FakeDriver(mac, fail=True)
    mac.alive = False
    jobs = _jobs(tmp_path, mac, driver)
    started = await jobs.start(["local-32k"])
    await jobs.wait()

    mac.alive = True
    need = _need_gb(_local(), 6.0)
    mac.machine = Machine(64.0, need + 1.0, {"qwen3.5:9b": 6 * GIB})
    with pytest.raises(EvalRefused, match="Not enough free memory"):
        await jobs.resume(started)
    got = jobs.get(started)
    assert got is not None and got.state == "stopped"  # nothing changed
    mac.machine = FITS
    driver.fail = False
    await jobs.resume(started)
    await jobs.wait()
    after = jobs.get(started)
    assert after is not None and after.state == "done"


# --- keeping --------------------------------------------------------------------------------------


async def test_a_measurement_left_running_is_stopped_at_the_next_start(tmp_path: Path) -> None:
    arm = _local()
    ask = ASKS[0]
    played = replace(
        not_run(arm, "off", ask), end="completed", quality=1.0, seconds=3.0, window_left=1000
    )
    left = Measurement(
        id="20261123-110000-abc123",
        started_at="2026-11-23T11:00:00+00:00",
        arms=[arm],
        slots=[
            Slot(arm.name, "off", "alpha", "completed", played),
            Slot(arm.name, "off", "beta", "running"),
            Slot(arm.name, "on", "alpha", "pending"),
            Slot(arm.name, "on", "beta", "pending"),
        ],
    )
    folder = tmp_path / "evals"
    folder.mkdir()
    (folder / f"{left.id}.json").write_text(json.dumps(dump(left)), "utf-8")
    (folder / "broken.json").write_text("{not json", "utf-8")

    mac = Mac()
    jobs = _jobs(tmp_path, mac, FakeDriver(mac))
    got = jobs.get(left.id)
    assert got is not None and got.state == "stopped"
    assert got.stop_reason == "golem restarted."
    assert got.ended_at is not None
    assert _runs(got) == [
        (arm.name, "off", "alpha", "completed"),
        (arm.name, "off", "beta", "not_run"),
        (arm.name, "on", "alpha", "not_run"),
        (arm.name, "on", "beta", "not_run"),
    ]
    assert got.runs[0].quality == 1.0
    assert json.loads((folder / f"{left.id}.json").read_text("utf-8"))["state"] == "stopped"

    await jobs.resume(left.id)  # it can go on, and only the missing runs play
    await jobs.wait()
    again = jobs.get(left.id)
    assert again is not None and again.state == "done"
    assert [r.end for r in again.runs] == ["completed"] * 4


async def test_the_list_is_newest_first_and_delete_is_refused_while_running(
    tmp_path: Path,
) -> None:
    mac = Mac()
    clock = [datetime(2026, 11, 23, 12, 0, tzinfo=UTC)]
    gate = asyncio.Event()
    driver = FakeDriver(mac, gate)
    parts = EvalParts(
        driver=lambda _t: driver,
        machine=lambda: mac.machine,
        key_found=lambda _p: True,
        asks=lambda: ASKS,
        project=tmp_path,
    )
    jobs = EvalJobs(
        tmp_path / "evals",
        delegate=DelegateSettings,
        clock=lambda: clock[0],
        parts=parts,
    )
    first = await jobs.start(["budget-cloud"])
    await driver.began.wait()
    gate.set()
    await jobs.wait()
    clock[0] = datetime(2026, 11, 23, 13, 0, tzinfo=UTC)
    driver.gate = asyncio.Event()
    driver.began.clear()
    second = await jobs.start(["frontier-cloud"])
    await driver.began.wait()

    assert [s.id for s in jobs.summaries()] == [second, first]
    assert [s.state for s in jobs.summaries()] == ["running", "done"]
    with pytest.raises(EvalRefused, match="running"):
        jobs.delete(second)
    assert jobs.delete("missing") is False
    assert jobs.delete(first) is True
    assert not (tmp_path / "evals" / f"{first}.json").exists()
    assert jobs.get(first) is None
    await jobs.aclose()  # shutdown keeps a running one as stopped
    ended = jobs.get(second)
    assert ended is not None and ended.state == "stopped"
    assert ended.stop_reason == "golem was shut down."
    assert jobs.delete(second) is True


# --- the real graph, scripted ---------------------------------------------------------------------


def _models(arm: Arm, ask: Ask, mode: str) -> Any:
    answer = f"The answer holds {ask.name}." if mode == "on" else "No facts here."
    return ToolCallingChatModel(replies=[answer], usage=USAGE)


async def test_a_measurement_through_the_scripted_driver(tmp_path: Path) -> None:
    mac = Mac()
    notes = Notes(tmp_path / "evals")
    jobs = _jobs(tmp_path, mac, ScriptedDriver(_models), notes=notes)
    started = await jobs.start(["budget-cloud"])
    await jobs.wait()
    got = jobs.get(started)
    assert got is not None and got.state == "done"
    assert [r.end for r in got.runs] == ["completed"] * 4
    assert [r.quality for r in got.runs] == [0.0, 0.0, 1.0, 1.0]
    assert got.proposal is not None and got.proposal.pairs == 2
    assert got.cost_usd is not None
    assert notes.methods()[0] == "eval.started" and notes.methods()[-1] == "eval.ended"


# --- the frozen binary ----------------------------------------------------------------------------


def test_the_daemon_command_of_a_checkout_and_of_the_frozen_binary() -> None:
    assert serve_command(frozen=False, executable="/venv/bin/python") == [
        "/venv/bin/python",
        "-m",
        "golem.cli",
        "serve",
    ]
    assert serve_command(frozen=True, executable="/opt/golem-daemon") == [
        "/opt/golem-daemon",
        "serve",
    ]
    assert serve_command(frozen=False)[0] == sys.executable


# --- through the socket ---------------------------------------------------------------------------


async def _until_ended(client: RpcClient) -> list[dict[str, object]]:
    for _ in range(200):
        notices = (await client.take_events(), client.notices)[1]
        if any(n.get("method") == "eval.ended" for n in notices):
            return notices
        await asyncio.sleep(0.05)
    raise TimeoutError(client.notices)


async def test_a_measurement_over_the_socket_and_apply_writes_the_config(
    short_home: Path,
) -> None:
    mac = Mac()
    config = short_home / "config.toml"
    config.write_text("# mine\n[agents]\nkeep_days = 3  # a week and a bit\n", "utf-8")
    parts = EvalParts(
        driver=lambda _tight: ScriptedDriver(_models),
        machine=lambda: mac.machine,
        key_found=lambda _provider: True,
        asks=lambda: ASKS,
    )
    app, task = await start_daemon(short_home, evals=parts)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        plan = rpc_result(await client.call("evals.plan", {}))
        assert [a["name"] for a in plan["arms"]] == [a.name for a in ARMS]  # type: ignore[index, union-attr]
        assert plan["running"] is None

        bad = await client.call("evals.start", {"arms": ["nope"]})
        assert "no arm named nope" in str(bad["error"])
        started = rpc_result(await client.call("evals.start", {"arms": ["budget-cloud"]}))
        again = await client.call("evals.start", {"arms": ["frontier-cloud"]})
        assert "already running" in str(again["error"])

        notices = await _until_ended(client)
        methods = [str(n["method"]) for n in notices]
        assert methods[0] == "eval.started" and methods[-1] == "eval.ended"
        assert methods.count("eval.progress") == 8

        got = rpc_result(await client.call("evals.get", {"id": started["id"]}))
        measurement: Any = got["measurement"]
        assert measurement["state"] == "done" and measurement["in_use"] is False
        assert [n["measured"] for n in measurement["proposal"]["numbers"]].count(True) == 1

        applied = rpc_result(await client.call("evals.apply", {"id": started["id"]}))
        assert applied["ok"] is True
        values: Any = applied["values"]
        assert values["delegate"]["fill_share"]["value"] == 0.05
        assert values["delegate"]["read_share"]["is_default"] is True
        text = config.read_text("utf-8")
        assert "# mine" in text and "# a week and a bit" in text
        assert tomllib.loads(text)["agents"]["delegate"] == {"fill_share": 0.05}
        keep: Any = rpc_result(await client.call("agents.keep", {}))
        assert keep["values"]["delegate"]["fill_share"]["value"] == 0.05

        after: Any = rpc_result(await client.call("evals.get", {"id": started["id"]}))
        assert after["measurement"]["in_use"] is True
        listed: Any = rpc_result(await client.call("evals.list", {}))
        assert [(m["id"], m["in_use"], m["proposes"]) for m in listed["measurements"]] == [
            (started["id"], True, 1)
        ]
        deleted = rpc_result(await client.call("evals.delete", {"id": started["id"]}))
        assert deleted == {"deleted": True}
        assert rpc_result(await client.call("evals.list", {}))["measurements"] == []
        assert not list((short_home / "evals").glob("*.json"))
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_apply_with_nothing_measured_changes_nothing(tmp_path: Path) -> None:
    from golem.server.evals_rpc import NOTHING_MEASURED

    mac = Mac()
    _jobs(tmp_path, mac, FakeDriver(mac))  # makes the folder
    # A done measurement whose asks all folded as well as helpers did measures nothing.
    arm = _local("budget-cloud")
    same = replace(
        not_run(arm, "off", ASKS[0]), end="completed", quality=1.0, seconds=1.0, window_left=10
    )
    item = Measurement(
        id="20261123-100000-aaaaaa",
        started_at="2026-11-23T10:00:00+00:00",
        arms=[arm],
        slots=[
            Slot(arm.name, "off", "alpha", "completed", same),
            Slot(arm.name, "on", "alpha", "completed", replace(same, mode="on")),
        ],
        state="done",
        ended_at="2026-11-23T10:05:00+00:00",
    )
    folder = tmp_path / "evals"
    (folder / f"{item.id}.json").write_text(json.dumps(dump(item)), "utf-8")
    again = _jobs(tmp_path, mac, FakeDriver(mac))
    assert again.numbers_to_apply(item.id) == {}
    assert "nothing to apply" in NOTHING_MEASURED
    with pytest.raises(EvalRefused):
        again.numbers_to_apply("missing")


async def test_the_whole_way_over_the_socket_refusals_stop_resume_apply(short_home: Path) -> None:
    """Plan, refusals, start, progress, stop, resume, done, apply: the client's path, scripted."""
    mac = Mac()
    gate = asyncio.Event()
    driver = FakeDriver(mac, gate, hold_after=2)  # the third run waits until the test lets it go
    parts = EvalParts(
        driver=lambda _tight: driver,
        machine=lambda: mac.machine,
        key_found=lambda _provider: True,
        memory=lambda: mac.reading,
        alive=lambda: mac.alive,
        low=lambda: mac.low,
        asks=lambda: ASKS,
        interval=0.01,
    )
    app, task = await start_daemon(short_home, evals=parts)
    client = await RpcClient.connect(app.paths.socket_path)
    need = _need_gb(_local(), 6.0)
    try:
        await client.call("hello", HELLO)

        # Too big and no room cannot start, even with allow_tight; tight needs allow_tight.
        mac.machine = Machine(need / 2, 100.0, {"qwen3.5:9b": 6 * GIB})
        too_big = await client.call("evals.start", {"arms": ["local-32k"], "allow_tight": True})
        assert "Too big for this Mac" in str(too_big["error"])
        mac.machine = Machine(64.0, need + 1.0, {"qwen3.5:9b": 6 * GIB})
        no_room = await client.call("evals.start", {"arms": ["local-32k"], "allow_tight": True})
        assert "Not enough free memory" in str(no_room["error"])
        mac.machine = Machine(need / 0.6, 100.0, {"qwen3.5:9b": 6 * GIB})
        tight = await client.call("evals.start", {"arms": ["local-32k"]})
        assert "needs your yes" in str(tight["error"])
        assert not list((short_home / "evals").glob("*.json"))
        mac.machine = FITS

        # Start; stop at the waiting run.
        started = rpc_result(await client.call("evals.start", {"arms": ["budget-cloud"]}))
        for _ in range(400):
            if len(driver.played) == 3:
                break
            await asyncio.sleep(0.005)
        stopped = rpc_result(await client.call("evals.stop", {"id": started["id"]}))
        assert stopped == {"stopped": True}
        notices = await _until_ended(client)
        methods = [str(n["method"]) for n in notices]
        assert methods[0] == "eval.started" and "eval.progress" in methods
        assert methods[-1] == "eval.ended"
        mid: Any = rpc_result(await client.call("evals.get", {"id": started["id"]}))
        assert mid["measurement"]["state"] == "stopped"
        assert [r["end"] for r in mid["measurement"]["runs"]].count("completed") == 2

        # Resume plays only the rest, and the measurement ends done.
        driver.played.clear()
        driver.gate = None
        client.notices.clear()
        rpc_result(await client.call("evals.resume", {"id": started["id"]}))
        await _until_ended(client)
        assert len(driver.played) == 2
        done: Any = rpc_result(await client.call("evals.get", {"id": started["id"]}))
        assert done["measurement"]["state"] == "done"
        assert done["measurement"]["in_use"] is False

        # Apply writes the numbers; agents.keep shows them and the list marks the one in use.
        applied = rpc_result(await client.call("evals.apply", {"id": started["id"]}))
        assert applied["ok"] is True
        keep: Any = rpc_result(await client.call("agents.keep", {}))
        assert keep["values"]["delegate"]["fill_share"]["value"] != 0.85
        listed: Any = rpc_result(await client.call("evals.list", {}))
        assert [(m["id"], m["in_use"]) for m in listed["measurements"]] == [(started["id"], True)]
    finally:
        gate.set()
        await client.close()
        await stop_daemon(app, task)


# --- the local model the service uses -------------------------------------------------------------


def _own(ref: str | None) -> Callable[[], Awaitable[str | None]]:
    async def read() -> str | None:
        return ref

    return read


async def test_a_local_arm_takes_the_configured_installed_model(tmp_path: Path) -> None:
    mac = Mac()
    mac.machine = Machine(64.0, 48.0, {"qwen3.8:27b": 17 * GIB, "llama3.2:3b": 2 * GIB})
    jobs = _jobs(tmp_path, mac, FakeDriver(mac), local_model=_own("ollama/qwen3.8:27b"))
    planned, _ = await jobs.plan(["local-32k", "local-128k"])
    assert [p.model for p in planned] == ["ollama/qwen3.8:27b"] * 2
    assert all("Ollama does not have" not in p.reason for p in planned)
    # a model named by the person beats the configured one
    named = await jobs.plan(["local-32k"], {"local-32k": "ollama/llama3.2:3b"})
    assert named[0][0].model == "ollama/llama3.2:3b"


async def test_a_configured_model_that_is_missing_is_named_not_swapped(tmp_path: Path) -> None:
    mac = Mac()
    mac.machine = Machine(64.0, 48.0, {"llama3.2:3b": 2 * GIB})
    jobs = _jobs(tmp_path, mac, FakeDriver(mac), local_model=_own("ollama/qwen3.8:27b"))
    arm = (await jobs.plan(["local-32k"]))[0][0]
    assert arm.model == "ollama/qwen3.8:27b"  # not the smallest installed model
    assert arm.verdict == "unknown"
    assert arm.reason == (
        "Ollama does not have qwen3.8:27b. Choose another model, or pull it first."
    )
    assert [c.ref for c in arm.choices] == ["ollama/llama3.2:3b"]
    with pytest.raises(EvalRefused, match="Choose another model, or pull it first"):
        await jobs.start(["local-32k"])


async def test_without_a_configured_model_the_harness_default_stays(tmp_path: Path) -> None:
    mac = Mac()
    mac.machine = Machine(64.0, 48.0, {"llama3.2:3b": 2 * GIB})
    for own in (_own(None), None):
        jobs = _jobs(tmp_path, mac, FakeDriver(mac), local_model=own)
        arm = (await jobs.plan(["local-32k"]))[0][0]
        assert arm.model == "ollama/qwen3.5:9b" and arm.verdict == "unknown"

    async def broken() -> str | None:
        raise RuntimeError("facts are down")

    jobs = _jobs(tmp_path, mac, FakeDriver(mac), local_model=broken)
    assert (await jobs.plan(["local-32k"]))[0][0].model == "ollama/qwen3.5:9b"


# --- keys and plain errors ------------------------------------------------------------------------

SECRET = "sk-fake-not-a-real-key-123"


class KeyFailDriver(FakeDriver):
    """A driver whose first message is refused the way a daemon with no key refuses it."""

    async def play(self, arm: Arm, mode: Any, asks: Sequence[Ask], *args: Any, **kw: Any) -> Any:
        from golem.evals.helpers import RpcError

        raise RpcError(
            "message.send",
            {"code": -32005, "message": "needs key: /login anthropic", "data": None},
        )


async def test_an_rpc_error_stops_the_measurement_with_its_plain_message(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from golem.evals import helpers

    def fake_key(provider: str) -> str:
        del provider
        return SECRET

    monkeypatch.setattr(helpers, "provider_key", fake_key)
    mac = Mac()
    notes = Notes()
    jobs = _jobs(tmp_path, mac, KeyFailDriver(mac), notes=notes)
    item_id = await jobs.start(["budget-cloud"])
    await jobs.wait()
    got = jobs.get(item_id)
    assert got is not None and got.state == "stopped"
    assert got.stop_reason == "It stopped on an error: needs key: /login anthropic"
    assert "{" not in (got.stop_reason or "") and "-32005" not in (got.stop_reason or "")
    saved = (tmp_path / "evals" / f"{item_id}.json").read_text("utf-8")
    assert SECRET not in saved
    assert all(SECRET not in json.dumps(params) for _, params in notes.items)


async def test_a_cloud_arm_without_a_key_is_refused_before_anything_starts(tmp_path: Path) -> None:
    mac = Mac()
    mac.keys = False
    driver = FakeDriver(mac)
    jobs = _jobs(tmp_path, mac, driver)
    with pytest.raises(EvalRefused) as raised:
        await jobs.start(["frontier-cloud"])
    assert str(raised.value) == (
        "frontier-cloud cannot run: No key for anthropic. Add it in Settings \u203a Models."
    )
    assert driver.played == [] and list((tmp_path / "evals").glob("*.json")) == []
