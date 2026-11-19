"""The dispatcher: lines, one order, aging, a live slot count. A fake clock, no real sleep."""

from __future__ import annotations

import asyncio
import dataclasses
from collections.abc import Callable

import pytest

from golem.models.dispatcher import Call, Dispatcher, Grant, LineKey, Wait
from golem.models.engine import OLLAMA, EngineProfile

SERVER = "http://127.0.0.1:11434"
QWEN = LineKey.local("ollama", SERVER, "qwen3:14b")
LLAMA = LineKey.local("ollama", SERVER, "llama3:8b")
ANTHROPIC = LineKey.provider("anthropic")
OPENAI = LineKey.provider("openai")
SHELL = LineKey.shell()


async def _settle() -> None:
    for _ in range(8):
        await asyncio.sleep(0)


class FakeClock:
    """Time that moves only when a test says so. ``sleep`` wakes when ``advance`` passes it."""

    def __init__(self) -> None:
        self.now = 1000.0
        self._sleepers: list[tuple[float, asyncio.Future[None]]] = []

    def __call__(self) -> float:
        return self.now

    async def sleep(self, delay: float) -> None:
        future: asyncio.Future[None] = asyncio.get_running_loop().create_future()
        self._sleepers.append((self.now + delay, future))
        await future

    async def advance(self, seconds: float) -> None:
        end = self.now + seconds
        await _settle()
        while True:
            due = sorted(
                (s for s in self._sleepers if s[0] <= end and not s[1].done()), key=lambda s: s[0]
            )
            if not due:
                break
            when, future = due[0]
            self.now = max(self.now, when)
            future.set_result(None)
            self._sleepers.remove(due[0])
            await _settle()
        self.now = end
        await _settle()


RANKS: dict[str, int] = {}


def _rank(call: Call) -> int:
    return RANKS.get(call.label, 2)


def _dispatcher(clock: FakeClock, **kwargs: object) -> Dispatcher:
    RANKS.clear()
    return Dispatcher(_rank, clock=clock, sleep=clock.sleep, **kwargs)  # type: ignore[arg-type]


def _call(line: LineKey, label: str, rank: int = 2, **kwargs: object) -> Call:
    RANKS[label] = rank
    return Call(line, f"s-{label}", "chat", label, **kwargs)  # type: ignore[arg-type]


class _Probe:
    """Runs ``hold`` as a task. It records the order it got in and leaves on ``leave``."""

    def __init__(
        self,
        dispatcher: Dispatcher,
        call: Call,
        order: list[str],
        on_wait: Callable[[Wait | None], None] | None = None,
    ) -> None:
        self.entered = asyncio.Event()
        self.leave = asyncio.Event()
        self.grant: Grant | None = None
        self.task = asyncio.create_task(self._run(dispatcher, call, order, on_wait))

    async def _run(
        self,
        dispatcher: Dispatcher,
        call: Call,
        order: list[str],
        on_wait: Callable[[Wait | None], None] | None,
    ) -> None:
        async with dispatcher.hold(call, on_wait) as grant:
            self.grant = grant
            order.append(call.label)
            self.entered.set()
            await self.leave.wait()

    async def finish(self) -> None:
        self.leave.set()
        await self.task


async def _start(
    d: Dispatcher, line: LineKey, label: str, order: list[str], rank: int = 2, **kw: object
) -> _Probe:
    probe = _Probe(d, _call(line, label, rank, **kw), order)
    await _settle()
    return probe


# --- order -------------------------------------------------------------------


