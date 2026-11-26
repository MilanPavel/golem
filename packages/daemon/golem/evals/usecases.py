"""The four use cases of the sub-agents design, as scenarios with pass conditions (ticket 15.11.1).

The design page (``golem-docs/mocks/sub-agents/usecases.html``) follows four requests from the
prompt to the answer. This harness plays each of them against a throwaway project and checks the
session's events and records, never the model's prose:

- ``broad-question``: explorers read in parallel and the lead's window stays small.
- ``stuck-bug``: the lead asks the advisor, at most once per message, and uses the answer.
- ``sweep``: many read jobs in one batch; never more than ``at_once`` run at the same time.
- ``upgrades``: five workers in copies return diffs and checks, the green ones are applied, one
  undo each restores the project, and no copy is left after the lead closes.

Each runs in two setups, ``local-only`` (nothing may leave the Mac: no paid model call, no cost) and
``cloud-only`` (no local model is used and no local question or screen appears).

Scripted mode (the default) runs the real chat graph, tools, ``delegate`` and session manager with
scripted models and a fake check runner, so it needs no network, no model and no shell sandbox.
``--live`` plays the same scenarios and conditions through a real daemon with real models. It costs
time and, in the cloud setup, money, so it needs the flag, and it prints a size note first. On
a small project a model may rightly read the files itself and start no helper; ``--ask-helpers``
names the helpers in the request, so the run tests how they work rather than the model's choice.

    uv run python -m golem.evals.usecases                              # scripted, all of it
    uv run python -m golem.evals.usecases --case sweep --setup local-only --out /tmp/usecases
    uv run python -m golem.evals.usecases --live --setup local-only --local-model qwen3.5:9b
    uv run python -m golem.evals.usecases --live --setup cloud-only --cloud-model anthropic/x
    uv run python -m golem.evals.usecases --live --ask-helpers --setup local-only --local-model m

A condition that cannot be read from what a mode records is shown as ``not checked``, with the
reason, and does not fail the case.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import tomllib
from collections.abc import AsyncGenerator, Callable, Generator, Mapping, Sequence
from contextlib import asynccontextmanager, contextmanager
from dataclasses import dataclass, field, replace
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Literal, Protocol, cast

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, ToolCall, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langgraph.checkpoint.memory import InMemorySaver

from golem.agents.bundled import bundled_agents_dir
from golem.agents.registry import AgentRegistry
from golem.coding.checks import Check
from golem.coding.worker_result import CheckOutcome
from golem.config import AgentSettings, GolemSettings, ModelPrice, RoutingSettings
from golem.evals.helpers import _Client, key_env, serve_command  # pyright: ignore
from golem.graphs.chat import open_chat
from golem.models.router import ModelRouter
from golem.models.tiers import Tier
from golem.models.window import ContextWindow
from golem.permissions.policy import Policy
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.manager import SessionManager
from golem.store.artifacts import ArtifactStore
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem.tools import default_registry

CaseName = Literal["broad-question", "stuck-bug", "sweep", "upgrades"]
SetupName = Literal["local-only", "cloud-only"]

CASES: tuple[CaseName, ...] = ("broad-question", "stuck-bug", "sweep", "upgrades")
SETUPS: tuple[SetupName, ...] = ("local-only", "cloud-only")

LOCAL_MODEL = "ollama/qwen3:8b"
CLOUD_MODEL = "anthropic/big"
WINDOW = 32_000
PEAK_BOUND = 0.5
"""The lead's window may be at most this full at any call in the broad question."""

AT_ONCE = 2
SWEEP_JOBS = 8
WORKERS = 5
FAILING_WORKER = 3
"""The worker whose copy fails its checks in the upgrades case (scripted mode)."""

Event = dict[str, Any]

# --- results --------------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Condition:
    """One pass condition. ``ok`` is None when the data to decide it is not recorded."""

    name: str
    ok: bool | None
    detail: str = ""

    @property
    def verdict(self) -> str:
        return "not checked" if self.ok is None else "pass" if self.ok else "FAIL"


@dataclass(slots=True)
class Outcome:
    """One case in one setup: its conditions, time, tokens and cost."""

    case: str
    setup: str
    mode: str
    conditions: list[Condition] = field(default_factory=list[Condition])
    seconds: float = 0.0
    tokens: int = 0
    cost_usd: float = 0.0
    error: str | None = None

    @property
    def passed(self) -> bool:
        return self.error is None and all(c.ok is not False for c in self.conditions)

    def as_json(self) -> dict[str, Any]:
        return {
            "case": self.case,
            "setup": self.setup,
            "mode": self.mode,
            "passed": self.passed,
            "seconds": round(self.seconds, 3),
            "tokens": self.tokens,
            "cost_usd": self.cost_usd,
            "error": self.error,
            "conditions": [
                {"name": c.name, "result": c.verdict, "detail": c.detail} for c in self.conditions
            ],
        }


@dataclass(slots=True)
class Trace:
    """What a run left behind: the facts the conditions read.

    ``events`` is the lead's log. ``helper_events`` maps a helper id to its own log, and is None
    when the mode cannot read it (live). ``copies_left`` is what is under the copies folder after
    the lead closed. ``applied`` maps an applied helper to ``(file, run id)`` pairs, ``restored``
    is whether the project was clean after the undos.
    """

    events: list[Event]
    project: Path
    helper_events: dict[str, list[Event]] | None = None
    copies_left: list[str] | None = None
    copies_during: list[str] | None = None
    applied: dict[str, list[str]] = field(default_factory=dict[str, list[str]])
    after_apply: dict[str, str] = field(default_factory=dict[str, str])
    after_undo: dict[str, str] = field(default_factory=dict[str, str])
    undo_runs: int = 0
    scripted: bool = False
    profiles: dict[str, str] = field(default_factory=dict[str, str])
    """The model profiles of the run's config, name to ``provider/model``: a helper given the
    lead's model (``same``) names the profile, not the provider."""


