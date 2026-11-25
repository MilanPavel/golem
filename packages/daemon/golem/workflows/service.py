"""The workflow service: the registry, the engine and the runs in flight (ADR-062).

``launch`` runs the engine as a background task the service tracks, so shutdown and
``workflow.cancel`` can stop it. The engine's events go out as ``workflow.run.*`` and
``workflow.step.*`` notifications. Each run gets one headless session (``origin`` is
``workflow:<name>``) before its first step event; it only holds the run, no turn starts.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from golem.routine_scheduler import trusted_folders
from golem.store.workflow_runs import WorkflowReviewRecord, WorkflowRunRecord, WorkflowRuns
from golem.workflow import WorkflowError
from golem.workflows.agents import WorkflowAgents
from golem.workflows.engine import AgentStarted, WorkflowEngine, restart_policy
from golem.workflows.llm import Llm
from golem.workflows.registry import WorkflowEntry, WorkflowRegistry
from golem.workflows.tools import WorkflowTools
from golem_protocol import rpc
from golem_protocol.commands import PendingItem, WorkflowRunEvent, WorkflowStepEvent

log = logging.getLogger("golem.server")

_NOTIFICATIONS: dict[str, type[BaseModel]] = {
    "workflow.run.started": rpc.WorkflowRunStartedNotification,
    "workflow.run.waiting": rpc.WorkflowRunWaitingNotification,
    "workflow.run.resumed": rpc.WorkflowRunResumedNotification,
    "workflow.run.done": rpc.WorkflowRunDoneNotification,
    "workflow.run.failed": rpc.WorkflowRunFailedNotification,
    "workflow.run.cancelled": rpc.WorkflowRunCancelledNotification,
    "workflow.step.started": rpc.WorkflowStepStartedNotification,
    "workflow.step.done": rpc.WorkflowStepDoneNotification,
    "workflow.step.failed": rpc.WorkflowStepFailedNotification,
    "workflow.step.waiting": rpc.WorkflowStepWaitingNotification,
    "workflow.step.in_doubt": rpc.WorkflowStepInDoubtNotification,
}


STOPPED = "the daemon stopped during the run"
RESUMABLE = ("running", "waiting", "failed")


class ResumeError(Exception):
    """A run cannot be continued: it is unknown, in flight, or ended."""


class ReviewError(Exception):
    """A review cannot be answered: the run or review is unknown, or it was answered already."""


PREVIEW_CHARS = 200
"""How much of a review's draft its pending item carries."""

_TOUCHING = ("workflow.run.started", "workflow.run.waiting", "workflow.step.waiting")
"""Events after which the run's session summary may carry a different review list."""


def review_text(draft: object) -> str:
    """A review's draft as text: a string as it is, anything else as JSON."""
    return draft if isinstance(draft, str) else json.dumps(draft, indent=2)


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _cut(text: str, size: int) -> str:
    one = " ".join(text.split())
    return one if len(one) <= size else one[: size - 1].rstrip() + "\u2026"


