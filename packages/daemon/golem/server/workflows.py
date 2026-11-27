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
import statistics
from pathlib import Path
from typing import Any

from golem.server.dispatcher import INTERNAL_ERROR, INVALID_PARAMS, RequestContext, RpcCallError
from golem.server.routines import routine_update
from golem.store.workflow_runs import WorkflowRunRecord, WorkflowStepRecord
from golem.workflows.check import CheckEnv, Problem
from golem.workflows.create import CreateError, file_name
from golem.workflows.edit import EditError, remove_argument, set_argument
from golem.workflows.lines import result_line
from golem.workflows.model_view import step_model, workflow_model
from golem.workflows.outline import OutlineError, WorkflowOutline, outline
from golem.workflows.outputs import OutputError, read_marked_file
from golem.workflows.propose import ProposeError
from golem.workflows.registry import WorkflowEntry
from golem.workflows.service import (
    ResumeError,
    ReviewError,
    SaveError,
    StartError,
    WorkflowService,
)
from golem.workflows.starter import STARTERS, StarterError
from golem.workflows.starter import get as get_starter
from golem_protocol.commands import (
    RoutineUpdateParams,
    WorkflowAddStarterParams,
    WorkflowAddStarterResult,
    WorkflowCancelParams,
    WorkflowCancelResult,
    WorkflowCheckParams,
    WorkflowCheckResult,
    WorkflowCreateParams,
    WorkflowCreateResult,
    WorkflowDraftParams,
    WorkflowDraftResult,
    WorkflowEditStepParams,
    WorkflowEditStepResult,
    WorkflowEntryInfo,
    WorkflowGetParams,
    WorkflowGetResult,
    WorkflowInputInfo,
    WorkflowListParams,
    WorkflowListResult,
    WorkflowModelInfo,
    WorkflowOutlineStep,
    WorkflowProblem,
    WorkflowProposeParams,
    WorkflowProposeResult,
    WorkflowReadOutputParams,
    WorkflowReadOutputResult,
    WorkflowResumeParams,
    WorkflowResumeResult,
    WorkflowReviewAnswerParams,
    WorkflowReviewAnswerResult,
    WorkflowReviewInfo,
    WorkflowRunInfo,
    WorkflowSaveParams,
    WorkflowSaveResult,
    WorkflowStarterInfo,
    WorkflowStarterRoutine,
    WorkflowStartersParams,
    WorkflowStartersResult,
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
        title=None if spec is None else spec.title,
        model=None if spec is None else spec.model,
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


def _outline_all(
    text: str, name: str, env: CheckEnv | None
) -> tuple[list[WorkflowOutlineStep], str | None, WorkflowModelInfo | None]:
    """The steps, the reason they cannot be read, and the workflow's own model."""
    try:
        found: list[WorkflowOutline] = outline(text)
    except OutlineError as exc:
        return [], str(exc), None
    for one in found:
        if one.name != name:
            continue
        steps: list[WorkflowOutlineStep] = []
        for s in one.steps:
            made = WorkflowOutlineStep.model_validate(s.to_dict())
            seen = None if env is None else step_model(s, one.model, env)
            if seen is not None:
                made = made.model_copy(
                    update={
                        "model": seen.written,
                        "model_now": seen.now,
                        "model_ready": seen.ready,
                    }
                )
            steps.append(made)
        info = None
        if env is not None:
            base = workflow_model(one.model, env)
            info = WorkflowModelInfo(
                model=one.model, now=base.now, ready=base.ready, note=base.note
            )
        return steps, None, info
    return [], None, None


def _outline_steps(
    entry: WorkflowEntry, env: CheckEnv | None = None
) -> tuple[list[WorkflowOutlineStep], str | None, str | None, WorkflowModelInfo | None]:
    """The outline steps and the text of the entry's file, or the reason they cannot be read."""
    try:
        text = entry.path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        return [], str(exc), None, None
    steps, problem, info = _outline_all(text, entry.name, env)
    return steps, problem, text, info


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
    steps, problem, code, mine = await asyncio.to_thread(_outline_steps, entry, service.check_env)
    if problem is not None:
        info = info.model_copy(update={"error": f"the steps cannot be read: {problem}"})
    digest = await asyncio.to_thread(_hash_of, entry.path) if code is not None else None
    return WorkflowGetResult(
        workflow=info, steps=steps, code=code, code_hash=digest, workflow_model=mine
    )


def _problem(p: Problem) -> WorkflowProblem:
    return WorkflowProblem(
        severity=p.severity, line=p.line, step_id=p.step_id, message=p.message, fix=p.fix
    )


def _checked(
    service: WorkflowService, entry: WorkflowEntry, code: str
) -> tuple[list[WorkflowProblem], list[WorkflowOutlineStep], WorkflowModelInfo | None]:
    problems = [_problem(p) for p in service.check_code(code, entry)]
    steps, _, mine = _outline_all(code, entry.name, service.check_env)
    return problems, steps, mine


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
    problems, steps, mine = await asyncio.to_thread(_checked, service, entry, code)
    return WorkflowCheckResult(problems=problems, steps=steps, workflow_model=mine)


async def workflow_edit_step(
    ctx: RequestContext, params: WorkflowEditStepParams
) -> WorkflowEditStepResult:
    """Set one argument of one step in ``code`` and return the new text with its outline and
    problems. Nothing is written: the editor keeps the text as an unsaved edit."""
    service = _service(ctx)
    entry = _find(await service.refresh([]), params.id)
    try:
        if params.value is None:
            code = await asyncio.to_thread(
                remove_argument, params.code, params.step_id, params.name, entry.name
            )
        else:
            code = await asyncio.to_thread(
                set_argument, params.code, params.step_id, params.name, params.value, entry.name
            )
    except EditError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    problems, steps, mine = await asyncio.to_thread(_checked, service, entry, code)
    return WorkflowEditStepResult(code=code, steps=steps, problems=problems, workflow_model=mine)


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
    steps, _, mine = _outline_all(params.code, saved.name, service.check_env)
    digest = await asyncio.to_thread(_hash_of, entry.path)
    return WorkflowSaveResult(
        workflow=_info(saved),
        steps=steps,
        workflow_model=mine,
        problems=[_problem(p) for p in warnings],
        code_hash=digest or hashlib.sha256(params.code.encode("utf-8")).hexdigest(),
    )


async def workflow_create(
    ctx: RequestContext, params: WorkflowCreateParams
) -> WorkflowCreateResult:
    """Write a new workflow file (a proposal's code, or the skeleton), and reload the registry."""
    service = _service(ctx)
    folder = None if params.folder is None else _folders([params.folder])[0]
    try:
        entry, _ = await service.create(params.name, folder, params.code)
    except CreateError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    try:
        code = await asyncio.to_thread(entry.path.read_text, encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise RpcCallError(INTERNAL_ERROR, f"the new file cannot be read: {exc}") from exc
    problems, steps, mine = await asyncio.to_thread(_checked, service, entry, code)
    digest = await asyncio.to_thread(_hash_of, entry.path)
    return WorkflowCreateResult(
        workflow=_info(entry),
        steps=steps,
        workflow_model=mine,
        problems=problems,
        code_hash=digest or hashlib.sha256(code.encode("utf-8")).hexdigest(),
        code=code,
    )


async def workflow_draft(ctx: RequestContext, params: WorkflowDraftParams) -> WorkflowDraftResult:
    """Ask golem for a new workflow from a few sentences. One model call, checked, never saved."""
    service = _service(ctx)
    folder = None if params.folder is None else _folders([params.folder])[0]
    try:
        made = await service.draft_code(params.name, params.ask, folder, params.model)
    except ProposeError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    function = file_name(params.name).file
    steps, _, mine = _outline_all(made.code, function, service.check_env)
    return WorkflowDraftResult(
        code=made.code,
        note=made.note,
        steps=steps,
        workflow_model=mine,
        problems=[_problem(p) for p in made.problems],
        model=made.model,
    )


async def workflow_starters(
    ctx: RequestContext, params: WorkflowStartersParams
) -> WorkflowStartersResult:
    """The starter workflows golem ships."""
    del ctx, params
    return WorkflowStartersResult(
        starters=[
            WorkflowStarterInfo(
                id=s.id,
                title=s.title,
                line=s.line,
                needs_folder=s.needs_folder,
                routine=None
                if s.routine is None
                else WorkflowStarterRoutine(
                    name=s.routine.name, schedule=s.routine.schedule, words=s.routine.words
                ),
            )
            for s in STARTERS
        ]
    )


async def workflow_add_starter(
    ctx: RequestContext, params: WorkflowAddStarterParams
) -> WorkflowAddStarterResult:
    """Write a starter as a workflow file, and reload the registry."""
    service = _service(ctx)
    folder = None if params.folder is None else _folders([params.folder])[0]
    try:
        entry = await service.add_starter(params.id, folder)
    except StarterError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    routine: str | None = None
    problem: str | None = None
    if params.routine:
        made = get_starter(params.id)
        if made is None or made.routine is None:
            problem = f"{params.id} has no routine"
        else:
            try:
                await routine_update(
                    ctx,
                    RoutineUpdateParams(
                        name=made.routine.name,
                        create=True,
                        fields={
                            "name": made.routine.name,
                            "schedule": made.routine.schedule,
                            "workflow": entry.name,
                        },
                    ),
                )
                routine = made.routine.name
            except RpcCallError as exc:
                problem = f"the routine {made.routine.name} was not added: {exc}"
    return WorkflowAddStarterResult(
        id=entry.id,
        name=entry.name,
        path=str(entry.path),
        routine=routine,
        routine_problem=problem,
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
    steps, _, mine = _outline_all(made.code, entry.name, service.check_env)
    return WorkflowProposeResult(
        code=made.code,
        # An older client reads the answer as a note on a file that did not change.
        note=made.answer or made.note,
        steps=steps,
        workflow_model=mine,
        problems=[_problem(p) for p in made.problems],
        model=made.model,
        kind=made.kind,
        answer=made.answer if made.kind == "answer" else None,
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
    if params.from_run is not None and params.from_key is not None:
        try:
            again, _ = await service.start_again(params.from_run, params.from_key)
        except StartError as exc:
            raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
        return WorkflowStartResult(workflow_run_id=again)
    assert params.id is not None  # the params check says id or from_run
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
    run_id, _ = await service.start_run(entry, inputs, params.trigger, params.model)
    return WorkflowStartResult(workflow_run_id=run_id)


async def _origin(service: WorkflowService, run: WorkflowRunRecord) -> dict[str, Any] | None:
    """Where a run started again from a step came from, or None."""
    if run.from_run_id is None or run.from_key is None:
        return None
    old = await service.runs.get_run(run.from_run_id)
    steps = await service.runs.list_steps(run.from_run_id)
    place = next((n for n, s in enumerate(steps, 1) if s.step_key == run.from_key), None)
    if old is None or place is None:
        return None
    step = steps[place - 1]
    return {
        "workflow_run_id": old.workflow_run_id,
        "started_at": old.started_at,
        "step_key": step.step_key,
        "step_title": step.title or step.step_key,
        "step_number": place,
    }


async def _run_info(service: WorkflowService, run: WorkflowRunRecord) -> WorkflowRunInfo:
    entry = next((e for e in service.registry.entries() if e.id == run.workflow_id), None)
    spec = None if entry is None else entry.spec
    outputs = await service.runs.list_outputs(run.workflow_run_id)
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
            "title": None if spec is None else spec.title,
            "description": "" if spec is None else spec.description,
            "result": json.loads(run.result_json) if run.result_json else None,
            "outputs": [
                {"title": o.title, "value": json.loads(o.value_json), "summary": o.summary}
                for o in outputs
            ],
            "summary": outputs[0].summary if outputs else None,
            "steps_expected": await service.engine.expected(run.workflow_run_id),
            "usual_ms": await _usual_ms(service, run),
            "from_run": await _origin(service, run),
        }
    )


USUAL_RUNS = 5
"""A run's usual time is the median of this many of the last done runs of its workflow."""


def median_ms(spans: list[int]) -> int | None:
    """The median of the times, or None when there are fewer than two."""
    if len(spans) < 2:
        return None
    return int(statistics.median(spans))


async def _usual_ms(service: WorkflowService, run: WorkflowRunRecord) -> int | None:
    """How long a run of this workflow usually takes, from its last done runs."""
    return median_ms(await service.runs.recent_durations_ms(run.workflow_id, USUAL_RUNS))


def _step_info(
    step: WorkflowStepRecord, of: int | None = None, progress: str | None = None
) -> WorkflowStepInfo:
    saved = json.loads(step.result_json) if step.result_json else None
    return WorkflowStepInfo.model_validate(
        {
            "key": step.step_key,
            "kind": step.kind,
            "title": step.title or step.step_key,
            "status": step.status,
            "group": step.group_key,
            "group_title": step.group_title,
            "item": step.item,
            "reused_from": step.reused_from,
            "attempts": step.attempts,
            "error": step.error,
            "child_session_id": step.child_session_id,
            "model": step.model,
            "cost_usd": step.cost_usd,
            "started_at": step.started_at,
            "finished_at": step.finished_at,
            "result": saved,
            "line": result_line(saved, step.kind),
            "of": of,
            "progress": progress,
        }
    )


async def workflow_status(
    ctx: RequestContext, params: WorkflowStatusParams
) -> WorkflowStatusResult:
    service = _service(ctx)
    runs = service.runs
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
        run=await _run_info(service, run),
        steps=[
            _step_info(
                s,
                service.engine.total_of(run.workflow_run_id, s.title or s.step_key),
                service.engine.progress_of(run.workflow_run_id, s.step_key),
            )
            for s in steps
        ],
        reviews=reviews,
    )


async def workflow_read_output(
    ctx: RequestContext, params: WorkflowReadOutputParams
) -> WorkflowReadOutputResult:
    """The text of an output of a run that is a file path the run marked."""
    runs = _service(ctx).runs
    if await runs.get_run(params.workflow_run_id) is None:
        raise RpcCallError(INVALID_PARAMS, f"no workflow run {params.workflow_run_id}")
    outputs = await runs.list_outputs(params.workflow_run_id)
    if params.index >= len(outputs):
        raise RpcCallError(INVALID_PARAMS, f"the run has no output {params.index}")
    try:
        path, text, truncated, size = await asyncio.to_thread(
            read_marked_file, json.loads(outputs[params.index].value_json), Path.home()
        )
    except OutputError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    return WorkflowReadOutputResult(path=path, text=text, truncated=truncated, size=size)


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
        run = await service.resume(params.workflow_run_id, params.model)
    except ResumeError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    return WorkflowResumeResult(run=await _run_info(service, run))


async def workflow_review_answer(
    ctx: RequestContext, params: WorkflowReviewAnswerParams
) -> WorkflowReviewAnswerResult:
    service = _service(ctx)
    try:
        run = await service.answer_review(
            params.workflow_run_id, params.key, params.verdict, params.text
        )
    except ReviewError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    return WorkflowReviewAnswerResult(run=await _run_info(service, run))


__all__ = [
    "workflow_cancel",
    "workflow_check",
    "workflow_get",
    "workflow_list",
    "workflow_propose",
    "workflow_read_output",
    "workflow_resume",
    "workflow_review_answer",
    "workflow_save",
    "workflow_start",
    "workflow_status",
]