# --- reading events -------------------------------------------------------------------------------


def of_type(events: Sequence[Event], kind: str) -> list[Event]:
    return [e for e in events if e.get("type") == kind]


def data(event: Event) -> Mapping[str, Any]:
    return cast("Mapping[str, Any]", event.get("data") or {})


def all_logs(trace: Trace) -> list[Event]:
    """The lead's events and every helper's, when helpers' logs are known."""
    found = list(trace.events)
    for log in (trace.helper_events or {}).values():
        found += log
    return found


def peak_share(events: Sequence[Event]) -> float:
    """The most of its window one call of the lead used, 0..1."""
    peak = 0.0
    for event in of_type(events, "model.call.started"):
        used, window = data(event).get("estimated_tokens"), data(event).get("context_window")
        if used is not None and window:
            peak = max(peak, used / window)
    return peak


def max_running(events: Sequence[Event]) -> int:
    """The most helpers running at the same moment, by the order of the lead's log."""
    running: set[int] = set()
    peak = 0
    for event in events:
        body = data(event)
        index = body.get("index")
        if event.get("type") == "helper.state" and isinstance(index, int):
            if body.get("state") == "running":
                running.add(index)
            else:
                running.discard(index)
        elif event.get("type") == "helper.ended" and isinstance(index, int):
            running.discard(index)
        peak = max(peak, len(running))
    return peak


def final_answer(events: Sequence[Event]) -> str:
    answer = ""
    for event in of_type(events, "message.completed"):
        if data(event).get("role") == "assistant":
            answer = str(data(event).get("text") or "") or answer
    return answer


def totals(trace: Trace) -> tuple[int, float]:
    """Tokens and cost of the lead's calls and of its helpers."""
    tokens, cost = 0, 0.0
    for event in of_type(trace.events, "model.call.completed"):
        usage = cast("Mapping[str, Any]", data(event).get("usage") or {})
        tokens += int(usage.get("input") or 0) + int(usage.get("output") or 0)
        cost += float(data(event).get("cost_usd") or 0)
    for event in of_type(trace.events, "helper.ended"):
        tokens += int(data(event).get("tokens") or 0)
        cost += float(data(event).get("cost_usd") or 0)
    return tokens, cost


def has(name: str, ok: bool | None, detail: str = "") -> Condition:
    return Condition(name, ok, detail)


# --- the projects ---------------------------------------------------------------------------------


def _git(folder: Path, *args: str) -> str:
    done = subprocess.run(
        ["git", "-c", "user.name=golem", "-c", "user.email=golem@example.invalid", *args],
        cwd=folder,
        check=True,
        capture_output=True,
        text=True,
    )
    return done.stdout


def _commit(folder: Path) -> None:
    _git(folder, "init", "-q", "-b", "main")
    _git(folder, "add", "-A")
    _git(folder, "commit", "-q", "-m", "first")


def _put(folder: Path, files: Mapping[str, str]) -> None:
    for name, text in files.items():
        path = folder / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")


def project_broad(folder: Path) -> None:
    """Two services that each retry in their own way."""
    _put(
        folder,
        {
            "services/api/client.py": "def call():\n    # retry 3 times\n    pass\n",
            "services/api/session.py": "RETRIES = 3\n",
            "services/worker/runner.py": "def loop():\n    # retry for ever, no cap\n    pass\n",
            "services/worker/queue.py": "RETRIES = None\n",
        },
    )


def project_stuck(folder: Path) -> None:
    _put(
        folder,
        {
            "settings.py": "TIMEZONE = 'local'\n",
            "tests/test_login.py": "def test_login():\n    assert True\n",
        },
    )


def project_sweep(folder: Path) -> None:
    _put(folder, {f"mod{n}.py": f"# TODO: mod{n} needs an audit\n" for n in range(SWEEP_JOBS)})


def project_upgrades(folder: Path) -> None:
    _put(folder, {f"svc{n}/requirements.txt": "lib==1.0\n" for n in range(WORKERS)})
    _commit(folder)


# --- the scripted model ---------------------------------------------------------------------------

Calls = list[tuple[str, dict[str, Any]]]
Reply = str | Calls


@dataclass(frozen=True, slots=True)
class Turn:
    """What a plan sees at one model call: whose it is, what was asked, what came back."""

    lead: bool
    first: str
    tools: list[str]
    names: list[str]


Plan = Callable[[Turn], Reply]