@pytest.mark.parametrize(
    ("waiters", "expected"),
    [
        pytest.param(
            [("job", 4), ("other", 2), ("viewed", 0)], ["viewed", "other", "job"], id="by class"
        ),
        pytest.param(
            [("helper", 1), ("viewed", 0), ("run", 3), ("job", 4), ("other", 2)],
            ["viewed", "helper", "other", "run", "job"],
            id="all five classes",
        ),
        pytest.param([("a", 2), ("b", 2), ("c", 2)], ["a", "b", "c"], id="same class by arrival"),
    ],
)
async def test_waiters_are_served_by_class_then_arrival(
    waiters: list[tuple[str, int]], expected: list[str]
) -> None:
    clock = FakeClock()
    d, order = _dispatcher(clock), list[str]()
    holder = await _start(d, QWEN, "holder", order)
    probes: list[_Probe] = []
    for label, rank in waiters:
        probes.append(await _start(d, QWEN, label, order, rank))
        await clock.advance(0.1)
    await holder.finish()
    for _ in waiters:
        await _settle()
        current = next(p for p in probes if p.entered.is_set() and not p.leave.is_set())
        await current.finish()
    assert order[1:] == expected


async def test_the_class_is_read_when_a_slot_frees() -> None:
    clock = FakeClock()
    d, order = _dispatcher(clock), list[str]()
    holder = await _start(d, QWEN, "holder", order)
    first = await _start(d, QWEN, "first", order, rank=0)
    second = await _start(d, QWEN, "second", order, rank=2)
    RANKS["first"], RANKS["second"] = 2, 0  # the user switched chats
    await holder.finish()
    assert second.entered.is_set()
    assert not first.entered.is_set()
    await second.finish()
    await first.finish()


async def test_a_call_with_a_slot_is_not_taken_away() -> None:
    clock = FakeClock()
    d, order = _dispatcher(clock), list[str]()
    job = await _start(d, QWEN, "job", order, rank=4)
    viewed = await _start(d, QWEN, "viewed", order, rank=0)
    assert job.entered.is_set()
    assert not viewed.entered.is_set()
    assert not job.task.done()
    await job.finish()
    await viewed.finish()


# --- aging -------------------------------------------------------------------


async def test_a_job_that_waited_four_minutes_goes_before_a_later_chat() -> None:
    clock = FakeClock()
    d, order = _dispatcher(clock), list[str]()
    holder = await _start(d, QWEN, "holder", order, rank=0)
    job = await _start(d, QWEN, "job", order, rank=4)
    await clock.advance(240)
    chat = await _start(d, QWEN, "chat", order, rank=2)
    await holder.finish()
    assert job.entered.is_set()
    assert not chat.entered.is_set()
    await job.finish()
    await chat.finish()


async def test_a_job_that_waited_less_does_not_go_first() -> None:
    clock = FakeClock()
    d, order = _dispatcher(clock), list[str]()
    holder = await _start(d, QWEN, "holder", order, rank=0)
    job = await _start(d, QWEN, "job", order, rank=4)
    await clock.advance(119)  # one step up only: class 3
    chat = await _start(d, QWEN, "chat", order, rank=2)
    await holder.finish()
    assert chat.entered.is_set()
    await chat.finish()
    await job.finish()


async def test_a_retry_keeps_its_old_arrival_for_aging() -> None:
    clock = FakeClock()
    d, order = _dispatcher(clock), list[str]()
    holder = await _start(d, QWEN, "holder", order, rank=0)
    retry = await _start(d, QWEN, "retry", order, rank=4, arrived=clock.now - 240)
    chat = await _start(d, QWEN, "chat", order, rank=2)
    await holder.finish()
    assert retry.entered.is_set()
    assert retry.grant is not None
    assert retry.grant.arrived == clock.now - 240
    await retry.finish()
    await chat.finish()


# --- cancel ------------------------------------------------------------------


async def test_cancel_while_waiting_leaves_the_queue_and_tells_none() -> None:
    clock = FakeClock()
    d, order, told = _dispatcher(clock), list[str](), list[Wait | None]()
    holder = await _start(d, QWEN, "holder", order)
    waiter = _Probe(d, _call(QWEN, "waiter"), order, told.append)
    after = await _start(d, QWEN, "after", order)
    await clock.advance(2)
    assert isinstance(told[-1], Wait)
    waiter.task.cancel()
    await _settle()
    assert told[-1] is None
    assert [w.label for w in d.snapshot()[0].waiting] == ["after"]
    await holder.finish()
    assert after.entered.is_set()
    with pytest.raises(asyncio.CancelledError):
        await waiter.task
    await after.finish()


