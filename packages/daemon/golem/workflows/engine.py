"""The workflow engine: runs a workflow function and keeps each step's result (ADR-062, B).

``workflow_steps`` is the journal. ``execute`` runs the workflow function from the top; every
``run.step`` looks its row up and returns the saved result when the step is ``done``, so a run
that was interrupted continues where it stopped and no finished step runs twice.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import importlib.util
import inspect
import json
import logging
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from golem.store.workflow_runs import WorkflowRuns
from golem.workflow import (
    IDEMPOTENCY_KEY,
    MAY_HAVE_RUN,
    SPEC_ATTR,
    Run,
    WorkflowError,
    WorkflowSpec,
    WorkflowWaiting,
)

__all__ = ["WorkflowEngine", "restart_policy"]

log = logging.getLogger(__name__)

_STEP_ATTR = "__golem_step__"

Emit = Callable[[str, dict[str, Any]], None]
Notify = Callable[[str | None, str, str], Awaitable[None]]
"""Tells the person: title (or None), text, and the workflow run id the text is about."""
AgentStarted = Callable[[str], Awaitable[None]]
AgentRunner = Callable[[str, str, str, str, str | None, AgentStarted], Awaitable[dict[str, Any]]]
"""Runs an agent step: workflow run id, step key, agent type, brief, model wish and a callback
for the helper's session id. Returns the step's result. ``workflows/agents.py`` is behind it."""


def _no_emit(name: str, payload: dict[str, Any]) -> None:
    pass


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _find(path: Path, name: str) -> Callable[..., Any]:
    spec = importlib.util.spec_from_file_location(f"golem_workflow_run_{path.stem}", path)
    if spec is None or spec.loader is None:
        raise WorkflowError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    for value in vars(module).values():
        label = getattr(value, SPEC_ATTR, None)
        if isinstance(label, WorkflowSpec) and label.name == name and callable(value):
            return value
    raise WorkflowError(f"{path} has no workflow named {name!r}")


def restart_policy(path: Path, name: str) -> str:
    """The ``on_restart`` of the workflow ``name`` in ``path``. Loads the file, like ``execute``."""
    spec = getattr(_find(path, name), SPEC_ATTR)
    return spec.on_restart if isinstance(spec, WorkflowSpec) else "resume"


class WorkflowEngine:
    def __init__(
        self,
        store: WorkflowRuns,
        emit: Emit | None = None,
        notify: Notify | None = None,
        agent: AgentRunner | None = None,
    ) -> None:
        self._store = store
        self._emit: Emit = emit or _no_emit
        self._notify = notify
        self._agent = agent
        self.stopping = False
        """True while the daemon shuts down: a cancelled run stays ``running`` and resumes later."""

    async def notify(self, workflow_run_id: str, title: str | None, text: str) -> None:
        """Send a ``run.notify`` text. Without a notifier the step still completes."""
        if self._notify is None:
            log.debug("workflow run %s notify (no notifier): %s", workflow_run_id, text)
            return
        await self._notify(title, text, workflow_run_id)

    async def run_agent(
        self, workflow_run_id: str, key: str, agent_type: str, brief: str, model: str | None
    ) -> dict[str, Any]:
        """Run an agent step's helper; its session id is saved on the step as soon as it exists."""
        if self._agent is None:
            raise WorkflowError("run.agent is not available: this daemon has no agents")

        async def started(session_id: str) -> None:
            await self._store.set_step_child_session(workflow_run_id, key, session_id)
            await self.step_event("workflow.step.started", workflow_run_id, key)

        return await self._agent(workflow_run_id, key, agent_type, brief, model, started)

    def send(self, name: str, payload: dict[str, Any]) -> None:
        try:
            self._emit(name, payload)
        except Exception:
            log.exception("workflow event %s failed", name)

    @property
    def store(self) -> WorkflowRuns:
        return self._store

    async def start(
        self,
        entry_path: Path | str,
        workflow_name: str,
        inputs: dict[str, Any] | None = None,
        trigger: str = "manual",
    ) -> str:
        """Create the run row and run it to its end. Returns the run id."""
        path = Path(entry_path)
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        run_id = await self._store.create_run(
            f"{path}::{workflow_name}",
            workflow_name,
            str(path),
            _now(),
            inputs_json=json.dumps(inputs or {}),
            trigger=trigger,
            source_hash=digest,
        )
        await self.execute(run_id)
        return run_id

    async def _run_event(self, name: str, workflow_run_id: str) -> None:
        """Send a run event from the row as it is now (the shape of ``WorkflowRunEvent``)."""
        run = await self._store.get_run(workflow_run_id)
        if run is None:
            return
        self.send(
            name,
            {
                "workflow_run_id": run.workflow_run_id,
                "workflow_id": run.workflow_id,
                "name": run.name,
                "status": run.status,
                "trigger": run.trigger,
                "session_id": run.session_id,
                "started_at": run.started_at,
                "finished_at": run.finished_at,
                "error": run.error,
            },
        )

    async def step_event(self, name: str, workflow_run_id: str, key: str) -> None:
        """Send a step event from the row as it is now (the shape of ``WorkflowStepEvent``)."""
        step = await self._store.get_step(workflow_run_id, key)
        if step is None:
            return
        self.send(
            name,
            {
                "workflow_run_id": step.workflow_run_id,
                "key": step.step_key,
                "kind": step.kind,
                "title": step.title or step.step_key,
                "status": step.status,
                "group": step.group_key,
                "attempts": step.attempts,
                "error": step.error,
                "child_session_id": step.child_session_id,
                "started_at": step.started_at,
                "finished_at": step.finished_at,
            },
        )

    async def mark_cancelled(self, workflow_run_id: str) -> None:
        """Set a run that never began to ``cancelled`` and send ``workflow.run.cancelled``."""
        await self._store.set_run_status(workflow_run_id, "cancelled", _now())
        await self._run_event("workflow.run.cancelled", workflow_run_id)

    async def mark_failed(self, workflow_run_id: str, error: str) -> None:
        """Set a run that will not continue to ``failed`` and send ``workflow.run.failed``."""
        await self._store.set_run_status(workflow_run_id, "failed", _now(), error)
        await self._run_event("workflow.run.failed", workflow_run_id)

    async def mark_waiting(self, workflow_run_id: str) -> None:
        """Set a run to ``waiting`` and send ``workflow.run.waiting``."""
        await self._store.set_run_status(workflow_run_id, "waiting", _now())
        await self._run_event("workflow.run.waiting", workflow_run_id)

    async def execute(self, workflow_run_id: str) -> None:
        """Run the workflow function from the top; finished steps return their saved result."""
        record = await self._store.get_run(workflow_run_id)
        if record is None:
            raise WorkflowError(f"no workflow run {workflow_run_id}")
        await self._store.set_run_status(workflow_run_id, "running", _now())
        await self._run_event("workflow.run.started", workflow_run_id)
        try:
            fn = await asyncio.to_thread(_find, Path(record.path), record.name)
            inputs: dict[str, Any] = json.loads(record.inputs_json or "{}")
            names = list(inspect.signature(fn).parameters)[1:]
            kwargs = {k: v for k, v in inputs.items() if k in names}
            await fn(Run(_Journal(self), workflow_run_id, inputs), **kwargs)
        except WorkflowWaiting:
            # A review is out: end the task, hold nothing. The answer runs the workflow again.
            await self.mark_waiting(workflow_run_id)
            return
        except asyncio.CancelledError:
            if not self.stopping:
                await self._store.set_run_status(workflow_run_id, "cancelled", _now())
                await self._run_event("workflow.run.cancelled", workflow_run_id)
            raise
        except Exception as exc:
            error = f"{type(exc).__name__}: {exc}"
            failed_step = getattr(exc, _STEP_ATTR, None)
            if failed_step is not None:
                error = f"step {failed_step!r} failed: {error}"
            await self._store.set_run_status(workflow_run_id, "failed", _now(), error)
            await self._run_event("workflow.run.failed", workflow_run_id)
            return
        await self._store.set_run_status(workflow_run_id, "done", _now())
        await self._run_event("workflow.run.done", workflow_run_id)


