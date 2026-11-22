"""``ollama.settings.get`` and ``ollama.settings.set``: the ``[ollama]`` settings for the web.

A write checks the values with the settings model first, so a wrong value comes back as a
field error and nothing is written. ``[ollama.models]`` is never touched. The file keeps its
comments. After a write the running daemon gets the new table at once: the server manager
reads ``start`` and ``idle_stop_minutes`` on its next use, and a server golem started
restarts between calls for a new ``parallel``.
"""

from __future__ import annotations

import asyncio
import logging

from pydantic import ValidationError

from golem.config import OllamaSettings, load_settings
from golem.config_edit import RawConflictError, set_keys
from golem.server.dispatcher import INTERNAL_ERROR, RequestContext, RpcCallError
from golem_protocol.commands import (
    ConfigError,
    OllamaSettingsGetParams,
    OllamaSettingsSetParams,
    OllamaSettingsSetResult,
    OllamaSettingsValues,
)

log = logging.getLogger(__name__)

_KEYS = {"start", "idle_stop_minutes", "parallel"}


async def _values(ctx: RequestContext) -> OllamaSettingsValues:
    paths = ctx.state.paths
    settings = await asyncio.to_thread(load_settings, home=paths.home, project_dir=paths.home)
    ollama = settings.ollama
    local = ctx.state.local_servers
    statuses = [] if local is None else local.statuses()
    return OllamaSettingsValues(
        start=ollama.start,
        idle_stop_minutes=ollama.idle_stop_minutes,
        parallel=ollama.parallel,
        started_by_golem=any(status.owner == "golem" for status in statuses),
        running=bool(statuses),
    )


async def ollama_settings_get(
    ctx: RequestContext, _params: OllamaSettingsGetParams
) -> OllamaSettingsValues:
    return await _values(ctx)


async def ollama_settings_set(
    ctx: RequestContext, params: OllamaSettingsSetParams
) -> OllamaSettingsSetResult:
    patch = params.model_dump(exclude_none=True)
    current = (await _values(ctx)).model_dump(include=_KEYS)
    try:
        OllamaSettings.model_validate({**current, **patch})
    except ValidationError as exc:
        return OllamaSettingsSetResult(
            ok=False,
            errors=[
                ConfigError(
                    path=f"ollama.{'.'.join(str(part) for part in error['loc'])}",
                    message=error["msg"],
                )
                for error in exc.errors()
            ],
        )
    config_file = ctx.state.paths.config_file
    try:
        if patch:
            await asyncio.to_thread(set_keys, config_file, {"ollama": patch})
    except (RawConflictError, ValueError) as exc:
        return OllamaSettingsSetResult(ok=False, errors=[ConfigError(message=str(exc))])
    except OSError as exc:
        raise RpcCallError(INTERNAL_ERROR, f"could not write {config_file}: {exc}") from exc
    ctx.state.apply_ollama()
    log.info("ollama settings saved keys=%s", sorted(patch))
    return OllamaSettingsSetResult(ok=True, values=await _values(ctx))