async def test_a_slot_handed_over_during_cancel_passes_to_the_next_waiter() -> None:
    clock = FakeClock()
    d, order = _dispatcher(clock), list[str]()
    holder = await _start(d, QWEN, "holder", order)
    waiter = await _start(d, QWEN, "waiter", order)
    after = await _start(d, QWEN, "after", order)
    holder.leave.set()
    await asyncio.sleep(0)  # the slot goes to ``waiter``, which has not run yet
    waiter.task.cancel()  # and in the same instant it is cancelled
    await _settle()
    assert after.entered.is_set()
    assert order == ["holder", "after"]
    await after.finish()
    await holder.task
    assert d.snapshot()[0].holders == ()


# --- the live slot count -----------------------------------------------------


async def test_a_lower_slot_count_takes_effect_as_calls_end() -> None:
    clock = FakeClock()
    d, order = _dispatcher(clock, local_slots=2), list[str]()
    a = await _start(d, QWEN, "a", order)
    b = await _start(d, QWEN, "b", order)
    d.set_slots(QWEN, 1)
    c = await _start(d, QWEN, "c", order)
    assert not a.task.done()
    assert not b.task.done()
    await a.finish()
    assert not c.entered.is_set()  # one still runs, and the count is now 1
    await b.finish()
    assert c.entered.is_set()
    await c.finish()


async def test_a_higher_slot_count_takes_effect_at_once() -> None:
    clock = FakeClock()
    d, order = _dispatcher(clock), list[str]()
    a = await _start(d, QWEN, "a", order)
    b = await _start(d, QWEN, "b", order)
    assert not b.entered.is_set()
    d.set_slots(QWEN, 2)
    await _settle()
    assert b.entered.is_set()
    await a.finish()
    await b.finish()


# --- the server cap and the swap rule ----------------------------------------


async def test_two_models_share_the_server_cap_when_max_loaded_is_one() -> None:
    clock = FakeClock()
    d, order = _dispatcher(clock, local_slots=2), list[str]()
    a = await _start(d, QWEN, "a", order)
    b = await _start(d, LLAMA, "b", order)  # a swap: qwen is loaded
    assert a.entered.is_set()
    assert not b.entered.is_set()
    await a.finish()
    assert b.entered.is_set()
    await b.finish()


async def test_two_models_run_at_once_up_to_max_loaded_times_slots() -> None:
    clock = FakeClock()
    profile = dataclasses.replace(OLLAMA, max_loaded=2)
    d, order = _dispatcher(clock, local_slots=1, profiles={"ollama": profile}), list[str]()
    a = await _start(d, QWEN, "a", order)
    b = await _start(d, LLAMA, "b", order)
    c = await _start(d, QWEN, "c", order)  # the qwen line has one slot, and it is taken
    assert a.entered.is_set()
    assert b.entered.is_set()
    assert not c.entered.is_set()
    await a.finish()
    assert c.entered.is_set()
    await b.finish()
    await c.finish()


async def test_the_server_cap_holds_with_many_slots() -> None:
    clock = FakeClock()
    profile = dataclasses.replace(OLLAMA, max_loaded=2)
    d, order = _dispatcher(clock, local_slots=2, profiles={"ollama": profile}), list[str]()
    probes = [await _start(d, QWEN, "q1", order), await _start(d, QWEN, "q2", order)]
    probes.append(await _start(d, LLAMA, "l1", order))
    probes.append(await _start(d, LLAMA, "l2", order))
    assert order == ["q1", "q2", "l1", "l2"]  # max_loaded x slots = 4, all four run
    probes.append(await _start(d, LLAMA, "l3", order))
    assert "l3" not in order  # the fifth waits
    for p in probes:
        await p.finish()


