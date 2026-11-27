"""Handlers for ``routine.list|get|update|preview|remove`` and ``routine.run``.

A routine is a ``[[routine]]`` in the user's ``config.toml`` or in a trusted
project's ``.golem/config.toml`` (ADR-050). The browser may read every routine
and edit the user's, with the daemon refusing to edit a project's: a project's
file is committed with the project, and is edited there. ``routine.run``
fires one now through the scheduler (:mod:`golem.routine_scheduler`). ``last`` and
the runs of ``routine.get`` come from ``routine_runs``. Pause is not built, so
``paused`` is false.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Any, cast

from pydantic import ValidationError

from golem.config import RoutineSettings
from golem.config_edit import (
    RoutineExistsError,
    RoutineTableError,
    add_routine,
    remove_routine,
    replace_routine,
    set_routine_enabled,
)
from golem.routine_files import (
    RoutineProblem,
    project_config,
    read_project_routines,
    read_routines,
)
from golem.routine_scheduler import (
    RoutineBlockedError,
    RoutineBusyError,
    RoutineNotFoundError,
    routine_problem,
)
from golem.routines import ScheduleError, next_after, parse_schedule
from golem.server.dispatcher import INTERNAL_ERROR, INVALID_PARAMS, RequestContext, RpcCallError
from golem.store.routine_runs import HeadlessRun, RoutineRunRecord
from golem.store.workflow_runs import WorkflowRuns
from golem.workflows.service import review_item
from golem_protocol.commands import (
    PendingItem,
    RoutineChanged,
    RoutineConfig,
    RoutineGetParams,
    RoutineGetResult,
    RoutineInfo,
    RoutineIssue,
    RoutineListParams,
    RoutineListResult,
    RoutinePreviewParams,
    RoutinePreviewResult,
    RoutineRemoveParams,
    RoutineRemoveResult,
    RoutineRunParams,
    RoutineRunResult,
    RoutineRunSummary,
    RoutineSource,
    RoutineUpdateParams,
    RoutineUpdateResult,
    RunInfo,
    RunListParams,
    RunListResult,
)
from golem_protocol.rpc import RoutineChangedNotification

log = logging.getLogger("golem.server")

PREVIEW_COUNT = 3

PROJECT_EDIT = "a project routine is edited in the project's .golem/config.toml, not from here"


async def routine_list(ctx: RequestContext, params: RoutineListParams) -> RoutineListResult:
    now = ctx.state.clock()
    folders = _folders(params.folders)
    routines, issues = await asyncio.to_thread(_collect, ctx, folders, now)
    issues = [*issues, *_watch_problems(ctx, folders), *_workflow_problems(ctx, routines)]
    shown: list[RoutineInfo] = []
    for info in routines:
        rows = await _rows(ctx, info, 1)
        shown.append(info.model_copy(update={"last": _summary(rows[0]) if rows else None}))
    return RoutineListResult(routines=shown, issues=[_issue(p) for p in issues])


async def routine_run(ctx: RequestContext, params: RoutineRunParams) -> RoutineRunResult:
    scheduler = ctx.state.routines
    if scheduler is None:
        raise RpcCallError(INTERNAL_ERROR, "the routine scheduler is not ready")
    folder = None if params.folder is None else _folders([params.folder])[0]
    try:
        run_id, session_id = await scheduler.run(params.name, folder)
    except RoutineNotFoundError as exc:
        where = "the user's config.toml" if folder is None else str(folder)
        raise RpcCallError(
            INVALID_PARAMS, f"there is no routine called {params.name} in {where}"
        ) from exc
    except RoutineBlockedError as exc:
        raise RpcCallError(INVALID_PARAMS, f"{exc}: trust the folder first") from exc
    except RoutineBusyError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    except Exception as exc:
        raise RpcCallError(INTERNAL_ERROR, f"{params.name} could not start: {exc}") from exc
    return RoutineRunResult(routine_run_id=run_id, session_id=session_id)


async def routine_get(ctx: RequestContext, params: RoutineGetParams) -> RoutineGetResult:
    now = ctx.state.clock()
    folders = [] if params.folder is None else _folders([params.folder])
    routines, _ = await asyncio.to_thread(_collect, ctx, folders, now)
    wanted = None if params.folder is None else str(folders[0])
    for info in routines:
        if info.config.name == params.name and info.folder == wanted:
            rows = await _rows(ctx, info, 50)
            shown = info.model_copy(update={"last": _summary(rows[0]) if rows else None})
            return RoutineGetResult(routine=shown, runs=[_summary(row) for row in rows])
    where = "the user's config.toml" if wanted is None else wanted
    raise RpcCallError(INVALID_PARAMS, f"there is no routine called {params.name} in {where}")


async def routine_update(ctx: RequestContext, params: RoutineUpdateParams) -> RoutineUpdateResult:
    if params.folder is not None:
        raise RpcCallError(INVALID_PARAMS, PROJECT_EDIT)
    path = ctx.state.paths.config_file
    found = await asyncio.to_thread(read_routines, path)
    existing = next((r for r in found.routines if r.name == params.name), None)
    if params.create:
        merged = dict(params.fields)
        if merged.setdefault("name", params.name) != params.name:
            raise RpcCallError(INVALID_PARAMS, "fields.name must be the routine's name")
    elif existing is None:
        raise RpcCallError(INVALID_PARAMS, f"there is no routine called {params.name}")
    else:
        merged = existing.model_dump(mode="json", exclude_unset=True)
        for key, value in params.fields.items():
            if value is None:
                merged.pop(key, None)
            else:
                merged[key] = value
    checked = _check(merged)
    await _refuse_workflow(ctx, checked)
    toggle = not params.create and set(params.fields) == {"enabled"} and "enabled" in merged
    try:
        if params.create:
            await asyncio.to_thread(add_routine, path, merged)
        elif toggle and isinstance(params.fields["enabled"], bool):
            await asyncio.to_thread(set_routine_enabled, path, params.name, checked.enabled)
        else:
            await asyncio.to_thread(replace_routine, path, params.name, merged)
    except (RoutineExistsError, RoutineTableError) as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    except (OSError, ValueError) as exc:
        raise RpcCallError(INTERNAL_ERROR, f"could not write {path}: {exc}") from exc
    ctx.state.broadcast(
        RoutineChangedNotification(
            params=RoutineChanged(name=checked.name, change="added" if params.create else "updated")
        )
    )
    if ctx.state.routines is not None:
        ctx.state.routines.reload()
    if ctx.state.watcher is not None:
        ctx.state.watcher.reload()
    log.info("wrote routine %s to %s", checked.name, path)
    now = ctx.state.clock()
    return RoutineUpdateResult(routine=_info(ctx, checked, "user", None, path, False, now))


async def routine_preview(
    ctx: RequestContext, params: RoutinePreviewParams
) -> RoutinePreviewResult:
    """The next three firings of a schedule, so the editor shows them before it saves."""
    found: list[str] = []
    try:
        if params.schedule is not None:
            schedule = parse_schedule(params.schedule)
            at = ctx.state.clock()
            for _ in range(PREVIEW_COUNT):
                at = next_after(schedule, at)
                found.append(at.isoformat())
    except ScheduleError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    problems: list[str] = []
    if params.workflow is not None:
        service = ctx.state.workflows
        if service is not None:
            await service.refresh([])
            folder = None if params.folder is None else _folders([params.folder])[0]
            given: dict[str, Any] = dict(params.inputs)
            if params.on_watch:
                given.setdefault("path", "")
            why = service.problem(params.workflow, folder, given)
            problems = [] if why is None else [why]
    return RoutinePreviewResult(next=found, problems=problems)


async def routine_remove(ctx: RequestContext, params: RoutineRemoveParams) -> RoutineRemoveResult:
    if params.folder is not None:
        raise RpcCallError(INVALID_PARAMS, PROJECT_EDIT)
    path = ctx.state.paths.config_file
    try:
        await asyncio.to_thread(remove_routine, path, params.name)
    except RoutineTableError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    except (OSError, ValueError) as exc:
        raise RpcCallError(INTERNAL_ERROR, f"could not write {path}: {exc}") from exc
    ctx.state.broadcast(
        RoutineChangedNotification(params=RoutineChanged(name=params.name, change="removed"))
    )
    if ctx.state.routines is not None:
        ctx.state.routines.reload()
    if ctx.state.watcher is not None:
        ctx.state.watcher.reload()
    return RoutineRemoveResult(name=params.name)


async def run_list(ctx: RequestContext, params: RunListParams) -> RunListResult:
    """The headless sessions as Runs rows: a routine's firing joins its session's state."""
    runs = ctx.state.routine_runs
    sessions = ctx.state.sessions
    if runs is None or sessions is None:
        return RunListResult(runs=[])
    shown: list[RunInfo] = []
    found = await runs.headless(params.limit, params.session_id)
    bare = [] if params.session_id is not None else await runs.sessionless(params.limit)
    found = [*found, *bare]
    for row in found:
        waiting = row.status == "waiting" and row.session_id is not None
        pending = await sessions.pending_of(row.session_id) if waiting and row.session_id else None
        info = run_info(row, pending)
        if (
            info.kind == "workflow" or row.origin.startswith("workflow:")
        ) and ctx.state.workflows is not None:
            info = await _workflow_row(ctx.state.workflows.runs, row, info)
        shown.append(info)
    if bare:
        # Runs with no session come from another table, so the two lists are merged by start.
        shown.sort(key=lambda info: info.started_at or "", reverse=True)
    return RunListResult(runs=shown[: params.limit])


_WORKFLOW_STATUS = {"pending": "queued", "done": "succeeded"}


async def _workflow_row(runs: WorkflowRuns, row: HeadlessRun, info: RunInfo) -> RunInfo:
    """A workflow run's row: its status, times and error come from its ``workflow_runs`` row."""
    run = (
        await runs.get_run(row.workflow_run_id)
        if row.workflow_run_id is not None
        else await runs.by_session(row.session_id or "")
    )
    if run is None:
        return info
    steps = await runs.list_steps(run.workflow_run_id)
    asked = await runs.list_open_reviews(run.workflow_run_id) if run.status == "waiting" else []
    summary = run.error if run.status == "failed" else None
    if asked:
        summary = review_item(run.workflow_run_id, asked[0]).ask
    elif run.status == "done":
        summary = await _came_out(runs, run.workflow_run_id, run.result_json)
    return info.model_copy(
        update={
            "status": _WORKFLOW_STATUS.get(run.status, run.status),
            "started_at": run.started_at or run.created_at,
            "ended_at": run.finished_at,
            "summary": summary,
            "reason": run.error if run.status == "failed" else None,
            "steps": len(steps),
            "approvals": len(asked),
            "workflow_run_id": run.workflow_run_id,
            "workflow_id": run.workflow_id,
        }
    )