class PlanModel(BaseChatModel):
    """A chat model that answers by a plan. One instance answers the lead and its helpers.

    The first human message tells whose call it is: the lead's holds the user's request, a
    helper's holds its brief. ``delay`` makes each call take a moment, so helpers overlap.
    """

    plan: Any
    request: str
    delay: float = 0.0

    @property
    def _llm_type(self) -> str:
        return "usecase-plan"

    def bind_tools(self, tools: Any, **kwargs: Any) -> Any:
        del tools, kwargs
        return self

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: Any = None,
        **kwargs: Any,
    ) -> ChatResult:
        del stop, run_manager, kwargs
        humans = [m.text for m in messages if isinstance(m, HumanMessage)]
        tools = [m for m in messages if isinstance(m, ToolMessage)]
        first = humans[0] if humans else ""
        turn = Turn(
            lead=first == self.request,
            first=first,
            tools=[m.text for m in tools],
            names=[m.name or "" for m in tools],
        )
        reply: Reply = self.plan(turn)
        size = sum(len(m.text) for m in messages) // 4 + 1
        if isinstance(reply, str):
            message = AIMessage(content=reply)
            out = len(reply) // 4 + 1
        else:
            message = AIMessage(
                content="",
                tool_calls=[
                    ToolCall(name=n, args=a, id=f"call_{len(tools)}_{i}")
                    for i, (n, a) in enumerate(reply)
                ],
            )
            out = 20
        message.usage_metadata = {  # type: ignore[assignment]
            "input_tokens": size,
            "output_tokens": out,
            "total_tokens": size + out,
        }
        return ChatResult(generations=[ChatGeneration(message=message)])

    async def _agenerate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: Any = None,
        **kwargs: Any,
    ) -> ChatResult:
        if self.delay:
            await asyncio.sleep(self.delay)
        return self._generate(messages, stop, run_manager, **kwargs)


class _Router(ModelRouter):
    """Gives its one scripted model for any profile."""

    def chat_model(self, profile: str, overrides: Any = None, *, local_only: bool = False) -> Any:
        del overrides
        if local_only:
            self.ensure_local(profile)
        return self._model


# --- the cases ------------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Scenario:
    """One use case: a request, a project, a scripted plan and the conditions."""

    name: CaseName
    request: str
    build: Callable[[Path], None]
    plan: Plan
    check: Callable[[Trace, SetupName], list[Condition]]
    agents: AgentSettings
    delay: float = 0.0
    git: bool = False
    """Whether the project is a git checkout (a worker needs one for its copy)."""
    hint: str = ""
    """What ``--ask-helpers`` adds to the request in a live run: it names the helpers, so the
    run tests how they work rather than whether the model chose them."""


def _broad_plan(turn: Turn) -> Reply:
    if turn.lead:
        if not turn.tools:
            batch = [
                {
                    "agent": "explorer",
                    "brief": f"read {d}/{f} and report the retry policy",
                    "label": d,
                }
                for d, f in (("services/api", "client.py"), ("services/worker", "runner.py"))
            ]
            return [("delegate", {"batch": batch})]
        return "Three retry policies and the worker has no cap on backoff: retry is not consistent."
    if not turn.tools:
        path = turn.first.split()[1]
        return [("read_file", {"path": path})]
    return f"{turn.first.split()[1]}:2 retry policy found"


def _broad_check(trace: Trace, setup: SetupName) -> list[Condition]:
    explorers = [
        e for e in of_type(trace.events, "helper.started") if data(e)["agent"] == "explorer"
    ]
    ended = of_type(trace.events, "helper.ended")
    peak = peak_share(trace.events)
    answer = final_answer(trace.events)
    return [
        has("at least two explorers ran", len(explorers) >= 2, f"{len(explorers)} started"),
        has(
            "every helper ended done",
            bool(ended) and all(data(e)["stopped"] == "done" for e in ended),
            ", ".join(str(data(e)["stopped"]) for e in ended),
        ),
        has(
            "explorers read in the lead's folder, no copy",
            not of_type(trace.events, "helper.applied") and not (trace.copies_during or []),
            f"copies: {trace.copies_during}" if trace.copies_during is not None else "",
        ),
        has("the lead answered", bool(answer.strip()), answer[:60]),
        has(
            f"the lead's peak window is below {PEAK_BOUND:.0%}",
            peak < PEAK_BOUND,
            f"peak {peak:.1%}",
        ),
    ]


def _stuck_plan(turn: Turn) -> Reply:
    if turn.lead:
        if len(turn.tools) < 2:
            return [("no_such_tool", {})]
        if not any(n == "delegate" for n in turn.names):
            brief = (
                "login test fails on CI, passes here; tried the test and the fixture. Which file?"
            )
            return [("delegate", {"agent": "advisor", "brief": brief})]
        return f"The advisor says: {turn.tools[-1].strip()[:120]}"
    return "Look at settings.py: TIMEZONE is 'local', CI runs in UTC."


def _stuck_check(trace: Trace, setup: SetupName) -> list[Condition]:
    advisors = [e for e in of_type(trace.events, "helper.started") if data(e)["agent"] == "advisor"]
    ended = of_type(trace.events, "helper.ended")
    answer = final_answer(trace.events)
    conditions = [
        has("the advisor was called", len(advisors) >= 1, f"{len(advisors)} started"),
        has("the advisor was called at most once", len(advisors) <= 1, f"{len(advisors)} started"),
        has(
            "the advisor ended done",
            bool(ended) and all(data(e)["stopped"] == "done" for e in ended),
            ", ".join(str(data(e)["stopped"]) for e in ended),
        ),
        has("the lead answered", bool(answer.strip()), answer[:60]),
        has(
            "the advisor's answer is in the lead's answer",
            "settings.py" in answer,
            answer[:80],
        ),
    ]
    if setup == "local-only" and advisors:
        model = str(data(advisors[0])["model"])
        conditions.append(
            has(
                "a local advisor runs on a local model",
                trace.profiles.get(model, model).startswith("ollama/"),
                model,
            )
        )
    # The nudge is a hint of a lead on route auto; this harness does not turn that route on.
    conditions.append(
        has(
            "the struggle nudge fired",
            None,
            "needs route auto and a step-up; covered by test_struggle_nudge.py",
        )
    )
    return conditions


