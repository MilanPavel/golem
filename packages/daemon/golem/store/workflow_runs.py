"""Read and write ``workflow_runs``, ``workflow_steps`` and ``workflow_reviews`` (ADR-062).

``workflow_steps`` is the engine's step journal and the source of truth. After a restart the
engine runs the workflow function again from the top, and each ``run.*`` call looks its row up
by ``(workflow_run_id, step_key)`` and returns the saved result when the step is ``done``.
JSON columns are held as text here; the engine encodes and decodes them.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass

from golem.sessions.ids import new_id
from golem.store.database import Database, Params, Transaction

__all__ = [
    "WorkflowOutputRecord",
    "WorkflowReviewRecord",
    "WorkflowRunRecord",
    "WorkflowRuns",
    "WorkflowStepRecord",
]

_ACTIVE = ("running", "waiting")


@dataclass(frozen=True, slots=True)
class WorkflowRunRecord:
    workflow_run_id: str
    workflow_id: str
    name: str
    path: str
    project: str | None
    session_id: str | None
    status: str
    inputs_json: str | None
    trigger: str
    error: str | None
    created_at: str
    started_at: str | None
    finished_at: str | None
    source_hash: str | None
    result_json: str | None


@dataclass(frozen=True, slots=True)
class WorkflowOutputRecord:
    workflow_run_id: str
    position: int
    title: str | None
    value_json: str
    summary: str | None


@dataclass(frozen=True, slots=True)
class WorkflowStepRecord:
    workflow_run_id: str
    step_key: str
    kind: str
    title: str | None
    group_key: str | None
    status: str
    attempts: int
    result_json: str | None
    error: str | None
    child_session_id: str | None
    cost_usd: float | None
    model: str | None
    started_at: str | None
    finished_at: str | None
    seq: int
    item: str | None
    group_title: str | None


@dataclass(frozen=True, slots=True)
class WorkflowReviewRecord:
    workflow_run_id: str
    step_key: str
    pending_json: str
    answer_json: str | None
    created_at: str
    answered_at: str | None


def _run(row: sqlite3.Row) -> WorkflowRunRecord:
    return WorkflowRunRecord(**dict(zip(row.keys(), tuple(row), strict=True)))  # type: ignore[arg-type]


def _step(row: sqlite3.Row) -> WorkflowStepRecord:
    return WorkflowStepRecord(**dict(zip(row.keys(), tuple(row), strict=True)))  # type: ignore[arg-type]


def _output(row: sqlite3.Row) -> WorkflowOutputRecord:
    return WorkflowOutputRecord(**dict(zip(row.keys(), tuple(row), strict=True)))  # type: ignore[arg-type]


def _review(row: sqlite3.Row) -> WorkflowReviewRecord:
    return WorkflowReviewRecord(**dict(zip(row.keys(), tuple(row), strict=True)))  # type: ignore[arg-type]


class WorkflowRuns:
    def __init__(self, database: Database) -> None:
        self._database = database

    async def _write(self, sql: str, params: Params) -> int:
        async with self._database.transaction() as tx:
            return await tx.execute(sql, params)

    # Runs

    async def create_run(
        self,
        workflow_id: str,
        name: str,
        path: str,
        at: str,
        *,
        project: str | None = None,
        inputs_json: str | None = None,
        trigger: str = "manual",
        source_hash: str | None = None,
    ) -> str:
        """Write a ``pending`` run. Returns its id."""
        run_id = new_id("wr")
        await self._write(
            "INSERT INTO workflow_runs (workflow_run_id, workflow_id, name, path, project,"
            " status, inputs_json, trigger, created_at, source_hash)"
            " VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)",
            (run_id, workflow_id, name, path, project, inputs_json, trigger, at, source_hash),
        )
        return run_id

    async def get_run(self, run_id: str) -> WorkflowRunRecord | None:
        row = await self._database.fetch_one(
            "SELECT * FROM workflow_runs WHERE workflow_run_id = ?", (run_id,)
        )
        return None if row is None else _run(row)

    async def by_session(self, session_id: str) -> WorkflowRunRecord | None:
        """The run that owns the headless ``session_id``, if any."""
        row = await self._database.fetch_one(
            "SELECT * FROM workflow_runs WHERE session_id = ?", (session_id,)
        )
        return None if row is None else _run(row)

    async def list_runs(
        self, workflow_id: str | None = None, status: str | None = None, limit: int = 50
    ) -> list[WorkflowRunRecord]:
        """Runs, newest first, optionally of one workflow and/or one status."""
        where: list[str] = []
        params: list[object] = []
        if workflow_id is not None:
            where.append("workflow_id = ?")
            params.append(workflow_id)
        if status is not None:
            where.append("status = ?")
            params.append(status)
        clause = f" WHERE {' AND '.join(where)}" if where else ""
        rows = await self._database.fetch_all(
            f"SELECT * FROM workflow_runs{clause} ORDER BY created_at DESC, rowid DESC LIMIT ?",
            (*params, limit),
        )
        return [_run(row) for row in rows]

    async def set_run_status(
        self, run_id: str, status: str, at: str | None = None, error: str | None = None
    ) -> None:
        """Move a run to ``status``.

        ``at`` stamps ``started_at`` (the first time the run is ``running``) or
        ``finished_at`` (``done``, ``failed`` or ``cancelled``). Any other status clears
        ``finished_at``, so a resumed run does not keep the time it stopped.
        """
        finished = status in ("done", "failed", "cancelled")
        await self._write(
            "UPDATE workflow_runs SET status = ?, error = ?,"
            " started_at = CASE WHEN ? AND started_at IS NULL THEN ? ELSE started_at END,"
            " finished_at = CASE WHEN ? THEN ? ELSE NULL END"
            " WHERE workflow_run_id = ?",
            (status, error, status == "running", at, finished, at, run_id),
        )

    async def set_run_session(self, run_id: str, session_id: str) -> None:
        await self._write(
            "UPDATE workflow_runs SET session_id = ? WHERE workflow_run_id = ?",
            (session_id, run_id),
        )

    async def set_run_result(self, run_id: str, result_json: str | None) -> None:
        """Keep what the workflow function returned (JSON text, or None for nothing)."""
        await self._write(
            "UPDATE workflow_runs SET result_json = ? WHERE workflow_run_id = ?",
            (result_json, run_id),
        )

    # Outputs

    async def add_output(
        self, run_id: str, position: int, title: str | None, value_json: str, summary: str | None
    ) -> None:
        """Save output ``position``. A run that is executed again marks the same ones; the one
        already saved is kept, so none is written twice."""
        await self._write(
            "INSERT OR IGNORE INTO workflow_outputs"
            " (workflow_run_id, position, title, value_json, summary) VALUES (?, ?, ?, ?, ?)",
            (run_id, position, title, value_json, summary),
        )

    async def list_outputs(self, run_id: str) -> list[WorkflowOutputRecord]:
        rows = await self._database.fetch_all(
            "SELECT * FROM workflow_outputs WHERE workflow_run_id = ? ORDER BY position",
            (run_id,),
        )
        return [_output(row) for row in rows]

    async def steps_for_recovery(self) -> list[tuple[WorkflowRunRecord, list[WorkflowStepRecord]]]:
        """Every run that is ``running`` or ``waiting``, oldest first, with its steps."""
        rows = await self._database.fetch_all(
            "SELECT * FROM workflow_runs WHERE status IN (?, ?) ORDER BY created_at, rowid",
            _ACTIVE,
        )
        return [(_run(row), await self.list_steps(row["workflow_run_id"])) for row in rows]

    # Steps

    async def get_step(self, run_id: str, key: str) -> WorkflowStepRecord | None:
        row = await self._database.fetch_one(
            "SELECT * FROM workflow_steps WHERE workflow_run_id = ? AND step_key = ?",
            (run_id, key),
        )
        return None if row is None else _step(row)

    async def list_steps(self, run_id: str) -> list[WorkflowStepRecord]:
        rows = await self._database.fetch_all(
            "SELECT * FROM workflow_steps WHERE workflow_run_id = ? ORDER BY seq", (run_id,)
        )
        return [_step(row) for row in rows]

    async def begin_step(
        self,
        run_id: str,
        key: str,
        kind: str,
        title: str | None,
        group_key: str | None,
        at: str,
        *,
        item: str | None = None,
        group_title: str | None = None,
    ) -> WorkflowStepRecord:
        """Start a step: insert it, or bump ``attempts`` of the row that is there.

        A step that is ``done`` or ``skipped`` comes back unchanged: its saved result is the
        answer. Any other status goes to ``running``.
        """
        async with self._database.transaction() as tx:
            rows = await tx.fetch_all(
                "SELECT status FROM workflow_steps WHERE workflow_run_id = ? AND step_key = ?",
                (run_id, key),
            )
            if not rows:
                await _insert_step(tx, run_id, key, kind, title, group_key, at, item, group_title)
            elif rows[0]["status"] not in ("done", "skipped"):
                await tx.execute(
                    "UPDATE workflow_steps SET status = 'running', attempts = attempts + 1,"
                    " started_at = ?, finished_at = NULL, error = NULL"
                    " WHERE workflow_run_id = ? AND step_key = ?",
                    (at, run_id, key),
                )
        step = await self.get_step(run_id, key)
        assert step is not None
        return step

    async def _step_update(self, run_id: str, key: str, sets: str, params: Params) -> None:
        await self._write(
            f"UPDATE workflow_steps SET {sets} WHERE workflow_run_id = ? AND step_key = ?",
            (*params, run_id, key),
        )

    async def finish_step(
        self, run_id: str, key: str, result_json: str | None, at: str, cost_usd: float | None = None
    ) -> None:
        await self._step_update(
            run_id,
            key,
            "status = 'done', result_json = ?, error = NULL, finished_at = ?,"
            " cost_usd = COALESCE(?, cost_usd)",
            (result_json, at, cost_usd),
        )

    async def fail_step(self, run_id: str, key: str, error: str, at: str) -> None:
        await self._step_update(
            run_id, key, "status = 'failed', error = ?, finished_at = ?", (error, at)
        )

    async def set_step_status(self, run_id: str, key: str, status: str) -> None:
        """Set ``waiting`` (a review or helper is out) or ``skipped``."""
        await self._step_update(run_id, key, "status = ?", (status,))

    async def mark_in_doubt(self, run_id: str, key: str, at: str) -> bool:
        """A keyed step found ``running`` at recovery. False when it was not running."""
        changed = await self._write(
            "UPDATE workflow_steps SET status = 'in_doubt', finished_at = ?"
            " WHERE workflow_run_id = ? AND step_key = ? AND status = 'running'",
            (at, run_id, key),
        )
        return changed > 0

    async def set_step_model(
        self, run_id: str, key: str, model: str | None, cost_usd: float | None
    ) -> None:
        """Keep the model that answered an ``llm`` step and what the call cost."""
        await self._step_update(run_id, key, "model = ?, cost_usd = ?", (model, cost_usd))

    async def set_step_child_session(self, run_id: str, key: str, session_id: str) -> None:
        await self._step_update(run_id, key, "child_session_id = ?", (session_id,))

    # Reviews

    async def create_review(
        self, run_id: str, step_key: str, pending_json: str, at: str
    ) -> WorkflowReviewRecord:
        """Write the open question of a review step. The one already there is kept."""
        await self._write(
            "INSERT OR IGNORE INTO workflow_reviews"
            " (workflow_run_id, step_key, pending_json, created_at) VALUES (?, ?, ?, ?)",
            (run_id, step_key, pending_json, at),
        )
        review = await self.get_review(run_id, step_key)
        assert review is not None
        return review

    async def get_review(self, run_id: str, step_key: str) -> WorkflowReviewRecord | None:
        row = await self._database.fetch_one(
            "SELECT * FROM workflow_reviews WHERE workflow_run_id = ? AND step_key = ?",
            (run_id, step_key),
        )
        return None if row is None else _review(row)

    async def answer_review(self, run_id: str, step_key: str, answer_json: str, at: str) -> bool:
        """Save the answer. False when there is no open review (none, or answered already)."""
        changed = await self._write(
            "UPDATE workflow_reviews SET answer_json = ?, answered_at = ?"
            " WHERE workflow_run_id = ? AND step_key = ? AND answered_at IS NULL",
            (answer_json, at, run_id, step_key),
        )
        return changed > 0

    async def list_open_reviews(self, run_id: str | None = None) -> list[WorkflowReviewRecord]:
        """Reviews without an answer, oldest first."""
        where = " AND workflow_run_id = ?" if run_id is not None else ""
        params: Params = (run_id,) if run_id is not None else ()
        rows = await self._database.fetch_all(
            f"SELECT * FROM workflow_reviews WHERE answered_at IS NULL{where}"
            " ORDER BY created_at, rowid",
            params,
        )
        return [_review(row) for row in rows]


async def _insert_step(
    tx: Transaction,
    run_id: str,
    key: str,
    kind: str,
    title: str | None,
    group_key: str | None,
    at: str,
    item: str | None,
    group_title: str | None,
) -> None:
    await tx.execute(
        "INSERT INTO workflow_steps (workflow_run_id, step_key, kind, title, group_key, status,"
        " attempts, started_at, seq, item, group_title) VALUES (?, ?, ?, ?, ?, 'running', 1, ?,"
        " (SELECT COALESCE(MAX(seq), 0) + 1 FROM workflow_steps WHERE workflow_run_id = ?),"
        " ?, ?)",
        (run_id, key, kind, title, group_key, at, run_id, item, group_title),
    )