_LINE = 120


def _one_line(text: str) -> str:
    line = next((part.strip() for part in text.splitlines() if part.strip()), "")
    return line if len(line) <= _LINE else line[: _LINE - 1].rstrip() + "\u2026"


def _value_line(value: Any) -> str | None:
    """One line for a saved value, or None when it is empty."""
    if value is None:
        return None
    if isinstance(value, str):
        return _one_line(value) or None
    if isinstance(value, list):
        rows = cast("list[object]", value)
        if not rows:
            return None
        if all(isinstance(item, dict) for item in rows):
            return f"{len(rows)} {'row' if len(rows) == 1 else 'rows'}"
    elif isinstance(value, dict):
        record = cast("dict[str, object]", value)
        if not record:
            return None
        summary = record.get("summary")
        if isinstance(summary, str) and summary.strip():
            return _one_line(summary)
        return f"{len(record)} {'field' if len(record) == 1 else 'fields'}"
    return _one_line(json.dumps(value))


def _decode(text: str | None) -> Any:
    try:
        return None if text is None else json.loads(text)
    except ValueError:
        return None


async def _came_out(runs: WorkflowRuns, run_id: str, result_json: str | None) -> str:
    """What a finished run came out with, in one line: its first result, else its return value."""
    for output in await runs.list_outputs(run_id):
        line = _one_line(output.summary or "") or _value_line(_decode(output.value_json))
        if line:
            return line
    return _value_line(_decode(result_json)) or "Nothing found"