def _sweep_plan(turn: Turn) -> Reply:
    if turn.lead:
        if not turn.tools:
            batch = [
                {
                    "agent": "explorer",
                    "brief": f"read mod{n}.py and list its TODOs",
                    "label": f"m{n}",
                }
                for n in range(SWEEP_JOBS)
            ]
            return [("delegate", {"batch": batch})]
        return f"Audited {SWEEP_JOBS} modules: each has one TODO."
    if not turn.tools:
        return [("read_file", {"path": turn.first.split()[1]})]
    return f"{turn.first.split()[1]}: one TODO"


def _sweep_check(trace: Trace, setup: SetupName) -> list[Condition]:
    started = of_type(trace.events, "helper.started")
    ended = of_type(trace.events, "helper.ended")
    peak = max_running(trace.events)
    queued = [e for e in of_type(trace.events, "helper.state") if data(e)["state"] == "queued"]
    return [
        has(f"{SWEEP_JOBS} helpers started", len(started) == SWEEP_JOBS, f"{len(started)} started"),
        has(
            "all helpers ended done",
            len(ended) == SWEEP_JOBS and all(data(e)["stopped"] == "done" for e in ended),
            f"{len(ended)} ended",
        ),
        has(f"never more than {AT_ONCE} running at once", peak <= AT_ONCE, f"peak {peak}"),
        has("the batch queued the rest", len(queued) >= 1, f"{len(queued)} queued"),
        has("the lead answered", bool(final_answer(trace.events).strip())),
    ]


def _check_file(n: int) -> str:
    return f"svc{n}/requirements.txt"


def _upgrades_plan(turn: Turn) -> Reply:
    if turn.lead:
        if not turn.tools:
            batch = [
                {"agent": "worker", "brief": f"job {n} upgrade svc{n}", "label": f"w{n}"}
                for n in range(WORKERS)
            ]
            return [("delegate", {"batch": batch})]
        return "Five upgrades are ready: review the diffs and apply the green ones."
    n = turn.first.split("job ")[1].split()[0]
    if not turn.tools:
        return [("write_file", {"path": _check_file(int(n)), "content": "lib==2.0\n"})]
    return "upgraded"


def _upgrades_check(trace: Trace, setup: SetupName) -> list[Condition]:
    bodies = [data(e) for e in of_type(trace.events, "helper.ended")]
    green = [b for b in bodies if b.get("checks") == "passed"]
    with_diff = [b for b in bodies if b.get("diff_artifact_id") and b.get("files")]
    changed = [name for name, text in trace.after_apply.items() if text == "lib==2.0\n"]
    restored = all(text == "lib==1.0\n" for text in trace.after_undo.values())
    # The scripted run fails one worker's lint on purpose; a live run cannot be told which.
    greens = (len(green) == WORKERS - 1) if trace.scripted else len(green) >= 1
    return [
        has(
            f"{WORKERS} workers ended done",
            len(bodies) == WORKERS and all(b["stopped"] == "done" for b in bodies),
            f"{len(bodies)} ended",
        ),
        has(
            "each worker had its own copy",
            None if trace.copies_during is None else len(trace.copies_during) == WORKERS,
            f"{len(trace.copies_during or [])} copies",
        ),
        has(
            "each worker returned a diff and a files list",
            len(with_diff) == WORKERS,
            f"{len(with_diff)} with a diff",
        ),
        has(
            "each worker returned a check result",
            bool(bodies) and all(b.get("checks") in ("passed", "failed", "none") for b in bodies),
            ", ".join(str(b.get("checks")) for b in bodies),
        ),
        has("the green workers are the expected ones", greens, f"{len(green)} green"),
        has(
            "applying the green changes the project",
            bool(green) and len(trace.applied) == len(green) == len(changed),
            f"{len(trace.applied)} applied, {len(changed)} files changed",
        ),
        has(
            "one undo of an apply restores its files",
            bool(trace.applied) and restored and trace.undo_runs == len(trace.applied),
            f"{trace.undo_runs} undos",
        ),
        has(
            "no copy is left after the lead closes",
            None if trace.copies_left is None else trace.copies_left == [],
            f"left: {trace.copies_left}" if trace.copies_left else "",
        ),
    ]


SCENARIOS: dict[str, Scenario] = {
    s.name: s
    for s in (
        Scenario(
            "broad-question",
            "How do we handle retries across the services, and is it consistent?",
            project_broad,
            _broad_plan,
            _broad_check,
            AgentSettings(at_once=2),
            delay=0.02,
            hint="Use helpers: delegate one explorer per service, in one batch.",
        ),
        Scenario(
            "stuck-bug",
            "The login test fails on CI but passes here. Which file is wrong?",
            project_stuck,
            _stuck_plan,
            _stuck_check,
            AgentSettings(at_once=2),
            hint="Before you answer, delegate the question to the advisor agent.",
        ),
        Scenario(
            "sweep",
            "Audit every module: list the TODOs.",
            project_sweep,
            _sweep_plan,
            _sweep_check,
            AgentSettings(at_once=AT_ONCE, max_per_batch=SWEEP_JOBS),
            delay=0.03,
            hint="Use helpers: delegate one explorer per module, in one batch.",
        ),
        Scenario(
            "upgrades",
            "Upgrade lib to 2.0 in all five services.",
            project_upgrades,
            _upgrades_plan,
            _upgrades_check,
            AgentSettings(at_once=WORKERS, max_per_batch=WORKERS),
            git=True,
            hint="Use helpers: delegate one worker per service, in one batch.",
        ),
    )
}