class WorkflowService:
    def __init__(
        self,
        *,
        runs: WorkflowRuns,
        user_dir: Path,
        user_file: Path,
        trusted: Callable[[Path], bool],
        broadcast: Callable[[BaseModel], None],
        create_session: Callable[[str, str | None], Awaitable[str]] | None = None,
        notify: Callable[[str, str, str | None], Awaitable[None]] | None = None,
        touch_session: Callable[[str], Awaitable[None]] | None = None,
        agents: WorkflowAgents | None = None,
        llm: Llm | None = None,
        tools: WorkflowTools | None = None,
    ) -> None:
        self.runs = runs
        self._agents = agents
        self._touch_session = touch_session
        self._touches: set[asyncio.Task[None]] = set()
        self._broadcast = broadcast
        self._create_session = create_session
        self._folders: set[Path] = set()
        self._tasks: dict[str, asyncio.Task[None]] = {}
        self._recovery: asyncio.Task[None] | None = None
        self._user_file = user_file
        self.registry = WorkflowRegistry(
            user_dir=user_dir, projects=self._projects, trusted=trusted
        )
        self._tell = notify
        self.engine = WorkflowEngine(
            runs,
            self._emit,
            self._notify if notify else None,
            agent=self._agent if agents else None,
            skill=self._skill if agents and agents.has_skills else None,
            llm=llm,
            tools=tools,
        )

    async def _agent(
        self,
        run_id: str,
        key: str,
        agent_type: str,
        brief: str,
        model: str | None,
        started: AgentStarted,
    ) -> dict[str, Any]:
        """Adapt a ``run.agent`` to the seam: the helper belongs to the run's session."""
        record = await self.runs.get_run(run_id)
        if self._agents is None or record is None or record.session_id is None:
            raise WorkflowError("run.agent needs the run's session, and this run has none")
        return await self._agents.run(
            session_id=record.session_id,
            cwd=record.project,
            key=key,
            agent_type=agent_type,
            brief=brief,
            model=model,
            started=started,
        )

    async def _skill(
        self, run_id: str, key: str, name: str, args: str, started: AgentStarted
    ) -> dict[str, Any]:
        """Adapt a ``run.skill`` to the seam: the helper belongs to the run's session."""
        record = await self.runs.get_run(run_id)
        if self._agents is None or record is None or record.session_id is None:
            raise WorkflowError("run.skill needs the run's session, and this run has none")
        return await self._agents.run_skill(
            session_id=record.session_id,
            cwd=record.project,
            key=key,
            name=name,
            args=args,
            started=started,
        )

    async def _notify(self, title: str | None, text: str, run_id: str) -> None:
        """Adapt a ``run.notify`` to the Notifier: the click opens the run's session."""
        if self._tell is None:
            return
        record = await self.runs.get_run(run_id)
        name = record.name if record is not None else "workflow"
        session_id = record.session_id if record is not None else None
        await self._tell(title or name, text, session_id)

    def _projects(self) -> list[Path]:
        """The folders asked for in ``workflow.list`` and the user's trusted folders."""
        return sorted({*self._folders, *trusted_folders(self._user_file)})

    def _emit(self, name: str, payload: dict[str, Any]) -> None:
        model = _NOTIFICATIONS.get(name)
        if model is None:
            return
        session_id = payload.get("session_id")
        if name in _TOUCHING and isinstance(session_id, str) and self._touch_session is not None:
            self._touch(session_id)
        params = WorkflowRunEvent if name.startswith("workflow.run.") else WorkflowStepEvent
        self._broadcast(model(params=params.model_validate(payload)))

    def _touch(self, session_id: str) -> None:
        """Have the session's summary sent again: its list of reviews may have changed."""
        touch = self._touch_session
        if touch is None:
            return

        async def push() -> None:
            try:
                await touch(session_id)
            except Exception:
                log.exception("the summary of session %s was not sent", session_id)

        task = asyncio.get_running_loop().create_task(push(), name="golem-workflow-touch")
        self._touches.add(task)
        task.add_done_callback(self._touches.discard)

    def start(self) -> None:
        """Start the registry, and deal with the runs the last daemon left ``running``."""
        self.registry.start()
        loop = asyncio.get_running_loop()
        self._recovery = loop.create_task(self._recover(), name="golem-workflow-recovery")

    async def _recover(self) -> None:
        """Apply each ``running`` run's ``on_restart`` policy. ``waiting`` runs stay waiting."""
        try:
            found = await self.runs.steps_for_recovery()
        except Exception:
            log.exception("workflow runs could not be listed for recovery")
            return
        for run, _steps in found:
            if run.status != "running" or run.workflow_run_id in self._tasks:
                continue
            try:
                await self._apply_policy(run)
            except Exception:
                log.exception("workflow run %s could not be recovered", run.workflow_run_id)

    async def _policy(self, run: WorkflowRunRecord) -> str:
        """The run's ``on_restart``, read from the workflow file the run started from.

        The file is loaded the way ``execute`` loads it, so a file that cannot be loaded gives
        ``resume`` and the run then fails with the real error.
        """
        try:
            return await asyncio.to_thread(restart_policy, Path(run.path), run.name)
        except Exception:
            return "resume"

    async def _apply_policy(self, run: WorkflowRunRecord) -> None:
        run_id = run.workflow_run_id
        policy = await self._policy(run)
        log.info("workflow run %s was running at restart: on_restart=%s", run_id, policy)
        if policy == "fail":
            await self.engine.mark_failed(run_id, STOPPED)
        elif policy == "ask":
            await self.engine.mark_waiting(run_id)
        else:
            self.launch(run_id)

    async def resume(self, run_id: str) -> WorkflowRunRecord:
        """Continue a ``running`` (orphaned), ``waiting`` or ``failed`` run; done steps are kept."""
        run = await self.runs.get_run(run_id)
        if run is None:
            raise ResumeError(f"no workflow run {run_id}")
        if run_id in self._tasks:
            raise ResumeError(f"workflow run {run_id} is already running")
        if run.status not in RESUMABLE:
            raise ResumeError(f"workflow run {run_id} is {run.status}; only a stopped run resumes")
        self.launch(run_id)
        return run

    async def answer_review(
        self, run_id: str, key: str, verdict: str, text: str | None
    ) -> WorkflowRunRecord:
        """Save the answer to a review, then continue the run once none of its reviews waits.

        ``approve`` without ``text`` answers with the draft itself. Raises :class:`ReviewError`.
        """
        run = await self.runs.get_run(run_id)
        if run is None:
            raise ReviewError(f"no workflow run {run_id}")
        review = await self.runs.get_review(run_id, key)
        if review is None:
            raise ReviewError(f"workflow run {run_id} has no review {key!r}")
        if review.answer_json is not None:
            raise ReviewError(f"review {key!r} of workflow run {run_id} is answered already")
        if verdict == "edit" and not text:
            raise ReviewError("an edit needs text: what you would send instead")
        if verdict == "approve" and not text:
            text = review_text(json.loads(review.pending_json).get("draft"))
        answer = json.dumps({"verdict": verdict, "text": text or ""})
        if not await self.runs.answer_review(run_id, key, answer, _now()):
            raise ReviewError(f"review {key!r} of workflow run {run_id} is answered already")
        self._touch_run(run)
        if not await self.runs.list_open_reviews(run_id):
            await self._continue(run_id)
        return run

    def _touch_run(self, run: WorkflowRunRecord) -> None:
        if run.session_id is not None:
            self._touch(run.session_id)

    async def _continue(self, run_id: str) -> None:
        """Run the workflow again after an answer. A task that is still ending is awaited first."""
        task = self._tasks.get(run_id)
        if task is not None:
            await asyncio.gather(task, return_exceptions=True)
        run = await self.runs.get_run(run_id)
        if run is not None and run.status == "waiting":
            self.launch(run_id)

    async def pending_items(self, session_id: str) -> list[PendingItem]:
        """The open reviews of the run that owns ``session_id``, oldest first."""
        run = await self.runs.by_session(session_id)
        if run is None or run.status != "waiting":
            return []
        return [
            review_item(run.workflow_run_id, r)
            for r in await self.runs.list_open_reviews(run.workflow_run_id)
        ]

    async def refresh(self, folders: list[Path]) -> list[WorkflowEntry]:
        self._folders.update(folders)
        await asyncio.to_thread(self.registry.refresh)
        return self.registry.entries()

    def launch(self, run_id: str) -> None:
        if run_id in self._tasks:
            return
        loop = asyncio.get_running_loop()
        task = loop.create_task(self._run(run_id), name=f"golem-workflow-{run_id}")
        self._tasks[run_id] = task
        task.add_done_callback(lambda _t: self._tasks.pop(run_id, None))

    async def _ensure_session(self, run_id: str) -> None:
        """Give the run its headless session, so ``workflow.run.started`` carries its id."""
        if self._create_session is None:
            return
        record = await self.runs.get_run(run_id)
        if record is None or record.session_id is not None:
            return
        try:
            session_id = await self._create_session(f"workflow:{record.name}", record.project)
            await self.runs.set_run_session(run_id, session_id)
        except Exception:
            log.exception("workflow run %s got no session", run_id)

    async def _warn_if_changed(self, run_id: str) -> None:
        """Log when the workflow file is not the one the run started with (versions: #17)."""
        record = await self.runs.get_run(run_id)
        if record is None or record.source_hash is None:
            return
        try:
            data = await asyncio.to_thread(Path(record.path).read_bytes)
        except OSError:
            return
        if hashlib.sha256(data).hexdigest() != record.source_hash:
            log.warning("workflow run %s: %s changed since the run started", run_id, record.path)

    async def _run(self, run_id: str) -> None:
        try:
            await self._warn_if_changed(run_id)
            await self._ensure_session(run_id)
            await self.engine.execute(run_id)
        except asyncio.CancelledError:
            record = await self.runs.get_run(run_id)
            if record is not None and record.status == "pending" and not self.engine.stopping:
                # Cancelled before the engine began: the engine never set the status.
                await self.engine.mark_cancelled(run_id)
        except Exception:
            log.exception("workflow run %s broke", run_id)

    async def cancel(self, run_id: str) -> bool:
        task = self._tasks.get(run_id)
        if task is None or task.done():
            return False
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        return True

    async def aclose(self) -> None:
        await self.registry.aclose()
        # A run stopped by shutdown is not cancelled: it stays `running` and the next start
        # applies its on_restart policy.
        self.engine.stopping = True
        tasks = list(self._tasks.values())
        if self._recovery is not None:
            tasks.append(self._recovery)
            self._recovery = None
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        self._tasks.clear()


def review_item(run_id: str, review: WorkflowReviewRecord) -> PendingItem:
    """The ``review`` pending item of an open review row."""
    pending = json.loads(review.pending_json)
    return PendingItem(
        kind="review",
        since=review.created_at,
        ask=_cut(str(pending.get("ask") or "Review this"), 500),
        preview=_cut(review_text(pending.get("draft")), PREVIEW_CHARS),
        workflow_run_id=run_id,
        key=review.step_key,
    )


__all__ = ["ResumeError", "ReviewError", "WorkflowService", "review_item", "review_text"]
