"""The workflow service: the registry, the engine and the runs in flight (ADR-062).

``launch`` runs the engine as a background task the service tracks, so shutdown and
``workflow.cancel`` can stop it. The engine's events go out as ``workflow.run.*`` and
``workflow.step.*`` notifications. A run's headless session is not made yet (``session_id``
stays null until agent steps need it).
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from golem.routine_scheduler import trusted_folders
from golem.store.workflow_runs import WorkflowRuns
from golem.workflows.engine import WorkflowEngine
from golem.workflows.registry import WorkflowEntry, WorkflowRegistry
from golem_protocol import rpc
from golem_protocol.commands import WorkflowRunEvent, WorkflowStepEvent

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


def _now() -> str:
    return datetime.now(UTC).isoformat()


class WorkflowService:
    def __init__(
        self,
        *,
        runs: WorkflowRuns,
        user_dir: Path,
        user_file: Path,
        trusted: Callable[[Path], bool],
        broadcast: Callable[[BaseModel], None],
    ) -> None:
        self.runs = runs
        self._broadcast = broadcast
        self._folders: set[Path] = set()
        self._tasks: dict[str, asyncio.Task[None]] = {}
        self._user_file = user_file
        self.registry = WorkflowRegistry(
            user_dir=user_dir, projects=self._projects, trusted=trusted
        )
        self.engine = WorkflowEngine(runs, self._emit)

    def _projects(self) -> list[Path]:
        """The folders asked for in ``workflow.list`` and the user's trusted folders."""
        return sorted({*self._folders, *trusted_folders(self._user_file)})

    def _emit(self, name: str, payload: dict[str, Any]) -> None:
        model = _NOTIFICATIONS.get(name)
        if model is None:
            return
        params = WorkflowRunEvent if name.startswith("workflow.run.") else WorkflowStepEvent
        self._broadcast(model(params=params.model_validate(payload)))

    def start(self) -> None:
        self.registry.start()

    async def refresh(self, folders: list[Path]) -> list[WorkflowEntry]:
        self._folders.update(folders)
        await asyncio.to_thread(self.registry.refresh)
        return self.registry.entries()

    def launch(self, run_id: str) -> None:
        loop = asyncio.get_running_loop()
        task = loop.create_task(self._run(run_id), name=f"golem-workflow-{run_id}")
        self._tasks[run_id] = task
        task.add_done_callback(lambda _t: self._tasks.pop(run_id, None))

    async def _run(self, run_id: str) -> None:
        try:
            await self.engine.execute(run_id)
        except asyncio.CancelledError:
            record = await self.runs.get_run(run_id)
            if record is not None and record.status == "pending":
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
        tasks = list(self._tasks.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        self._tasks.clear()


__all__ = ["WorkflowService"]