# --- the setup conditions -------------------------------------------------------------------------

PENDING = ("approval.needed", "route.consent.needed")


def models_used(trace: Trace) -> set[str]:
    """The providers the run's models belong to, from the lead's and the helpers' records."""
    logs = all_logs(trace)
    found: set[str] = set()
    for event in of_type(logs, "session.created"):
        body = data(event)
        found.add(
            str(body.get("model_provider") or body.get("model_profile") or "").partition("/")[0]
        )
    for event in of_type(logs, "model.call.started"):
        if data(event).get("provider"):
            found.add(str(data(event)["provider"]))
    for kind in ("helper.started", "helper.model"):
        for event in of_type(trace.events, kind):
            model = str(data(event)["model"])
            found.add(trace.profiles.get(model, model).partition("/")[0])
    found.discard("")
    return found


def setup_conditions(trace: Trace, setup: SetupName) -> list[Condition]:
    """What a setup promises, from the events and the usage the run recorded."""
    logs = all_logs(trace)
    done = of_type(logs, "model.call.completed")
    providers = models_used(trace)
    paid = [e for e in done if float(data(e).get("cost_usd") or 0) > 0]
    pending = [str(e["type"]) for e in logs if e.get("type") in PENDING]
    helper_paid = [e for e in of_type(trace.events, "helper.ended") if data(e).get("cost_usd")]
    if setup == "local-only":
        return [
            has(
                "nothing left the Mac: every model is local",
                bool(providers) and providers == {"ollama"},
                f"providers {sorted(providers)}",
            ),
            has(
                "no paid usage row",
                not paid and not helper_paid,
                f"{len(paid)} paid calls, {len(helper_paid)} paid helpers",
            ),
            has("no paid question was asked", "route.consent.needed" not in pending),
        ]
    return [
        has(
            "no local model was used",
            bool(providers) and "ollama" not in providers,
            f"providers {sorted(providers)}",
        ),
        has(
            "no local screen or question was raised",
            not pending and not of_type(logs, "helper.model"),
            f"pending {pending}",
        ),
    ]


def evaluate(scenario: Scenario, setup: SetupName, trace: Trace, mode: str) -> Outcome:
    """The conditions of a scenario and of a setup, over one trace."""
    out = Outcome(scenario.name, setup, mode)
    completed = bool(of_type(trace.events, "run.completed"))
    out.conditions.append(has("the run completed", completed))
    out.conditions += scenario.check(trace, setup)
    out.conditions += setup_conditions(trace, setup)
    out.tokens, out.cost_usd = totals(trace)
    return out


# --- the session a scenario is played in ----------------------------------------------------------


class Played(Protocol):
    """The part of a daemon a scenario needs. In process (scripted) or over the socket (live)."""

    scripted: bool

    async def send(self, text: str) -> None: ...
    async def events(self) -> list[Event]: ...
    async def helper_events(self, helper_id: str) -> list[Event] | None: ...
    async def apply(self, helper_id: str) -> list[str]: ...
    async def undo(self, change_id: str) -> None: ...
    async def close(self) -> None: ...
    def copies(self) -> list[str]: ...


async def drive(scenario: Scenario, played: Played, project: Path) -> Trace:
    """Send the request, then do what the case does after it: apply the green and undo."""
    await played.send(scenario.request)
    events = await played.events()
    helper_ids = [str(data(e)["helper_id"]) for e in of_type(events, "helper.started")]
    trace = Trace(events, project, scripted=played.scripted)
    logs: dict[str, list[Event]] = {}
    known = True
    for helper in helper_ids:
        found = await played.helper_events(helper)
        if found is None:
            known = False
        else:
            logs[helper] = found
    trace.helper_events = logs if known else None
    trace.copies_during = played.copies()
    if scenario.name == "upgrades":
        await _apply_and_undo(played, trace)
    await played.close()
    trace.events = await played.events()
    trace.copies_left = played.copies()
    return trace


def _read(project: Path, name: str) -> str:
    path = project / name
    return path.read_text(encoding="utf-8") if path.exists() else ""


async def _apply_and_undo(played: Played, trace: Trace) -> None:
    """Apply every worker whose checks passed, then undo each apply with one undo."""
    started = of_type(trace.events, "helper.started")
    changes: list[str] = []
    for event in of_type(trace.events, "helper.ended"):
        body = data(event)
        if body.get("checks") != "passed":
            continue
        helper = next(
            str(data(s)["helper_id"])
            for s in started
            if data(s)["index"] == body["index"] and data(s)["call_id"] == body["call_id"]
        )
        files = [str(f["path"]) for f in cast("list[Mapping[str, Any]]", body.get("files") or [])]
        changes += await played.apply(helper)
        trace.applied[helper] = files
        for name in files:
            trace.after_apply[name] = _read(trace.project, name)
    for change_id in changes:
        await played.undo(change_id)
        trace.undo_runs += 1
    for files in trace.applied.values():
        for name in files:
            trace.after_undo[name] = _read(trace.project, name)


# --- scripted mode --------------------------------------------------------------------------------

CHECKS_TOML = (
    '[coding]\nchecks = "auto"\n'
    '[[coding.check]]\nname = "tests"\ncommand = "true"\n'
    '[[coding.check]]\nname = "lint"\ncommand = "true"\n'
)


def settings_of(setup: SetupName, project: Path, agents: AgentSettings) -> GolemSettings:
    if setup == "cloud-only":
        start = GolemSettings(default_model=CLOUD_MODEL)
    else:
        start = GolemSettings(
            default_model=LOCAL_MODEL, routing=RoutingSettings(local_only=[str(project)])
        )
    return start.model_copy(update={"agents": agents})


