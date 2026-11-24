"""The workflow engine: runs a workflow function and keeps each step's result (ADR-062, B).

``workflow_steps`` is the journal. ``execute`` runs the workflow function from the top; every
``run.step`` looks its row up and returns the saved result when the step is ``done``, so a run
that was interrupted continues where it stopped and no finished step runs twice.
"""

from __future__ import annotations

import asyncio
import hashlib
import importlib.util
import inspect
import json
import logging
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from golem.store.workflow_runs import WorkflowRuns
from golem.workflow import SPEC_ATTR, Run, WorkflowError, WorkflowSpec

__all__ = ["WorkflowEngine"]

log = logging.getLogger(__name__)

Emit = Callable[[str, dict[str, Any]], None]


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


class WorkflowEngine:
    def __init__(self, store: WorkflowRuns, emit: Emit | None = None) -> None:
        self._store = store
        self._emit: Emit = emit or _no_emit

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

    async def execute(self, workflow_run_id: str) -> None:
        """Run the workflow function from the top; finished steps return their saved result."""
        record = await self._store.get_run(workflow_run_id)
        if record is None:
            raise WorkflowError(f"no workflow run {workflow_run_id}")
        await self._store.set_run_status(workflow_run_id, "running", _now())
        base = {"workflow_run_id": workflow_run_id, "name": record.name}
        self.send("workflow.run.started", base)
        try:
            fn = _find(Path(record.path), record.name)
            inputs: dict[str, Any] = json.loads(record.inputs_json or "{}")
            names = list(inspect.signature(fn).parameters)[1:]
            kwargs = {k: v for k, v in inputs.items() if k in names}
            await fn(Run(_Journal(self), workflow_run_id, inputs), **kwargs)
        except asyncio.CancelledError:
            await self._store.set_run_status(workflow_run_id, "cancelled", _now())
            raise
        except Exception as exc:
            error = f"{type(exc).__name__}: {exc}"
            await self._store.set_run_status(workflow_run_id, "failed", _now(), error)
            self.send("workflow.run.failed", {**base, "error": error})
            return
        await self._store.set_run_status(workflow_run_id, "done", _now())
        self.send("workflow.run.done", base)


class _Journal:
    """The step journal :class:`~golem.workflow.Run` writes through."""

    def __init__(self, engine: WorkflowEngine) -> None:
        self._engine = engine

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
    ) -> Any:
        store = self._engine.store
        send = self._engine.send
        row = await store.begin_step(workflow_run_id, key, kind, title, group_key, _now())
        if row.status == "done":
            return json.loads(row.result_json) if row.result_json is not None else None

        def payload(error: str | None = None) -> dict[str, Any]:
            return {
                "workflow_run_id": workflow_run_id,
                "step_key": key,
                "kind": kind,
                "title": title,
                "group_key": group_key,
                "attempts": row.attempts,
                "error": error,
            }

        send("workflow.step.started", payload())
        try:
            if inspect.iscoroutinefunction(fn):
                result = await fn(*args, **kwargs)
            else:
                result = await asyncio.to_thread(fn, *args, **kwargs)
                if inspect.isawaitable(result):
                    result = await result
            try:
                encoded = json.dumps(result)
            except (TypeError, ValueError) as exc:
                raise WorkflowError(
                    f"step {key!r} returned a value that is not JSON ({exc}); return numbers,"
                    " strings, lists and dicts"
                ) from exc
        except Exception as exc:
            error = f"{type(exc).__name__}: {exc}"
            await store.fail_step(workflow_run_id, key, error, _now())
            send("workflow.step.failed", payload(error))
            raise
        await store.finish_step(workflow_run_id, key, encoded, _now())
        send("workflow.step.done", payload())
        return result
