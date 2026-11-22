"""``chat.get``, ``chat.set`` and ``chat.prompt``: the ``[chat]`` defaults for new chats.

A write checks the values first, so a wrong line comes back as an error that names it and
nothing is written. The file keeps its comments.
"""

from __future__ import annotations

import asyncio
import logging

from golem.config import check_instructions, load_settings
from golem.config_edit import RawConflictError, set_keys
from golem.server.dispatcher import (
    INTERNAL_ERROR,
    INVALID_PARAMS,
    RequestContext,
    RpcCallError,
)
from golem.tokens import CHARS_PER_TOKEN
from golem_protocol.commands import (
    ChatGetParams,
    ChatPromptParams,
    ChatPromptPart,
    ChatPromptResult,
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


def _tokens(chars: int) -> int:
    return -(-chars // CHARS_PER_TOKEN)


async def chat_prompt(ctx: RequestContext, params: ChatPromptParams) -> ChatPromptResult:
    """What the model of a new chat reads now. Nothing is written and no model is called."""
    lines: list[str] | None = None
    if params.instructions is not None:
        try:
            lines = check_instructions(params.instructions)
        except ValueError as exc:
            raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    sessions = ctx.state.sessions
    if sessions is None:
        raise RpcCallError(INTERNAL_ERROR, "sessions are not ready")
    built = await sessions.new_chat_prompt(lines)
    parts = [
        ChatPromptPart(name=name, text=text, tokens=_tokens(len(text)))
        for name, text in built.parts
    ]
    tools = _tokens(built.tools_chars)
    return ChatPromptResult(
        model=built.model,
        parts=parts,
        tools_tokens=tools,
        total_tokens=sum(part.tokens for part in parts) + tools,
    )