def _tier_of(profile: str) -> Tier | None:
    return "frontier" if profile.startswith("anthropic/") else "local"


def _price_of(profile: str) -> ModelPrice | None:
    return ModelPrice(input=1.0, output=2.0) if profile.startswith("anthropic/") else None


async def _fake_checks(check: Check, root: Path) -> CheckOutcome:
    """The lint of one worker's copy fails. No shell, so no sandbox is needed."""
    del check
    path = root / _check_file(FAILING_WORKER)
    return (
        "failed" if path.exists() and path.read_text(encoding="utf-8") == "lib==2.0\n" else "passed"
    )


@contextmanager
def _golem_home(home: Path) -> Generator[None]:
    before = os.environ.get("GOLEM_HOME")
    os.environ["GOLEM_HOME"] = str(home)
    try:
        yield
    finally:
        if before is None:
            os.environ.pop("GOLEM_HOME", None)
        else:
            os.environ["GOLEM_HOME"] = before


class InProcess:
    """A real runtime, session manager and change store, over a scripted model."""

    scripted = True

    def __init__(self, scenario: Scenario, setup: SetupName, folder: Path, home: Path) -> None:
        self.scenario = scenario
        self.setup: SetupName = setup
        self.folder, self.home = folder, home
        self.session = ""
        self.manager: SessionManager
        self.events_log: EventLog
        self.records: SessionRecords
        self.changes: Any = None

    @asynccontextmanager
    async def open(self, database: Database) -> AsyncGenerator[InProcess]:
        scenario = self.scenario
        (self.home / "config.toml").write_text(CHECKS_TOML, encoding="utf-8")
        model = PlanModel(plan=scenario.plan, request=scenario.request, delay=scenario.delay)
        settings = settings_of(self.setup, self.folder, scenario.agents)
        agents = AgentRegistry(
            AgentSettings(),
            golem_agents=self.home / "agents",
            trusted=lambda _root: False,
            bundled=bundled_agents_dir(),
        )
        runtime = open_chat(
            _Router(settings, model=model),
            InMemorySaver(),
            default_registry(),
            Policy(self.home / "config.toml", home=self.home),
            window_of=lambda _profile, _options: ContextWindow(window=WINDOW),
            price_of=_price_of,
            tier_of=_tier_of,
            budget_refs=lambda: ["deepseek/chat"] if self.setup == "cloud-only" else [],
        )
        runtime.artifacts = ArtifactStore(database)
        from golem.coding.changes import ChangeStore
        from golem.store.blobs import BlobStore

        self.changes = ChangeStore(database, BlobStore(database))
        runtime.changes = self.changes
        self.events_log = EventLog(database)
        self.records = SessionRecords(database)
        log = SessionLog(self.events_log, EventBus(), self.records)
        self.manager = SessionManager(
            runtime, log, self.records, RunRecords(database), agents=agents
        )
        runtime.helpers = self.manager
        self.manager.check_runner = _fake_checks
        profile = CLOUD_MODEL if self.setup == "cloud-only" else LOCAL_MODEL
        self.session = await self.manager.create(profile, cwd=str(self.folder))
        try:
            yield self
        finally:
            await self.manager.cancel_all()

    async def send(self, text: str) -> None:
        await self.manager.send(self.session, text)
        async with asyncio.timeout(30):
            while not any(
                e.type == "run.completed" for e in await self.events_log.after(self.session, 0)
            ):
                await asyncio.sleep(0.01)
            while await self.manager.is_busy(self.session):
                await asyncio.sleep(0.01)

    async def events(self) -> list[Event]:
        return [
            json.loads(e.model_dump_json()) for e in await self.events_log.after(self.session, 0)
        ]

    async def helper_events(self, helper_id: str) -> list[Event] | None:
        return [json.loads(e.model_dump_json()) for e in await self.events_log.after(helper_id, 0)]

    async def apply(self, helper_id: str) -> list[str]:
        return await self.manager.apply_helper(self.session, helper_id)

    async def undo(self, change_id: str) -> None:
        from golem.server.handlers import _changes_revert  # pyright: ignore
        from golem_protocol.commands import ChangesRevertParams, RevertTarget

        state = SimpleNamespace(sessions=self.manager, changes=self.changes)
        ctx = SimpleNamespace(state=state, connection=None)
        params = ChangesRevertParams(
            session_id=self.session, target=RevertTarget(kind="change", change_id=change_id)
        )
        await _changes_revert(cast(Any, ctx), params)

    async def close(self) -> None:
        await self.manager.close(self.session)

    def copies(self) -> list[str]:
        from golem.coding import copies

        return [p.name for p in copies.list_copies()]


async def run_scripted(case: str, setup: SetupName, scratch: Path) -> Outcome:
    """Play one case in one setup with scripted models. Never touches a network or a model."""
    scenario = SCENARIOS[case]
    folder, home = scratch / "project", scratch / "home"
    folder.mkdir(parents=True)
    home.mkdir(parents=True)
    scenario.build(folder)
    if scenario.git and not (folder / ".git").exists():
        _commit(folder)
    started = time.monotonic()
    out = Outcome(case, setup, "scripted")
    try:
        with _golem_home(home):
            async with (
                Database.open(scratch / "golem.db") as database,
                InProcess(scenario, setup, folder, home).open(database) as played,
            ):
                trace = await drive(scenario, played, folder)
        out = evaluate(scenario, setup, trace, "scripted")
    except Exception as exc:  # a broken run is a failed case, not a crashed report
        out.error = f"{type(exc).__name__}: {exc}"
    out.seconds = time.monotonic() - started
    return out


