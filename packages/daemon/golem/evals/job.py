"""The helper measurement as one job of the service (step 15.14, ticket #1707).

:mod:`golem.evals.helpers` plays the asks of the helper eval in four arms. This module runs that
play as a background job of the daemon and keeps it:

- :class:`EvalJobs` plans a measurement (``evals.plan``), starts one (``evals.start``), follows it
  run by run, stops it (``evals.stop``) and goes on with it (``evals.resume``). At most one runs.
- Every run is written to ``<golem home>/evals/<id>.json`` as soon as it ends, so a daemon that
  dies loses at most the run in progress. At the next start a file left ``running`` becomes
  ``stopped`` and can be resumed.
- A measurement stops by itself when Ollama stops answering or memory runs low (the rules of the
  harness) and when you stop it. Its runs left are ``not run``, and a resume plays only those.
- The proposal for ``[agents.delegate]`` is :func:`golem.evals.helpers.propose` over the runs
  that ran. ``evals.apply`` writes it with the same writer as ``agents.keep``.

Nothing here loads a model by itself: the driver does, and tests give a scripted one.

The estimates of ``evals.plan`` are rough and say so:

- ``minutes`` of an arm: its runs (asks, twice each) times ``LOCAL_SECONDS_PER_RUN`` for a local
  model or ``CLOUD_SECONDS_PER_RUN`` for a hosted one, over 60.
- ``cost_usd`` of a cloud arm: its runs times ``RUN_INPUT_TOKENS`` of input and
  ``RUN_OUTPUT_TOKENS`` of output at the lead's price, and a quarter more for the helpers that
  the runs with helpers start. Null when the model was swapped (its price is not known here).
"""

from __future__ import annotations

import asyncio
import contextlib
import dataclasses
import json
import logging
import math
import os
import shutil
import tempfile
import time
import uuid
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, cast

from pydantic import BaseModel

from golem import __version__
from golem.config import DelegateSettings, ModelPrice
from golem.evals.helpers import (
    ARMS,
    MODES,
    REASONS,
    Arm,
    Ask,
    Driver,
    LiveDriver,
    Machine,
    MemoryCheck,
    Mode,
    Run,
    fact_label,
    facts_found,
    free_memory_gb,
    load_asks,
    memory_check,
    memory_low,
    ollama_alive,
    propose,
    provider_key_found,
    read_machine,
    setup_of,
    with_models,
)
from golem.models.hardware import total_ram_gb
from golem.models.tiers import Tier
from golem_protocol.commands import (
    EvalArmParams,
    EvalArmUsed,
    EvalAsk,
    EvalMeasurement,
    EvalModelChoice,
    EvalNumber,
    EvalPlanArm,
    EvalProgress,
    EvalProposal,
    EvalRun,
    EvalStarted,
    EvalSummary,
)
from golem_protocol.commands import EvalEnded as EvalEndedParams
from golem_protocol.rpc import (
    EvalEndedNotification,
    EvalProgressNotification,
    EvalStartedNotification,
)

log = logging.getLogger(__name__)

LOCAL_SECONDS_PER_RUN = 120.0
CLOUD_SECONDS_PER_RUN = 45.0
RUN_INPUT_TOKENS = 40_000
RUN_OUTPUT_TOKENS = 3_000
HELPER_COST_FACTOR = 1.25
"""The share of runs that start helpers cost this many times a run that folds, as a guess."""

MEMORY_SECONDS = 5.0
"""How often a local arm's run sends a memory reading."""

MIN_PAIRS_WHEN_STOPPED = 2
"""A stopped measurement proposes numbers only with this many asks played both ways."""

STOPPED_BY_YOU = "You stopped it."
STOPPED_LOW_MEMORY = "The Mac is running low on memory."
STOPPED_BY_SHUTDOWN = "golem was shut down."
STOPPED_BY_RESTART = "golem restarted."

NUMBER_KEYS = ("read_share", "fill_share", "job_share", "price_ratio")

Broadcast = Callable[[BaseModel], None]
MemoryReading = Callable[[], tuple[float | None, float | None]]
"""Memory in use and memory in all, in GiB; a figure that cannot be read is None."""

DriverFactory = Callable[[bool, bool], Driver]
"""Makes the driver of a measurement from ``allow_tight`` and ``own_risk``. The default is
:class:`LiveDriver`."""


class EvalRefused(Exception):
    """A call that cannot be done now. The message is plain text for the person."""


