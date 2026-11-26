"""Instruction lines drafted from a person's own words (``chat.draft``).

A small model job like a session title: the model of the role ``summarise``, the paid gate,
a slot on the local line, and each call written to the usage table. Nothing is saved.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Awaitable, Callable

from langchain_core.messages import HumanMessage, SystemMessage

from golem.config import ModelPrice
from golem.models.cost import cost_usd
from golem.models.dispatcher import Dispatcher, job_slot
from golem.models.errors import BUDGET_HINT, BudgetSpent
from golem.models.roles import for_role
from golem.models.router import ModelConfigError, ModelRouter
from golem.models.tiers import Tier
from golem.sessions.titles import token_usage
from golem.sessions.usage import Usage

log = logging.getLogger("golem.sessions")

MAX_LINES = 8
MAX_LINE_CHARS = 300
UNUSABLE = "golem couldn't draft lines from that. Try saying more about how you like answers."

_INSTRUCTION = (
    "A person describes how they like answers. Write 3 to 8 short lines they might write"
    " themselves about how they want answers: one rule per line, in plain words, with no"
    " numbering and no bullets. Say nothing about code unless the description is about code."
    " Name no language: the model answers in the user's language anyway. Reply with the"
    " lines only."
)

_MARKER = re.compile(r"^\s*(?:[-*•]+|\d+[.)])\s*")


class DraftUnusable(Exception):
    """The model's reply held no line to keep. The message is for the person."""

    def __init__(self, message: str = UNUSABLE) -> None:
        super().__init__(message)


class NoLocalModel(Exception):
    """A job that reads private text found no local model to run on."""


def parse_lines(reply: str) -> list[str]:
    """Lines of ``reply`` without bullets or numbers, no blanks, no repeats, at most 8 of 300."""
    lines: list[str] = []
    for raw in reply.splitlines():
        line = " ".join(_MARKER.sub("", raw).split())
        if len(line) > MAX_LINE_CHARS:
            line = line[:MAX_LINE_CHARS].rstrip()
        if line and line not in lines:
            lines.append(line)
    return lines[:MAX_LINES]


class ModelDrafts:
    """Asks the model of the role ``summarise``, with the default model as the session's."""

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
        self._dispatcher = dispatcher

    def limit(self, paid_ok: Callable[[str | None], Awaitable[bool]]) -> None:
        """Refuse a paid draft when ``paid_ok`` says a cap in ``[budget]`` is spent."""
        self._paid_ok = paid_ok

    def bind(
        self, tier_of_ref: Callable[[str], Tier | None], budget_refs: Callable[[], list[str]]
    ) -> None:
        self._tier_of_ref = tier_of_ref
        self._budget_refs = budget_refs

    def record_to(
        self,
        usage: Usage,
        price_of: Callable[[str], ModelPrice | None],
        tier_of: Callable[[str], Tier | None],
    ) -> None:
        self._usage = usage
        self._price_of = price_of
        self._tier_of = tier_of

    def _tier_of_profile(self, profile: str) -> Tier | None:
        try:
            return self._tier_of_ref(self._router.resolve(profile).ref)
        except ModelConfigError:
            return None

    async def draft(self, description: str) -> tuple[list[str], str]:
        """The lines and the name of the model that wrote them.

        Raises :class:`BudgetSpent` on a paid model with a cap spent, and
        :class:`DraftUnusable` when the reply holds no line.
        """
        reply, label = await self.ask(
            _INSTRUCTION, lambda _local: description, "an instruction draft"
        )
        lines = parse_lines(reply)
        if not lines:
            raise DraftUnusable
        return lines, label

    async def ask(
        self, instruction: str, build: Callable[[bool], str], what: str
    ) -> tuple[str, str]:
        """The reply of the ``summarise`` model and its name, for a job ``what`` the person asked.

        ``build`` gets True when that model is local and returns the text it reads, so the
        text can hold private rows only for a model that may see them. Raises
        :class:`BudgetSpent` on a paid model with a cap spent.
        """
        session_profile = self._router.profile_name
        role = for_role(
            "summarise",
            session_profile=session_profile,
            settings=self._router.roles(),
            tier_of_profile=self._tier_of_profile,
            budget_models=self._budget_refs(),
        )
        tier = self._tier_of_profile(role.profile)
        ask = self._paid_ok
        paid = tier not in (None, "local")
        if ask is not None and paid and not await ask(None):
            raise BudgetSpent("a budget cap is spent, so there is no paid draft", hint=BUDGET_HINT)
        model = self._router.chat_model(role.profile)
        line = self._router.local_line(role.profile)
        text = build(tier == "local")
        try:
            async with job_slot(self._dispatcher, line, None, what):
                answer = await model.ainvoke(
                    [SystemMessage(content=instruction), HumanMessage(content=text)]
                )
        except Exception:
            await self._record(role.profile, None, failed=True)
            raise
        await self._record(role.profile, answer.usage_metadata)
        identity = self._router.identity(role.profile)
        name = identity.name
        label = role.profile if name is None else f"{identity.provider}/{name}"
        return answer.text, label

    def local_profile(self) -> str | None:
        """The profile of the ``summarise`` role when it is a local model, else None."""
        role = for_role(
            "summarise",
            session_profile=self._router.profile_name,
            settings=self._router.roles(),
            tier_of_profile=self._tier_of_profile,
            budget_models=self._budget_refs(),
            local_only=True,
        )
        return None if role.reason == "no local model" else role.profile

    async def ask_local(self, instruction: str, text: str, label: str) -> str:
        """The reply of the ``summarise`` model, which must be local: ``text`` is private.

        Raises :class:`NoLocalModel` when there is none. A hosted model is never asked.
        """
        profile = self.local_profile()
        if profile is None:
            raise NoLocalModel
        model = self._router.chat_model(profile, local_only=True)
        line = self._router.local_line(profile)
        try:
            async with job_slot(self._dispatcher, line, None, label):
                answer = await model.ainvoke(
                    [SystemMessage(content=instruction), HumanMessage(content=text)]
                )
        except Exception:
            await self._record(profile, None, failed=True)
            raise
        await self._record(profile, answer.usage_metadata)
        return answer.text

    async def _record(self, profile: str, metadata: object, *, failed: bool = False) -> None:
        if self._usage is None:
            return
        try:
            identity = self._router.identity(profile)
            usage = token_usage(metadata)
            price = None if self._price_of is None else self._price_of(profile)
            tier = None if self._tier_of is None else self._tier_of(profile)
            await self._usage.record_role_call(
                session_id=None,
                role="summarise",
                provider=identity.provider,
                model=identity.name,
                tier=tier,
                usage=usage,
                cost_usd=None if usage is None else cost_usd(usage.model_dump(), price),
                failed=failed,
            )
        except Exception:
            log.warning("recording the draft call failed", exc_info=True)


__all__ = ["UNUSABLE", "DraftUnusable", "ModelDrafts", "NoLocalModel", "parse_lines"]
