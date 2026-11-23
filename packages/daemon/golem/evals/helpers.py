"""Helpers on and off, four arms: does a helper beat doing the work in the chat? (ticket 15.4.5)

ADR-059, section 2 says golem folds by default and starts a helper for one of three reasons. The
thresholds of ``[agents.delegate]`` (``read_share``, ``fill_share``, ``job_share``,
``price_ratio``) were a first guess. This eval measures them. It plays a fixed set of asks
(``data/helper_asks.toml``) in four arms:

- ``local-32k``: a local lead with a 32K window,
- ``local-128k``: a local lead with a 128K window,
- ``budget-cloud``: a budget cloud lead,
- ``frontier-cloud``: a frontier cloud lead,

each with helpers on (``[agents] use_helpers = "when_needed"``) and off (``"never"``, which
removes the ``delegate`` tool). Every run keeps: the answer's quality, the wall time, the peak
share of the lead's window used and the tokens left, the cost of the lead and of its helpers
apart, the ``delegate`` calls, the helpers started and why each stopped.

Run it by hand:

    uv run python -m golem evals helpers                       # the plan: arms and asks, no model
    uv run python -m golem evals helpers --live                # all four arms, real models
    uv run python -m golem evals helpers --live --allow-tight  # also run a local arm that is tight
    uv run python -m golem evals helpers --live --arm local-32k --ask sweep-handlers-24
    uv run python -m golem evals helpers --live --model local-32k=ollama/qwen3.5:9b \\
        --model budget-cloud=anthropic/claude-haiku-5-5 --project .

A local arm is guarded, because a model that does not fit in memory froze a Mac (ticket 15.4.10).
Before each local arm the harness adds up the model's size on disk (from Ollama), the KV cache of
the arm's window for one slot and a fixed overhead, and compares that with this Mac's RAM
(``golem.models.hardware.fit``) and with the memory free right now. An arm that is ``too big``, or
whose need plus a 2 GB reserve is more than the free memory, is skipped with a line that gives the
numbers. One that is
``tight`` runs only with ``--allow-tight``. A size or a RAM figure that is not known skips the arm.
A local arm runs one model (the helpers use the lead's own: ``model = "same"``) and one request at
a time (``[ollama] parallel = 1``). The check counts one slot: an Ollama that was started with
``OLLAMA_NUM_PARALLEL`` above 1 holds more, and the harness cannot see that. So between two asks
the arm also stops when less than 1.5 GB is free. When Ollama stops answering during an arm, or
memory runs low, the arm stops: the
runs left (and the one that died) are ``not run``, shown in the table and left out of the
averages, of the on/off pairs and of the proposal. The plan prints the memory check of each local
arm and says "unknown" when Ollama is down.

Without ``--live`` nothing reaches a network or a model. With ``--live`` each (arm, mode) starts
a daemon in a throwaway golem home (never ``~/.golem``), so the daemon's own wiring decides the
window, the prices and the helper's model, and ``use_helpers`` is applied by the daemon. A local
arm needs Ollama up with its model pulled. A cloud arm needs a key (environment or Keychain). An
arm whose models are not there is skipped with a line, never failed. A hosted arm costs money.

Quality is the share of the ask's ``facts`` that the lead's final answer holds (see
:func:`score`). Tests play the same code against scripted models (:class:`ScriptedDriver`).
:func:`propose` turns the runs into a proposal for ``DelegateSettings``. It is a proposal only:
nothing here changes ``config.py`` (ticket 15.4.6 does, after a long live run).
"""

from __future__ import annotations

import asyncio
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import tomllib
import urllib.request
from collections.abc import Awaitable, Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field, replace
from importlib import resources
from pathlib import Path
from typing import Any, Literal, Protocol, cast

from langgraph.checkpoint.memory import InMemorySaver

from golem.agents.bundled import bundled_agents_dir
from golem.agents.registry import AgentRegistry
from golem.config import AgentSettings, DelegateSettings, GolemSettings, ModelPrice
from golem.graphs.chat import open_chat
from golem.graphs.delegate_prompt import delegate_prompt, prices_of
from golem.graphs.prompt import SystemPrompt
from golem.models.discovery import ListedModel
from golem.models.hardware import OVERHEAD_GB, Fit, fit, kv_gb, total_ram_gb
from golem.models.router import PRESETS, ModelRouter
from golem.models.tiers import Tier, blended
from golem.models.window import ContextWindow
from golem.permissions.policy import Policy
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.manager import SessionManager
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem.tools import default_registry

NOT_RUN = "not run"
"""The ``end`` of a run that did not happen: Ollama stopped answering, or memory ran low."""

FREE_RESERVE_GB = 2.0
"""Free memory an arm must leave over its need before it starts: room for what else runs."""

FREE_FLOOR_GB = 1.5
"""With less free memory than this between two asks, a local arm stops before the Mac swaps."""

Mode = Literal["on", "off"]
MODES: tuple[Mode, ...] = ("off", "on")
SETTING: dict[Mode, str] = {"on": "when_needed", "off": "never"}
"""The ``[agents] use_helpers`` value of each mode."""

COST_FACTOR = 1.5
"""A helper run may cost this many times the run that folds and still count as a win."""
QUALITY_MARGIN = 0.05
"""Quality must be this much higher (of 1.0) for a run to beat another on quality."""
LEFT_MARGIN = 0.10
"""The window left (share of the window) must be this much more for a run to beat another."""
WIN_RATE = 0.6
"""A reading share is proposed when at least this share of the pairs at or above it were won."""
SOURCE_DEFAULT = "defaults"


# --- the asks -------------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Ask:
    """One fixed ask. ``facts`` is what a good answer must contain (``a|b``: a or b)."""

    name: str
    text: str
    facts: tuple[str, ...]
    size: Literal["little", "much"]
    reason: Literal["none", "window", "at_once", "model"]
    read_tokens: int
    jobs: int = 1
    hard: bool = False
    files: Mapping[str, str] = field(default_factory=dict[str, str])
    sweep_files: int = 0
    sweep_lines: int = 0
    sweep_hits: tuple[str, ...] = ()
    needs_project: bool = False


def asks_file() -> Path:
    return Path(str(resources.files("golem.evals").joinpath("data/helper_asks.toml")))


