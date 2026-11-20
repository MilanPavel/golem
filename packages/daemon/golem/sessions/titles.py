"""Short session titles, chosen once after the first completed run.

The model is asked outside the graph, so the question and its answer never
enter the checkpoint. When it fails or takes too long, the title is the first
line the user wrote.

The model is the one ``[routing.roles] titles`` picks (see ``golem.models.roles``).
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable, Mapping
from typing import Protocol, cast

from langchain_core.messages import HumanMessage, SystemMessage

from golem.config import ModelPrice
from golem.models.cost import cost_usd
from golem.models.dispatcher import Dispatcher, job_slot
from golem.models.errors import BUDGET_HINT, BudgetSpent
from golem.models.roles import for_role
from golem.models.router import ModelConfigError, ModelRouter
from golem.models.tiers import Tier
from golem.sessions.usage import Usage
from golem_protocol.events import TokenUsage

log = logging.getLogger("golem.sessions")

TITLE_MAX_CHARS = 60
TITLE_TIMEOUT_SECONDS = 20.0

_INSTRUCTION = (
    "Name this conversation in at most six words. Reply with the name only:"
    " no quotes, no trailing punctuation."
)
_REPLY_CHARS = 2_000
TITLE_NUM_PREDICT = 64


class TitleGenerator(Protocol):
    """Proposes a title for a session from its first exchange."""

    async def title(
        self,
        model_profile: str,
        prompt: str,
        reply: str,
        options: Mapping[str, float | str] | None = None,
        session_id: str | None = None,
        local_only: bool = False,
    ) -> str: ...


class ModelTitles:
    """Asks the model of the role ``titles``.

    That is the session's model on a local session, called with the session's own options
    so Ollama does not reload it. On a hosted session it is a ready budget model, when
    there is one. ``tier_of_ref`` and ``budget_refs`` read what discovery has cached, with
    no network call; until they are set, the session's model is used.

    Once :meth:`record_to` has been called, each answer is written to the usage table as a
    ``titles`` call of the session, under the model that wrote it.
    """

    def __init__(self, router: ModelRouter, dispatcher: Dispatcher | None = None) -> None:
        self._router = router
        self._dispatcher = dispatcher
        self._tier_of_ref: Callable[[str], Tier | None] = lambda ref: None
        self._budget_refs: Callable[[], list[str]] = list
        self._usage: Usage | None = None
        self._price_of: Callable[[str], ModelPrice | None] | None = None
        self._tier_of: Callable[[str], Tier | None] | None = None
        self._paid_ok: Callable[[str | None], Awaitable[bool]] | None = None

    def use(self, dispatcher: Dispatcher) -> None:
        """Take a slot of ``dispatcher`` before each local title call."""
        self._dispatcher = dispatcher

    def limit(self, paid_ok: Callable[[str | None], Awaitable[bool]]) -> None:
        """Skip a paid title when ``paid_ok`` says a cap in ``[budget]`` is spent."""
        self._paid_ok = paid_ok

    def bind(
        self, tier_of_ref: Callable[[str], Tier | None], budget_refs: Callable[[], list[str]]
    ) -> None:
        """Use the cached listing to tell tiers and find ready budget models."""
        self._tier_of_ref = tier_of_ref
        self._budget_refs = budget_refs

    def record_to(
        self,
        usage: Usage,
        price_of: Callable[[str], ModelPrice | None],
        tier_of: Callable[[str], Tier | None],
    ) -> None:
        """Write each title call to ``usage``, priced and filed by the profile's model."""
        self._usage = usage
        self._price_of = price_of
        self._tier_of = tier_of

    def _tier_of_profile(self, profile: str) -> Tier | None:
        try:
            return self._tier_of_ref(self._router.resolve(profile).ref)
        except ModelConfigError:
            return None

    async def title(
        self,
        model_profile: str,
        prompt: str,
        reply: str,
        options: Mapping[str, float | str] | None = None,
        session_id: str | None = None,
        local_only: bool = False,
    ) -> str:
        role = for_role(
            "titles",
            session_profile=model_profile,
            settings=self._router.roles(),
            tier_of_profile=self._tier_of_profile,
            budget_models=self._budget_refs(),
            local_only=local_only,
        )
        ask = self._paid_ok
        paid = self._tier_of_profile(role.profile) not in (None, "local")
        if ask is not None and paid and not await ask(session_id):
            raise BudgetSpent("a budget cap is spent, so there is no paid title", hint=BUDGET_HINT)
        overrides: dict[str, float | str] = dict(options or {}) if role.same_as_session else {}
        server = self._router.ollama_server(role.profile)
        if server is not None:
            # A title is six words. num_predict does not reload the model; num_ctx does.
            overrides["num_predict"] = TITLE_NUM_PREDICT
            model_id = self._router.resolve(role.profile).model_id
            if "off" in (self._router.think_values(model_id) or ()):
                overrides["think"] = "off"
        model = self._router.chat_model(role.profile, overrides, local_only=local_only)
        # A title waits behind the chat on the local line of the model it runs on.
        line = self._router.local_line(role.profile)
        try:
            async with job_slot(self._dispatcher, line, session_id, "a title job"):
                answer = await model.ainvoke(
                    [
                        SystemMessage(content=_INSTRUCTION),
                        HumanMessage(
                            content=f"User: {prompt}\n\nAssistant: {reply[:_REPLY_CHARS]}"
                        ),
                    ]
                )
        except Exception:
            await self._record(session_id, role.profile, None, failed=True)
            raise
        await self._record(session_id, role.profile, answer.usage_metadata)
        return answer.text

    async def _record(
        self, session_id: str | None, profile: str, metadata: object, *, failed: bool = False
    ) -> None:
        if self._usage is None:
            return
        try:
            identity = self._router.identity(profile)
            usage = token_usage(metadata)
            price = None if self._price_of is None else self._price_of(profile)
            tier = None if self._tier_of is None else self._tier_of(profile)
            await self._usage.record_role_call(
                session_id=session_id,
                role="titles",
                provider=identity.provider,
                model=identity.name,
                tier=tier,
                usage=usage,
                cost_usd=None if usage is None else cost_usd(usage.model_dump(), price),
                failed=failed,
            )
        except Exception:
            log.warning("recording the title call failed", exc_info=True)


