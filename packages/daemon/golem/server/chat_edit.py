"""``chat.get``, ``chat.set``, ``chat.prompt`` and ``chat.draft``: the ``[chat]`` defaults.

A write checks the values first, so a wrong line comes back as an error that names it and
nothing is written. The file keeps its comments.
"""

from __future__ import annotations

import asyncio
import logging

from golem.config import check_instructions, load_settings
from golem.config_edit import RawConflictError, set_keys
from golem.models.errors import BudgetSpent, ModelUnreachable
from golem.models.router import ModelConfigError
from golem.server.dispatcher import (
    BUDGET_SPENT,
    INTERNAL_ERROR,
    INVALID_PARAMS,
    MODEL_NOT_CONFIGURED,
    RequestContext,
    RpcCallError,
)
from golem.sessions.drafts import UNUSABLE, DraftUnusable
from golem.tokens import CHARS_PER_TOKEN
from golem_protocol.commands import (
    ChatDraftParams,
    ChatDraftResult,
    ChatGetParams,
    ChatPromptParams,
    ChatPromptPart,
    ChatPromptResult,
    ChatSetParams,
    ChatSetResult,
    ChatSuggestionDismissParams,
    ChatSuggestionDismissResult,
    ChatSuggestionsParams,
    ChatSuggestionsResult,
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


async def chat_draft(ctx: RequestContext, params: ChatDraftParams) -> ChatDraftResult:
    drafts = ctx.state.drafts
    if drafts is None:
        raise RpcCallError(INTERNAL_ERROR, "the daemon is not ready to draft lines yet")
    description = params.description.strip()
    if not description:
        raise RpcCallError(INVALID_PARAMS, UNUSABLE)
    try:
        lines, model = await drafts.draft(description)
    except BudgetSpent as exc:
        raise RpcCallError(BUDGET_SPENT, f"{exc}; {exc.hint}") from exc
    except ModelConfigError as exc:
        raise RpcCallError(MODEL_NOT_CONFIGURED, str(exc)) from exc
    except ModelUnreachable as exc:
        raise RpcCallError(INTERNAL_ERROR, f"{exc}; {exc.hint}") from exc
    except DraftUnusable as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    return ChatDraftResult(lines=lines, model=model)


async def chat_suggestions(
    ctx: RequestContext, _params: ChatSuggestionsParams
) -> ChatSuggestionsResult:
    """What is kept. A kept result older than a day starts the job; the answer never waits."""
    suggestions = ctx.state.suggestions
    if suggestions is None:
        raise RpcCallError(INTERNAL_ERROR, "the daemon is not ready to suggest lines yet")
    return await suggestions.get()


async def chat_suggestion_dismiss(
    ctx: RequestContext, params: ChatSuggestionDismissParams
) -> ChatSuggestionDismissResult:
    suggestions = ctx.state.suggestions
    if suggestions is None:
        raise RpcCallError(INTERNAL_ERROR, "the daemon is not ready to suggest lines yet")
    line = params.line.strip()
    if not line:
        raise RpcCallError(INVALID_PARAMS, "there is no line to dismiss")
    await suggestions.dismiss(line)
    return ChatSuggestionDismissResult(ok=True)