def load_asks(path: Path | None = None) -> list[Ask]:
    """The asks of ``path`` (default: the bundled file). Raises ``ValueError`` on a bad entry."""
    source = path or asks_file()
    table = tomllib.loads(source.read_text("utf-8"))
    asks: list[Ask] = []
    for raw in cast("list[dict[str, Any]]", table.get("ask", [])):
        try:
            ask = Ask(
                name=str(raw["name"]),
                text=str(raw["text"]),
                facts=tuple(str(f) for f in raw["facts"]),
                size=raw["size"],
                reason=raw["reason"],
                read_tokens=int(raw["read_tokens"]),
                jobs=int(raw.get("jobs", 1)),
                hard=bool(raw.get("hard", False)),
                files=dict(cast("dict[str, str]", raw.get("files", {}))),
                sweep_files=int(raw.get("sweep_files", 0)),
                sweep_lines=int(raw.get("sweep_lines", 0)),
                sweep_hits=tuple(str(h) for h in raw.get("sweep_hits", ())),
                needs_project=bool(raw.get("needs_project", False)),
            )
        except KeyError as exc:
            raise ValueError(f"{source}: an ask lacks {exc}") from exc
        if ask.size not in ("little", "much") or ask.reason not in (
            "none",
            "window",
            "at_once",
            "model",
        ):
            raise ValueError(f"{source}: ask {ask.name} has a bad size or reason")
        if not ask.facts or ask.read_tokens <= 0 or ask.jobs < 1:
            raise ValueError(f"{source}: ask {ask.name} needs facts, read_tokens > 0, jobs >= 1")
        asks.append(ask)
    names = [a.name for a in asks]
    if len(set(names)) != len(names):
        raise ValueError(f"{source}: ask names are not unique")
    return asks


def materialise(ask: Ask, folder: Path, project: Path) -> Path:
    """Write the ask's files into ``folder`` and return the folder it runs in.

    An ask that needs the project runs in ``project`` and writes nothing.
    """
    if ask.needs_project:
        return project
    folder.mkdir(parents=True, exist_ok=True)
    for path, text in ask.files.items():
        target = folder / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")
    hits = dict(hit.split(":", 1) for hit in ask.sweep_hits)
    for index in range(ask.sweep_files):
        name = f"mod{index:02d}"
        lines = [f'"""Module {name}."""', ""]
        if name in hits:
            word = hits[name]
            lines += [f"def handle_{word}():", f'    return "{word}"', ""]
        step = 0
        while len(lines) < ask.sweep_lines:
            lines += [f"def filler_{index}_{step}(x):", f"    return x + {step}", ""]
            step += 1
        (folder / f"{name}.py").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return folder


def score(answer: str, facts: Sequence[str]) -> float:
    """The share of ``facts`` the ``answer`` holds, ignoring case. ``a|b`` holds when a or b does.

    This is the check of the scripted runs and the default for live ones. It rewards naming
    what a good answer names; it cannot see a wrong claim next to a right one.
    """
    if not facts:
        return 1.0
    text = answer.lower()
    held = sum(1 for fact in facts if any(alt.strip().lower() in text for alt in fact.split("|")))
    return held / len(facts)


# --- the arms -------------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Other:
    """Another model ready beside the lead: a helper can run on it. ``price`` None: local."""

    ref: str
    tier: Tier
    price: ModelPrice | None = None


@dataclass(frozen=True, slots=True)
class Arm:
    """A lead and the setup around it.

    ``lead`` is the model ref and ``window`` its window in tokens. ``others`` are the other ready
    models, which scripted runs list for the policy and the helper's pick. A live run reads the
    daemon's own listing instead and ignores ``others``.
    """

    name: str
    tier: Tier
    window: int
    lead: str
    price: ModelPrice | None = None
    others: tuple[Other, ...] = ()

    @property
    def local(self) -> bool:
        return self.tier == "local"


ARMS: tuple[Arm, ...] = (
    Arm(
        "local-32k",
        "local",
        32_768,
        "ollama/qwen3.5:9b",
    ),
    Arm(
        "local-128k",
        "local",
        131_072,
        "ollama/qwen3.5:9b",
    ),
    Arm(
        "budget-cloud",
        "budget",
        200_000,
        "anthropic/claude-haiku-5-5",
        ModelPrice(input=1.0, output=5.0),
        (
            Other("deepseek/deepseek-v4-flash", "budget", ModelPrice(input=0.14, output=0.28)),
            Other("anthropic/claude-opus-5-5", "frontier", ModelPrice(input=5.0, output=25.0)),
        ),
    ),
    Arm(
        "frontier-cloud",
        "frontier",
        200_000,
        "anthropic/claude-opus-5-5",
        ModelPrice(input=5.0, output=25.0),
        (
            Other("anthropic/claude-haiku-5-5", "budget", ModelPrice(input=1.0, output=5.0)),
            Other("deepseek/deepseek-v4-flash", "budget", ModelPrice(input=0.14, output=0.28)),
        ),
    ),
)
"""The four arms. The nominal prices (USD per million tokens) only feed scripted runs.

A local arm lists no other model: its helpers run on the lead's own (one model in memory).
"""


def with_models(arms: Sequence[Arm], models: Mapping[str, str]) -> list[Arm]:
    """``arms`` with the lead of the named arms swapped for the given refs."""
    unknown = set(models) - {arm.name for arm in arms}
    if unknown:
        raise ValueError(f"no arm named {', '.join(sorted(unknown))}")
    return [replace(arm, lead=models.get(arm.name, arm.lead)) for arm in arms]


# --- one run --------------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Run:
    """What one ask did in one arm and mode."""

    arm: str
    tier: Tier
    window: int
    ask: str
    size: str
    reason: str
    read_tokens: int
    jobs: int
    mode: Mode
    end: str  # completed | failed | cancelled | timeout | not run
    quality: float
    seconds: float
    peak_share: float  # the most of the window one call of the lead used, 0..1
    window_left: int  # the fewest tokens left in the window at any call of the lead
    lead_cost: float
    helper_cost: float
    lead_tokens: int
    helper_tokens: int
    delegate_calls: int
    helpers_started: int
    helper_stops: tuple[str, ...] = ()
    helper_models: tuple[str, ...] = ()

    @property
    def ok(self) -> bool:
        return self.end == "completed"

    @property
    def ran(self) -> bool:
        """False for a run that never happened (its arm's server died): it counts for nothing."""
        return self.end != NOT_RUN

    @property
    def cost(self) -> float:
        return self.lead_cost + self.helper_cost

    @property
    def left_share(self) -> float:
        return self.window_left / self.window if self.window else 0.0

    @property
    def read_share(self) -> float:
        """The job's reading as a share of the lead's window: what the thresholds compare."""
        return self.read_tokens / self.window if self.window else 0.0

    @property
    def lead_price(self) -> float | None:
        """USD per million tokens the lead paid on average. None when it paid nothing."""
        return _price(self.lead_cost, self.lead_tokens)

    @property
    def helper_price(self) -> float | None:
        return _price(self.helper_cost, self.helper_tokens)


