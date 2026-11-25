"""The seam between a workflow's ``run.agent`` and golem's helpers (ADR-062, ADR-059).

This is the only workflow code that touches ``SessionManager`` helper APIs. An agent step is a
helper of the run's own session: ``start_helper`` makes it once per ``wf:<step key>`` (a second
call after a restart returns the helper that exists), and the step waits for it to end.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from golem.agents.model import WISHES
from golem.agents.registry import AgentRegistry
from golem.config import AgentSettings
from golem.sessions.bus import EventBus
from golem.sessions.helpers import snapshot_of
from golem.sessions.manager import SessionManager
from golem.tools.registry import ToolError
from golem.workflow import WorkflowError
from golem_protocol.events import AgentOrigin, ChatEvent

log = logging.getLogger(__name__)

RECHECK_SECONDS = 60.0
"""The wait is woken by ``helper.ended``; this is only a safety net against a missed event."""

Started = Callable[[str], Awaitable[None]]
"""Called with the helper's session id as soon as the helper exists."""


def call_id_of(key: str) -> str:
    """The ``delegate`` call id the helper of the step ``key`` is stored under."""
    return f"wf:{key}"


class WorkflowAgents:
    def __init__(
        self,
        *,
        sessions: SessionManager,
        agents: AgentRegistry,
        bus: EventBus,
        settings: Callable[[], AgentSettings],
    ) -> None:
        self._sessions = sessions
        self._agents = agents
        self._settings = settings
        self._waiters: dict[str, set[asyncio.Event]] = {}
        bus.observe(self._seen)

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
    ) -> dict[str, Any]:
        """Run one agent as a helper of ``session_id`` and return its outcome.

        Returns ``{"status", "answer", "session_id"}``. Raises :class:`WorkflowError` for an
        unknown or unavailable agent type, a model wish that is not one, a helper that cannot
        start, and a helper that failed or was stopped.
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
        call_id = call_id_of(key)
        try:
            ref = await self._sessions.start_helper(
                session_id,
                call_id,
                0,
                snapshot,
                brief,
                await self._sessions.model_profile(session_id),
                cwd,
                label=key,
                prompt=agent.body,
                asked_model=model,
                gets=agent.gets,
            )
        except ToolError as exc:
            raise WorkflowError(str(exc)) from exc
        await started(ref.session_id)
        await self._wait(session_id, call_id)
        (outcome,) = await self._sessions.helper_results(session_id, call_id)
        if outcome.stopped != "done":
            detail = f": {outcome.covered}" if outcome.covered else ""
            raise WorkflowError(f"agent {agent_type} stopped ({outcome.stopped}){detail}")
        return {"status": "done", "answer": outcome.text, "session_id": ref.session_id}

    async def _wait(self, session_id: str, call_id: str) -> None:
        """Wait until the helper has ended: ``helper.ended`` wakes this, nothing polls."""
        waiter = asyncio.Event()
        waiters = self._waiters.setdefault(session_id, set())
        waiters.add(waiter)
        try:
            while True:
                waiter.clear()
                if await self._sessions.helpers_ended(session_id, call_id):
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
