"""What each agent type is and becomes, and the one change the browser may make to it.

``agents.list`` and ``agents.get`` fill ``resolves_to``: what the type's wish picks in this
setup, from the same code a helper uses to pick its model
(:meth:`~golem.sessions.manager.SessionManager.resolve_wish`). ``agents.set_wish`` rewrites the
``model:`` key of the agent file that wins the name (ADR-059, section 4):

- a user or extra-folder file, and a project file of a trusted folder, are edited in place;
- a bundled file cannot be, so the wish goes into ``[agents.<name>] model`` of ``config.toml``,
  which the registry applies over the bundled file's wish. Nothing is copied, so the prompt,
  tools and limits stay the bundled ones of the running release;
- a project file of a folder that is not in ``trusted_projects`` is never edited: the registry
  does not even show it as a winner.

``agents.list`` and ``agents.get`` show the limits a helper of each type really runs with
(:func:`~golem.agents.limits.resolve_limits`) and which of them ``[agents.<name>]`` sets.
``agents.set_limits`` writes the limits of one type the same two ways as the wish: the front
matter lines of your own file, or ``[agents.<name>]`` of ``config.toml`` for a built-in type.
``agents.set_default_limits`` writes the limits of ``[agents]``, which bound every helper.

``agents.save``, ``agents.copy`` and ``agents.delete`` write, copy and remove the user's own files
in ``~/.golem/agents``, and nothing outside that folder. A name is checked against the agent name
rules before any path is built, and the final path is checked to be a direct child of the folder.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import re
import tempfile
from collections.abc import Mapping
from pathlib import Path
from typing import cast

from pydantic import ValidationError

from golem.agents.bundled import bundled_agents_dir
from golem.agents.edit import AgentEditError, check_wish, with_limits, with_wish
from golem.agents.limits import resolve_limits
from golem.agents.model import AGENT_SUFFIX, Agent
from golem.agents.parse import parse_agent
from golem.agents.registry import AgentRegistry, Listed
from golem.config import BUNDLED_TYPES, AgentSettings, DelegateSettings, load_settings
from golem.config_edit import RawConflictError, set_keys
from golem.server.dispatcher import (
    INTERNAL_ERROR,
    INVALID_PARAMS,
    RequestContext,
    RpcCallError,
)
from golem.skills.parse import MAX_NAME, NAME, frontmatter_fields, split_frontmatter
from golem_protocol.commands import (
    AgentInfo,
    AgentsCopyParams,
    AgentsCopyResult,
    AgentsDelegateNumber,
    AgentsDelegateValues,
    AgentsDeleteParams,
    AgentsDeleteResult,
    AgentsKeepParams,
    AgentsKeepResult,
    AgentsKeepValues,
    AgentsSaveParams,
    AgentsSaveProblem,
    AgentsSaveResult,
    AgentsSetDefaultLimitsParams,
    AgentsSetLimitsParams,
    AgentsSetLimitsResult,
    AgentsSetWishParams,
    AgentsSetWishResult,
    ConfigError,
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
    sessions = ctx.state.sessions
    home = ctx.state.user_home or Path.home()
    settings = await _agent_settings(ctx)

    async def info(entry: Listed, *, trusted: bool) -> tuple[AgentInfo, Agent]:
        agent = entry.agent
        shadowed: list[AgentOrigin] = [
            other.origin
            for other in view.listed
            if other.shadowed_by == agent.path and other.agent.valid
        ]
        count = None if counts is None else counts.get(agent.name)
        text = await _file_text(agent.path) if trusted else None
        usable = trusted and agent.valid and sessions is not None
        resolved = resolve_limits(agent, settings)
        return AgentInfo(
            name=agent.name,
            description=agent.description,
            origin=entry.origin,
            wish=agent.wish,
            tools=list(agent.tools),
            limits=AgentLimits(
                max_calls=resolved.max_calls,
                max_seconds=resolved.max_seconds,
                max_cost_usd=resolved.max_cost_usd,
                max_tokens=resolved.max_tokens,
                answer_chars=resolved.answer_chars,
            ),
            limits_from_config=_from_config(agent.name, settings),
            asks=agent.asks,
            errors=list(agent.errors),
            shadowed=shadowed,
            trusted=trusted,
            used=0 if count is None else count.used,
            finished=None if counts is None else (0 if count is None else count.finished),
            resolves_to=await _resolves_to(ctx, entry, cwd) if trusted else None,
            path=shown_path(agent.path, entry.origin, root, home),
            text=text,
            prompt=agent.body if trusted else None,
            changing_tools=sessions.changing_tools(agent) if sessions is not None else [],
            unavailable=sessions.unavailable_reason(agent, cwd) if usable and sessions else None,
            stopped=None if counts is None else (0 if count is None else count.stopped),
            cost_usd=None if count is None else count.cost_usd,
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


async def _agent_settings(ctx: RequestContext) -> AgentSettings:
    """``[agents]`` as ``config.toml`` has it now; the defaults when the file does not validate."""
    paths = ctx.state.paths
    try:
        loaded = await asyncio.to_thread(load_settings, home=paths.home, project_dir=paths.home)
    except (OSError, ValueError):
        return AgentSettings()
    return loaded.agents


_LIMIT_NAMES = {
    "max_calls": "max_calls",
    "working_seconds": "max_seconds",
    "max_cost": "max_cost_usd",
    "max_tokens": "max_tokens",
    "answer_chars": "answer_chars",
}
"""The keys of ``[agents.<name>]`` and the name each has in ``AgentLimits``."""


def _from_config(name: str, settings: AgentSettings) -> list[str]:
    """The limits that ``[agents.<name>]`` sets for ``name``, by their ``AgentLimits`` names."""
    table = settings.table_for(name)
    if table is None:
        return []
    return [shown for key, shown in _LIMIT_NAMES.items() if table.given(key) is not None]


def shown_path(path: Path, origin: AgentOrigin, root: Path | None, home: Path) -> str:
    """The file as a person reads it: ``~`` for the home folder, the package path for a bundled
    file, the path inside the project for a project file."""
    if origin == "bundled":
        package = bundled_agents_dir().parent.parent
        with contextlib.suppress(ValueError):
            return f"{package.name}/{path.relative_to(package).as_posix()}"
    if origin == "project" and root is not None:
        with contextlib.suppress(ValueError):
            return path.relative_to(root).as_posix()
    with contextlib.suppress(ValueError):
        return f"~/{path.relative_to(home).as_posix()}"
    return str(path)


async def _file_text(path: Path) -> str | None:
    """The file as written, or None when it cannot be read."""
    try:
        return await asyncio.to_thread(_read, path)
    except (OSError, UnicodeDecodeError):
        return None


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
        target = ctx.state.paths.config_file
        if params.name not in BUNDLED_TYPES:
            raise RpcCallError(INVALID_PARAMS, f"the wish of {params.name} cannot be changed here")
        try:
            check_wish(params.wish)
            await asyncio.to_thread(
                set_keys, target, {f"agents.{params.name}": {"model": params.wish}}
            )
        except AgentEditError as exc:
            raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
        except (OSError, ValueError, RawConflictError) as exc:
            raise RpcCallError(INTERNAL_ERROR, f"could not write {target}: {exc}") from exc
    else:
        try:
            text = await asyncio.to_thread(_read, target)
            changed = with_wish(text, params.wish)
            await asyncio.to_thread(_write, target, changed, False)
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


def _delegate_values(delegate: DelegateSettings) -> AgentsDelegateValues:
    """The four numbers of ``[agents.delegate]``, each with the shipped value and whether the
    user's file leaves it at that."""
    shipped = DelegateSettings()

    def number(key: str) -> AgentsDelegateNumber:
        value = float(getattr(delegate, key))
        default = float(getattr(shipped, key))
        return AgentsDelegateNumber(value=value, default=default, is_default=value == default)

    return AgentsDelegateValues(
        read_share=number("read_share"),
        fill_share=number("fill_share"),
        job_share=number("job_share"),
        price_ratio=number("price_ratio"),
    )


