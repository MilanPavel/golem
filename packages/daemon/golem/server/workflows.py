"""Handlers for ``workflow.list|get|start|status|cancel|resume|review.answer`` (ADR-062).

``workflow.start`` writes the run row, starts the engine as a background task of the
:class:`~golem.workflows.service.WorkflowService` and returns the id at once; the steps reach
clients as ``workflow.run.*`` and ``workflow.step.*`` notifications. A run's headless session
is not made yet (``session_id`` stays null until agent steps need it).
"""

from __future__ import annotations

import asyncio
import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from golem.server.dispatcher import INTERNAL_ERROR, INVALID_PARAMS, RequestContext, RpcCallError
from golem.store.workflow_runs import WorkflowRunRecord, WorkflowStepRecord
from golem.workflows.outline import OutlineError, WorkflowOutline, outline
from golem.workflows.registry import WorkflowEntry
from golem.workflows.service import ResumeError, ReviewError, WorkflowService
from golem_protocol.commands import (
    WorkflowCancelParams,
    WorkflowCancelResult,
    WorkflowEntryInfo,
    WorkflowGetParams,
    WorkflowGetResult,
    WorkflowInputInfo,
    WorkflowListParams,
    WorkflowListResult,
    WorkflowOutlineStep,
    WorkflowResumeParams,
    WorkflowResumeResult,
    WorkflowReviewAnswerParams,
    WorkflowReviewAnswerResult,
    WorkflowReviewInfo,
    WorkflowRunInfo,
    WorkflowStartParams,
    WorkflowStartResult,
    WorkflowStatusParams,
    WorkflowStatusResult,
    WorkflowStepInfo,
    WorkflowTriggerInfo,
)


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _service(ctx: RequestContext) -> WorkflowService:
    service = ctx.state.workflows
    if service is None:
        raise RpcCallError(INTERNAL_ERROR, "workflows are not available")
    return service


def _folders(folders: list[str]) -> list[Path]:
    found: list[Path] = []
    for text in folders:
        folder = Path(text)
        if not folder.is_absolute():
            raise RpcCallError(INVALID_PARAMS, f"{text} is not an absolute path")
        found.append(folder.resolve())
    return found


def _trigger(entry: WorkflowEntry) -> WorkflowTriggerInfo | None:
    spec = entry.spec
    if spec is None or spec.trigger is None:
        return None
    t = spec.trigger
    return WorkflowTriggerInfo(
        kind=t.kind,
        expr=getattr(t, "expr", None),
        path=getattr(t, "path", None),
    )


def _info(entry: WorkflowEntry) -> WorkflowEntryInfo:
    spec = entry.spec
    return WorkflowEntryInfo(
        id=entry.id,
        name=entry.name,
        path=str(entry.path),
        project=None if entry.project is None else str(entry.project),
        state=entry.state,
        error=entry.error,
        trigger=_trigger(entry),
        inputs=[] if spec is None else [WorkflowInputInfo(name=n, type=t) for n, t in spec.inputs],
        description="" if spec is None else spec.description,
    )


def _find(entries: list[WorkflowEntry], ident: str) -> WorkflowEntry:
    for entry in entries:
        if entry.id == ident:
            return entry
    raise RpcCallError(INVALID_PARAMS, f"no workflow {ident}")


async def workflow_list(ctx: RequestContext, params: WorkflowListParams) -> WorkflowListResult:
    service = _service(ctx)
    folders = _folders(params.folders)
    entries = await service.refresh(folders)
    shown = [e for e in entries if e.project is None or e.project in folders]
    return WorkflowListResult(workflows=[_info(e) for e in shown])


def _outline_steps(
    entry: WorkflowEntry,
) -> tuple[list[WorkflowOutlineStep], str | None, str | None]:
    """The outline steps and the text of the entry's file, or the reason they cannot be read."""
    try:
        text = entry.path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        return [], str(exc), None
    try:
        found: list[WorkflowOutline] = outline(text)
    except OutlineError as exc:
        return [], str(exc), text
    for one in found:
        if one.name == entry.name:
            return [WorkflowOutlineStep.model_validate(s.to_dict()) for s in one.steps], None, text
    return [], None, text


async def workflow_get(ctx: RequestContext, params: WorkflowGetParams) -> WorkflowGetResult:
    service = _service(ctx)
    entry = _find(await service.refresh([]), params.id)
    info = _info(entry)
    if entry.state != "ok":
        return WorkflowGetResult(workflow=info)
    steps, problem, code = await asyncio.to_thread(_outline_steps, entry)
    if problem is not None:
        info = info.model_copy(update={"error": f"the steps cannot be read: {problem}"})
    return WorkflowGetResult(workflow=info, steps=steps, code=code)