# --- live mode ------------------------------------------------------------------------------------

COST_NOTE = (
    "--live plays the four use cases through a real daemon with real models.\n"
    "  Size: 4 cases per setup, each one lead run plus up to 8 helper runs (the sweep) or 5\n"
    "  workers (the upgrades). On a local model that is minutes of Mac load and memory for the\n"
    "  model and its slots; check that it fits before you run it. On a cloud model it spends\n"
    "  tokens: the report shows the cost it measured. Nothing runs without this flag."
)


LIVE_PROFILE = "t"
"""The one model profile of a live run's config."""


def live_config(setup: SetupName, model: str, agents: AgentSettings) -> str:
    """The ``config.toml`` of a throwaway golem home: one model, and every helper on it.

    Local: one slot. Cloud: golem starts no Ollama. The daemon still sees an Ollama that is
    already running on this Mac, and ``cheapest`` would pick its free models, so the helpers
    are pinned to the lead's model (``same``) in both setups.
    """
    text = f'default_model = "{LIVE_PROFILE}"\n[models.{LIVE_PROFILE}]\nmodel = "{model}"\n'
    text += f"[agents]\nat_once = {agents.at_once}\n"
    if agents.max_per_batch is not None:
        text += f"max_per_batch = {agents.max_per_batch}\n"
    text += "[ollama]\nparallel = 1\n" if setup == "local-only" else "[ollama]\nstart = false\n"
    text += "".join(
        f'[agents.{name}]\nmodel = "same"\n' for name in ("explorer", "worker", "advisor")
    )
    text += CHECKS_TOML + '[permissions]\nmode = "autopilot"\n'
    return text


def configured_model(setup: SetupName, local: str | None, cloud: str | None) -> str:
    """The model of a live setup: the flag, else the user's own ``default_model`` for cloud."""
    if setup == "local-only":
        if not local:
            raise SystemExit("--live with local-only needs --local-model NAME (an Ollama model)")
        return local if "/" in local else f"ollama/{local}"
    if cloud:
        return cloud
    home = Path(os.environ.get("GOLEM_HOME") or Path.home() / ".golem")
    try:
        config = tomllib.loads((home / "config.toml").read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError):
        config = {}
    name = config.get("default_model")
    models = cast("dict[str, Any]", config.get("models") or {})
    if isinstance(name, str):
        entry = models.get(name)
        ref = cast("dict[str, Any]", entry).get("model") if isinstance(entry, dict) else None
        found = ref if isinstance(ref, str) else name
        if not found.startswith("ollama/"):
            return found
    raise SystemExit(
        "--live with cloud-only needs --cloud-model PROVIDER/MODEL or a hosted default"
    )


class Rpc:
    """A real daemon in a throwaway golem home, over its socket."""

    scripted = False

    def __init__(self, client: _Client, folder: Path, home: Path, session: str) -> None:
        self.client, self.folder, self.home, self.session = client, folder, home, session
        self.seen: list[Event] = []

    def _drain(self) -> None:
        while not self.client.events.empty():
            event = self.client.events.get_nowait()
            if event.get("session_id") in (None, self.session):
                self.seen.append(event)

    async def send(self, text: str, timeout: float = 900.0) -> None:
        await self.client.call("message.send", {"session_id": self.session, "text": text})
        async with asyncio.timeout(timeout):
            while True:
                self._drain()
                if any(
                    e.get("type") in ("run.completed", "run.failed", "run.cancelled")
                    for e in self.seen
                ):
                    return
                await asyncio.sleep(0.2)

    async def events(self) -> list[Event]:
        self._drain()
        return list(self.seen)

    async def helper_events(self, helper_id: str) -> list[Event] | None:
        return None

    async def apply(self, helper_id: str) -> list[str]:
        result = await self.client.call(
            "helper.apply", {"session_id": self.session, "helper_id": helper_id}
        )
        return list(result.get("change_ids") or [])

    async def undo(self, change_id: str) -> None:
        target = {"kind": "change", "change_id": change_id}
        await self.client.call("changes.revert", {"session_id": self.session, "target": target})

    async def close(self) -> None:
        await self.client.call("session.close", {"session_id": self.session})
        await asyncio.sleep(1.0)
        self._drain()

    def copies(self) -> list[str]:
        root = self.home / "copies"
        return sorted(p.name for p in root.iterdir()) if root.is_dir() else []


