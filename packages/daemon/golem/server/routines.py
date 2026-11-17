"""Handlers for ``routine.list``, ``routine.get``, ``routine.update`` and ``routine.remove``.

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
import logging
from datetime import datetime
from pathlib import Path
from typing import Any

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
from golem.routine_scheduler import RoutineBlockedError, RoutineBusyError, RoutineNotFoundError
from golem.routines import ScheduleError, next_after
from golem.server.dispatcher import INTERNAL_ERROR, INVALID_PARAMS, RequestContext, RpcCallError
from golem.store.routine_runs import RoutineRunRecord
from golem_protocol.commands import (
    RoutineChanged,
    RoutineConfig,
    RoutineGetParams,
    RoutineGetResult,
    RoutineInfo,
    RoutineIssue,
    RoutineListParams,
    RoutineListResult,
    RoutineRemoveParams,
    RoutineRemoveResult,
    RoutineRunParams,
    RoutineRunResult,
    RoutineRunSummary,
    RoutineSource,
    RoutineUpdateParams,
    RoutineUpdateResult,
)
from golem_protocol.rpc import RoutineChangedNotification

log = logging.getLogger("golem.server")

PROJECT_EDIT = "a project routine is edited in the project's .golem/config.toml, not from here"


async def routine_list(ctx: RequestContext, params: RoutineListParams) -> RoutineListResult:
    now = ctx.state.clock()
    routines, issues = await asyncio.to_thread(_collect, ctx, _folders(params.folders), now)
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
    log.info("wrote routine %s to %s", checked.name, path)
    now = ctx.state.clock()
    return RoutineUpdateResult(routine=_info(ctx, checked, "user", None, path, False, now))


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
    return RoutineRemoveResult(name=params.name)


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
        }
    )


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


def _issue(problem: RoutineProblem) -> RoutineIssue:
    return RoutineIssue(file=problem.file, line=problem.line, message=problem.message)
