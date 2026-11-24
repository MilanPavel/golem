"""``routing.get`` and ``routing.set``: the routing, budget and context settings for the browser.

The five tables are ``[routing]``, ``[routing.ladder]``, ``[routing.roles]``, ``[budget]`` and
``[context]``. A write checks every value with the settings models first, so a wrong value
comes back as a field error and nothing is written. The file keeps its comments.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, cast

from pydantic import BaseModel, ValidationError

from golem.config import BudgetSettings, ContextSettings, RoutingSettings
from golem.config_edit import RawConflictError, set_keys
from golem.models.pick import tier_picks
from golem.models.router import ModelConfigError, ModelRouter
from golem.models.tiers import TIERS
from golem.server.dispatcher import INTERNAL_ERROR, RequestContext, RpcCallError
from golem_protocol.commands import (
    ConfigError,
    RoutingBudget,
    RoutingContext,
    RoutingGetParams,
    RoutingGetResult,
    RoutingLadder,
    RoutingPicked,
    RoutingRoles,
    RoutingSetParams,
    RoutingSetResult,
    RoutingValues,
)

log = logging.getLogger(__name__)

_ORDER_KEYS = ("clear_to", "clear_at", "compact_at")
"""The keys of ``[context]`` whose order is checked together."""


def _router(ctx: RequestContext) -> ModelRouter:
    sessions = ctx.state.sessions
    if sessions is None:
        raise RpcCallError(INTERNAL_ERROR, "sessions are not ready")
    return sessions.router


async def _picked(ctx: RequestContext) -> RoutingPicked:
    """What golem would take for each tier with an empty ladder, from the cached facts."""
    sessions = ctx.state.sessions
    if sessions is None or sessions.facts is None:
        return RoutingPicked()
    default = sessions.configured_model().profile or ""
    try:
        refs = [sessions.router.resolve(default).ref] if default else []
    except ModelConfigError:
        refs = []
    refs.extend(sessions.listed_refs())
    facts = await sessions.facts.facts(list(dict.fromkeys(refs)))
    picks = tier_picks(RoutingSettings().ladder, default, facts)
    return RoutingPicked(
        local=None if picks["local"] is None else picks["local"].ref,
        budget=None if picks["budget"] is None else picks["budget"].ref,
        frontier=None if picks["frontier"] is None else picks["frontier"].ref,
    )


async def local_model_in_use(sessions: Any) -> str | None:
    """The Ollama model golem treats as "the local model", for the helper measurement.

    The same pick as the Routing page, but with the ladder in force: ``[routing.ladder] local``
    when set, else the session model when it is local, else the local model with the widest
    window that is ready. None when there is none, or it is not an Ollama model. A model that
    is named but not installed is returned too: the measurement says so, and never swaps it
    for another.
    """
    if sessions is None or sessions.facts is None:
        return None
    default = sessions.configured_model().profile or ""
    try:
        refs = [sessions.router.resolve(default).ref] if default else []
    except ModelConfigError:
        refs = []
    refs.extend(sessions.listed_refs())
    facts = await sessions.facts.facts(list(dict.fromkeys(refs)))
    ladder = sessions.router.routing_settings().ladder
    pick = tier_picks(ladder, default, facts)["local"]
    if pick is None or not pick.ref.startswith("ollama/"):
        return None
    return pick.ref


async def _values(ctx: RequestContext) -> RoutingGetResult:
    router = _router(ctx)
    routing = router.routing_settings()
    context = router.context_settings()
    budget = router.budget_settings()
    return RoutingGetResult(
        routing=RoutingValues(
            mode=routing.mode,
            paid=routing.paid,
            budget_max_price=routing.budget_max_price,
            local_only=list(routing.local_only),
        ),
        ladder=RoutingLadder(**routing.ladder.model_dump()),
        roles=RoutingRoles(**routing.roles.model_dump()),
        budget=RoutingBudget(**budget.model_dump()),
        context=RoutingContext(**context.model_dump()),
        picked=await _picked(ctx),
    )


async def routing_get(ctx: RequestContext, params: RoutingGetParams) -> RoutingGetResult:
    del params
    return await _values(ctx)


def _patch(model: BaseModel | None) -> dict[str, Any]:
    """The keys a patch names, a null among them meaning the key goes."""
    if model is None:
        return {}
    return {name: getattr(model, name) for name in model.model_fields_set}


def _merged(current: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    """The values with the patch applied. A removed key drops out, so its default applies."""
    merged = {**current}
    for key, value in patch.items():
        if value is None:
            merged.pop(key, None)
        else:
            merged[key] = value
    return merged


def _error(path: str, message: str) -> ConfigError:
    return ConfigError(path=path, message=message)


def _text(raw: str) -> str:
    return raw.removeprefix("Value error, ")


def _field_errors(
    exc: ValidationError, prefix: str, patch: dict[str, Any], *, deep: tuple[str, ...] = ()
) -> list[ConfigError]:
    """One error for each setting that failed, the last message when a union gave several."""
    found: dict[str, str] = {}
    for item in exc.errors():
        loc = [str(part) for part in item["loc"]]
        if not loc:
            # A rule over several keys: put it on the first of them the request changed.
            keys = [key for key in _ORDER_KEYS if key in patch] or [_ORDER_KEYS[0]]
            found[f"{prefix}.{keys[0]}"] = _text(item["msg"])
            continue
        size = 2 if loc[0] in deep and len(loc) > 1 else 1
        found[".".join([prefix, *loc[:size]])] = _text(item["msg"])
    return [_error(path, message) for path, message in found.items()]


def _check_models(
    ctx: RequestContext, ladder: dict[str, Any], roles: dict[str, Any]
) -> list[ConfigError]:
    """Each named model must exist, and a ladder line must hold a model of its own tier."""
    router = _router(ctx)
    models = ctx.state.models
    errors: list[ConfigError] = []
    for name, value in ladder.items():
        if value is None:
            continue
        path = f"routing.ladder.{name}"
        try:
            ref = router.resolve(value).ref
        except ModelConfigError:
            errors.append(_error(path, f"there is no model called {value}"))
            continue
        tier = None if models is None else models.tier_of_ref(ref)
        if name in TIERS and tier is not None and tier != name:
            errors.append(_error(path, f"{ref} is a {tier} model, not a {name} one"))
    for name, value in roles.items():
        if value is None or value == "session":
            continue
        try:
            router.resolve(value)
        except ModelConfigError:
            errors.append(_error(f"routing.roles.{name}", f"there is no model called {value}"))
    return errors


def _check_folders(folders: object) -> list[ConfigError]:
    if not isinstance(folders, list):
        return []
    bad = [item for item in cast(list[object], folders) if not str(item).startswith("/")]
    if not bad:
        return []
    return [_error("routing.local_only", f"{bad[0]} is not an absolute folder path")]


async def routing_set(ctx: RequestContext, params: RoutingSetParams) -> RoutingSetResult:
    router = _router(ctx)
    routing = _patch(params.routing)
    ladder = _patch(params.ladder)
    roles = _patch(params.roles)
    budget = _patch(params.budget)
    context = _patch(params.context)

    errors: list[ConfigError] = []
    current = router.routing_settings().model_dump()
    try:
        RoutingSettings.model_validate(
            {
                **_merged(current, routing),
                "ladder": _merged(current["ladder"], ladder),
                "roles": _merged(current["roles"], roles),
            }
        )
    except ValidationError as exc:
        errors += _field_errors(exc, "routing", routing, deep=("ladder", "roles"))
    try:
        BudgetSettings.model_validate(_merged(router.budget_settings().model_dump(), budget))
    except ValidationError as exc:
        errors += _field_errors(exc, "budget", budget)
    try:
        ContextSettings.model_validate(_merged(router.context_settings().model_dump(), context))
    except ValidationError as exc:
        errors += _field_errors(exc, "context", context)
    if not errors:
        errors += _check_models(ctx, ladder, roles)
        errors += _check_folders(routing.get("local_only"))
    if errors:
        return RoutingSetResult(ok=False, errors=errors)

    config_file = ctx.state.paths.config_file
    changes = {
        key: value
        for key, value in {
            "routing": routing,
            "routing.ladder": ladder,
            "routing.roles": roles,
            "budget": budget,
            "context": context,
        }.items()
        if value
    }
    if "local_only" in routing and routing["local_only"] == []:
        # No folders is the default, so the key goes.
        changes["routing"] = {**routing, "local_only": None}
    try:
        await asyncio.to_thread(set_keys, config_file, changes)
    except RawConflictError as exc:
        return RoutingSetResult(ok=False, errors=[ConfigError(message=str(exc))])
    except ValueError as exc:
        return RoutingSetResult(ok=False, errors=[ConfigError(message=str(exc))])
    except OSError as exc:
        raise RpcCallError(INTERNAL_ERROR, f"could not write {config_file}: {exc}") from exc
    log.info("routing settings saved tables=%s", sorted(changes))
    if budget and ctx.state.sessions is not None:
        # A raised cap frees the helpers it held back.
        await ctx.state.sessions.release_budget_held()
    return RoutingSetResult(ok=True, values=await _values(ctx))
