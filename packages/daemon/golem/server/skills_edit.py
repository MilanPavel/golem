"""Handlers that read, write, create and disable a skill.

The browser may call ``skill.read``, ``skill.write``, ``skill.create`` and
``skill.set_disabled`` (ADR-054). ``skill.write`` and ``skill.create`` refuse a
project skill unless the project is in ``trusted_projects``; the ``_protected``
twins, which only a local client may call, do not. Writing a skill never trusts it.
"""

from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path

from golem.config_edit import set_skill_disabled
from golem.server.dispatcher import (
    INTERNAL_ERROR,
    INVALID_PARAMS,
    SKILL_NOT_FOUND,
    RequestContext,
    RpcCallError,
)
from golem.skills import edit
from golem.skills.edit import SkillConflictError, SkillEditError
from golem.skills.model import SKILL_FILE
from golem.skills.parse import NAME
from golem.skills.registry import PROJECT_DIRS, SkillRegistry
from golem_protocol.commands import (
    SkillCreateParams,
    SkillCreateResult,
    SkillIssue,
    SkillReadParams,
    SkillReadResult,
    SkillSetDisabledParams,
    SkillSetDisabledResult,
    SkillWriteParams,
    SkillWriteResult,
)

log = logging.getLogger("golem.server")

PROJECT_CREATE_DIR = PROJECT_DIRS[1]
"""``.agents/skills``, where ``skill.create`` puts a project skill."""


async def skill_read(ctx: RequestContext, params: SkillReadParams) -> SkillReadResult:
    registry = _registry(ctx)
    entries = [
        entry
        for entry in registry.view(_root(params.cwd)).listed
        if entry.skill.name == params.name
    ]
    if not entries:
        raise RpcCallError(SKILL_NOT_FOUND, f"there is no skill called {params.name}")
    entry = next((e for e in entries if e.usable), entries[0])
    file = entry.skill.file
    try:
        text, mtime = await asyncio.to_thread(_read, file)
    except OSError as exc:
        raise RpcCallError(INTERNAL_ERROR, f"could not read {file}: {exc}") from exc
    return SkillReadResult(path=str(file), text=text, mtime_ns=mtime, source=entry.origin)


async def skill_write(ctx: RequestContext, params: SkillWriteParams) -> SkillWriteResult:
    """The browser's write: a project skill needs a trusted project."""
    return await _write(ctx, params, protected=True)


async def skill_write_protected(ctx: RequestContext, params: SkillWriteParams) -> SkillWriteResult:
    """The terminal's write: the same checks, in any project."""
    return await _write(ctx, params, protected=False)


async def skill_create(ctx: RequestContext, params: SkillCreateParams) -> SkillCreateResult:
    return await _create(ctx, params, protected=True)


async def skill_create_protected(
    ctx: RequestContext, params: SkillCreateParams
) -> SkillCreateResult:
    return await _create(ctx, params, protected=False)


async def skill_set_disabled(
    ctx: RequestContext, params: SkillSetDisabledParams
) -> SkillSetDisabledResult:
    registry = _registry(ctx)
    if not NAME.fullmatch(params.name):
        raise RpcCallError(INVALID_PARAMS, f"{params.name!r} is not a skill name")
    path = ctx.state.paths.config_file
    try:
        await asyncio.to_thread(set_skill_disabled, path, params.name, params.disabled)
    except (OSError, ValueError) as exc:
        raise RpcCallError(INTERNAL_ERROR, f"could not write {path}: {exc}") from exc
    registry.check()
    return SkillSetDisabledResult(name=params.name, disabled=params.disabled)


async def _write(
    ctx: RequestContext, params: SkillWriteParams, *, protected: bool
) -> SkillWriteResult:
    registry = _registry(ctx)
    root = _root(params.cwd)
    try:
        file, origin = edit.target(registry, root, params.path)
    except SkillEditError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    if origin == "project" and protected:
        _need_trusted(ctx, root)
    checked = await asyncio.to_thread(edit.check, file.parent.name, params.text)
    errors = [SkillIssue(line=i.line, message=i.message) for i in checked.errors]
    warnings = [SkillIssue(line=i.line, message=i.message) for i in checked.warnings]
    try:
        current = (await asyncio.to_thread(file.stat)).st_mtime_ns
    except OSError as exc:
        raise RpcCallError(INTERNAL_ERROR, f"could not read {file}: {exc}") from exc
    if current != params.base_mtime_ns:
        return _conflict(f"{SKILL_FILE} changed on disk; reload")
    if params.dry_run:
        return SkillWriteResult(
            ok=True, written=False, errors=errors, warnings=warnings, mtime_ns=current
        )
    try:
        written = await asyncio.to_thread(edit.write, file, params.text, params.base_mtime_ns)
    except SkillConflictError as exc:
        return _conflict(str(exc))
    except SkillEditError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    except OSError as exc:
        raise RpcCallError(INTERNAL_ERROR, f"could not write {file}: {exc}") from exc
    registry.check()
    log.info("wrote %s (%d characters)", file, len(params.text))
    return SkillWriteResult(
        ok=True, written=True, errors=errors, warnings=warnings, mtime_ns=written
    )


async def _create(
    ctx: RequestContext, params: SkillCreateParams, *, protected: bool
) -> SkillCreateResult:
    registry = _registry(ctx)
    if params.scope == "user":
        folder = ctx.state.paths.skills_dir
    else:
        if params.cwd is None:
            raise RpcCallError(INVALID_PARAMS, "project scope needs a cwd")
        root = _root(params.cwd)
        assert root is not None
        if protected:
            _need_trusted(ctx, root)
        folder = root / PROJECT_CREATE_DIR
    try:
        file = await asyncio.to_thread(
            edit.create,
            folder,
            params.name,
            params.description,
            model_invocable=params.model_invocable,
        )
        mtime = (await asyncio.to_thread(file.stat)).st_mtime_ns
    except SkillEditError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    except OSError as exc:
        raise RpcCallError(INTERNAL_ERROR, f"could not create the skill: {exc}") from exc
    registry.check()
    log.info("created %s", file)
    return SkillCreateResult(path=str(file), mtime_ns=mtime)


def _conflict(message: str) -> SkillWriteResult:
    return SkillWriteResult(ok=False, written=False, errors=[SkillIssue(message=message)])


def _read(file: Path) -> tuple[str, int]:
    with file.open("rb") as handle:
        data = handle.read()
        mtime = os.fstat(handle.fileno()).st_mtime_ns
    return data.decode("utf-8", errors="replace"), mtime


def _need_trusted(ctx: RequestContext, root: Path | None) -> None:
    policy = ctx.state.policy
    if root is None or policy is None or not policy.trusted(root):
        raise RpcCallError(
            INVALID_PARAMS,
            f"{root} is not in trusted_projects: trust it before the browser edits its skills",
        )


def _root(cwd: str | None) -> Path | None:
    if cwd is None:
        return None
    root = Path(cwd)
    if not root.is_absolute():
        raise RpcCallError(INVALID_PARAMS, "cwd must be an absolute path")
    if not root.is_dir():
        raise RpcCallError(INVALID_PARAMS, f"There is no folder at {cwd}.")
    return root


def _registry(ctx: RequestContext) -> SkillRegistry:
    if ctx.state.skills is None:
        raise RpcCallError(INTERNAL_ERROR, "skills are not available")
    return ctx.state.skills