def token_usage(metadata: object) -> TokenUsage | None:
    """The tokens of a langchain ``usage_metadata``, or None when there is none."""
    if not isinstance(metadata, dict):
        return None
    meta = cast(dict[str, object], metadata)
    details = meta.get("input_token_details")
    cached = cast(dict[str, object], details) if isinstance(details, dict) else {}
    return TokenUsage(
        input=_count(meta.get("input_tokens")),
        output=_count(meta.get("output_tokens")),
        cache_read=_count(cached.get("cache_read")),
        cache_write=_count(cached.get("cache_creation")),
    )


def _count(value: object) -> int | None:
    return value if isinstance(value, int) and value >= 0 else None


async def choose_title(
    generator: TitleGenerator,
    *,
    model_profile: str,
    prompt: str,
    reply: str,
    options: Mapping[str, float | str] | None = None,
    session_id: str | None = None,
    timeout: float = TITLE_TIMEOUT_SECONDS,
    local_only: bool = False,
) -> str:
    """A clean title from ``generator``, or from ``prompt`` when that fails.

    With ``local_only`` the title is written by a local model, and a hosted one is never asked:
    the first line of the prompt is the title instead.
    """
    try:
        async with asyncio.timeout(timeout):
            proposed = await generator.title(
                model_profile, prompt, reply, options, session_id, local_only
            )
    except Exception:
        log.warning("title generation failed; using the first line", exc_info=True)
        proposed = ""
    return clean_title(proposed) or clean_title(prompt) or "untitled"


_FORK_SUFFIX = " (fork)"


def fork_title(title: str) -> str:
    """``title (fork)``, with ``title`` cut so the whole fits in 60 characters."""
    room = TITLE_MAX_CHARS - len(_FORK_SUFFIX)
    base = title if len(title) <= room else title[: room - 1].rstrip() + "…"
    return base + _FORK_SUFFIX


def clean_title(text: str) -> str:
    """The first non-blank line, unquoted, one space between words, at most 60 chars.

    Returns ``""`` when nothing is left.
    """
    line = next((line for line in text.splitlines() if line.strip()), "")
    words = " ".join(line.split()).strip("\"'`*#").strip()
    words = words.removeprefix("Title:").strip().rstrip(".")
    if len(words) <= TITLE_MAX_CHARS:
        return words
    return words[: TITLE_MAX_CHARS - 1].rstrip() + "…"


def first_words(text: str, limit: int = TITLE_MAX_CHARS) -> str:
    """The first line of ``text`` cut after a whole word, at most ``limit`` characters, one line.

    A cut ends with ``…``. Returns ``""`` when nothing is left.
    """
    line = next((line for line in text.splitlines() if line.strip()), "")
    words = " ".join(line.split()).strip("\"'`*#").strip()
    if len(words) <= limit:
        return words
    cut = words[: limit - 1]
    # Cut at the last space when the cut is inside a word and a word is left before it.
    if words[limit - 1] != " " and " " in cut:
        cut = cut.rsplit(" ", 1)[0]
    return cut.rstrip() + "…"


def provisional_title(message: str) -> str:
    """The title until the generated one arrives: the first words of the first message."""
    return first_words(message)


def helper_title(agent: str, label: str, brief: str) -> str:
    """``<agent> · <label>``, or ``<agent> · <first words of the brief>``, at most 60 characters."""
    head = f"{agent} · "
    room = max(TITLE_MAX_CHARS - len(head), 1)
    rest = first_words(label, room) or first_words(brief, room)
    return head.rstrip(" ·") if rest == "" else head + rest


__all__ = [
    "TITLE_MAX_CHARS",
    "ModelTitles",
    "TitleGenerator",
    "choose_title",
    "clean_title",
    "first_words",
    "fork_title",
    "helper_title",
    "provisional_title",
]