async def test_a_loaded_model_goes_before_a_swap_in_the_same_class() -> None:
    clock = FakeClock()
    d, order = _dispatcher(clock, local_slots=2), list[str]()
    holder = await _start(d, QWEN, "holder", order)
    swap = await _start(d, LLAMA, "swap", order)
    same = await _start(d, QWEN, "same", order)  # arrived later, but its model is loaded
    assert same.entered.is_set()
    assert not swap.entered.is_set()
    await holder.finish()
    assert not swap.entered.is_set()  # ``same`` still runs
    await same.finish()
    assert swap.entered.is_set()
    await swap.finish()


async def test_a_swap_that_waited_a_minute_goes_by_arrival_not_behind_the_loaded_model() -> None:
    clock = FakeClock()
    d, order = _dispatcher(clock, local_slots=2), list[str]()
    first = await _start(d, QWEN, "first", order)
    second = await _start(d, QWEN, "second", order)
    swap = await _start(d, LLAMA, "swap", order)
    await clock.advance(60)
    # A steady stream for the loaded model: a new call is waiting each time a slot frees.
    third = await _start(d, QWEN, "third", order)
    await first.finish()
    assert not third.entered.is_set()  # the swap is ahead now, and qwen runs dry for it
    await second.finish()
    assert swap.entered.is_set()
    await swap.finish()
    assert third.entered.is_set()
    await third.finish()


async def test_a_better_class_swap_is_not_starved_by_a_worse_class_loaded_call() -> None:
    clock = FakeClock()
    d, order = _dispatcher(clock, local_slots=2), list[str]()
    holder = await _start(d, QWEN, "holder", order, rank=2)
    swap = await _start(d, LLAMA, "swap", order, rank=0)
    later = await _start(d, QWEN, "later", order, rank=4)
    assert not later.entered.is_set()  # it would keep qwen busy
    await holder.finish()
    assert swap.entered.is_set()
    await swap.finish()
    await later.finish()


async def test_servers_do_not_share_a_cap() -> None:
    clock = FakeClock()
    other = LineKey.local("ollama", "http://127.0.0.1:11435", "qwen3:14b")
    d, order = _dispatcher(clock), list[str]()
    a = await _start(d, QWEN, "a", order)
    b = await _start(d, other, "b", order)
    assert a.entered.is_set()
    assert b.entered.is_set()
    await a.finish()
    await b.finish()


# --- the provider line -------------------------------------------------------


async def test_a_provider_at_its_cap_makes_the_next_call_wait() -> None:
    clock = FakeClock()
    d, order = _dispatcher(clock, provider_slots=2), list[str]()  # no local line, no engine
    a = await _start(d, ANTHROPIC, "a", order)
    b = await _start(d, ANTHROPIC, "b", order)
    c = await _start(d, ANTHROPIC, "c", order)
    other = await _start(d, OPENAI, "other", order)  # another account has its own line
    assert not c.entered.is_set()
    assert other.entered.is_set()
    await a.finish()
    assert c.entered.is_set()
    await b.finish()
    await c.finish()
    await other.finish()


@pytest.mark.parametrize(
    ("refusals", "retry_after", "expected"),
    [
        pytest.param([None], None, 2.0, id="first refusal"),
        pytest.param([None, None], None, 4.0, id="second in a row"),
        pytest.param([None, None, None], None, 8.0, id="third in a row"),
        pytest.param([None], 10.0, 10.0, id="retry-after is longer"),
        pytest.param([None, None], 1.0, 4.0, id="retry-after is shorter"),
        pytest.param([None] * 8, None, 60.0, id="at most 60 s"),
        pytest.param([None], 600.0, 60.0, id="retry-after is capped too"),
    ],
)
async def test_the_provider_backs_off_by_the_rule(
    refusals: list[None], retry_after: float | None, expected: float
) -> None:
    clock = FakeClock()
    d = _dispatcher(clock)
    for i, _ in enumerate(refusals):
        last = i == len(refusals) - 1
        d.refused(ANTHROPIC, retry_after if last else None)
        if not last:
            await clock.advance(61)  # each refusal starts a fresh backoff
    order: list[str] = []
    probe = await _start(d, ANTHROPIC, "a", order)
    state = d.snapshot()[0]
    assert state.retry_in == pytest.approx(expected)
    await clock.advance(expected - 0.5)
    assert not probe.entered.is_set()
    await clock.advance(0.5)
    assert probe.entered.is_set()
    await probe.finish()


