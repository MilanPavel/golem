"""The seam between a workflow's ``run.agent`` and golem's helpers (ADR-062, ADR-059).

This is the only workflow code that touches ``SessionManager`` helper APIs. An agent step is a
helper of the run's own session: ``start_helper`` makes it once per ``wf:<step key>`` (a second
call after a restart returns the helper that exists), and the step waits for it to end.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable, Sequence
from pathlib import Path
from typing import Any

from golem.agents.model import WISHES, Agent
from golem.agents.registry import AgentRegistry
from golem.config import AgentSettings
from golem.sessions.bus import EventBus
from golem.sessions.helpers import snapshot_of
from golem.sessions.manager import SessionManager
from golem.skills.invoke import SkillInvokeError, invoke
from golem.skills.registry import SkillRegistry
from golem.tools.registry import ToolError
from golem.workflow import WorkflowError
from golem_protocol.events import AgentOrigin, AgentSnapshot, ChatEvent, SkillCall

log = logging.getLogger(__name__)

RECHECK_SECONDS = 60.0
"""The wait is woken by ``helper.ended``; this is only a safety net against a missed event."""

SKILL_BASE_AGENT = "explorer"
"""The agent whose tools a skill's helper gets, besides the skill's ``allowed-tools``."""

SKILL_PROMPT = (
    "You run one skill as a short turn. Follow the instructions you are given, use only your"
    " tools, and finish with the result as your answer."
)

Started = Callable[[str], Awaitable[None]]
"""Called with the helper's session id as soon as the helper exists."""


def call_id_of(key: str) -> str:
    """The ``delegate`` call id the helper of the step ``key`` is stored under."""
    return f"wf:{key}"


def place_of(key: str, batch: tuple[str, int] | None) -> tuple[str, int]:
    """The call id and index of a step's helper: its place in its ``run.parallel`` group, or
    ``wf:<key>`` and 0 for an agent on its own."""
    if batch is None:
        return call_id_of(key), 0
    return call_id_of(batch[0]), batch[1]


