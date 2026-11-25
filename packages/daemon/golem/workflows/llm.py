"""One model call for ``run.llm`` (ADR-062, 3.8.1): no tools, one prompt, one answer.

``model=`` is a wish (``cheapest``, ``same``, ``stronger``, ``local`` ...), never a model name
(ADR-062 "No model names"). The folder of the run decides first: a local-only folder always gets a
local model, whatever the wish says. The call takes a dispatcher ``job`` slot, like a title.
"""

from __future__ import annotations

import json
import logging
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage

from golem.agents.model import WISHES
from golem.config import ModelPrice
from golem.models.cost import cost_usd
from golem.models.dispatcher import Dispatcher, job_slot
from golem.models.errors import BUDGET_HINT, BudgetSpent
from golem.models.roles import for_role
from golem.models.router import ModelRouter
from golem.models.tiers import Tier
from golem.sessions.titles import token_usage
from golem.sessions.usage import Usage
from golem.workflow import WorkflowError

__all__ = ["Llm", "LlmAnswer", "WorkflowLlm", "parse_object"]

log = logging.getLogger(__name__)

_SESSION_WISHES = ("same", "stronger", "frontier")
_FENCE = re.compile(r"^```[a-zA-Z]*\s*\n(.*?)\n```\s*$", re.DOTALL)


def _no_refs() -> list[str]:
    return []


def _no_tier(profile: str) -> Tier | None:
    return None


@dataclass(frozen=True, slots=True)
class LlmAnswer:
    """What one call gave: the text, the model that wrote it and what it cost (None: unpriced)."""

    text: str
    model: str
    cost_usd: float | None


Llm = Callable[[str, dict[str, Any] | None, str | None, str | None], Awaitable[LlmAnswer]]
"""``(prompt, json_schema, wish, folder) -> answer``. ``folder`` is the run's folder or None."""


class WorkflowLlm:
    """The ``Llm`` the daemon gives the engine."""

    def __init__(
        self,
        router: ModelRouter,
        dispatcher: Dispatcher | None,
        *,
        local_only: Callable[[str | None], bool],
        tier_of_profile: Callable[[str], Tier | None] = _no_tier,
        budget_refs: Callable[[], list[str]] = _no_refs,
        price_of: Callable[[str], ModelPrice | None] | None = None,
        paid_ok: Callable[[str | None], Awaitable[bool]] | None = None,
        usage: Usage | None = None,
    ) -> None:
        self._router = router
        self._dispatcher = dispatcher
        self._local_only = local_only
        self._tier_of_profile = tier_of_profile
        self._budget_refs = budget_refs
        self._price_of = price_of
        self._paid_ok = paid_ok
        self._usage = usage

    def _role(self, local_only: bool) -> str:
        return for_role(
            "summarise",
            session_profile=self._router.profile_name,
            settings=self._router.roles(),
            tier_of_profile=self._tier_of_profile,
            budget_models=self._budget_refs(),
            local_only=local_only,
        ).profile

    def profile_for(self, wish: str | None, local_only: bool) -> str:
        """The profile a wish gets. A local-only folder only ever gets a local one."""
        if wish is not None and wish not in WISHES:
            raise WorkflowError(
                f"run.llm model= is a wish, one of {', '.join(WISHES)}; got {wish!r}."
                " Workflow files do not name models"
            )
        if wish == "local":
            return self._role(True)
        if wish in _SESSION_WISHES and not local_only:
            return self._router.profile_name
        return self._role(local_only)

    async def __call__(
        self, prompt: str, schema: dict[str, Any] | None, wish: str | None, folder: str | None
    ) -> LlmAnswer:
        local_only = self._local_only(folder)
        profile = self.profile_for(wish, local_only)
        paid = self._tier_of_profile(profile) not in (None, "local")
        if self._paid_ok is not None and paid and not await self._paid_ok(None):
            raise BudgetSpent(
                "a budget cap is spent, so there is no paid model call", hint=BUDGET_HINT
            )
        model = self._router.chat_model(profile, local_only=local_only)
        line = self._router.local_line(profile)
        messages: list[SystemMessage | HumanMessage] = [HumanMessage(content=prompt)]
        if schema is not None:
            messages.insert(0, SystemMessage(content=_schema_instruction(schema)))
        try:
            async with job_slot(self._dispatcher, line, None, "a workflow model call"):
                answer = await model.ainvoke(messages)
        except Exception:
            await self._record(profile, None, None, failed=True)
            raise
        usage = token_usage(answer.usage_metadata)
        price = None if self._price_of is None else self._price_of(profile)
        cost = None if usage is None else cost_usd(usage.model_dump(), price)
        await self._record(profile, answer.usage_metadata, cost)
        identity = self._router.identity(profile)
        name = profile if identity.name is None else f"{identity.provider}/{identity.name}"
        return LlmAnswer(answer.text, name, cost)

    async def _record(
        self, profile: str, metadata: object, cost: float | None, *, failed: bool = False
    ) -> None:
        """Write the call to the usage table, so budget caps count workflow spend."""
        if self._usage is None:
            return
        try:
            identity = self._router.identity(profile)
            await self._usage.record_role_call(
                session_id=None,
                role="workflow",
                provider=identity.provider,
                model=identity.name,
                tier=self._tier_of_profile(profile),
                usage=token_usage(metadata),
                cost_usd=cost,
                failed=failed,
            )
        except Exception:
            log.warning("recording the workflow model call failed", exc_info=True)


def _schema_instruction(schema: dict[str, Any]) -> str:
    return (
        "Answer with one JSON object that follows this JSON schema, and nothing else: no"
        f" prose, no code fence.\n{json.dumps(schema)}"
    )


def parse_object(text: str) -> dict[str, Any]:
    """The JSON object in a model's answer. Raises :class:`WorkflowError` when there is none."""
    body = text.strip()
    fenced = _FENCE.match(body)
    if fenced:
        body = fenced.group(1).strip()
    value: object
    try:
        value = json.loads(body)
    except ValueError:
        start, end = body.find("{"), body.rfind("}")
        try:
            value = json.loads(body[start : end + 1]) if 0 <= start < end else None
        except ValueError:
            value = None
    if not isinstance(value, dict):
        raise WorkflowError("run.llm: the model did not answer with a JSON object")
    return value  # pyright: ignore[reportUnknownVariableType]
