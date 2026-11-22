"""``chat.get`` and ``chat.set``: the ``[chat]`` defaults for new chats, for the web.

A write checks the values first, so a wrong line comes back as an error that names it and
nothing is written. The file keeps its comments.
"""

from __future__ import annotations

import asyncio
import logging

from golem.config import check_instructions, load_settings
from golem.config_edit import RawConflictError, set_keys
from golem.server.dispatcher import INTERNAL_ERROR, RequestContext, RpcCallError
from golem_protocol.commands import (
    ChatGetParams,
    ChatSetParams,
    ChatSetResult,
    ChatValues,
    ConfigError,
)

log = logging.getLogger(__name__)


async def _values(ctx: RequestContext) -> ChatValues:
    paths = ctx.state.paths
    settings = await asyncio.to_thread(load_settings, home=paths.home, project_dir=paths.home)
    return ChatValues(
        instructions=list(settings.chat.instructions),
        plan_first=settings.chat.plan_first,
        mode=settings.permissions.mode,
    )


async def chat_get(ctx: RequestContext, _params: ChatGetParams) -> ChatValues:
    return await _values(ctx)


async def chat_set(ctx: RequestContext, params: ChatSetParams) -> ChatSetResult:
    patch: dict[str, object] = params.model_dump(exclude_none=True)
    if params.instructions is not None:
        try:
            patch["instructions"] = check_instructions(params.instructions)
        except ValueError as exc:
            return ChatSetResult(
                ok=False, errors=[ConfigError(path="chat.instructions", message=str(exc))]
            )
    config_file = ctx.state.paths.config_file
    try:
        if patch:
            await asyncio.to_thread(set_keys, config_file, {"chat": patch})
    except (RawConflictError, ValueError) as exc:
        return ChatSetResult(ok=False, errors=[ConfigError(message=str(exc))])
    except OSError as exc:
        raise RpcCallError(INTERNAL_ERROR, f"could not write {config_file}: {exc}") from exc
    log.info("chat settings saved keys=%s", sorted(patch))
    return ChatSetResult(ok=True, values=await _values(ctx))