def not_run(arm: Arm, mode: Mode, ask: Ask) -> Run:
    """The placeholder for a run that did not happen. Zeros, and left out of every figure."""
    return Run(
        arm=arm.name,
        tier=arm.tier,
        window=arm.window,
        ask=ask.name,
        size=ask.size,
        reason=ask.reason,
        read_tokens=ask.read_tokens,
        jobs=ask.jobs,
        mode=mode,
        end=NOT_RUN,
        quality=0.0,
        seconds=0.0,
        peak_share=0.0,
        window_left=arm.window,
        lead_cost=0.0,
        helper_cost=0.0,
        lead_tokens=0,
        helper_tokens=0,
        delegate_calls=0,
        helpers_started=0,
    )


def _price(cost: float, tokens: int) -> float | None:
    return cost / tokens * 1_000_000 if cost > 0 and tokens > 0 else None


Event = Mapping[str, Any]
"""A chat event as a plain mapping: ``{"type": ..., "data": {...}}``, as on the wire."""


def measure(
    events: Iterable[Event], arm: Arm, ask: Ask, mode: Mode, seconds: float, end: str = ""
) -> Run:
    """Turn the lead's events of one run into a :class:`Run`. Pure.

    The lead's log holds its own calls and a summary of each helper (``helper.started`` and
    ``helper.ended``), so the lead's cost sums its ``model.call.completed`` and the helpers' cost
    sums the ``helper.ended`` rows. ``window_left`` is the least the window had left at a call of
    the lead (the window less golem's estimate of the prompt).
    """
    answer = ""
    peak, left = 0.0, arm.window
    lead_cost, helper_cost, lead_tokens, helper_tokens = 0.0, 0.0, 0, 0
    delegates = 0
    models: list[str] = []
    stops: list[str] = []
    ended = end
    for event in events:
        kind = str(event.get("type"))
        data = cast("Mapping[str, Any]", event.get("data") or {})
        if kind == "model.call.started":
            used, window = data.get("estimated_tokens"), data.get("context_window") or arm.window
            if used is not None and window:
                peak = max(peak, used / window)
                left = min(left, window - used)
        elif kind == "model.call.completed":
            lead_cost += float(data.get("cost_usd") or 0)
            usage = cast("Mapping[str, Any]", data.get("usage") or {})
            lead_tokens += int(usage.get("input") or 0) + int(usage.get("output") or 0)
        elif kind == "tool.requested":
            delegates += data.get("name") == "delegate"
        elif kind == "helper.started":
            models.append(str(data.get("model")))
        elif kind == "helper.ended":
            helper_cost += float(data.get("cost_usd") or 0)
            helper_tokens += int(data.get("tokens") or 0)
            stops.append(str(data.get("stopped")))
        elif kind == "message.completed" and data.get("role") == "assistant":
            answer = str(data.get("text") or "") or answer
        elif kind in ("run.completed", "run.failed", "run.cancelled"):
            ended = kind.split(".")[1]
    return Run(
        arm=arm.name,
        tier=arm.tier,
        window=arm.window,
        ask=ask.name,
        size=ask.size,
        reason=ask.reason,
        read_tokens=ask.read_tokens,
        jobs=ask.jobs,
        mode=mode,
        end=ended or "timeout",
        quality=score(answer, ask.facts) if ended == "completed" else 0.0,
        seconds=seconds,
        peak_share=peak,
        window_left=left,
        lead_cost=lead_cost,
        helper_cost=helper_cost,
        lead_tokens=lead_tokens,
        helper_tokens=helper_tokens,
        delegate_calls=delegates,
        helpers_started=len(models),
        helper_stops=tuple(stops),
        helper_models=tuple(models),
    )


# --- drivers --------------------------------------------------------------------------------------


class Driver(Protocol):
    """Plays asks in one arm and mode. Scripted in tests, a real daemon with ``--live``."""

    def unavailable(self, arm: Arm) -> str | None:
        """Why the arm cannot run (a line for the report), or None when it can."""
        ...

    async def play(
        self, arm: Arm, mode: Mode, asks: Sequence[Ask], project: Path, scratch: Path
    ) -> list[Run]: ...


ModelFactory = Callable[[Arm, Ask, Mode], Any]
"""Gives the scripted chat model (a LangChain chat model) for an arm, an ask and a mode."""


class ScriptedDriver:
    """The real chat graph, tools, ``delegate`` and session manager, with scripted models.

    ``models`` makes the model of one run. It answers the lead and its helpers in turn, so its
    script holds the calls of both. ``unavailable`` names arms to skip and why. Nothing touches a
    network. ``timeout`` bounds the wait for a run.
    """

    def __init__(
        self,
        models: ModelFactory,
        *,
        unavailable: Mapping[str, str] | None = None,
        timeout: float = 20.0,
    ) -> None:
        self._models = models
        self._unavailable = dict(unavailable or {})
        self._timeout = timeout

    def unavailable(self, arm: Arm) -> str | None:
        return self._unavailable.get(arm.name)

    async def play(
        self, arm: Arm, mode: Mode, asks: Sequence[Ask], project: Path, scratch: Path
    ) -> list[Run]:
        runs: list[Run] = []
        for ask in asks:
            runs.append(await self._one(arm, mode, ask, project, scratch / ask.name))
        return runs

    async def _one(self, arm: Arm, mode: Mode, ask: Ask, project: Path, scratch: Path) -> Run:
        folder = materialise(ask, scratch / "project", project)
        home = scratch / "home"
        home.mkdir(parents=True)
        config = home / "config.toml"
        config.write_text(
            '[[rule]]\ntool = "edit_file"\naction = "allow"\n'
            '[[rule]]\ntool = "shell_unsandboxed"\naction = "allow"\n',
            encoding="utf-8",
        )
        members: list[tuple[str, Tier, ModelPrice | None]] = [
            (arm.lead, arm.tier, arm.price),
            *((o.ref, o.tier, o.price) for o in arm.others),
        ]
        listed = tuple(
            ListedModel(
                ref=ref,
                label=ref,
                provider=ref.partition("/")[0],
                source="catalog",
                status="ready",
                price=price,
                tier=tier,
                tools=True,
            )
            for ref, tier, price in members
        )
        by_ref = {m.ref: m for m in listed}
        lead_blend = None if arm.price is None else blended(arm.price)
        prices = prices_of(arm.lead, arm.tier, lead_blend, listed)
        settings = GolemSettings(
            default_model=arm.lead,
            agents=AgentSettings(use_helpers=SETTING[mode]),  # type: ignore[arg-type]
        )
        registry = default_registry()
        agents = AgentRegistry(
            AgentSettings(),
            golem_agents=home / "agents",
            trusted=lambda _root: False,
            bundled=bundled_agents_dir(),
        )

        def writes(name: str) -> bool:
            tool = registry.get(name)
            return tool is not None and not tool.read_only

        model = self._models(arm, ask, mode)
        router = _FixedRouter(settings, model=model)

        def price_of(profile: str) -> ModelPrice | None:
            found = by_ref.get(profile)
            return found.price if found is not None else arm.price

        def tier_of(profile: str) -> Tier | None:
            found = by_ref.get(profile)
            return found.tier if found is not None else arm.tier

        started = time.monotonic()
        async with Database.open(scratch / "golem.db") as database:
            runtime = open_chat(
                router,
                InMemorySaver(),
                registry,
                Policy(config, home=home),
                prompt=SystemPrompt(
                    sections=(
                        delegate_prompt(
                            lambda root: agents.view(root).usable(),
                            writes,
                            settings.agents.delegate,
                        ),
                    )
                ),
                window_of=lambda _profile, _options: ContextWindow(window=arm.window),
                price_of=price_of,
                tier_of=tier_of,
                helper_prices=lambda _profile: prices,
                budget_refs=lambda: [m.ref for m in listed if m.tier == "budget"],
            )
            events = EventLog(database)
            runs = RunRecords(database)
            records = SessionRecords(database)
            manager = SessionManager(
                runtime, SessionLog(events, EventBus(), records), records, runs, agents=agents
            )
            session_id = await manager.create(None, cwd=str(folder))
            run_id = await manager.send(session_id, ask.text)
            end = "timeout"
            try:
                async with asyncio.timeout(self._timeout):
                    while (run := await runs.get(run_id)) is None or run.status in (
                        "running",
                        "waiting",
                    ):
                        await asyncio.sleep(0.01)
                end = "completed" if run.status == "completed" else run.status
            except TimeoutError:
                pass
            seconds = time.monotonic() - started
            log = await events.for_run(run_id)
            plain = [json.loads(e.model_dump_json()) for e in log]
        return measure(plain, arm, ask, mode, seconds, end)