def _question(pending: PendingItem) -> str:
    """One line for what a waiting session asks: ``Allow <tool>``, with the subject."""
    if pending.kind == "consent":
        return "Asks to use a paid model"
    name = pending.name or "a tool"
    subject = " ".join((pending.subject or "").split())
    return f"Allow {name}: {subject}" if subject else f"Allow {name}"


def run_info(row: HeadlessRun, pending: PendingItem | None) -> RunInfo:
    waiting = row.status == "waiting"
    summary = row.summary
    if waiting and pending is not None:
        summary = _question(pending)
    elif waiting:
        summary = None
    folder = None if row.scope in (None, "user") else row.scope
    return RunInfo.model_validate(
        {
            "session_id": row.session_id,
            "kind": "routine"
            if row.routine_run_id is not None
            else "workflow"
            if row.origin.startswith("workflow:")
            else "ask",
            "origin": row.origin,
            "routine": row.routine,
            "folder": folder,
            "routine_run_id": row.routine_run_id,
            "trigger": row.trigger,
            "status": row.status,
            "started_at": row.started_at,
            "ended_at": row.ended_at,
            "summary": summary,
            "reason": row.reason,
            "approvals": 1 if waiting and pending is not None else 0,
            "watch_path": row.watch_path,
        }
    )