class WorkflowAgents:
    def __init__(
        self,
        *,
        sessions: SessionManager,
        agents: AgentRegistry,
        bus: EventBus,
        settings: Callable[[], AgentSettings],
        skills: SkillRegistry | None = None,
    ) -> None:
        self._skills = skills
        self._sessions = sessions
        self._agents = agents
        self._settings = settings
        self._waiters: dict[str, set[asyncio.Event]] = {}
        bus.observe(self._seen)

    @property
    def has_skills(self) -> bool:
        return self._skills is not None

    def _seen(self, event: ChatEvent) -> None:
        if event.type != "helper.ended":
            return
        for waiter in self._waiters.get(event.session_id, ()):
            waiter.set()

    async def run(
        self,
        *,
        session_id: str,
        cwd: str | None,
        key: str,
        agent_type: str,
        brief: str,
        model: str | None,
        started: Started,
        batch: tuple[str, int] | None = None,
        gets: Sequence[str] = (),
        budget: float | None = None,
    ) -> dict[str, Any]:
        """Run one agent as a helper of ``session_id`` and return its outcome.

        Returns ``{"status", "answer", "session_id"}``. Raises :class:`WorkflowError` for an
        unknown or unavailable agent type, a model wish that is not one, a helper that cannot
        start, and a helper that failed or was stopped.

        ``batch`` is the group key and position of an agent inside ``run.parallel``: the agents
        of one group are the helpers of one ``delegate`` call, so the helper cap, the queue and
        the wait reasons apply to them together. ``gets`` is added to what the agent's file
        asks for, and ``budget`` (dollars) caps the helper's cost, the lower of it and the
        file's own ``max_cost``.
        """
        if model is not None and model not in WISHES:
            raise WorkflowError(
                f"run.agent model= is a wish, one of {', '.join(WISHES)}; got {model!r}."
                " Workflow files do not name models"
            )
        view = self._agents.view(None if cwd is None else Path(cwd))
        agent = view.get(agent_type)
        if agent is None:
            names = ", ".join(a.name for a in view.usable())
            raise WorkflowError(f"unknown agent type {agent_type!r}; the agents are {names}")
        reason = self._sessions.unavailable_reason(agent, cwd)
        if reason is not None:
            raise WorkflowError(reason)
        origin: AgentOrigin = next(e.origin for e in view.listed if e.agent is agent)
        snapshot = snapshot_of(agent, origin, agent.tools, self._settings())
        if budget is not None:
            have = snapshot.limits.max_cost_usd
            cap = budget if have is None else min(have, budget)
            snapshot = snapshot.model_copy(
                update={"limits": snapshot.limits.model_copy(update={"max_cost_usd": cap})}
            )
        outcome, child = await self._helper(
            session_id,
            cwd,
            key,
            snapshot,
            brief,
            started,
            prompt=agent.body,
            asked_model=model,
            gets=tuple(dict.fromkeys((*agent.gets, *gets))),
            batch=batch,
        )
        if outcome.stopped != "done":
            detail = f": {outcome.covered}" if outcome.covered else ""
            raise WorkflowError(f"agent {agent_type} stopped ({outcome.stopped}){detail}")
        return {"status": "done", "answer": outcome.text, "session_id": child}

    async def run_skill(
        self,
        *,
        session_id: str,
        cwd: str | None,
        key: str,
        name: str,
        args: str,
        started: Started,
    ) -> dict[str, Any]:
        """Run the skill ``name`` as one short turn of a helper of ``session_id``.

        The helper's brief is the skill's body with ``args`` filled in, and its tools are the
        skill's ``allowed-tools``. Returns ``{"status", "answer", "session_id"}``. Raises
        :class:`WorkflowError` for a skill the run's folder does not see (the message lists the
        ones it does), a skill that cannot run, and a helper that cannot start or did not finish.
        """
        if self._skills is None:
            raise WorkflowError("run.skill is not available: this daemon has no skills")
        view = self._skills.view(None if cwd is None else Path(cwd))
        if not any(e.skill.name == name for e in view.listed):
            known = ", ".join(s.name for s in view.usable()) or "none"
            raise WorkflowError(f"unknown skill {name!r}; the skills are {known}")
        try:
            call = invoke(view, SkillCall(name=name, args=args), session_id=session_id)
        except SkillInvokeError as exc:
            raise WorkflowError(str(exc)) from exc
        skill = view.get(name)
        assert skill is not None
        # In a chat a skill keeps the lead's tools; ``allowed-tools`` only skips the asking.
        # A skill's helper gets the explorer's read-only tools plus the ones the skill names.
        # Helpers that change things wait for copies (15.10), so such a skill is refused.
        base = self._agents.view(None if cwd is None else Path(cwd)).get(SKILL_BASE_AGENT)
        named = {t.split("(")[0].strip() for t in skill.allowed_tools}
        tools = sorted((named | set(base.tools if base else ())) - {"", "delegate"})
        agent = Agent(
            name=f"skill-{name}",
            description=skill.description,
            path=skill.path,
            real_path=skill.real_path,
            hash=skill.hash,
            wish=skill.model or "cheapest",
            tools=tuple(tools),
        )
        reason = self._sessions.unavailable_reason(agent, cwd)
        if reason is not None:
            raise WorkflowError(reason)
        snapshot = snapshot_of(agent, call.source, agent.tools, self._settings())
        outcome, child = await self._helper(
            session_id,
            cwd,
            key,
            snapshot,
            call.text,
            started,
            prompt=SKILL_PROMPT,
            asked_model=None,
            gets=(),
            batch=None,
        )
        if outcome.stopped != "done":
            detail = f": {outcome.covered}" if outcome.covered else ""
            raise WorkflowError(f"skill {name} stopped ({outcome.stopped}){detail}")
        return {"status": "done", "answer": outcome.text, "session_id": child}

    async def _helper(
        self,
        session_id: str,
        cwd: str | None,
        key: str,
        snapshot: AgentSnapshot,
        brief: str,
        started: Started,
        *,
        prompt: str,
        asked_model: str | None,
        gets: tuple[str, ...],
        batch: tuple[str, int] | None,
    ) -> tuple[Any, str]:
        """Start the helper of step ``key`` once, wait for it, and return its outcome and id.

        The helper is stored under ``(call id, index)``: ``wf:<key>`` and 0 on its own, or
        ``wf:<group key>`` and its position in the group, so a restart finds it again.
        """
        call_id, index = place_of(key, batch)
        try:
            ref = await self._sessions.start_helper(
                session_id,
                call_id,
                index,
                snapshot,
                brief,
                await self._sessions.model_profile(session_id),
                cwd,
                label=key,
                prompt=prompt,
                asked_model=asked_model,
                gets=gets,
            )
        except ToolError as exc:
            raise WorkflowError(str(exc)) from exc
        await started(ref.session_id)
        await self._wait(session_id, call_id, index)
        (outcome,) = await self._sessions.helper_results(session_id, call_id, index)
        return outcome, ref.session_id

    async def _wait(self, session_id: str, call_id: str, index: int) -> None:
        """Wait until the helper at ``index`` of the call has ended.

        ``helper.ended`` wakes this, nothing polls.
        """
        waiter = asyncio.Event()
        waiters = self._waiters.setdefault(session_id, set())
        waiters.add(waiter)
        try:
            while True:
                waiter.clear()
                if await self._sessions.helpers_ended(session_id, call_id, index):
                    return
                try:
                    await asyncio.wait_for(waiter.wait(), RECHECK_SECONDS)
                except TimeoutError:
                    log.debug("helper %s of %s: rechecking", call_id, session_id)
        finally:
            waiters.discard(waiter)
            if not waiters:
                self._waiters.pop(session_id, None)


__all__ = ["WorkflowAgents", "call_id_of"]