async def _keep_values(ctx: RequestContext) -> AgentsKeepValues:
    paths = ctx.state.paths
    settings = await asyncio.to_thread(load_settings, home=paths.home, project_dir=paths.home)
    agents = settings.agents
    return AgentsKeepValues(
        keep_days=agents.keep_days,
        keep_problem_days=agents.keep_problem_days,
        max_calls=agents.max_calls,
        working_seconds=agents.working_seconds,
        max_cost=agents.max_cost,
        max_tokens=agents.max_tokens,
        use_helpers=agents.use_helpers,
        delegate=_delegate_values(agents.delegate),
    )


async def agents_keep(ctx: RequestContext, params: AgentsKeepParams) -> AgentsKeepResult:
    """Read how long a finished helper's steps are kept, or write the keys that were sent.

    A wrong value comes back as a field error and nothing is written. The trim reads the file
    again on its next pass, so no restart is needed.
    """
    patch = params.model_dump(exclude_none=True)
    current = (await _keep_values(ctx)).model_dump(exclude={"delegate"})
    try:
        AgentSettings.model_validate({**current, **patch})
    except ValidationError as exc:
        return AgentsKeepResult(
            ok=False,
            errors=[
                ConfigError(
                    path=f"agents.{'.'.join(str(part) for part in error['loc'])}",
                    message=error["msg"],
                )
                for error in exc.errors()
            ],
        )
    config_file = ctx.state.paths.config_file
    try:
        if patch:
            await asyncio.to_thread(set_keys, config_file, {"agents": patch})
    except (RawConflictError, ValueError) as exc:
        return AgentsKeepResult(ok=False, errors=[ConfigError(message=str(exc))])
    except OSError as exc:
        raise RpcCallError(INTERNAL_ERROR, f"could not write {config_file}: {exc}") from exc
    if patch:
        log.info("helper keep settings saved keys=%s", sorted(patch))
    return AgentsKeepResult(ok=True, values=await _keep_values(ctx))