async def test_a_success_resets_the_run_of_refusals() -> None:
    clock = FakeClock()
    d = _dispatcher(clock)
    d.refused(ANTHROPIC)
    await clock.advance(3)
    d.refused(ANTHROPIC)  # the second in a row: 4 s
    assert d.snapshot()[0].retry_in == pytest.approx(4.0)
    await clock.advance(5)
    d.succeeded(ANTHROPIC)
    d.refused(ANTHROPIC)
    assert d.snapshot()[0].retry_in == pytest.approx(2.0)


async def test_refusals_during_one_backoff_count_once() -> None:
    clock = FakeClock()
    d = _dispatcher(clock)
    for _ in range(4):  # four parallel calls refused in the same moment
        d.refused(ANTHROPIC)
    assert d.snapshot()[0].retry_in == pytest.approx(2.0)


async def test_a_backoff_holds_calls_but_not_running_ones_or_other_providers() -> None:
    clock = FakeClock()
    d, order = _dispatcher(clock), list[str]()
    running = await _start(d, ANTHROPIC, "running", order)
    d.refused(ANTHROPIC)
    held = await _start(d, ANTHROPIC, "held", order)
    other = await _start(d, OPENAI, "other", order)
    assert not running.task.done()
    assert not held.entered.is_set()
    assert other.entered.is_set()
    await clock.advance(2)
    assert held.entered.is_set()
    for p in (running, held, other):
        await p.finish()


async def test_a_waiting_call_is_told_the_provider_reason_and_the_backoff() -> None:
    clock = FakeClock()
    d, order, told = _dispatcher(clock), list[str](), list[Wait | None]()
    d.refused(ANTHROPIC)
    probe = _Probe(d, _call(ANTHROPIC, "a"), order, told.append)
    await clock.advance(1.5)
    wait = told[-1]
    assert isinstance(wait, Wait)
    assert (wait.reason, wait.line, wait.position) == ("provider", "anthropic", 1)
    assert wait.retry_in == pytest.approx(1.0)  # as of the notice, at 1 s
    await clock.advance(1)
    assert told[-1] is None
    await probe.finish()


# --- telling a waiter --------------------------------------------------------


async def test_on_wait_is_called_after_one_second_and_with_none_at_the_turn() -> None:
    clock = FakeClock()
    d, order, told = _dispatcher(clock), list[str](), list[Wait | None]()
    holder = await _start(d, QWEN, "holder", order)
    waiter = _Probe(d, _call(QWEN, "waiter"), order, told.append)
    await clock.advance(0.9)
    assert told == []
    await clock.advance(0.2)
    assert told == [Wait("slot", 1, "holder", "qwen3:14b", None)]
    await holder.finish()
    assert told[-1] is None
    assert len(told) == 2
    assert waiter.grant is not None
    assert waiter.grant.waited == pytest.approx(1.1)
    await waiter.finish()


async def test_a_wait_of_one_second_or_less_calls_nothing() -> None:
    clock = FakeClock()
    d, order, told = _dispatcher(clock), list[str](), list[Wait | None]()
    holder = await _start(d, QWEN, "holder", order)
    waiter = _Probe(d, _call(QWEN, "waiter"), order, told.append)
    await clock.advance(0.5)
    await holder.finish()
    assert waiter.entered.is_set()
    assert told == []
    await waiter.finish()


