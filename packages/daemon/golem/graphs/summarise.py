"""Summarise old turns of a chat, so a long session goes on in a small window.

:func:`summarise` turns messages into one text and knows nothing of the graph.
:class:`Summariser` picks the model of the role ``summarise``, waits its turn on a
local server, and writes the call to the usage table. The chat graph calls
``Summariser.make``, and a manual compaction can call it too.

The summary keeps the task and its state. It does not retell the chat.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Awaitable, Callable, Mapping, Sequence
from contextvars import ContextVar

from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)
from langchain_core.outputs import ChatGeneration, LLMResult
from langchain_core.tracers.context import register_configure_hook
from pydantic import BaseModel

from golem.config import ModelPrice
from golem.graphs.adapter import message_text
from golem.models.cost import cost_usd
from golem.models.errors import BUDGET_HINT, BudgetSpent
from golem.models.gate import ServerGate
from golem.models.roles import RoleModel, for_role
from golem.models.router import ModelRouter
from golem.models.structured import StructuredError, structured
from golem.models.tiers import Tier
from golem.sessions.titles import token_usage
from golem.sessions.usage import Usage

log = logging.getLogger("golem.graphs")

RESULT_CHARS = 1_500
ARGS_CHARS = 300
CHARS_PER_TOKEN_SAFE = 3
DEFAULT_ROOM = 16_000
ANSWER_TOKENS = 2_000
MIN_INPUT_CHARS = 3_000

_INSTRUCTION = (
    "You summarise the start of a work session between a user and an assistant that uses tools."
    " Someone must continue the work from your summary alone, so keep the task and its state."
    " Do not retell the chat. Keep what shows whether the work is done or not."
    " Use the user's own words for the request where you can. Keep exact paths, names,"
    " numbers and decisions. Leave out anything that is no longer needed."
)
_PLAIN_INSTRUCTION = (
    "Summarise for someone who must continue this work. Say what the user asked for, what was"
    " done and decided, which files matter, what was learned that later steps need, and what is"
    " still open. Keep exact paths and names. Do not retell the chat."
)


class Summary(BaseModel):
    request: str
    """What the user asked for, in their words where possible."""
    done: list[str]
    """What was done and decided, one line each."""
    files: list[str]
    """Paths read or changed that still matter."""
    facts: list[str]
    """Things learned that later steps need."""
    open: list[str]
    """What is still to do or unanswered."""


def render_summary(summary: Summary) -> str:
    """The summary as plain text with five headings."""

    def block(title: str, lines: Sequence[str]) -> str:
        body = "\n".join(f"- {line}" for line in lines if line.strip()) or "- none"
        return f"{title}:\n{body}"

    return "\n\n".join(
        [
            f"Request:\n{summary.request.strip() or 'unknown'}",
            block("Done", summary.done),
            block("Files", summary.files),
            block("Facts", summary.facts),
            block("Open", summary.open),
        ]
    )


def render(messages: Sequence[BaseMessage]) -> list[str]:
    """One text per message: ``User:``, ``Assistant:``, ``Tool <name>:`` and ``→ name(args)``."""
    lines: list[str] = []
    for message in messages:
        text = message_text(message).strip()
        if isinstance(message, HumanMessage):
            lines.append(f"User: {text}")
        elif isinstance(message, AIMessage):
            parts = [f"Assistant: {text}"] if text else []
            for call in message.tool_calls:
                args = json.dumps(call["args"], ensure_ascii=False, default=str)
                if len(args) > ARGS_CHARS:
                    args = args[:ARGS_CHARS] + "..."
                parts.append(f"→ {call['name']}({args})")
            if parts:
                lines.append("\n".join(parts))
        elif isinstance(message, ToolMessage):
            if len(text) > RESULT_CHARS:
                text = text[:RESULT_CHARS] + f"... [{len(text) - RESULT_CHARS} more characters]"
            lines.append(f"Tool {message.name or 'tool'}: {text}")
    return lines


def _chunks(lines: Sequence[str], limit: int) -> list[str]:
    """``lines`` joined in groups of at most ``limit`` characters. A longer line is cut."""
    groups: list[str] = []
    current: list[str] = []
    size = 0
    for line in lines:
        if len(line) > limit:
            line = line[:limit]
        if current and size + len(line) + 2 > limit:
            groups.append("\n\n".join(current))
            current, size = [], 0
        current.append(line)
        size += len(line) + 2
    if current:
        groups.append("\n\n".join(current))
    return groups


def _with_focus(instruction: str, focus: str | None) -> str:
    """``instruction``, and when ``focus`` is given, what the summary must keep."""
    if focus is None or not focus.strip():
        return instruction
    return f"{instruction} Keep especially: {focus.strip()}"


async def _one(
    model: BaseChatModel, text: str, earlier: str | None, focus: str | None = None
) -> str:
    body = text if not earlier else f"Earlier summary:\n{earlier}\n\nNew messages:\n{text}"
    try:
        found = await structured(
            model,
            Summary,
            [
                SystemMessage(content=_with_focus(_INSTRUCTION, focus)),
                HumanMessage(content=body),
            ],
        )
        return render_summary(found)
    except StructuredError:
        log.info("the summary did not come as structured output; asking for plain text")
    reply = await model.ainvoke(
        [
            SystemMessage(content=_with_focus(_PLAIN_INSTRUCTION, focus)),
            HumanMessage(content=body),
        ]
    )
    answer = reply.text.strip()
    if not answer:
        raise ValueError("the model wrote an empty summary")
    return answer


async def summarise(
    model: BaseChatModel,
    messages: Sequence[BaseMessage],
    earlier: str | None,
    *,
    room: int | None = None,
    focus: str | None = None,
) -> str:
    """A summary of ``messages`` as text.

    ``earlier`` is a summary that came before them. It goes first, marked as earlier, so the
    new summary builds on it. ``room`` is the tokens the model takes in a call; with
    messages that do not fit, each chunk is summarised and then the summaries are summarised.
    That is two levels at most. ``focus`` is added to the instruction as what to keep
    especially. The model gets no tools. Raises when the model fails.
    """
    tokens = (room or DEFAULT_ROOM) - ANSWER_TOKENS
    limit = max(
        MIN_INPUT_CHARS, tokens * CHARS_PER_TOKEN_SAFE - len(earlier or "") - len(_INSTRUCTION)
    )
    chunks = _chunks(render(messages), limit)
    if not chunks:
        raise ValueError("nothing to summarise")
    if len(chunks) == 1:
        return await _one(model, chunks[0], earlier, focus)
    parts = [await _one(model, c, earlier if i == 0 else None, focus) for i, c in enumerate(chunks)]
    joined = "\n\n".join(f"Part {i + 1} of {len(parts)}:\n{p}" for i, p in enumerate(parts))
    return await _one(model, joined[:limit], None, focus)


class Summariser:
    """Makes summaries with the model of the role ``summarise``.

    That is the session's model when it is local (so Ollama does not load a second one),
    else a ready budget model when there is one. A local call waits behind the chat. Each
    call is written to ``usage`` as a ``summarise`` call of the session.
    """

    def __init__(
        self,
        router: ModelRouter,
        *,
        gate: ServerGate | None = None,
        usage: Usage | None = None,
        price_of: Callable[[str], ModelPrice | None] | None = None,
        tier_of: Callable[[str], Tier | None] | None = None,
        budget_refs: Callable[[], list[str]] | None = None,
        window_of: Callable[[str, Mapping[str, float | str]], int | None] | None = None,
        paid_ok: Callable[[str | None], Awaitable[bool]] | None = None,
    ) -> None:
        self._router = router
        self._gate = gate
        self._usage = usage
        self._price_of = price_of
        self._tier_of = tier_of
        self._budget_refs = budget_refs
        self._window_of = window_of
        self._paid_ok = paid_ok

    def _role(self, session_profile: str) -> RoleModel:
        return for_role(
            "summarise",
            session_profile=session_profile,
            settings=self._router.roles(),
            tier_of_profile=self._tier_of or (lambda _profile: None),
            budget_models=self._budget_refs() if self._budget_refs else [],
        )

    def model_name(self, session_profile: str) -> str:
        """The name of the model that would write a summary for a session on this profile."""
        profile = self._role(session_profile).profile
        return self._router.identity(profile).name or profile

    async def make(
        self,
        *,
        session_id: str | None,
        session_profile: str,
        options: Mapping[str, float | str] | None,
        messages: Sequence[BaseMessage],
        earlier: str | None,
        focus: str | None = None,
    ) -> str:
        """The summary of ``messages``, built on ``earlier``. Raises when the call fails."""
        role = self._role(session_profile)
        paid = self._tier_of is not None and self._tier_of(role.profile) not in (None, "local")
        if paid and self._paid_ok is not None and not await self._paid_ok(session_id):
            raise BudgetSpent(
                "a budget cap is spent, so there is no paid summary", hint=BUDGET_HINT
            )
        overrides: dict[str, float | str] = dict(options or {}) if role.same_as_session else {}
        server = self._router.ollama_server(role.profile)
        if server is not None:
            model_id = self._router.resolve(role.profile).model_id
            if "off" in (self._router.think_values(model_id) or ()):
                overrides["think"] = "off"
        window = None if self._window_of is None else self._window_of(role.profile, overrides)
        reserve = self._router.context_settings().reply_reserve
        room = None if window is None else max(1, window - reserve)
        model = self._router.chat_model(role.profile, overrides)
        held = None if self._gate is None or server is None else server[1]
        gate = self._gate or ServerGate()
        try:
            seen = _Tokens()
            at = _COUNTING.set(seen)
            try:
                async with gate.hold(held, "job"):
                    text = await summarise(model, messages, earlier, room=room, focus=focus)
            finally:
                _COUNTING.reset(at)
        except Exception:
            await self._record(session_id, role.profile, None, failed=True)
            raise
        await self._record(session_id, role.profile, seen.total)
        return text

    async def _record(
        self,
        session_id: str | None,
        profile: str,
        seen: Mapping[str, object] | None,
        *,
        failed: bool = False,
    ) -> None:
        if self._usage is None:
            return
        try:
            usage = token_usage(seen)
            identity = self._router.identity(profile)
            price = None if self._price_of is None else self._price_of(profile)
            tier = None if self._tier_of is None else self._tier_of(profile)
            await self._usage.record_role_call(
                session_id=session_id,
                role="summarise",
                provider=identity.provider,
                model=identity.name,
                tier=tier,
                usage=usage,
                cost_usd=None if usage is None else cost_usd(usage.model_dump(), price),
                failed=failed,
            )
        except Exception:
            log.warning("recording the summary call failed", exc_info=True)


class _Tokens(BaseCallbackHandler):
    """Adds up the token counts of every reply a model gives, whatever the model is called."""

    def __init__(self) -> None:
        self.input = 0
        self.output = 0
        self.cache_read = 0
        self.cache_creation = 0
        self.counted = False

    def on_llm_end(self, response: LLMResult, **kwargs: object) -> None:
        del kwargs
        for generations in response.generations:
            for generation in generations:
                message = generation.message if isinstance(generation, ChatGeneration) else None
                meta = message.usage_metadata if isinstance(message, AIMessage) else None
                if not meta:
                    continue
                self.counted = True
                self.input += meta.get("input_tokens", 0)
                self.output += meta.get("output_tokens", 0)
                details = meta.get("input_token_details") or {}
                self.cache_read += details.get("cache_read", 0)
                self.cache_creation += details.get("cache_creation", 0)

    @property
    def total(self) -> dict[str, object] | None:
        """A ``usage_metadata`` of the sum, or None when no reply had counts."""
        if not self.counted:
            return None
        return {
            "input_tokens": self.input,
            "output_tokens": self.output,
            "input_token_details": {
                "cache_read": self.cache_read,
                "cache_creation": self.cache_creation,
            },
        }


_COUNTING: ContextVar[_Tokens | None] = ContextVar("golem_summary_tokens", default=None)
register_configure_hook(_COUNTING, inheritable=True)