async def set_delegate_numbers(
    ctx: RequestContext, numbers: Mapping[str, float]
) -> AgentsKeepResult:
    """Write some of the four numbers of ``[agents.delegate]``, the way ``agents.keep`` writes.

    The numbers are checked first against ``DelegateSettings``; a wrong one comes back as a
    field error and nothing is written. The file keeps its comments. Every use of the numbers
    reads ``config.toml`` again (``router.agent_settings()``), so no restart is needed.
    """
    delegate = (await _agent_settings(ctx)).delegate
    try:
        DelegateSettings.model_validate({**delegate.model_dump(), **numbers})
    except ValidationError as exc:
        return AgentsKeepResult(
            ok=False,
            errors=[
                ConfigError(
                    path=f"agents.delegate.{'.'.join(str(part) for part in error['loc'])}",
                    message=error["msg"],
                )
                for error in exc.errors()
            ],
        )
    config_file = ctx.state.paths.config_file
    try:
        if numbers:
            await asyncio.to_thread(set_keys, config_file, {"agents.delegate": dict(numbers)})
    except (RawConflictError, ValueError) as exc:
        return AgentsKeepResult(ok=False, errors=[ConfigError(message=str(exc))])
    except OSError as exc:
        raise RpcCallError(INTERNAL_ERROR, f"could not write {config_file}: {exc}") from exc
    if numbers:
        log.info("delegate numbers saved keys=%s", sorted(numbers))
    return AgentsKeepResult(ok=True, values=await _keep_values(ctx))


# --- agents.set_limits, agents.set_default_limits ---------------------------------------------

_FILE_KEYS = {
    "max_calls": "max-calls",
    "working_seconds": "max-seconds",
    "max_cost": "max-cost-usd",
    "max_tokens": "max-tokens",
}
"""The front matter line of an agent file for each limit key of ``config.toml``."""

_EXPLORER_MAX_CALLS = 50


def _limit_changes(
    params: AgentsSetLimitsParams | AgentsSetDefaultLimitsParams, *, name: str | None
) -> dict[str, float | None]:
    """The keys to write, a value or None to remove, after checking each one.

    Raises :class:`AgentEditError` with the first wrong value, and for a key that is both set
    and cleared. ``name`` is the type: only the explorer's ``max_calls`` has an upper bound.
    """
    changes: dict[str, float | None] = {}
    for key in _FILE_KEYS:
        value = cast(float | None, getattr(params, key))
        if value is not None:
            changes[key] = value
    for key in params.clear:
        if key in changes:
            raise AgentEditError(f"{key} is both set and cleared: send one of them")
        changes[key] = None
    for key, value in changes.items():
        if value is None:
            continue
        if key == "max_cost":
            if value < 0:
                raise AgentEditError("max_cost must be 0 or more (US dollars)")
        elif value != int(value) or value < 1:
            raise AgentEditError(f"{key} must be a whole number, 1 or more")
        elif key == "max_calls" and name == "explorer" and value > _EXPLORER_MAX_CALLS:
            raise AgentEditError(f"max_calls of the explorer must be {_EXPLORER_MAX_CALLS} or less")
    return changes