async def test_a_call_that_does_not_wait_calls_nothing() -> None:
    clock = FakeClock()
    d, order, told = _dispatcher(clock), list[str](), list[Wait | None]()
    probe = _Probe(d, _call(QWEN, "a"), order, told.append)
    await clock.advance(5)
    assert told == []
    await probe.finish()


async def test_a_change_of_position_is_told_at_most_once_a_second() -> None:
    clock = FakeClock()
    d, order, told = _dispatcher(clock, local_slots=1), list[str](), list[Wait | None]()
    a = await _start(d, QWEN, "a", order)
    b = await _start(d, QWEN, "b", order)
    c = _Probe(d, _call(QWEN, "c"), order, told.append)
    await clock.advance(1.0)
    assert [w.position for w in told if w] == [2]
    await a.finish()  # b gets the slot, c is next
    await clock.advance(0.3)
    assert [w.position for w in told if w] == [2]  # too soon after the last notice
    await clock.advance(0.8)
    assert [w.position for w in told if w] == [2, 1]
    await b.finish()
    assert told[-1] is None
    await c.finish()


# --- snapshot ----------------------------------------------------------------


async def test_snapshot_lists_lines_holders_and_waiters() -> None:
    clock = FakeClock()
    d, order = _dispatcher(clock), list[str]()
    a = await _start(d, QWEN, "a", order, rank=0)
    b = await _start(d, QWEN, "b", order, rank=4)
    c = await _start(d, QWEN, "c", order, rank=1)
    p = await _start(d, ANTHROPIC, "p", order)
    d.refused(OPENAI)
    d.set_slots(SHELL, 1)
    lines = {state.line: state for state in d.snapshot()}
    assert set(lines) == {str(QWEN), "provider:anthropic", "provider:openai", "shell"}
    qwen = lines[str(QWEN)]
    assert (qwen.kind, qwen.slots) == ("local", 1)
    assert [(h.label, h.session_id, h.role) for h in qwen.holders] == [("a", "s-a", "chat")]
    assert [(w.label, w.position, w.effective_class) for w in qwen.waiting] == [
        ("c", 1, 1),
        ("b", 2, 4),
    ]
    assert qwen.retry_in is None
    assert lines["provider:anthropic"].slots == 4
    assert lines["provider:openai"].retry_in == pytest.approx(2.0)
    assert lines["shell"].holders == ()
    for probe in (a, b, c, p):
        probe.leave.set()
    await _settle()


async def test_snapshot_shows_the_effective_class_after_aging() -> None:
    clock = FakeClock()
    d, order = _dispatcher(clock), list[str]()
    holder = await _start(d, QWEN, "holder", order)
    job = await _start(d, QWEN, "job", order, rank=4)
    await clock.advance(130)
    assert d.snapshot()[0].waiting[0].effective_class == 2
    holder.leave.set()
    job.leave.set()
    await _settle()


# --- the two setups ----------------------------------------------------------


async def test_local_only_makes_only_local_lines() -> None:
    clock = FakeClock()
    d, order = _dispatcher(clock), list[str]()
    a = await _start(d, QWEN, "a", order)
    b = await _start(d, LLAMA, "b", order)
    assert {state.kind for state in d.snapshot()} == {"local"}
    await a.finish()
    await b.finish()


async def test_provider_only_makes_only_provider_lines_and_asks_no_engine(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def no_question(self: object, *args: object, **kwargs: object) -> None:
        raise AssertionError("the dispatcher asked an engine")

    monkeypatch.setattr(EngineProfile, "read_state", no_question)
    clock = FakeClock()
    d, order = _dispatcher(clock, profiles={}), list[str]()
    a = await _start(d, ANTHROPIC, "a", order)
    b = await _start(d, OPENAI, "b", order, rank=0)
    assert {state.kind for state in d.snapshot()} == {"provider"}
    assert order == ["a", "b"]
    await a.finish()
    await b.finish()