async def _rows(ctx: RequestContext, info: RoutineInfo, limit: int) -> list[RoutineRunRecord]:
    runs = ctx.state.routine_runs
    if runs is None:
        return []
    scope = "user" if info.folder is None else info.folder
    return await runs.recent(info.config.name, scope, limit)


def _summary(row: RoutineRunRecord) -> RoutineRunSummary:
    return RoutineRunSummary.model_validate(
        {
            "routine_run_id": row.routine_run_id,
            "routine": row.routine,
            "scope": row.scope,
            "session_id": row.session_id,
            "trigger": row.trigger,
            "due_at": row.due_at,
            "started_at": row.started_at,
            "ended_at": row.ended_at,
            "status": row.status,
            "reason": row.reason,
            "summary": row.summary,
            "watch_path": row.watch_path,
        }
    )


async def _refuse_workflow(ctx: RequestContext, routine: RoutineSettings) -> None:
    """Refuse a routine whose workflow is not there, or whose inputs it does not take."""
    service = ctx.state.workflows
    if routine.workflow is None or service is None:
        return
    await service.refresh([])
    why = routine_problem(routine, None, service)
    if why is not None:
        raise RpcCallError(INVALID_PARAMS, why)


def _workflow_problems(ctx: RequestContext, shown: list[RoutineInfo]) -> list[RoutineProblem]:
    """The routines whose workflow is missing or broken, or whose inputs do not fit it."""
    service = ctx.state.workflows
    if service is None:
        return []
    found: list[RoutineProblem] = []
    for info in shown:
        if info.config.workflow is None or not info.config.enabled or info.blocked:
            continue
        folder = None if info.folder is None else Path(info.folder)
        settings = RoutineSettings.model_validate(info.config.model_dump(mode="json"))
        why = routine_problem(settings, folder, service)
        if why is not None:
            found.append(RoutineProblem(info.path, why))
    return found


def _check(table: dict[str, Any]) -> RoutineSettings:
    try:
        return RoutineSettings.model_validate(table)
    except ValidationError as exc:
        first = exc.errors()[0]
        where = ".".join(str(part) for part in first["loc"])
        message = first["msg"].removeprefix("Value error, ")
        raise RpcCallError(INVALID_PARAMS, f"{where}: {message}" if where else message) from exc


def _folders(folders: list[str]) -> list[Path]:
    found: list[Path] = []
    for text in folders:
        folder = Path(text)
        if not folder.is_absolute():
            raise RpcCallError(INVALID_PARAMS, f"{text} is not an absolute path")
        resolved = folder.resolve()
        if resolved not in found:
            found.append(resolved)
    return found


def _collect(
    ctx: RequestContext, folders: list[Path], now: datetime
) -> tuple[list[RoutineInfo], list[RoutineProblem]]:
    user_file = ctx.state.paths.config_file
    user = read_routines(user_file)
    infos = [_info(ctx, r, "user", None, user_file, False, now) for r in user.routines]
    problems = list(user.problems)
    for folder in folders:
        path = project_config(folder)
        policy = ctx.state.policy
        trusted = policy is not None and policy.trusted(folder)
        found = read_project_routines(user_file, folder, trusted)
        problems += found.problems
        infos += [_info(ctx, r, "project", folder, path, not trusted, now) for r in found.routines]
    return infos, problems


def _info(
    ctx: RequestContext,
    routine: RoutineSettings,
    source: RoutineSource,
    folder: Path | None,
    path: Path,
    blocked: bool,
    now: datetime,
) -> RoutineInfo:
    next_at: str | None = None
    if routine.schedule is not None and routine.enabled and not blocked:
        try:
            next_at = next_after(routine.schedule, now).isoformat()
        except ScheduleError:
            next_at = None
    return RoutineInfo(
        config=RoutineConfig.model_validate(routine.model_dump(mode="json")),
        source=source,
        folder=None if folder is None else str(folder),
        path=str(path),
        next_at=next_at,
        blocked=blocked,
    )


def _watch_problems(ctx: RequestContext, folders: list[Path]) -> list[RoutineProblem]:
    """The watched folders that cannot be read, of the routines ``routine.list`` shows."""
    if ctx.state.watcher is None:
        return []
    shown = {str(ctx.state.paths.config_file), *(str(project_config(f)) for f in folders)}
    return [p for p in ctx.state.watcher.problems() if p.file in shown]


def _issue(problem: RoutineProblem) -> RoutineIssue:
    return RoutineIssue(file=problem.file, line=problem.line, message=problem.message)