def _shadowing_keys(
    name: str, changes: dict[str, float | None], settings: AgentSettings
) -> list[str]:
    """The keys of ``[agents.<name>]`` that would win over a file for the limits in ``changes``.

    For the explorer, ``timeout_seconds`` goes with ``working_seconds``.
    """
    table = settings.table_for(name)
    if table is None:
        return []
    keys = list(changes)
    if name == "explorer" and "working_seconds" in changes:
        keys.append("timeout_seconds")
    return [key for key in keys if table.given(key) is not None]


def _file_problems(text: str, name: str) -> list[str]:
    """What the registry's parser finds wrong with ``text`` as the file of agent ``name``."""
    with tempfile.TemporaryDirectory(prefix="golem-agent-") as scratch:
        draft = Path(scratch) / f"{name}{AGENT_SUFFIX}"
        draft.write_bytes(text.encode("utf-8"))
        return list(parse_agent(draft).errors)


async def agents_set_limits(
    ctx: RequestContext, params: AgentsSetLimitsParams
) -> AgentsSetLimitsResult:
    """Set or clear limits of the type ``name``, and answer with the type.

    A built-in type gets them in ``[agents.<name>]`` of ``config.toml``, a file of the user's
    in its front matter, and then the same keys are removed from a ``[agents.<name>]`` table of
    the same name, which would win over the file. A project agent is read-only. The file is
    checked with the registry's parser before it is written, and a wrong value writes nothing.
    No restart is needed.
    """
    registry = _registry(ctx, params.cwd)
    root = None if params.cwd is None else Path(params.cwd)
    view = registry.view(root)
    winner = next((e for e in view.listed if e.usable and e.agent.name == params.name), None)
    if winner is None:
        raise RpcCallError(INVALID_PARAMS, _why_not(registry, root, params.name, view.listed))
    target: Path | None = None
    changes: dict[str, float | None] = {}
    try:
        changes = _limit_changes(params, name=params.name)
        if winner.origin == "project":
            raise AgentEditError(
                f"{params.name} is a project agent: project agents are read-only here. "
                "Change its file in the project's .golem/agents yourself."
            )
        if not changes:
            pass
        elif winner.origin == "bundled":
            target = ctx.state.paths.config_file
            if params.name not in BUNDLED_TYPES:
                raise AgentEditError(f"the limits of {params.name} cannot be changed here")
            table = dict(changes)
            if params.name == "explorer" and "working_seconds" in table:
                table["timeout_seconds"] = None
            await asyncio.to_thread(set_keys, target, {f"agents.{params.name}": table})
        else:
            target = _user_file(_agents_folder(ctx), params.name)
            if not target.is_file():
                raise AgentEditError(f"You have no agent file named {params.name}.")
            text = await asyncio.to_thread(_read, target)
            lines = {_FILE_KEYS[key]: value for key, value in changes.items()}
            changed = with_limits(text, lines)
            problems = _file_problems(changed, params.name)
            if problems:
                raise AgentEditError(f"{params.name} would have a problem: {problems[0]}")
            await asyncio.to_thread(_write, target, changed, False)
            shadowing = _shadowing_keys(params.name, changes, await _agent_settings(ctx))
            if shadowing:
                config_file = ctx.state.paths.config_file
                await asyncio.to_thread(
                    set_keys, config_file, {f"agents.{params.name}": dict.fromkeys(shadowing)}
                )
    except AgentEditError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    except (OSError, ValueError, RawConflictError) as exc:
        raise RpcCallError(INTERNAL_ERROR, f"could not write the limits: {exc}") from exc
    registry.check()
    if target is not None:
        log.info("set limits %s of %s in %s", sorted(changes), params.name, target)
    found = await agent_infos(ctx, params.cwd)
    info = next(
        pair[0]
        for pair in found
        if pair[0].name == params.name and pair[0].trusted and not pair[0].errors
    )
    return AgentsSetLimitsResult(**info.model_dump())


async def agents_set_default_limits(
    ctx: RequestContext, params: AgentsSetDefaultLimitsParams
) -> AgentsKeepResult:
    """Set or clear the limits in ``[agents]`` of ``config.toml``, and answer with what is in
    force. A wrong value comes back as a field error and nothing is written."""
    try:
        changes = _limit_changes(params, name=None)
    except AgentEditError as exc:
        key = str(exc).split(" ", maxsplit=1)[0]
        error = ConfigError(path=f"agents.{key}", message=str(exc))
        return AgentsKeepResult(ok=False, errors=[error])
    config_file = ctx.state.paths.config_file
    try:
        if changes:
            await asyncio.to_thread(set_keys, config_file, {"agents": dict(changes)})
    except (RawConflictError, ValueError) as exc:
        return AgentsKeepResult(ok=False, errors=[ConfigError(message=str(exc))])
    except OSError as exc:
        raise RpcCallError(INTERNAL_ERROR, f"could not write {config_file}: {exc}") from exc
    if changes:
        log.info("helper default limits saved keys=%s", sorted(changes))
    return AgentsKeepResult(ok=True, values=await _keep_values(ctx))


