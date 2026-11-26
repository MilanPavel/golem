"""Handlers for ``workflow.list|get|check|save|start|status|cancel|resume|review.answer`` (ADR-062).

``workflow.start`` writes the run row, starts the engine as a background task of the
:class:`~golem.workflows.service.WorkflowService` and returns the id at once; the steps reach
clients as ``workflow.run.*`` and ``workflow.step.*`` notifications. A run's headless session
is not made yet (``session_id`` stays null until agent steps need it).
"""

from __future__ import annotations

import asyncio
import hashlib
import json
from pathlib import Path
from typing import Any

from golem.server.dispatcher import INTERNAL_ERROR, INVALID_PARAMS, RequestContext, RpcCallError
from golem.store.workflow_runs import WorkflowRunRecord, WorkflowStepRecord
from golem.workflows.check import Problem
from golem.workflows.edit import EditError, set_argument
from golem.workflows.outline import OutlineError, WorkflowOutline, outline
from golem.workflows.propose import ProposeError
from golem.workflows.registry import WorkflowEntry
from golem.workflows.service import ResumeError, ReviewError, SaveError, WorkflowService
from golem_protocol.commands import (
    WorkflowCancelParams,
    WorkflowCancelResult,
    WorkflowCheckParams,
    WorkflowCheckResult,
    WorkflowEditStepParams,
    WorkflowEditStepResult,
    WorkflowEntryInfo,
    WorkflowGetParams,
    WorkflowGetResult,
    WorkflowInputInfo,
    WorkflowListParams,
    WorkflowListResult,
    WorkflowOutlineStep,
    WorkflowProblem,
    WorkflowProposeParams,
    WorkflowProposeResult,
    WorkflowResumeParams,
    WorkflowResumeResult,
    WorkflowReviewAnswerParams,
    WorkflowReviewAnswerResult,
    WorkflowReviewInfo,
    WorkflowRunInfo,
    WorkflowSaveParams,
    WorkflowSaveResult,
    WorkflowStartParams,
    WorkflowStartResult,
    WorkflowStatusParams,
    WorkflowStatusResult,
    WorkflowStepInfo,
    WorkflowTriggerInfo,
)


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


def _outline_of(text: str, name: str) -> tuple[list[WorkflowOutlineStep], str | None]:
    """The outline steps of the workflow ``name`` in ``text``, or why they cannot be read."""
    try:
        found: list[WorkflowOutline] = outline(text)
    except OutlineError as exc:
        return [], str(exc)
    for one in found:
        if one.name == name:
            return [WorkflowOutlineStep.model_validate(s.to_dict()) for s in one.steps], None
    return [], None


def _outline_steps(
    entry: WorkflowEntry,
) -> tuple[list[WorkflowOutlineStep], str | None, str | None]:
    """The outline steps and the text of the entry's file, or the reason they cannot be read."""
    try:
        text = entry.path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        return [], str(exc), None
    steps, problem = _outline_of(text, entry.name)
    return steps, problem, text


def _hash_of(path: Path) -> str | None:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except OSError:
        return None


async def workflow_get(ctx: RequestContext, params: WorkflowGetParams) -> WorkflowGetResult:
    service = _service(ctx)
    entry = _find(await service.refresh([]), params.id)
    info = _info(entry)
    if entry.state != "ok":
        return WorkflowGetResult(workflow=info)
    steps, problem, code = await asyncio.to_thread(_outline_steps, entry)
    if problem is not None:
        info = info.model_copy(update={"error": f"the steps cannot be read: {problem}"})
    digest = await asyncio.to_thread(_hash_of, entry.path) if code is not None else None
    return WorkflowGetResult(workflow=info, steps=steps, code=code, code_hash=digest)


def _problem(p: Problem) -> WorkflowProblem:
    return WorkflowProblem(
        severity=p.severity, line=p.line, step_id=p.step_id, message=p.message, fix=p.fix
    )


def _checked(
    service: WorkflowService, entry: WorkflowEntry, code: str
) -> tuple[list[WorkflowProblem], list[WorkflowOutlineStep]]:
    problems = [_problem(p) for p in service.check_code(code, entry)]
    steps, _ = _outline_of(code, entry.name)
    return problems, steps


async def workflow_check(ctx: RequestContext, params: WorkflowCheckParams) -> WorkflowCheckResult:
    """Check the given ``code``, or the saved file. A broken or untrusted file is read as text
    and never imported, so it can be checked too."""
    service = _service(ctx)
    entry = _find(await service.refresh([]), params.id)
    code = params.code
    if code is None:
        try:
            code = await asyncio.to_thread(entry.path.read_text, encoding="utf-8")
        except (OSError, UnicodeDecodeError) as exc:
            raise RpcCallError(INVALID_PARAMS, f"the file cannot be read: {exc}") from exc
    problems, steps = await asyncio.to_thread(_checked, service, entry, code)
    return WorkflowCheckResult(problems=problems, steps=steps)


async def workflow_edit_step(
    ctx: RequestContext, params: WorkflowEditStepParams
) -> WorkflowEditStepResult:
    """Set one argument of one step in ``code`` and return the new text with its outline and
    problems. Nothing is written: the editor keeps the text as an unsaved edit."""
    service = _service(ctx)
    entry = _find(await service.refresh([]), params.id)
    try:
        code = await asyncio.to_thread(
            set_argument, params.code, params.step_id, params.name, params.value, entry.name
        )
    except EditError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    problems, steps = await asyncio.to_thread(_checked, service, entry, code)
    return WorkflowEditStepResult(code=code, steps=steps, problems=problems)


async def workflow_save(ctx: RequestContext, params: WorkflowSaveParams) -> WorkflowSaveResult:
    service = _service(ctx)
    entry = _find(await service.refresh([]), params.id)
    try:
        warnings = await asyncio.to_thread(service.save_code, entry, params.code, params.base_hash)
    except SaveError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    reloaded = [e for e in service.registry.entries() if e.path == entry.path]
    saved = next((e for e in reloaded if e.name == entry.name), None) or (
        reloaded[0] if reloaded else entry
    )
    steps, _ = _outline_of(params.code, saved.name)
    digest = await asyncio.to_thread(_hash_of, entry.path)
    return WorkflowSaveResult(
        workflow=_info(saved),
        steps=steps,
        problems=[_problem(p) for p in warnings],
        code_hash=digest or hashlib.sha256(params.code.encode("utf-8")).hexdigest(),
    )


async def workflow_propose(
    ctx: RequestContext, params: WorkflowProposeParams
) -> WorkflowProposeResult:
    """Ask golem for a change to the given ``code``. One model call, checked, never saved."""
    service = _service(ctx)
    entry = _find(await service.refresh([]), params.id)
    previous = (
        None if params.previous_code is None else (params.previous_code, params.previous_note or "")
    )
    try:
        made = await service.propose_code(entry, params.code, params.ask, previous)
    except ProposeError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    steps, _ = _outline_of(made.code, entry.name)
    return WorkflowProposeResult(
        code=made.code,
        note=made.note,
        steps=steps,
        problems=[_problem(p) for p in made.problems],
        model=made.model,
    )


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
    run_id, _ = await service.start_run(entry, inputs, params.trigger)
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
            "result": json.loads(step.result_json) if step.result_json else None,
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
    "workflow_check",
    "workflow_get",
    "workflow_list",
    "workflow_propose",
    "workflow_resume",
    "workflow_review_answer",
    "workflow_save",
    "workflow_start",
    "workflow_status",
]