class _Stop(Exception):
    """The measurement ends here, with ``reason`` as the plain-text cause."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True, slots=True)
class EvalParts:
    """What a test swaps. A part left None is the real one (a live driver, this Mac's probes)."""

    driver: DriverFactory | None = None
    machine: Callable[[], Machine] | None = None
    key_found: Callable[[str], bool] | None = None
    memory: MemoryReading | None = None
    alive: Callable[[], bool] | None = None
    low: Callable[[], bool] | None = None
    asks: Callable[[], list[Ask]] | None = None
    interval: float = MEMORY_SECONDS
    project: Path | None = None
    local_model: Callable[[], Awaitable[str | None]] | None = None
    """The Ollama model the service uses as its local one (``ollama/name``), or None."""


def read_memory() -> tuple[float | None, float | None]:
    """Memory in use and in all now, in GiB, from ``vm_stat`` and the RAM size."""
    total, free = total_ram_gb(), free_memory_gb()
    if total is None or free is None:
        return None, total
    return max(total - free, 0.0), total


# --- what is kept ---------------------------------------------------------------------------------


@dataclass(slots=True)
class Slot:
    """One planned run. ``end`` is ``pending``, ``running``, ``not_run`` or how the run ended."""

    arm: str
    mode: Mode
    ask: str
    end: str = "pending"
    run: Run | None = None


@dataclass(slots=True)
class Measurement:
    """A measurement as kept in its file."""

    id: str
    started_at: str
    arms: list[Arm]
    slots: list[Slot]
    state: str = "running"
    ended_at: str | None = None
    stop_reason: str | None = None
    applied: dict[str, float] | None = None
    """The four numbers in force right after ``evals.apply`` wrote this one's."""
    own_risk: bool = False
    """Started, or resumed, at the person's own risk: an arm may have been too big or short."""
    asks: list[dict[str, Any]] = field(default_factory=list[dict[str, Any]])
    """The asks of the set when it started, as :class:`EvalAsk` dumps (empty in an old file)."""
    rules: dict[str, float] = field(default_factory=dict[str, float])
    """The four numbers of ``[agents.delegate]`` in force when it started."""
    golem_version: str | None = None


def _arm_dump(arm: Arm) -> dict[str, Any]:
    price = None if arm.price is None else arm.price.model_dump()
    return {
        "name": arm.name,
        "tier": arm.tier,
        "window": arm.window,
        "lead": arm.lead,
        "price": price,
    }


def _arm_load(raw: Mapping[str, Any]) -> Arm:
    price = raw.get("price")
    return Arm(
        name=str(raw["name"]),
        tier=cast("Tier", raw["tier"]),
        window=int(raw["window"]),
        lead=str(raw["lead"]),
        price=None if price is None else ModelPrice.model_validate(price),
    )


def _run_load(raw: Mapping[str, Any]) -> Run:
    fields: dict[str, Any] = dict(raw)
    fields["helper_stops"] = tuple(raw.get("helper_stops", ()))
    fields["helper_models"] = tuple(raw.get("helper_models", ()))
    return Run(**fields)


def dump(item: Measurement) -> dict[str, Any]:
    """The JSON form of a measurement. :func:`load` reads it back."""
    return {
        "id": item.id,
        "started_at": item.started_at,
        "ended_at": item.ended_at,
        "state": item.state,
        "stop_reason": item.stop_reason,
        "applied": item.applied,
        "own_risk": item.own_risk,
        "asks": item.asks,
        "rules": item.rules,
        "golem_version": item.golem_version,
        "arms": [_arm_dump(arm) for arm in item.arms],
        "slots": [
            {
                "arm": s.arm,
                "mode": s.mode,
                "ask": s.ask,
                "end": s.end,
                "run": None if s.run is None else dataclasses.asdict(s.run),
            }
            for s in item.slots
        ],
    }


def load(raw: Mapping[str, Any]) -> Measurement:
    """A measurement from its JSON form. Raises ``KeyError``, ``TypeError`` or ``ValueError``."""
    slots = [
        Slot(
            arm=str(s["arm"]),
            mode=cast("Mode", s["mode"]),
            ask=str(s["ask"]),
            end=str(s["end"]),
            run=None if s.get("run") is None else _run_load(s["run"]),
        )
        for s in raw["slots"]
    ]
    applied = raw.get("applied")
    return Measurement(
        id=str(raw["id"]),
        started_at=str(raw["started_at"]),
        arms=[_arm_load(a) for a in raw["arms"]],
        slots=slots,
        state=str(raw["state"]),
        ended_at=raw.get("ended_at"),
        stop_reason=raw.get("stop_reason"),
        applied=None if applied is None else {str(k): float(v) for k, v in applied.items()},
        own_risk=bool(raw.get("own_risk", False)),
        asks=[dict(a) for a in raw.get("asks", [])],
        rules={
            str(k): float(v) for k, v in cast("Mapping[str, Any]", raw.get("rules") or {}).items()
        },
        golem_version=raw.get("golem_version"),
    )


def _write_atomic(path: Path, text: str) -> None:
    """Write ``text`` to ``path`` so a reader sees the old file or the new one, never half."""
    handle, name = tempfile.mkstemp(dir=path.parent, prefix=".eval-", suffix=".tmp")
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as out:
            out.write(text)
        os.replace(name, path)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(name)
        raise


# --- the plan -------------------------------------------------------------------------------------


def verdict_of(check: MemoryCheck) -> str:
    """``fits``, ``tight``, ``too_big``, ``no_room`` (it fits but little is free) or ``unknown``."""
    fits = check.fit
    if fits is None:
        return "unknown"
    if fits == "too_big":
        return "too_big"
    if check.short:
        return "no_room"
    return fits


def no_key_reason(provider: str) -> str:
    return f"No key for {provider}. Add it in Settings \u203a Models."


def _label(arm: Arm) -> str:
    if arm.local:
        return f"Local model, {arm.window // 1024}K window"
    return "Budget cloud model" if arm.tier == "budget" else "Frontier cloud model"


def _local_reason(arm: Arm, check: MemoryCheck, verdict: str, machine: Machine) -> str:
    name = arm.lead.partition("/")[2]
    if machine.sizes is None:
        return "Ollama is not reachable, so the size of the model is not known."
    if check.model_gb is None:
        return f"Ollama does not have {name}. Choose another model, or pull it first."
    numbers = check.numbers()
    return {
        "fits": f"Fits: {numbers}.",
        "tight": f"Tight: it fits but takes most of the memory, so it needs your yes: {numbers}.",
        "too_big": (
            f"Too big for this Mac: {numbers}. You can still run it at your own risk, "
            "but the Mac may stop answering."
        ),
        "no_room": (
            f"Not enough free memory right now: {numbers}. You can still run it at your own "
            "risk, but the Mac may stop answering."
        ),
        "unknown": (
            f"The memory is not known: {numbers}. You can still run it at your own risk, "
            "but the Mac may stop answering."
        ),
    }[verdict]


def estimated_minutes(arm: Arm, asks: int) -> float:
    """A rough time for the arm: its runs times a fixed time for each run."""
    seconds = LOCAL_SECONDS_PER_RUN if arm.local else CLOUD_SECONDS_PER_RUN
    return round(asks * len(MODES) * seconds / 60, 1)


def estimated_cost(arm: Arm, asks: int, default: Arm) -> float | None:
    """A rough cost in US dollars of a cloud arm's runs. None when its price is not known here."""
    if arm.local or arm.price is None or arm.lead != default.lead:
        return None
    per_run = (
        RUN_INPUT_TOKENS * arm.price.input + RUN_OUTPUT_TOKENS * arm.price.output
    ) / 1_000_000
    off = asks * per_run
    on = asks * per_run * HELPER_COST_FACTOR
    return round(off + on, 2)


def plan_arm(
    arm: Arm,
    default: Arm,
    asks: int,
    machine: Machine,
    key_found: Callable[[str], bool],
) -> EvalPlanArm:
    """One arm as ``evals.plan`` shows it. Pure: the machine and the keys are given."""
    common: dict[str, Any] = {
        "name": arm.name,
        "label": _label(arm),
        "tier": arm.tier,
        "window": arm.window,
        "model": arm.lead,
        "asks": asks,
        "minutes": estimated_minutes(arm, asks),
    }
    if arm.local:
        check = memory_check(arm, machine)
        verdict = verdict_of(check)
        choices = [
            EvalModelChoice(ref=f"ollama/{name}", size_gb=round(size / 2**30, 2))
            for name, size in sorted((machine.sizes or {}).items())
        ]
        return EvalPlanArm(
            kind="local",
            choices=choices,
            needed_gb=None if check.need_gb is None else round(check.need_gb, 2),
            ram_gb=machine.ram_gb,
            free_gb=machine.free_gb,
            loaded_gb=round(check.loaded_gb, 2) if check.loaded_gb > 0 else None,
            verdict=cast("Any", verdict),
            runnable=check.model_gb is not None,
            reason=_local_reason(arm, check, verdict, machine),
            **common,
        )
    provider = arm.lead.partition("/")[0]
    cost = estimated_cost(arm, asks, default)
    if not key_found(provider):
        reason = no_key_reason(provider)
        common["runnable"] = False
    elif cost is None:
        reason = "A hosted model costs money. The cost of this one is not estimated."
    else:
        reason = f"A hosted model: about ${cost:.2f} in all, a rough guess."
    return EvalPlanArm(kind="cloud", cost_usd=cost, reason=reason, **common)


def refusal_of(
    planned: EvalPlanArm, allow_tight: bool, own_risk: bool, key_found: Callable[[str], bool]
) -> str | None:
    """Why this arm must not run now, as a plain sentence, or None when it may.

    A hosted model without a key, and a local model Ollama does not have, never run: there is
    nothing to load. A tight arm needs ``allow_tight`` or ``own_risk``; a too big one, one with
    no room and one of unknown size need ``own_risk``.
    """
    if planned.kind == "cloud":
        provider = planned.model.partition("/")[0]
        if key_found(provider):
            return None
        return f"{planned.name} cannot run: {no_key_reason(provider)}"
    if not planned.runnable:
        return f"{planned.name} cannot run: {planned.reason}"
    if planned.verdict == "fits" or own_risk or (planned.verdict == "tight" and allow_tight):
        return None
    if planned.verdict == "tight":
        return f"{planned.name} is tight on memory and needs your yes: {planned.reason}"
    return (
        f"{planned.name} needs your own risk to run: {planned.reason} "
        "To run it anyway, set own_risk (golem eval helpers ... --own-risk)."
    )


# --- the proposal ---------------------------------------------------------------------------------


def proposal_of(item: Measurement, current: DelegateSettings) -> EvalProposal | None:
    """The proposal of a measurement: none while it runs, or if a stopped one played too little."""
    if item.state == "running":
        return None
    runs = [s.run for s in item.slots if s.run is not None]
    found = propose(runs, current)
    if item.state == "stopped" and found.pairs < MIN_PAIRS_WHEN_STOPPED:
        return None
    numbers = [
        EvalNumber(
            key=cast("Any", s.key),
            current=float(s.current),
            proposed=None if s.proposed is None else round(s.proposed, 4),
            measured=s.proposed is not None,
            note=s.why,
        )
        for s in found.suggestions
    ]
    return EvalProposal(numbers=numbers, pairs=found.pairs, wins=found.wins)


def in_force(current: DelegateSettings) -> dict[str, float]:
    """The four numbers in force."""
    return {key: float(getattr(current, key)) for key in NUMBER_KEYS}


def is_in_use(item: Measurement, current: DelegateSettings) -> bool:
    """Whether the numbers this measurement applied are still the ones in force."""
    if item.applied is None:
        return False
    now = in_force(current)
    return all(math.isclose(now[key], item.applied.get(key, math.nan)) for key in NUMBER_KEYS)


def _end_of(run: Run) -> str:
    return run.end if run.end in ("completed", "failed", "cancelled", "timeout") else "failed"


def _slot_wire(slot: Slot, asks: Mapping[str, Ask]) -> EvalRun:
    run = slot.run
    if run is None:
        return EvalRun(arm=slot.arm, ask=slot.ask, mode=slot.mode, end=cast("Any", slot.end))
    ask = asks.get(slot.ask)
    found, missing = (
        ([], []) if ask is None or not run.answer else facts_found(run.answer, ask.facts)
    )
    return EvalRun(
        arm=slot.arm,
        ask=slot.ask,
        mode=slot.mode,
        end=cast("Any", slot.end),
        quality=min(max(run.quality, 0.0), 1.0),
        seconds=max(run.seconds, 0.0),
        window_left=min(max(run.left_share, 0.0), 1.0),
        helpers_started=run.helpers_started,
        answer=run.answer,
        found=found,
        missing=missing,
    )


def ask_wire(ask: Ask) -> EvalAsk:
    """An ask as a person reads it: the message, what the answer must mention, the set-up, why."""
    return EvalAsk(
        name=ask.name,
        text=ask.text,
        facts=[fact_label(f) for f in ask.facts],
        setup=setup_of(ask),
        reason=ask.reason,
        why=REASONS[ask.reason],
    )


def arm_params_wire(arm: Arm) -> EvalArmParams:
    """What an arm runs with: its model, window, requests at once and where helpers run."""
    return EvalArmParams(
        name=arm.name,
        model=arm.lead,
        window=arm.window,
        at_a_time=1 if arm.local else None,
        helper_model=(
            "the same model as the lead (no second model is loaded)"
            if arm.local
            else "chosen by golem from the models that are ready"
        ),
    )


def _cost_of(item: Measurement) -> float | None:
    """What the paid arms cost, or None when no paid arm is part of it."""
    if all(arm.local for arm in item.arms):
        return None
    return round(
        sum(s.run.cost for s in item.slots if s.run is not None and s.run.tier != "local"), 6
    )


def _arms_wire(item: Measurement) -> list[EvalArmUsed]:
    return [EvalArmUsed(name=arm.name, model=arm.lead) for arm in item.arms]


# --- the job --------------------------------------------------------------------------------------


class EvalJobs:
    """Plans, runs and keeps helper measurements. One runs at a time.

    ``folder`` holds one ``<id>.json`` per measurement. ``delegate`` gives the ``[agents.delegate]``
    in force now. ``broadcast`` sends a notification to every connection. ``parts`` swaps the
    driver, the probes and the clock, for tests. The constructor reads the folder and ends any
    measurement a dead daemon left ``running``.
    """

    def __init__(
        self,
        folder: Path,
        *,
        delegate: Callable[[], DelegateSettings],
        broadcast: Broadcast | None = None,
        clock: Callable[[], datetime] | None = None,
        parts: EvalParts | None = None,
    ) -> None:
        self._folder = folder
        self._delegate = delegate
        self._broadcast: Broadcast = broadcast or (lambda _note: None)
        self._clock = clock or (lambda: datetime.now().astimezone())
        parts = parts or EvalParts()
        self._parts = parts
        self._driver: DriverFactory = parts.driver or (
            lambda allow_tight, own_risk: LiveDriver(allow_tight=allow_tight, own_risk=own_risk)
        )
        self._machine = parts.machine or read_machine
        self._key_found = parts.key_found or provider_key_found
        self._local_model = parts.local_model
        self._memory = parts.memory or read_memory
        self._alive = parts.alive or ollama_alive
        self._low = parts.low or memory_low
        read_asks = parts.asks or load_asks
        # The service has no project folder, so an ask about "this repo" is left out unless a
        # test (or a later caller) names the folder.
        self._asks = (
            read_asks
            if parts.project is not None
            else lambda: [ask for ask in read_asks() if not ask.needs_project]
        )
        self._project = parts.project or Path.cwd().resolve()
        self._items: dict[str, Measurement] = {}
        self._task: asyncio.Task[None] | None = None
        self._running: Measurement | None = None
        self._why = STOPPED_BY_SHUTDOWN
        self._load_all()

    # --- reading the folder

    def _load_all(self) -> None:
        self._folder.mkdir(parents=True, exist_ok=True)
        for path in sorted(self._folder.glob("*.json")):
            try:
                item = load(json.loads(path.read_text("utf-8")))
            except (OSError, ValueError, KeyError, TypeError):
                log.warning("could not read the measurement %s", path, exc_info=True)
                continue
            if item.state == "running":
                self._end_for_restart(item)
            self._items[item.id] = item

    def _end_for_restart(self, item: Measurement) -> None:
        """A file left ``running`` is a measurement the daemon did not finish: it is stopped."""
        self._close(item, STOPPED_BY_RESTART)

    def _save(self, item: Measurement) -> None:
        try:
            _write_atomic(self._folder / f"{item.id}.json", json.dumps(dump(item), indent=1))
        except OSError:
            log.warning("could not write the measurement %s", item.id, exc_info=True)

    def _now(self) -> str:
        return self._clock().isoformat(timespec="seconds")

    def _close(self, item: Measurement, reason: str | None) -> None:
        """End ``item``: runs not played become ``not_run``; ``reason`` says why it stopped."""
        for slot in item.slots:
            if slot.end in ("pending", "running"):
                slot.end = "not_run"
        item.state = "done" if reason is None else "stopped"
        item.stop_reason = reason
        item.ended_at = self._now()
        self._save(item)

    # --- the plan

    def running_id(self) -> str | None:
        return None if self._running is None else self._running.id

    async def _arms(self, names: Sequence[str], models: Mapping[str, str]) -> list[Arm]:
        """The arms of ``names`` (all when empty), in the harness order, with the model swaps.

        A local arm whose model is not named takes the service's own local model, when it has
        one; otherwise it keeps the harness default.
        """
        known = {arm.name for arm in ARMS}
        unknown = [n for n in [*names, *models] if n not in known]
        if unknown:
            raise EvalRefused(
                f"There is no arm named {', '.join(sorted(set(unknown)))}. "
                f"The arms are {', '.join(arm.name for arm in ARMS)}."
            )
        for name, ref in models.items():
            arm = next(a for a in ARMS if a.name == name)
            provider, _, model = ref.partition("/")
            if not model or (provider == "ollama") != arm.local:
                kind = "an Ollama model (ollama/name)" if arm.local else "a hosted model"
                raise EvalRefused(f"{name} needs {kind}, not {ref!r}.")
        chosen = dict(models)
        if self._local_model is not None and any(a.local and a.name not in models for a in ARMS):
            try:
                own = await self._local_model()
            except Exception:
                log.warning("the local model could not be read", exc_info=True)
                own = None
            if own:
                chosen.update({a.name: own for a in ARMS if a.local and a.name not in models})
        swapped = with_models(ARMS, chosen)
        return [arm for arm in swapped if not names or arm.name in names]

    async def _read_machine(self, arms: Sequence[Arm]) -> Machine:
        if not any(arm.local for arm in arms):
            return Machine()
        return await asyncio.to_thread(self._machine)

    def _planned(self, arms: Sequence[Arm], machine: Machine, asks: int) -> list[EvalPlanArm]:
        defaults = {arm.name: arm for arm in ARMS}
        return [plan_arm(arm, defaults[arm.name], asks, machine, self._key_found) for arm in arms]

    async def plan(
        self, names: Sequence[str] = (), models: Mapping[str, str] | None = None
    ) -> tuple[list[EvalPlanArm], str | None]:
        """The arms as they stand now and the id of the running measurement. No model is called."""
        arms = await self._arms(names, models or {})
        machine = await self._read_machine(arms)
        return self._planned(arms, machine, len(self._asks())), self.running_id()

    def asks_wire(self) -> list[EvalAsk]:
        """The asks of the set now, so they can be read before a measurement starts."""
        return [ask_wire(ask) for ask in self._asks()]

    async def _guard(self, arms: Sequence[Arm], allow_tight: bool, own_risk: bool) -> None:
        """Raise :class:`EvalRefused` naming every arm that must not run now."""
        machine = await self._read_machine(arms)
        planned = self._planned(arms, machine, len(self._asks()))
        refusals = [
            r for p in planned if (r := refusal_of(p, allow_tight, own_risk, self._key_found))
        ]
        if refusals:
            raise EvalRefused("\n".join(refusals))

    def _busy(self) -> None:
        if self._running is not None:
            raise EvalRefused("A measurement is already running. Stop it, or wait until it ends.")

    # --- start, resume, stop

    async def start(
        self,
        names: Sequence[str],
        models: Mapping[str, str] | None = None,
        allow_tight: bool = False,
        own_risk: bool = False,
    ) -> str:
        """Begin a measurement of ``names``. Returns its id at once; the play goes on behind."""
        self._busy()
        arms = await self._arms(names, models or {})
        await self._guard(arms, allow_tight, own_risk)
        self._busy()  # another start may have got in while the machine was read
        asks = self._asks()
        item = Measurement(
            id=f"{self._clock():%Y%m%d-%H%M%S}-{uuid.uuid4().hex[:6]}",
            started_at=self._now(),
            arms=arms,
            slots=[
                Slot(arm.name, mode, ask.name) for arm in arms for mode in MODES for ask in asks
            ],
            own_risk=own_risk,
            asks=[ask_wire(ask).model_dump() for ask in asks],
            rules=in_force(self._current_numbers()),
            golem_version=__version__,
        )
        self._items[item.id] = item
        self._save(item)
        self._launch(item, allow_tight, own_risk)
        return item.id

    async def resume(self, id: str, allow_tight: bool = False, own_risk: bool = False) -> str:
        """Play the runs a stopped measurement did not play. The same checks as ``start``."""
        item = self._items.get(id)
        if item is None:
            raise EvalRefused("There is no measurement with that id.")
        self._busy()
        if item.state != "stopped":
            raise EvalRefused("Only a stopped measurement can go on.")
        left = {s.arm for s in item.slots if s.end == "not_run"}
        names = {s.ask for s in item.slots if s.end == "not_run"}
        gone = names - {ask.name for ask in self._asks()}
        if gone:
            raise EvalRefused(
                f"The ask {', '.join(sorted(gone))} no longer exists, so it cannot go on."
            )
        await self._guard([arm for arm in item.arms if arm.name in left], allow_tight, own_risk)
        self._busy()
        for slot in item.slots:
            if slot.end == "not_run":
                slot.end = "pending"
        item.state, item.ended_at, item.stop_reason = "running", None, None
        item.own_risk = item.own_risk or own_risk
        self._save(item)
        self._launch(item, allow_tight, own_risk)
        return item.id

    def _launch(self, item: Measurement, allow_tight: bool, own_risk: bool) -> None:
        self._running = item
        self._why = STOPPED_BY_SHUTDOWN
        self._task = asyncio.create_task(
            self._run(item, allow_tight, own_risk), name=f"golem-eval-{item.id}"
        )

    async def stop(self, id: str) -> bool:
        """Stop the running measurement ``id``; false when it is not the one running.

        Returns after the play is cancelled and the file says ``stopped``.
        """
        task = self._task
        if self._running is None or self._running.id != id or task is None:
            return False
        self._why = STOPPED_BY_YOU
        task.cancel()
        await asyncio.wait([task])
        return True

    async def wait(self) -> None:
        """Wait until the running measurement, if any, has ended."""
        task = self._task
        if task is not None:
            await asyncio.wait([task])

    async def aclose(self) -> None:
        """Stop what runs, at shutdown. The measurement is kept as ``stopped``."""
        task = self._task
        if task is not None and not task.done():
            self._why = STOPPED_BY_SHUTDOWN
            task.cancel()
            await asyncio.wait([task])

    # --- the play

    def _notify(self, note: BaseModel) -> None:
        try:
            self._broadcast(note)
        except Exception:
            log.debug("broadcast failed", exc_info=True)

    async def _run(self, item: Measurement, allow_tight: bool, own_risk: bool) -> None:
        todo = [s for s in item.slots if s.end == "pending"]
        play = _Play(item, len(todo), time.monotonic())
        self._notify(
            EvalStartedNotification(
                params=EvalStarted(
                    id=item.id,
                    started_at=item.started_at,
                    arms=_arms_wire(item),
                    total=max(len(todo), 1),
                )
            )
        )
        scratch = Path(tempfile.mkdtemp(prefix="golem-eval-"))
        reason: str | None = None
        try:
            driver = self._driver(allow_tight, own_risk)
            for arm, mode, slots in _groups(item, todo):
                await self._play_group(driver, play, arm, mode, slots, scratch)
        except _Stop as stop:
            reason = stop.reason
        except asyncio.CancelledError:
            reason = self._why
        except Exception as exc:
            log.warning("measurement %s failed", item.id, exc_info=True)
            reason = f"It stopped on an error: {exc}"
        finally:
            if play.ticker is not None:
                play.ticker.cancel()
            shutil.rmtree(scratch, ignore_errors=True)
            self._close(item, reason)
            self._running = None
            self._notify(
                EvalEndedNotification(
                    params=EvalEndedParams(
                        id=item.id, state=cast("Any", item.state), stop_reason=item.stop_reason
                    )
                )
            )

    async def _play_group(
        self,
        driver: Driver,
        play: _Play,
        arm: Arm,
        mode: Mode,
        slots: list[Slot],
        scratch: Path,
    ) -> None:
        """Play the runs of one arm and mode, in order, and follow each."""
        why = await asyncio.to_thread(driver.unavailable, arm)
        if why is not None:
            raise _Stop(f"{arm.name} cannot run now: {why}")
        by_name = {ask.name: ask for ask in self._asks()}
        pending = iter(slots)
        current: list[Slot] = []

        def on_start(_ask: Ask) -> None:
            slot = next(pending)
            current[:] = [slot]
            slot.end = "running"
            play.index += 1
            self._save(play.item)
            self._progress(play, slot, "running")
            if arm.local:
                play.ticker = asyncio.create_task(self._tick(play, slot))

        def on_run(run: Run) -> None:
            if play.ticker is not None:
                play.ticker.cancel()
                play.ticker = None
            slot = current[0] if current else next(pending)
            if not run.ran:
                raise _Stop(self._why_ended(arm))
            slot.end, slot.run = _end_of(run), run
            self._save(play.item)
            self._progress(play, slot, slot.end)
            current.clear()

        folder = scratch / arm.name / mode
        await driver.play(
            arm, mode, [by_name[s.ask] for s in slots], self._project, folder, on_start, on_run
        )

    def _why_ended(self, arm: Arm) -> str:
        """The plain reason a local arm's play ended early: Ollama stopped, or memory ran low."""
        if not self._alive():
            return "Ollama stopped answering."
        if self._low():
            return STOPPED_LOW_MEMORY
        return f"{arm.name} stopped before it was done."

    def _progress(
        self,
        play: _Play,
        slot: Slot,
        state: str,
        memory: tuple[float | None, float | None] = (None, None),
    ) -> None:
        used, total = memory
        self._notify(
            EvalProgressNotification(
                params=EvalProgress(
                    id=play.item.id,
                    index=min(max(play.index, 1), play.total),
                    total=max(play.total, 1),
                    arm=slot.arm,
                    mode=slot.mode,
                    ask=slot.ask,
                    state=cast("Any", state),
                    elapsed=round(time.monotonic() - play.began, 3),
                    memory_used_gb=None if used is None else round(used, 2),
                    memory_total_gb=None if total is None else round(total, 2),
                )
            )
        )

    async def _tick(self, play: _Play, slot: Slot) -> None:
        """While a local run plays, send the memory now every few seconds.

        When memory runs low in the middle of a run, the measurement is stopped there: waiting
        for the run to end could be too late.
        """
        while True:
            await asyncio.sleep(self._parts.interval)
            reading = await asyncio.to_thread(self._memory)
            self._progress(play, slot, "running", reading)
            if await asyncio.to_thread(self._low) and self._task is not None:
                self._why = STOPPED_LOW_MEMORY
                self._task.cancel()
                return

    # --- reading

    def _current_numbers(self) -> DelegateSettings:
        try:
            return self._delegate()
        except Exception:
            log.debug("could not read [agents.delegate]", exc_info=True)
            return DelegateSettings()

    def _summary(self, item: Measurement, current: DelegateSettings) -> EvalSummary:
        proposal = proposal_of(item, current)
        return EvalSummary(
            id=item.id,
            started_at=item.started_at,
            ended_at=item.ended_at,
            state=cast("Any", item.state),
            stop_reason=item.stop_reason,
            arms=_arms_wire(item),
            runs_played=sum(1 for s in item.slots if s.run is not None),
            runs_total=len(item.slots),
            proposes=0 if proposal is None else sum(1 for n in proposal.numbers if n.measured),
            in_use=proposal is not None and is_in_use(item, current),
            cost_usd=_cost_of(item),
        )

    def summaries(self) -> list[EvalSummary]:
        """Every kept measurement, the newest first."""
        current = self._current_numbers()
        ordered = sorted(self._items.values(), key=lambda i: (i.started_at, i.id), reverse=True)
        return [self._summary(item, current) for item in ordered]

    def get(self, id: str) -> EvalMeasurement | None:
        item = self._items.get(id)
        if item is None:
            return None
        current = self._current_numbers()
        proposal = proposal_of(item, current)
        current_asks = {ask.name: ask for ask in self._asks()}
        kept = [EvalAsk.model_validate(a) for a in item.asks]
        if not kept:  # a file from before the asks were kept: the asks of the set now
            names = dict.fromkeys(s.ask for s in item.slots)
            kept = [ask_wire(current_asks[n]) for n in names if n in current_asks]
        return EvalMeasurement(
            id=item.id,
            started_at=item.started_at,
            ended_at=item.ended_at,
            state=cast("Any", item.state),
            stop_reason=item.stop_reason,
            arms=_arms_wire(item),
            runs=[_slot_wire(s, current_asks) for s in item.slots],
            proposal=proposal,
            in_use=proposal is not None and is_in_use(item, current),
            cost_usd=_cost_of(item),
            asks=kept,
            arm_params=[arm_params_wire(arm) for arm in item.arms],
            rules=item.rules,
            golem_version=item.golem_version,
            own_risk=item.own_risk,
        )

    # --- apply and delete

    def numbers_to_apply(self, id: str) -> dict[str, float]:
        """The measured numbers of ``id``, by key; empty when it measured none."""
        item = self._items.get(id)
        if item is None:
            raise EvalRefused("There is no measurement with that id.")
        proposal = proposal_of(item, self._current_numbers())
        if proposal is None:
            return {}
        return {n.key: n.proposed for n in proposal.numbers if n.proposed is not None}

    def mark_applied(self, id: str, values: Mapping[str, float]) -> None:
        """Remember the four numbers now in force, as the ones this measurement applied."""
        item = self._items.get(id)
        if item is None:
            return
        item.applied = {key: float(values[key]) for key in NUMBER_KEYS}
        self._save(item)

    def delete(self, id: str) -> bool:
        """Delete a measurement that is not running. False when there is no such one."""
        item = self._items.get(id)
        if item is None:
            return False
        if self._running is not None and self._running.id == id:
            raise EvalRefused("That measurement is running. Stop it first.")
        del self._items[id]
        with contextlib.suppress(FileNotFoundError):
            (self._folder / f"{id}.json").unlink()
        return True


@dataclass(slots=True)
class _Play:
    """The bookkeeping of one play: which measurement, how many runs, and how far it is."""

    item: Measurement
    total: int
    began: float
    index: int = 0
    ticker: asyncio.Task[None] | None = None


def _groups(item: Measurement, todo: Sequence[Slot]) -> list[tuple[Arm, Mode, list[Slot]]]:
    """The slots to play grouped by arm and mode, in the order planned."""
    arms = {arm.name: arm for arm in item.arms}
    groups: list[tuple[Arm, Mode, list[Slot]]] = []
    for slot in todo:
        if groups and groups[-1][0].name == slot.arm and groups[-1][1] == slot.mode:
            groups[-1][2].append(slot)
        else:
            groups.append((arms[slot.arm], slot.mode, [slot]))
    return groups


__all__ = [
    "EvalJobs",
    "EvalParts",
    "EvalRefused",
    "Measurement",
    "Slot",
    "dump",
    "load",
    "plan_arm",
    "proposal_of",
    "verdict_of",
]