# --- agents.save, agents.copy, agents.delete --------------------------------------------------

_KEY_IN_ERROR = re.compile(r"`([a-z-]+)`")
_KEY_LINE = re.compile(r"([A-Za-z0-9_-]+)[ \t]*:")
_DRAFT = "draft"
_NO_NAME = "`name` is missing: the name inside the file decides the file name"


def _agents_folder(ctx: RequestContext) -> Path:
    """The folder of the user's own agent files, the only one these methods write in."""
    return ctx.state.paths.agents_dir


def _user_file(folder: Path, name: str) -> Path:
    """The path of the user's file for ``name``. Checks the name before it builds the path.

    Raises :class:`AgentEditError` for a name that is not 1-64 lowercase letters, digits and
    single hyphens, so a ``/``, a ``..`` or a leading dot never reaches the file system.
    """
    if len(name) > MAX_NAME or not NAME.fullmatch(name):
        raise AgentEditError(
            f"{name!r} is not a name an agent can have: use 1-{MAX_NAME} lowercase letters, "
            "digits and single hyphens, such as `code-reviewer`"
        )
    path = folder / f"{name}{AGENT_SUFFIX}"
    if path.resolve().parent != folder.resolve() or path.is_symlink():
        raise AgentEditError(f"{name!r} would be written outside {folder}, so it is refused")
    return path


def _key_lines(text: str) -> dict[str, int]:
    """The line (from 1) of each top-level frontmatter key in ``text``."""
    lines = text.lstrip("\ufeff").splitlines()
    found: dict[str, int] = {}
    if not lines or lines[0].strip() != "---":
        return found
    for number, line in enumerate(lines[1:], start=2):
        if line.strip() == "---":
            break
        match = _KEY_LINE.match(line)
        if match:
            found.setdefault(match.group(1), number)
    return found


def _problem(message: str, keys: dict[str, int]) -> AgentsSaveProblem:
    """A parser message with a line: the line of the first `key` the message names."""
    for key in _KEY_IN_ERROR.findall(message):
        if key in keys:
            return AgentsSaveProblem(message=message, line=keys[key])
    return AgentsSaveProblem(message=message)


def _name_in(text: str) -> str | None:
    """The ``name`` key of the frontmatter, or None when there is none or it is not text."""
    split = split_frontmatter(text.encode("utf-8"), complete=True)
    if isinstance(split, str):
        return None
    value = frontmatter_fields(split[0], []).get("name")
    return value.strip() if isinstance(value, str) and value.strip() else None


def _check_text(text: str) -> tuple[str | None, list[AgentsSaveProblem]]:
    """Read ``text`` with the registry's parser. Returns the agent's name and its problems.

    The parser reads files, so the text goes into a scratch folder first, never into the
    agents folder. The file there is named after the agent, so the parser's own name checks run.
    """
    keys = _key_lines(text)
    name = _name_in(text)
    valid = name is not None and len(name) <= MAX_NAME and NAME.fullmatch(name) is not None
    with tempfile.TemporaryDirectory(prefix="golem-agent-") as scratch:
        draft = Path(scratch) / f"{name if valid else _DRAFT}{AGENT_SUFFIX}"
        draft.write_bytes(text.encode("utf-8"))
        agent = parse_agent(draft)
    problems = [_problem(message, keys) for message in agent.errors]
    if name is None:
        problems.insert(0, AgentsSaveProblem(message=_NO_NAME, line=keys.get("name")))
    return name, problems


async def _user_info(ctx: RequestContext, cwd: str | None, name: str) -> AgentInfo:
    """The user's agent ``name`` as the list shows it, after the registry looked again."""
    if ctx.state.agents is not None:
        ctx.state.agents.check()
    found = await agent_infos(ctx, cwd)
    return next(
        pair[0]
        for pair in found
        if pair[0].name == name and pair[0].origin == "user" and pair[0].trusted
    )


def _registry(ctx: RequestContext, cwd: str | None) -> AgentRegistry:
    registry = ctx.state.agents
    if registry is None:
        raise RpcCallError(INTERNAL_ERROR, "agents are not available")
    check_cwd(cwd)
    return registry