class _FixedRouter(ModelRouter):
    """Gives its one scripted model for any profile."""

    def chat_model(self, profile: str, overrides: Any = None, *, local_only: bool = False) -> Any:
        del overrides
        if local_only:
            self.ensure_local(profile)
        return self._model


# --- the live driver ------------------------------------------------------------------------------


OLLAMA_TAGS = "http://127.0.0.1:11434/api/tags"


def ollama_sizes() -> dict[str, int] | None:
    """The models Ollama has, name to size on disk in bytes, or None when it is not reachable."""
    try:
        with urllib.request.urlopen(OLLAMA_TAGS, timeout=3) as reply:
            body = json.load(reply)
    except (OSError, ValueError):
        return None
    return {str(m.get("name")): int(m.get("size") or 0) for m in body.get("models", [])}


def parse_vm_stat(text: str) -> float | None:
    """GiB of memory that is free now, from the output of macOS ``vm_stat``. None if unreadable.

    It adds the free, inactive and speculative pages: what the system gives back at once.
    """
    head = re.search(r"page size of (\d+) bytes", text)
    if head is None:
        return None
    pages = 0
    seen = 0
    for key in ("free", "inactive", "speculative"):
        found = re.search(rf"^Pages {key}:\s+(\d+)", text, re.MULTILINE)
        if found is not None:
            pages += int(found.group(1))
            seen += 1
    return pages * int(head.group(1)) / 2**30 if seen else None


def free_memory_gb() -> float | None:
    """GiB of memory free right now (macOS ``vm_stat``), or None when it cannot be read."""
    try:
        out = subprocess.run(["vm_stat"], capture_output=True, text=True, timeout=3, check=True)
    except (OSError, subprocess.SubprocessError):
        return None
    return parse_vm_stat(out.stdout)


@dataclass(frozen=True, slots=True)
class Machine:
    """What this Mac and its Ollama say: RAM and free memory in GiB, and the models' sizes in bytes.

    ``sizes`` is None when Ollama is not reachable. A figure that is not known is None.
    """

    ram_gb: float | None = None
    free_gb: float | None = None
    sizes: Mapping[str, int] | None = None


def read_machine() -> Machine:
    """The real machine, read now: three probes, none of which loads a model."""
    return Machine(total_ram_gb(), free_memory_gb(), ollama_sizes())


def model_size_gb(sizes: Mapping[str, int] | None, name: str) -> float | None:
    """The size on disk of the Ollama model ``name`` in GiB, or None when it is not known."""
    if sizes is None:
        return None
    size = sizes.get(name) or sizes.get(f"{name}:latest")
    return size / 2**30 if size else None


@dataclass(frozen=True, slots=True)
class MemoryCheck:
    """Whether a local arm's model fits: what it needs against RAM and the free memory."""

    model_gb: float | None
    window: int
    ram_gb: float | None
    free_gb: float | None

    @property
    def cache_gb(self) -> float:
        """The KV cache of the arm's window, for one slot."""
        return kv_gb(self.window, slots=1)

    @property
    def need_gb(self) -> float | None:
        if self.model_gb is None:
            return None
        return self.model_gb + self.cache_gb + OVERHEAD_GB

    @property
    def fit(self) -> Fit | None:
        """The rule of :mod:`golem.models.hardware`, or None when the size or the RAM is unknown."""
        if self.model_gb is None or self.ram_gb is None:
            return None
        return fit(self.model_gb, self.ram_gb, self.window, slots=1)

    @property
    def short(self) -> bool:
        """Less memory is free now than the need plus the reserve (False when either is unknown)."""
        need = self.need_gb
        if need is None or self.free_gb is None:
            return False
        return self.free_gb < need + FREE_RESERVE_GB

    @property
    def verdict(self) -> str:
        if self.fit is None:
            return "unknown"
        return "too big" if self.fit == "too_big" else self.fit

    def numbers(self) -> str:
        """The figures in GB, for a line of the report."""

        def gb(value: float | None) -> str:
            return "unknown" if value is None else f"{value:.1f} GB"

        return (
            f"needs {gb(self.need_gb)} (model {gb(self.model_gb)} + cache {self.cache_gb:.1f} GB "
            f"at {self.window:,} tokens, one slot + overhead {OVERHEAD_GB:.1f} GB), "
            f"RAM {gb(self.ram_gb)}, free now {gb(self.free_gb)}"
        )

    def skip(self, allow_tight: bool = False) -> str | None:
        """Why the arm must not run (a line with the numbers), or None when it may.

        Skipped: the size or the RAM unknown, ``too big``, free memory known and below the need,
        and ``tight`` unless ``allow_tight``.
        """
        fits = self.fit
        if fits is None:
            return f"memory not known, so not run to be safe: {self.numbers()}"
        if fits == "too_big":
            return f"too big for this Mac: {self.numbers()}"
        if self.short:
            return (
                f"not enough free memory (the need plus a {FREE_RESERVE_GB:.1f} GB reserve): "
                f"{self.numbers()}"
            )
        if fits == "tight" and not allow_tight:
            return f"tight (run it with --allow-tight): {self.numbers()}"
        return None