async def run_live(
    case: str,
    setup: SetupName,
    model: str,
    scratch: Path,
    *,
    timeout: float = 900.0,
    ask_helpers: bool = False,
) -> Outcome:
    """Play one case through a real daemon with a real model. ``ask_helpers``: the request
    names the helpers (the scenario's ``hint``), instead of leaving the choice to the model."""
    from golem_protocol import PROTOCOL_MAJOR

    scenario = SCENARIOS[case]
    if ask_helpers:
        scenario = replace(scenario, request=f"{scenario.request} {scenario.hint}")
    started = time.monotonic()
    out = Outcome(case, setup, "live")
    root = Path(tempfile.mkdtemp(prefix="gu", dir="/var/tmp")).resolve()
    home, user, folder = root / "g", root / "h", scratch / "project"
    for path in (home, user, folder):
        path.mkdir(parents=True, exist_ok=True)
    scenario.build(folder)
    if scenario.git and not (folder / ".git").exists():
        _commit(folder)
    (home / "config.toml").write_text(live_config(setup, model, scenario.agents), "utf-8")
    env = {**os.environ, "GOLEM_HOME": str(home), "HOME": str(user)}
    if setup == "cloud-only":
        env.update(key_env(cast(Any, SimpleNamespace(lead=model, others=())), None))
    daemon = subprocess.Popen(
        serve_command(frozen=bool(getattr(sys, "frozen", False))),
        env=env,
        stderr=subprocess.DEVNULL,
    )
    try:
        socket = home / "run" / "golem.sock"
        for _ in range(150):
            if socket.exists():
                break
            await asyncio.sleep(0.2)
        reader, writer = await asyncio.open_unix_connection(str(socket))
        client = _Client(reader, writer)
        await client.call(
            "hello", {"protocol_major": PROTOCOL_MAJOR, "protocol_minor": 0, "client": "tui"}
        )
        created = await client.call("session.create", {"cwd": str(folder)})
        session = str(created["session_id"])
        await client.call("session.attach", {"session_id": session, "after_seq": 0})
        played = Rpc(client, folder, home, session)
        trace = await asyncio.wait_for(drive(scenario, played, folder), timeout * 2)
        trace.profiles = {LIVE_PROFILE: model}
        out = evaluate(scenario, setup, trace, "live")
    except Exception as exc:
        out.error = f"{type(exc).__name__}: {exc}"
    finally:
        daemon.terminate()
        try:
            await asyncio.shield(asyncio.to_thread(daemon.wait, 10))
        except subprocess.TimeoutExpired:
            daemon.kill()
        shutil.rmtree(root, ignore_errors=True)
    out.seconds = time.monotonic() - started
    return out


# --- the report -----------------------------------------------------------------------------------


def summary(outcomes: Sequence[Outcome]) -> str:
    """A short markdown report: one table, then every condition that did not pass."""
    lines = [
        "# Use cases",
        "",
        "| case | setup | mode | result | seconds | tokens | cost |",
        "| --- | --- | --- | --- | ---: | ---: | ---: |",
    ]
    for o in outcomes:
        result = "pass" if o.passed else "FAIL"
        lines.append(
            f"| {o.case} | {o.setup} | {o.mode} | {result} | {o.seconds:.1f} | {o.tokens} "
            f"| ${o.cost_usd:.4f} |"
        )
    notes = [
        f"- {o.case} / {o.setup}: {c.verdict}: {c.name}" + (f" ({c.detail})" if c.detail else "")
        for o in outcomes
        for c in o.conditions
        if c.ok is not True
    ]
    errors = [f"- {o.case} / {o.setup}: error: {o.error}" for o in outcomes if o.error]
    if notes or errors:
        lines += ["", "## Not passing", "", *errors, *notes]
    return "\n".join(lines) + "\n"


def write_report(outcomes: Sequence[Outcome], out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    (out / "usecases.json").write_text(
        json.dumps([o.as_json() for o in outcomes], indent=2) + "\n", encoding="utf-8"
    )
    (out / "usecases.md").write_text(summary(outcomes), encoding="utf-8")


async def run_all(
    cases: Sequence[str],
    setups: Sequence[SetupName],
    *,
    live: bool = False,
    local_model: str | None = None,
    cloud_model: str | None = None,
    scratch: Path | None = None,
    ask_helpers: bool = False,
) -> list[Outcome]:
    """Play ``cases`` in ``setups``. ``live`` is explicit: it is never the default."""
    base = scratch or Path(tempfile.mkdtemp(prefix="golem-usecases-"))
    outcomes: list[Outcome] = []
    try:
        for setup in setups:
            model = configured_model(setup, local_model, cloud_model) if live else ""
            for case in cases:
                folder = base / setup / case
                if live:
                    outcomes.append(
                        await run_live(case, setup, model, folder, ask_helpers=ask_helpers)
                    )
                else:
                    outcomes.append(await run_scripted(case, setup, folder))
    finally:
        if scratch is None:
            shutil.rmtree(base, ignore_errors=True)
    return outcomes


def main(argv: Sequence[str] | None = None, out: Callable[[str], None] = print) -> int:
    parser = argparse.ArgumentParser(prog="python -m golem.evals.usecases", description=__doc__)
    parser.add_argument("--live", action="store_true", help="real models through a real daemon")
    parser.add_argument("--setup", choices=[*SETUPS, "both"], default="both")
    parser.add_argument("--case", choices=[*CASES, "all"], default="all")
    parser.add_argument("--out", type=Path, help="a folder for usecases.json and usecases.md")
    parser.add_argument("--local-model", help="live local-only: an Ollama model, e.g. qwen3.5:9b")
    parser.add_argument("--cloud-model", help="live cloud-only: provider/model (default: yours)")
    parser.add_argument(
        "--ask-helpers",
        action="store_true",
        help="live: the request names the helpers, so the run tests them, not the model's choice",
    )
    args = parser.parse_args(argv)
    setups = SETUPS if args.setup == "both" else (cast(SetupName, args.setup),)
    cases = CASES if args.case == "all" else (cast(CaseName, args.case),)
    if args.live:
        out(COST_NOTE)
    outcomes = asyncio.run(
        run_all(
            cases,
            setups,
            live=args.live,
            local_model=args.local_model,
            cloud_model=args.cloud_model,
            ask_helpers=args.ask_helpers,
        )
    )
    out(summary(outcomes))
    if args.out is not None:
        write_report(outcomes, args.out)
        out(f"written to {args.out}")
    return 0 if all(o.passed for o in outcomes) else 1


if __name__ == "__main__":
    sys.exit(main())
