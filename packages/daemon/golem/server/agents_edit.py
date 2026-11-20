"""What each agent type is and becomes, and the one change the browser may make to it.

``agents.list`` and ``agents.get`` fill ``resolves_to``: what the type's wish picks in this
setup, from the same code a helper uses to pick its model
(:meth:`~golem.sessions.manager.SessionManager.resolve_wish`). ``agents.set_wish`` rewrites the
``model:`` key of the agent file that wins the name (ADR-059, section 4):

- a user or extra-folder file, and a project file of a trusted folder, are edited in place;
- a bundled file cannot be, so the wish goes into a copy in ``~/.golem/agents``, which wins over
  the bundled one. The copy keeps the bundled prompt as it was when the wish was set;
- a project file of a folder that is not in ``trusted_projects`` is never edited: the registry
  does not even show it as a winner.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import tempfile
from pathlib import Path

from golem.agents.edit import AgentEditError, with_wish
from golem.agents.model import Agent
from golem.agents.registry import AgentRegistry, Listed
from golem.server.dispatcher import (
    INTERNAL_ERROR,
    INVALID_PARAMS,
    RequestContext,
    RpcCallError,
)
from golem_protocol.commands import (
    AgentInfo,
    AgentsSetWishParams,
    AgentsSetWishResult,
    WishResolution,
)
from golem_protocol.events import AgentLimits, AgentOrigin

log = logging.getLogger("golem.server")

REASON_MAX = 200


def check_cwd(cwd: str | None) -> None:
    """Refuse a project folder that is not an absolute path to a folder that exists."""
    if cwd is None:
        return
    if not Path(cwd).is_absolute():
        raise RpcCallError(INVALID_PARAMS, "cwd must be an absolute path")
    if not Path(cwd).is_dir():
        raise RpcCallError(INVALID_PARAMS, f"There is no folder at {cwd}.")


async def agent_infos(ctx: RequestContext, cwd: str | None) -> list[tuple[AgentInfo, Agent]]:
    """Every agent type a session in ``cwd`` sees, highest origin first, each with its file.

    A valid agent that lost its name is not listed on its own: its origin is in ``shadowed``
    of the winner. A broken agent is always listed. A project agent in a folder that is not
    trusted comes first with ``trusted = False``; it never wins a name.
    """
    check_cwd(cwd)
    registry = ctx.state.agents
    if registry is None:
        return []
    root = None if cwd is None else Path(cwd)
    view = registry.view(root)
    counts = await ctx.state.agent_usage.counts() if ctx.state.agent_usage is not None else None

    async def info(entry: Listed, *, trusted: bool) -> tuple[AgentInfo, Agent]:
        agent = entry.agent
        shadowed: list[AgentOrigin] = [
            other.origin
            for other in view.listed
            if other.shadowed_by == agent.path and other.agent.valid
        ]
        count = None if counts is None else counts.get(agent.name)
        return AgentInfo(
            name=agent.name,
            description=agent.description,
            origin=entry.origin,
            wish=agent.wish,
            tools=list(agent.tools),
            limits=AgentLimits(
                max_calls=agent.limits.max_calls,
                max_seconds=agent.limits.max_seconds,
                max_cost_usd=agent.limits.max_cost_usd,
                answer_chars=agent.limits.answer_chars,
            ),
            asks=agent.asks,
            errors=list(agent.errors),
            shadowed=shadowed,
            trusted=trusted,
            used=0 if count is None else count.used,
            finished=None if counts is None else (0 if count is None else count.finished),
            resolves_to=await _resolves_to(ctx, entry, cwd) if trusted else None,
        ), agent

    held_back = [
        await info(Listed(agent, "project"), trusted=False) for agent in registry.blocked(root)
    ]
    shown = [
        await info(entry, trusted=True)
        for entry in view.listed
        if entry.usable or not entry.agent.valid
    ]
    return held_back + shown


async def _resolves_to(
    ctx: RequestContext, entry: Listed, cwd: str | None
) -> WishResolution | None:
    """What the wish of a usable type becomes, or None without model facts or for a broken file."""
    sessions = ctx.state.sessions
    if sessions is None or not entry.usable:
        return None
    pick = await sessions.resolve_wish(entry.agent, cwd)
    if pick is None:
        return None
    reason = pick.detail
    if pick.overridden_by is not None:
        reason = (
            f"[routing.roles] explore = {pick.overridden_by} overrides the file's wish; {reason}"
        )
    if len(reason) > REASON_MAX:
        reason = reason[: REASON_MAX - 1].rstrip() + "…"
    return WishResolution(
        model=pick.profile, tier=pick.tier, reason=reason, fresh_window=pick.fresh_window
    )


async def agents_set_wish(ctx: RequestContext, params: AgentsSetWishParams) -> AgentsSetWishResult:
    """Write the wish of the type ``name`` where the registry reads it, and answer with the type."""
    registry = ctx.state.agents
    if registry is None:
        raise RpcCallError(INTERNAL_ERROR, "agents are not available")
    check_cwd(params.cwd)
    root = None if params.cwd is None else Path(params.cwd)
    view = registry.view(root)
    winner = next((e for e in view.listed if e.usable and e.agent.name == params.name), None)
    if winner is None:
        raise RpcCallError(INVALID_PARAMS, _why_not(registry, root, params.name, view.listed))
    target = winner.agent.path
    if winner.origin == "bundled":
        target = ctx.state.paths.agents_dir / target.name
        if target.exists():  # a broken copy, which never won: it must be fixed first
            raise RpcCallError(
                INVALID_PARAMS,
                f"{target} exists but has errors, so it cannot be changed; fix or remove it",
            )
    try:
        text = await asyncio.to_thread(_read, winner.agent.path)
        changed = with_wish(text, params.wish)
        await asyncio.to_thread(_write, target, changed, winner.origin == "bundled")
    except AgentEditError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    except OSError as exc:
        raise RpcCallError(INTERNAL_ERROR, f"could not write {target}: {exc}") from exc
    registry.check()
    log.info("set the wish of %s to %s in %s", params.name, params.wish, target)
    found = await agent_infos(ctx, params.cwd)
    info = next(
        pair[0]
        for pair in found
        if pair[0].name == params.name and pair[0].trusted and not pair[0].errors
    )
    return AgentsSetWishResult(**info.model_dump())


def _why_not(
    registry: AgentRegistry, root: Path | None, name: str, listed: tuple[Listed, ...]
) -> str:
    if any(a.name == name and a.valid for a in registry.blocked(root)):
        return (
            f"agent {name} is in this project's .golem/agents, and the project is not in "
            "trusted_projects: trust it before the browser changes its agents"
        )
    broken = next((e.agent for e in listed if e.agent.name == name), None)
    if broken is not None:
        return f"agent {name} has errors, so it cannot be changed: {broken.errors[0]}"
    return f"There is no agent named {name}."


def _read(path: Path) -> str:
    return path.read_bytes().decode("utf-8")


def _write(path: Path, text: str, create: bool) -> None:
    """Replace ``path`` with ``text`` through a temporary file next to it, keeping its mode."""
    path.parent.mkdir(parents=True, exist_ok=True)
    mode = None
    if not create:
        with contextlib.suppress(OSError):
            mode = path.stat().st_mode & 0o7777
    handle, name = tempfile.mkstemp(prefix=".agent-", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(handle, "wb") as out:
            out.write(text.encode("utf-8"))
        if mode is not None:
            os.chmod(name, mode)
        os.replace(name, path)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(name)
        raise


__all__ = ["agent_infos", "agents_set_wish", "check_cwd"]