class _Journal:
    """The step journal :class:`~golem.workflow.Run` writes through."""

    def __init__(self, engine: WorkflowEngine) -> None:
        self._engine = engine

    async def notify(self, workflow_run_id: str, title: str | None, text: str) -> None:
        await self._engine.notify(workflow_run_id, title, text)

    async def run_step(
        self,
        workflow_run_id: str,
        key: str,
        kind: str,
        title: str,
        group_key: str | None,
        fn: Callable[..., Any],
        args: tuple[Any, ...],
        kwargs: dict[str, Any],
        keyed: bool = False,
        retries: int = 0,
        backoff: float = 0.0,
    ) -> Any:
        store = self._engine.store
        event = self._engine.step_event
        before = await store.get_step(workflow_run_id, key)
        doubt = before is not None and before.status in ("running", "in_doubt") and keyed
        if doubt and before is not None and before.status == "running":
            # The daemon died while a keyed step ran: it may have done its action.
            await store.mark_in_doubt(workflow_run_id, key, _now())
            await event("workflow.step.in_doubt", workflow_run_id, key)
        row = await store.begin_step(workflow_run_id, key, kind, title, group_key, _now())
        if row.status == "done":
            return json.loads(row.result_json) if row.result_json is not None else None

        await event("workflow.step.started", workflow_run_id, key)
        key_token = IDEMPOTENCY_KEY.set(key if keyed else None)
        doubt_token = MAY_HAVE_RUN.set(doubt)
        result: Any = None
        encoded = "null"
        try:
            for attempt in range(retries + 1):
                try:
                    result = await _call(fn, args, kwargs)
                    try:
                        encoded = json.dumps(result)
                    except (TypeError, ValueError) as exc:
                        raise WorkflowError(
                            f"step {key!r} returned a value that is not JSON ({exc}); return"
                            " numbers, strings, lists and dicts"
                        ) from exc
                except WorkflowError:
                    raise
                except Exception:
                    if attempt >= retries:
                        raise
                    if backoff:
                        await asyncio.sleep(backoff)
                    await store.begin_step(workflow_run_id, key, kind, title, group_key, _now())
                    continue
                break
        except Exception as exc:
            error = f"{type(exc).__name__}: {exc}"
            with contextlib.suppress(AttributeError):
                setattr(exc, _STEP_ATTR, key)
            await store.fail_step(workflow_run_id, key, error, _now())
            await event("workflow.step.failed", workflow_run_id, key)
            raise
        finally:
            IDEMPOTENCY_KEY.reset(key_token)
            MAY_HAVE_RUN.reset(doubt_token)
        await store.finish_step(workflow_run_id, key, encoded, _now())
        await event("workflow.step.done", workflow_run_id, key)
        return result

    async def agent(
        self,
        workflow_run_id: str,
        key: str,
        agent_type: str,
        brief: str,
        model: str | None,
        group_key: str | None,
    ) -> dict[str, Any]:
        return await self.run_step(
            workflow_run_id,
            key,
            "agent",
            agent_type,
            group_key,
            self._engine.run_agent,
            (workflow_run_id, key, agent_type, brief, model),
            {},
        )

    async def review(
        self,
        workflow_run_id: str,
        key: str,
        ask: str,
        group_key: str | None,
        draft: Any,
    ) -> Any:
        """The ``run.review`` step: return the answer, or write the review row and stop the run."""
        store = self._engine.store
        event = self._engine.step_event
        before = await store.get_step(workflow_run_id, key)
        if before is not None and before.status == "done":
            return json.loads(before.result_json) if before.result_json is not None else None
        review = await store.get_review(workflow_run_id, key)
        if review is not None and review.answer_json is not None:
            await store.begin_step(workflow_run_id, key, "review", ask, group_key, _now())
            await store.finish_step(workflow_run_id, key, review.answer_json, _now())
            await event("workflow.step.done", workflow_run_id, key)
            return json.loads(review.answer_json)
        if review is None:
            try:
                pending = json.dumps({"ask": ask, "draft": draft})
            except (TypeError, ValueError) as exc:
                raise WorkflowError(
                    f"review {key!r} got a draft that is not JSON ({exc}); pass a string, a list"
                    " or a dict"
                ) from exc
            await store.begin_step(workflow_run_id, key, "review", ask, group_key, _now())
            await event("workflow.step.started", workflow_run_id, key)
            await store.create_review(workflow_run_id, key, pending, _now())
        await store.set_step_status(workflow_run_id, key, "waiting")
        await event("workflow.step.waiting", workflow_run_id, key)
        raise WorkflowWaiting


async def _call(fn: Callable[..., Any], args: tuple[Any, ...], kwargs: dict[str, Any]) -> Any:
    if inspect.iscoroutinefunction(fn):
        return await fn(*args, **kwargs)
    result = await asyncio.to_thread(fn, *args, **kwargs)
    if inspect.isawaitable(result):
        result = await result
    return result