def memory_check(arm: Arm, machine: Machine) -> MemoryCheck:
    """The memory check of a local arm on ``machine``. Pure."""
    name = arm.lead.partition("/")[2]
    return MemoryCheck(
        model_size_gb(machine.sizes, name), arm.window, machine.ram_gb, machine.free_gb
    )


def provider_key_found(provider: str) -> bool:
    """Whether a key for the provider is in the environment or the Keychain."""
    from golem.models.keys import ProviderKeys
    from golem.secrets import KeychainSecrets

    preset = PRESETS.get(provider)
    if preset is not None and preset.api_key_env and os.environ.get(preset.api_key_env):
        return True
    try:
        return ProviderKeys(KeychainSecrets()).get(provider) is not None
    except Exception:
        return False


class _Client:
    """A line-delimited JSON-RPC client of the daemon's socket."""

    def __init__(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        self.reader, self.writer = reader, writer
        self.next_id = 1
        self.events: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self.waiters: dict[int, asyncio.Future[dict[str, Any]]] = {}
        self.pump = asyncio.create_task(self._pump())

    async def _pump(self) -> None:
        while line := await self.reader.readline():
            message = json.loads(line)
            waiter = self.waiters.pop(message["id"], None) if "id" in message else None
            if waiter is not None:
                waiter.set_result(message)
            elif message.get("method") == "event":
                await self.events.put(message["params"])

    async def call(self, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        request_id, self.next_id = self.next_id, self.next_id + 1
        waiter: asyncio.Future[dict[str, Any]] = asyncio.get_running_loop().create_future()
        self.waiters[request_id] = waiter
        body = {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params or {}}
        self.writer.write(json.dumps(body).encode() + b"\n")
        await self.writer.drain()
        reply = await asyncio.wait_for(waiter, timeout=60)
        if "error" in reply:
            raise RuntimeError(f"{method}: {reply['error']}")
        return cast("dict[str, Any]", reply["result"])


def ollama_alive() -> bool:
    """Whether Ollama answers now. The probe after a failed run."""
    return ollama_sizes() is not None


def memory_low() -> bool:
    """Whether less than ``FREE_FLOOR_GB`` is free now. False when it cannot be read."""
    free = free_memory_gb()
    return free is not None and free < FREE_FLOOR_GB


LOCAL_HELPERS = ("explorer", "worker", "reviewer", "advisor")
"""The bundled helper types. In a local arm each is told ``model = "same"``: the lead's model."""


def arm_config(arm: Arm, mode: Mode) -> str:
    """The ``config.toml`` of the throwaway golem home of one arm and mode.

    A local arm sets its window, one Ollama slot (``[ollama] parallel = 1``) and, for every
    bundled helper type, ``model = "same"``, so no second model is ever loaded.
    """
    config = f'default_model = "t"\n[models.t]\nmodel = "{arm.lead}"\n'
    if arm.local:
        config += f"ctx = {arm.window}\n"
    config += f'[agents]\nuse_helpers = "{SETTING[mode]}"\n'
    if arm.local:
        config += "[ollama]\nparallel = 1\n"
        config += "".join(f'[agents.{name}]\nmodel = "same"\n' for name in LOCAL_HELPERS)
    return config + '[permissions]\nmode = "autopilot"\n'


async def play_until_dead(
    arm: Arm,
    mode: Mode,
    asks: Sequence[Ask],
    one: Callable[[Ask], Awaitable[Run]],
    alive: Callable[[], bool] | None = None,
    low: Callable[[], bool] | None = None,
) -> list[Run]:
    """Play ``asks`` with ``one``. A local arm ends when its server dies or memory runs low.

    After a run that did not complete, ``alive`` is asked (a local arm only). When it says no,
    that run and every one after it are ``not run``: the run died with the server, so its failure
    says nothing about helpers. Before each ask of a local arm ``low`` is asked. When it says
    yes, that ask and every one after it are ``not run``, so the arm stops before the Mac swaps.
    """
    runs: list[Run] = []
    dead = False
    for ask in asks:
        dead = dead or (arm.local and low is not None and low())
        if dead:
            runs.append(not_run(arm, mode, ask))
            continue
        run = await one(ask)
        if not run.ok and arm.local and alive is not None and not alive():
            dead = True
            run = not_run(arm, mode, ask)
        runs.append(run)
    return runs


class LiveDriver:
    """Real models, through a real daemon in a throwaway golem home.

    A local arm needs Ollama up with the lead's model pulled, and the model must fit in memory
    (:class:`MemoryCheck`; ``allow_tight`` lets a tight one run). A cloud arm needs a key for the
    lead's provider. The daemon applies ``use_helpers`` and picks the helper's model from the
    models that are ready on this machine, so a cloud arm's helper is whatever is ready. A local
    arm's helpers run on the lead's own model. ``machine`` reads RAM, free memory and Ollama's
    model sizes, and ``alive`` says whether Ollama still answers: both can be injected.
    """

    def __init__(
        self,
        *,
        timeout: float = 600.0,
        allow_tight: bool = False,
        machine: Callable[[], Machine] | None = None,
        alive: Callable[[], bool] | None = None,
        low: Callable[[], bool] | None = None,
    ):
        self._low = low or memory_low
        self._timeout = timeout
        self._allow_tight = allow_tight
        self._machine = machine or read_machine
        self._alive = alive or ollama_alive

    def unavailable(self, arm: Arm) -> str | None:
        provider, _, name = arm.lead.partition("/")
        if provider == "ollama":
            machine = self._machine()
            have = machine.sizes
            if have is None:
                return f"Ollama is not reachable at {OLLAMA_TAGS}"
            if name not in have and f"{name}:latest" not in have:
                return f"Ollama does not have {name} (ollama pull {name})"
            return memory_check(arm, machine).skip(self._allow_tight)
        if not provider_key_found(provider):
            return f"no key for {provider} in the environment or the Keychain"
        return None

    async def play(
        self, arm: Arm, mode: Mode, asks: Sequence[Ask], project: Path, scratch: Path
    ) -> list[Run]:
        from golem_protocol import PROTOCOL_MAJOR

        root = Path(tempfile.mkdtemp(prefix="gh", dir="/var/tmp")).resolve()
        home, user = root / "g", root / "h"
        for folder in (home, user):
            folder.mkdir(parents=True)
        (home / "config.toml").write_text(arm_config(arm, mode), "utf-8")
        env = {**os.environ, "GOLEM_HOME": str(home), "HOME": str(user)}
        daemon = subprocess.Popen(
            [sys.executable, "-m", "golem.cli", "serve"], env=env, stderr=subprocess.DEVNULL
        )
        try:
            socket = home / "run" / "golem.sock"
            for _ in range(150):
                if socket.exists():
                    break
                await asyncio.sleep(0.2)
            reader, writer = await asyncio.open_unix_connection(str(socket))
            client = _Client(reader, writer)
            hello = {"protocol_major": PROTOCOL_MAJOR, "protocol_minor": 0, "client": "tui"}
            await client.call("hello", hello)

            async def one(ask: Ask) -> Run:
                folder = materialise(ask, scratch / mode / ask.name, project)
                return await self._one(client, arm, mode, ask, folder)

            runs = await play_until_dead(arm, mode, asks, one, self._alive, self._low)
        finally:
            daemon.terminate()
            try:
                daemon.wait(timeout=10)
            except subprocess.TimeoutExpired:
                daemon.kill()
            shutil.rmtree(root, ignore_errors=True)
        return runs

    async def _one(self, client: _Client, arm: Arm, mode: Mode, ask: Ask, folder: Path) -> Run:
        created = await client.call("session.create", {"cwd": str(folder)})
        session_id = created["session_id"]
        await client.call("session.attach", {"session_id": session_id, "after_seq": 0})
        while not client.events.empty():
            client.events.get_nowait()
        started = time.monotonic()
        await client.call("message.send", {"session_id": session_id, "text": ask.text})
        events: list[dict[str, Any]] = []
        end = "timeout"
        deadline = started + self._timeout
        while time.monotonic() < deadline:
            try:
                event = await asyncio.wait_for(client.events.get(), deadline - time.monotonic())
            except TimeoutError:
                break
            if event.get("session_id") not in (None, session_id):
                continue
            events.append(event)
            kind = str(event.get("type"))
            if kind in ("run.completed", "run.failed", "run.cancelled"):
                end = kind.split(".")[1]
                break
        return measure(events, arm, ask, mode, time.monotonic() - started, end)


# --- the report -----------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class ArmResult:
    """An arm's runs, or why it was skipped."""

    arm: Arm
    skipped: str | None = None
    runs: tuple[Run, ...] = ()


async def run_eval(
    driver: Driver,
    asks: Sequence[Ask],
    arms: Sequence[Arm] = ARMS,
    *,
    project: Path | None = None,
    scratch: Path | None = None,
) -> list[ArmResult]:
    """Play ``asks`` in each arm, helpers off then on. An arm the driver cannot run is skipped.

    An arm with a run that did not happen (its server died) plays no more runs.
    """
    keep = scratch is not None
    base = scratch or Path(tempfile.mkdtemp(prefix="golem-helpers-eval-"))
    results: list[ArmResult] = []
    try:
        for arm in arms:
            reason = driver.unavailable(arm)
            if reason is not None:
                results.append(ArmResult(arm, skipped=reason))
                continue
            runs: list[Run] = []
            for mode in MODES:
                if any(not r.ran for r in runs):  # the arm's server died: the rest does not run
                    runs += [not_run(arm, mode, ask) for ask in asks]
                    continue
                folder = base / arm.name / mode
                runs += await driver.play(arm, mode, asks, project or Path.cwd(), folder)
            results.append(ArmResult(arm, runs=tuple(runs)))
    finally:
        if not keep:
            shutil.rmtree(base, ignore_errors=True)
    return results


def _money(value: float) -> str:
    return "0" if value == 0 else f"${value:.4f}"


def _table(rows: Sequence[Sequence[str]]) -> list[str]:
    widths = [max(len(row[i]) for row in rows) for i in range(len(rows[0]))]
    return ["  ".join(cell.ljust(widths[i]) for i, cell in enumerate(row)).rstrip() for row in rows]


def arm_table(result: ArmResult) -> str:
    """The table of one arm: two rows an ask, helpers off then on, then totals."""
    arm = result.arm
    title = f"== {arm.name}: {arm.lead}, window {arm.window:,}, {arm.tier}"
    if result.skipped is not None:
        return f"{title}\nskipped: {result.skipped}"
    rows = [
        (
            "ask",
            "size",
            "helpers",
            "end",
            "quality",
            "seconds",
            "peak window",
            "left",
            "lead $",
            "helper $",
            "delegates",
            "helpers",
            "stopped",
        )
    ]
    for run in result.runs:
        rows.append(
            (
                run.ask,
                run.size,
                run.mode,
                run.end,
                f"{run.quality:.2f}",
                f"{run.seconds:.1f}",
                f"{run.peak_share:.0%}",
                f"{run.window_left:,}",
                _money(run.lead_cost),
                _money(run.helper_cost),
                str(run.delegate_calls),
                str(run.helpers_started),
                ",".join(run.helper_stops) or "-",
            )
        )
    lines = [title, *_table(rows)]
    unrun = sum(1 for r in result.runs if not r.ran)
    if unrun:
        lines.append(
            f"{unrun} runs not run (Ollama stopped answering, or memory ran low), "
            "left out of the figures below"
        )
    for mode in MODES:
        runs = [r for r in result.runs if r.mode == mode and r.ran]
        if not runs:
            continue
        lines.append(
            f"helpers {mode}: quality {_mean([r.quality for r in runs]):.2f} · "
            f"{sum(r.seconds for r in runs):.1f}s · "
            f"peak window {max(r.peak_share for r in runs):.0%}"
            f" · lead {_money(sum(r.lead_cost for r in runs))}"
            f" + helpers {_money(sum(r.helper_cost for r in runs))}"
            f" · {sum(r.delegate_calls for r in runs)} delegate calls,"
            f" {sum(r.helpers_started for r in runs)} helpers"
        )
    return "\n".join(lines)


def _mean(values: Sequence[float]) -> float:
    return sum(values) / len(values) if values else 0.0


# --- the threshold proposal -----------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Pair:
    """The same ask in the same arm with helpers off and on, both finished."""

    off: Run
    on: Run

    @property
    def name(self) -> str:
        return f"{self.on.arm}/{self.on.ask}"

    @property
    def cheap_enough(self) -> bool:
        """Helpers did not cost more than ``COST_FACTOR`` times folding. Free stays free."""
        if self.off.cost == 0:
            return self.on.cost == 0
        return self.on.cost <= COST_FACTOR * self.off.cost

    @property
    def better_quality(self) -> bool:
        return self.on.quality >= self.off.quality + QUALITY_MARGIN

    @property
    def more_room(self) -> bool:
        """At least as good an answer, and clearly more window left."""
        return (
            self.on.quality >= self.off.quality - 1e-9
            and self.on.left_share >= self.off.left_share + LEFT_MARGIN
        )

    @property
    def win(self) -> bool:
        """On beat off on quality or window left, without costing over the stated factor."""
        return (
            self.on.helpers_started > 0
            and (self.better_quality or self.more_room)
            and (self.cheap_enough)
        )

    @property
    def folding_lost(self) -> bool:
        """Folding gave a worse answer, or failed, where helpers answered."""
        return self.on.ok and (
            not self.off.ok or self.off.quality + QUALITY_MARGIN <= self.on.quality
        )

    @property
    def ratio(self) -> float | None:
        """How many times dearer the lead's tokens were than the helpers'. None: not known."""
        lead = self.off.lead_price or self.on.lead_price
        helper = self.on.helper_price
        if lead is None or helper is None or helper <= 0:
            return None
        return lead / helper

    @property
    def saved(self) -> bool:
        return self.off.cost > 0 and self.on.cost < self.off.cost


def pairs_of(runs: Iterable[Run]) -> list[Pair]:
    """Pair each off run with the on run of the same arm and ask. Unfinished runs are left out."""
    by_key: dict[tuple[str, str, Mode], Run] = {(r.arm, r.ask, r.mode): r for r in runs}
    found: list[Pair] = []
    for (arm, ask, mode), off in by_key.items():
        on = by_key.get((arm, ask, "on"))
        if mode == "off" and on is not None and off.ok and on.ok:
            found.append(Pair(off, on))
    return found


@dataclass(frozen=True, slots=True)
class Suggestion:
    """One key of ``DelegateSettings``: the current value, a proposed one and why."""

    key: str
    current: float
    proposed: float | None
    why: str


@dataclass(frozen=True, slots=True)
class Proposal:
    """A proposal for ``[agents.delegate]``, with the numbers behind it. Never applied."""

    suggestions: tuple[Suggestion, ...]
    pairs: int
    wins: int

    def render(self) -> str:
        lines = [
            "== proposed thresholds for [agents.delegate]  (a PROPOSAL from this run's data, "
            "not applied; ticket 15.4.6 decides)",
            f"rule: a helper run wins when it beat folding on quality (>= +{QUALITY_MARGIN:.2f}) "
            f"or on window left (>= +{LEFT_MARGIN:.0%} of the window) at the same or better "
            f"quality, and cost no more than {COST_FACTOR}x folding. "
            f"{self.wins} of {self.pairs} pairs won.",
        ]
        for item in self.suggestions:
            shown = "no proposal" if item.proposed is None else f"{item.proposed:g}"
            lines.append(f"{item.key} = {shown}  (now {item.current:g}): {item.why}")
        return "\n".join(lines)

    def settings(self, base: DelegateSettings | None = None) -> DelegateSettings:
        """``DelegateSettings`` with the proposed values, for a caller that wants to try them."""
        values = {s.key: s.proposed for s in self.suggestions if s.proposed is not None}
        return (base or DelegateSettings()).model_copy(update=values)


def _down(value: float, step: float) -> float:
    return max(step, math.floor(value / step + 1e-9) * step)


def propose(runs: Iterable[Run], current: DelegateSettings | None = None) -> Proposal:
    """Propose ``read_share``, ``fill_share``, ``job_share`` and ``price_ratio`` from ``runs``.

    - ``read_share``: of the pairs sorted by the job's reading share (its ``read_tokens`` over
      the lead's window), the smallest share at which at least ``WIN_RATE`` of the pairs at or
      above it were won; rounded down to 0.05.
    - ``fill_share``: the smallest peak share of the window that a folding run reached when it
      did worse than the helper run (or failed); rounded down to 0.05.
    - ``job_share``: the smallest reading per job (a share of the window) of a won pair on a
      cloud lead with independent jobs or a reason of ``model``; rounded down to 0.05. A local
      lead never starts helpers for these reasons (the policy), so local pairs are left out.
    - ``price_ratio``: the smallest ratio of the lead's price to the helpers' price (from the
      cost per token seen in the events) among cloud pairs where helpers cost less than
      folding; rounded down to 0.5.
    """
    cfg = current or DelegateSettings()
    pairs = pairs_of(runs)
    wins = [p for p in pairs if p.win]
    out: list[Suggestion] = []

    # read_share
    by_share = sorted(pairs, key=lambda p: p.on.read_share)
    chosen: float | None = None
    detail = "no pair was won, so helpers never beat folding in this data"
    if wins:
        detail = "no share held a win rate of " + f"{WIN_RATE:.0%}"
    for candidate in sorted({p.on.read_share for p in wins}):
        at_or_above = [p for p in by_share if p.on.read_share >= candidate - 1e-12]
        won = sum(1 for p in at_or_above if p.win)
        if won / len(at_or_above) >= WIN_RATE:
            chosen = candidate
            below = [p for p in pairs if p.on.read_share < candidate and not p.win]
            top = max((p.on.read_share for p in below), default=None)
            detail = (
                f"smallest reading share where helpers won and held {won} of "
                f"{len(at_or_above)} pairs at or above it: {candidate:.3f} "
                f"({', '.join(sorted(p.name for p in wins if p.on.read_share == candidate))})"
                + (
                    ""
                    if top is None
                    else f"; the biggest share folding was enough for below it: {top:.3f}"
                )
            )
            break
    out.append(
        Suggestion(
            "read_share",
            cfg.read_share,
            None if chosen is None else min(_down(chosen, 0.05), 1.0),
            detail,
        )
    )

    # fill_share
    lost = [p for p in pairs if p.folding_lost]
    if lost:
        low = min(lost, key=lambda p: p.off.peak_share)
        out.append(
            Suggestion(
                "fill_share",
                cfg.fill_share,
                min(_down(low.off.peak_share, 0.05), 1.0),
                f"folding lost on {len(lost)} pairs; the lowest peak window it reached was "
                f"{low.off.peak_share:.0%} ({low.name})",
            )
        )
    else:
        out.append(
            Suggestion("fill_share", cfg.fill_share, None, "folding never lost in this data")
        )

    # job_share
    jobs = [
        p
        for p in wins
        if p.on.tier != "local" and (p.on.jobs >= 2 or p.on.reason in ("at_once", "model"))
    ]
    if jobs:
        low = min(jobs, key=lambda p: p.on.read_share / p.on.jobs)
        each = low.on.read_share / low.on.jobs
        out.append(
            Suggestion(
                "job_share",
                cfg.job_share,
                min(_down(each, 0.05), 1.0),
                f"{len(jobs)} won pairs on cloud leads with several jobs or a model reason; "
                f"the smallest reading per job was {each:.3f} of the window ({low.name})",
            )
        )
    else:
        out.append(
            Suggestion("job_share", cfg.job_share, None, "no cloud pair with several jobs was won")
        )

    # price_ratio
    cheaper = [p for p in wins if p.on.tier != "local" and p.ratio is not None and p.saved]
    if cheaper:
        low = min(cheaper, key=lambda p: cast(float, p.ratio))
        ratio = cast(float, low.ratio)
        costly = [p for p in pairs if p.ratio is not None and not p.saved and p.on.helpers_started]
        top = max((cast(float, p.ratio) for p in costly), default=None)
        out.append(
            Suggestion(
                "price_ratio",
                cfg.price_ratio,
                max(1.5, _down(ratio, 0.5)),
                f"{len(cheaper)} cloud pairs where helpers cost less than folding; the smallest "
                f"lead-to-helper price ratio among them was {ratio:.1f}x ({low.name})"
                + (
                    ""
                    if top is None
                    else f"; the biggest ratio where helpers still cost more: {top:.1f}x"
                ),
            )
        )
    else:
        out.append(
            Suggestion(
                "price_ratio",
                cfg.price_ratio,
                None,
                "no cloud pair showed helpers costing less than folding with a known price ratio",
            )
        )
    return Proposal(tuple(out), len(pairs), len(wins))


# --- the open question of the ADR -----------------------------------------------------------------


def open_question(runs: Iterable[Run]) -> str:
    """The data for ADR-059's open question: large sweeps on a cloud lead, or on a cheaper model.

    For each cloud arm, over the asks that read much, it compares folding (the lead does the
    sweep) with helpers on (the sweep goes to a helper): quality, cost split in lead and helpers,
    and the helper's models and its price against the lead's. Data only, no verdict.
    """
    lines = [
        "== open question of ADR-059: does a cloud lead hand large sweeps to a cheaper model "
        "by default? (data, not a verdict)"
    ]
    cloud = [p for p in pairs_of(runs) if p.on.tier != "local" and p.on.size == "much"]
    if not cloud:
        lines.append("no large sweep ran in a cloud arm")
        return "\n".join(lines)
    for arm in dict.fromkeys(p.on.arm for p in cloud):
        group = [p for p in cloud if p.on.arm == arm]
        handed = [p for p in group if p.on.helpers_started > 0]
        models = sorted({m for p in handed for m in p.on.helper_models})
        ratios = [r for p in handed if (r := p.ratio) is not None]
        lines.append(
            f"{arm}: {len(group)} large sweeps, {len(handed)} handed to a helper"
            + (f" (models {', '.join(models)})" if models else "")
        )
        lines.append(
            f"  on the lead (helpers off): quality {_mean([p.off.quality for p in group]):.2f}, "
            f"cost {_money(sum(p.off.cost for p in group))}, "
            f"peak window {max(p.off.peak_share for p in group):.0%}"
        )
        lines.append(
            f"  helpers on: quality {_mean([p.on.quality for p in group]):.2f}, cost "
            f"{_money(sum(p.on.cost for p in group))} "
            f"(lead {_money(sum(p.on.lead_cost for p in group))}"
            f" + helpers {_money(sum(p.on.helper_cost for p in group))}), "
            f"peak window {max(p.on.peak_share for p in group):.0%}"
            + (f", lead/helper price ratio {_mean(ratios):.1f}x" if ratios else "")
        )
    return "\n".join(lines)


def full_report(results: Sequence[ArmResult]) -> str:
    """The table of every arm, the threshold proposal and the data for the open question."""
    runs = [run for result in results for run in result.runs]
    parts = [arm_table(result) for result in results]
    parts.append(propose(runs).render())
    parts.append(open_question(runs))
    return "\n\n".join(parts)


# --- the command ----------------------------------------------------------------------------------


def plan(arms: Sequence[Arm], asks: Sequence[Ask], machine: Machine | None = None) -> str:
    """What ``--live`` would run, with no model called.

    For each local arm it says the memory needed, the RAM, the free memory and ``fits`` /
    ``tight`` / ``too big`` (``unknown`` when Ollama or the figure is not there).
    """
    lines = ["helper eval plan (nothing ran; pass --live to run it against real models)", ""]
    lines.append("arms (each with helpers on = when_needed and off = never):")
    for arm in arms:
        lines.append(f"  {arm.name}: {arm.lead}, window {arm.window:,}, {arm.tier}")
        if arm.local:
            check = memory_check(arm, machine or Machine())
            lines.append(f"    memory: {check.verdict}; {check.numbers()}")
    lines += ["", "asks:"]
    for ask in asks:
        extra = " (about --project)" if ask.needs_project else ""
        lines.append(
            f"  {ask.name}: {ask.size}, reason {ask.reason}, ~{ask.read_tokens:,} tokens{extra}"
        )
    lines.append(f"\n{len(arms) * len(asks) * 2} runs")
    return "\n".join(lines)


def command(
    *,
    live: bool,
    arm_names: Sequence[str] = (),
    ask_names: Sequence[str] = (),
    models: Sequence[str] = (),
    project: Path | None = None,
    timeout: float = 600.0,
    allow_tight: bool = False,
    driver: Driver | None = None,
    machine: Callable[[], Machine] = read_machine,
    out: Callable[[str], None] = print,
) -> int:
    """``golem evals helpers``. 0 when it ran or planned; 1 for an unknown arm, ask or model."""
    try:
        swaps = dict(item.split("=", 1) for item in models)
        arms = with_models(ARMS, swaps)
        asks = load_asks()
    except ValueError as exc:
        out(str(exc))
        return 1
    if arm_names:
        unknown = set(arm_names) - {a.name for a in arms}
        if unknown:
            out(
                f"no arm named {', '.join(sorted(unknown))}; "
                f"the arms are {', '.join(a.name for a in arms)}"
            )
            return 1
        arms = [a for a in arms if a.name in arm_names]
    if ask_names:
        unknown = set(ask_names) - {a.name for a in asks}
        if unknown:
            out(
                f"no ask named {', '.join(sorted(unknown))}; "
                f"the asks are {', '.join(a.name for a in asks)}"
            )
            return 1
        asks = [a for a in asks if a.name in ask_names]
    if not live and driver is None:
        out(plan(arms, asks, machine() if any(a.local for a in arms) else None))
        return 0
    chosen: Driver = driver or LiveDriver(timeout=timeout, allow_tight=allow_tight)
    results = asyncio.run(run_eval(chosen, asks, arms, project=(project or Path.cwd()).resolve()))
    out(full_report(results))
    return 0


__all__ = [
    "ARMS",
    "Arm",
    "ArmResult",
    "Ask",
    "Driver",
    "LiveDriver",
    "Machine",
    "MemoryCheck",
    "Pair",
    "Proposal",
    "Run",
    "ScriptedDriver",
    "arm_config",
    "arm_table",
    "command",
    "full_report",
    "load_asks",
    "measure",
    "memory_check",
    "not_run",
    "open_question",
    "pairs_of",
    "parse_vm_stat",
    "plan",
    "play_until_dead",
    "propose",
    "run_eval",
    "score",
]