def _coerce(entry: WorkflowEntry, inputs: dict[str, Any]) -> dict[str, Any]:
    """Turn text values (from a command line) into the type the input declares."""
    spec = entry.spec
    types = {} if spec is None else dict(spec.inputs)
    out: dict[str, Any] = {}
    for key, value in inputs.items():
        if key not in types:
            raise RpcCallError(INVALID_PARAMS, f"{entry.name} has no input {key!r}")
        kind = types[key]
        try:
            if isinstance(value, str) and kind == "int":
                value = int(value)
            elif isinstance(value, str) and kind == "float":
                value = float(value)
            elif isinstance(value, str) and kind == "bool":
                if value.lower() not in ("true", "false"):
                    raise ValueError(value)
                value = value.lower() == "true"
        except ValueError as exc:
            raise RpcCallError(INVALID_PARAMS, f"input {key!r} is not a {kind}: {value}") from exc
        out[key] = value
    return out


async def workflow_start(ctx: RequestContext, params: WorkflowStartParams) -> WorkflowStartResult:
    service = _service(ctx)
    entry = _find(await service.refresh([]), params.id)
    if entry.state == "untrusted":
        raise RpcCallError(
            INVALID_PARAMS,
            f"{entry.name} is in a folder that is not trusted; add it to trusted_projects first",
        )
    if entry.state != "ok":
        last = (entry.error or "it cannot be loaded").strip().splitlines()[-1:]
        raise RpcCallError(INVALID_PARAMS, f"{entry.name} is broken: {''.join(last)}")
    inputs = _coerce(entry, params.inputs)
    digest = hashlib.sha256(entry.path.read_bytes()).hexdigest()
    run_id = await service.runs.create_run(
        entry.id,
        entry.name,
        str(entry.path),
        _now(),
        project=None if entry.project is None else str(entry.project),
        inputs_json=json.dumps(inputs),
        trigger=params.trigger,
        source_hash=digest,
    )
    service.launch(run_id)
    return WorkflowStartResult(workflow_run_id=run_id)


def _run_info(run: WorkflowRunRecord) -> WorkflowRunInfo:
    return WorkflowRunInfo.model_validate(
        {
            "workflow_run_id": run.workflow_run_id,
            "workflow_id": run.workflow_id,
            "name": run.name,
            "status": run.status,
            "trigger": run.trigger,
            "inputs": json.loads(run.inputs_json or "{}"),
            "session_id": run.session_id,
            "started_at": run.started_at,
            "finished_at": run.finished_at,
            "error": run.error,
        }
    )


def _step_info(step: WorkflowStepRecord) -> WorkflowStepInfo:
    return WorkflowStepInfo.model_validate(
        {
            "key": step.step_key,
            "kind": step.kind,
            "title": step.title or step.step_key,
            "status": step.status,
            "group": step.group_key,
            "attempts": step.attempts,
            "error": step.error,
            "child_session_id": step.child_session_id,
            "model": step.model,
            "cost_usd": step.cost_usd,
            "started_at": step.started_at,
            "finished_at": step.finished_at,
        }
    )


async def workflow_status(
    ctx: RequestContext, params: WorkflowStatusParams
) -> WorkflowStatusResult:
    runs = _service(ctx).runs
    run = await runs.get_run(params.workflow_run_id)
    if run is None:
        raise RpcCallError(INVALID_PARAMS, f"no workflow run {params.workflow_run_id}")
    steps = await runs.list_steps(params.workflow_run_id)
    reviews = [
        WorkflowReviewInfo(
            key=r.step_key,
            ask=json.loads(r.pending_json).get("ask") or "",
            draft=json.loads(r.pending_json).get("draft"),
            created_at=r.created_at,
        )
        for r in await runs.list_open_reviews(params.workflow_run_id)
    ]
    return WorkflowStatusResult(
        run=_run_info(run), steps=[_step_info(s) for s in steps], reviews=reviews
    )


async def workflow_cancel(
    ctx: RequestContext, params: WorkflowCancelParams
) -> WorkflowCancelResult:
    service = _service(ctx)
    if await service.runs.get_run(params.workflow_run_id) is None:
        raise RpcCallError(INVALID_PARAMS, f"no workflow run {params.workflow_run_id}")
    return WorkflowCancelResult(cancelled=await service.cancel(params.workflow_run_id))


async def workflow_resume(
    ctx: RequestContext, params: WorkflowResumeParams
) -> WorkflowResumeResult:
    service = _service(ctx)
    try:
        run = await service.resume(params.workflow_run_id)
    except ResumeError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    return WorkflowResumeResult(run=_run_info(run))


async def workflow_review_answer(
    ctx: RequestContext, params: WorkflowReviewAnswerParams
) -> WorkflowReviewAnswerResult:
    try:
        run = await _service(ctx).answer_review(
            params.workflow_run_id, params.key, params.verdict, params.text
        )
    except ReviewError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    return WorkflowReviewAnswerResult(run=_run_info(run))


__all__ = [
    "workflow_cancel",
    "workflow_get",
    "workflow_list",
    "workflow_resume",
    "workflow_review_answer",
    "workflow_start",
    "workflow_status",
]