async def agents_save(ctx: RequestContext, params: AgentsSaveParams) -> AgentsSaveResult:
    """Save ``params.text`` as a user agent file, only when the parser finds nothing wrong.

    Problems come back as ``ok = False``, each with the line of the frontmatter key it names
    when there is one, and nothing is written. A refused name (taken, or the file to replace
    is not there) is one more problem.
    """
    _registry(ctx, params.cwd)
    folder = _agents_folder(ctx)
    name, problems = await asyncio.to_thread(_check_text, params.text)
    if problems or name is None:
        return AgentsSaveResult(ok=False, problems=problems)
    try:
        target = _user_file(folder, name)
        old = None if params.name is None else _user_file(folder, params.name)
        if old is not None and not old.is_file():
            raise AgentEditError(f"You have no agent file named {params.name} to replace.")
        if target.exists() and target != old:
            raise AgentEditError(
                f"You already have an agent named {name}: pick another name, or edit that one."
            )
    except AgentEditError as exc:
        return AgentsSaveResult(ok=False, problems=[AgentsSaveProblem(message=str(exc))])
    try:
        await asyncio.to_thread(_write, target, params.text, old != target)
        if old is not None and old != target:
            await asyncio.to_thread(old.unlink)
    except OSError as exc:
        raise RpcCallError(INTERNAL_ERROR, f"could not write {target}: {exc}") from exc
    log.info("saved agent %s to %s", name, target)
    return AgentsSaveResult(ok=True, agent=await _user_info(ctx, params.cwd, name))


async def agents_copy(ctx: RequestContext, params: AgentsCopyParams) -> AgentsCopyResult:
    """Copy the bundled file of ``params.name`` to the user's folder, unchanged."""
    _registry(ctx, params.cwd)
    try:
        target = _user_file(_agents_folder(ctx), params.name)
        source = bundled_agents_dir() / f"{params.name}{AGENT_SUFFIX}"
        if not source.is_file():
            raise AgentEditError(
                f"{params.name} is not a built-in agent, so there is nothing to copy."
            )
        if target.exists():
            raise AgentEditError(
                f"You already have an agent named {params.name}: edit that one instead."
            )
        text = await asyncio.to_thread(_read, source)
        await asyncio.to_thread(_write, target, text, True)
    except AgentEditError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    except (OSError, UnicodeDecodeError) as exc:
        raise RpcCallError(INTERNAL_ERROR, f"could not copy {params.name}: {exc}") from exc
    log.info("copied the built-in agent %s to %s", params.name, target)
    info = await _user_info(ctx, params.cwd, params.name)
    return AgentsCopyResult(**info.model_dump())


async def agents_delete(ctx: RequestContext, params: AgentsDeleteParams) -> AgentsDeleteResult:
    """Remove the user's file of ``params.name``. Answers with what the name means now."""
    registry = _registry(ctx, params.cwd)
    try:
        target = _user_file(_agents_folder(ctx), params.name)
        if not target.is_file():
            raise AgentEditError(_cannot_delete(registry, params))
        await asyncio.to_thread(target.unlink)
    except AgentEditError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    except OSError as exc:
        raise RpcCallError(INTERNAL_ERROR, f"could not delete {params.name}: {exc}") from exc
    registry.check()
    log.info("deleted the agent file %s", target)
    found = await agent_infos(ctx, params.cwd)
    now = next(
        (p[0] for p in found if p[0].name == params.name and p[0].trusted and not p[0].errors),
        None,
    )
    return AgentsDeleteResult(agent=now)


def _cannot_delete(registry: AgentRegistry, params: AgentsDeleteParams) -> str:
    root = None if params.cwd is None else Path(params.cwd)
    winner = next(
        (e for e in registry.view(root).listed if e.agent.name == params.name and e.usable), None
    )
    if winner is not None and winner.origin == "bundled":
        return f"{params.name} is a built-in agent: it cannot be deleted."
    if winner is not None and winner.origin == "project":
        return (
            f"{params.name} is a project agent: delete its file in the project's "
            ".golem/agents yourself."
        )
    return f"You have no agent file named {params.name}."


__all__ = [
    "agent_infos",
    "agents_copy",
    "agents_delete",
    "agents_keep",
    "agents_save",
    "agents_set_default_limits",
    "agents_set_limits",
    "agents_set_wish",
    "check_cwd",
]
