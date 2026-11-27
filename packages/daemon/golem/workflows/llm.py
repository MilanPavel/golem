"""One model call for ``run.llm`` (ADR-062, 3.8.1): no tools, one prompt, one answer.

``model=`` is the name of a model the user has set up (ADR-062, amended by 3.13.7), or one of the
old wish words (``cheapest``, ``same``, ``stronger``, ``local`` ...), which work as they did.
Without one, golem's default model is used. A named model is never swapped: in a local-only folder
a hosted one stops the step and says why. A wish in such a folder still gets a local model. The
call takes a dispatcher ``job`` slot, like a title.
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
from golem.models.router import ModelConfigError, ModelRouter
from golem.models.tiers import Tier
from golem.sessions.titles import token_usage
from golem.sessions.usage import Usage
from golem.workflow import WorkflowError

__all__ = ["Llm", "LlmAnswer", "WorkflowLlm", "named_model_problem", "parse_object"]

log = logging.getLogger(__name__)

_SESSION_WISHES = ("same", "stronger", "frontier")
_FENCE = re.compile(r"^```[a-zA-Z]*\s*\n(.*?)\n```\s*$", re.DOTALL)


def not_set_up(name: str) -> str:
    """What a model step says when its model is not set up on this machine."""
    return (
        f"the model {name} is not set up on this machine. Set it up in Settings, or write the"
        " name of a model you have"
    )


def named_model_problem(router: ModelRouter, name: str, local_only: bool = False) -> str | None:
    """Why a step cannot use the model ``name``, or None when it can.

    The two reasons are the ones the guards already know: the model is not set up on this
    machine, and the folder stays on this Mac while the model is hosted."""
    try:
        router.resolve(name)
        if local_only:
            router.ensure_local(name)
    except ModelConfigError as exc:
        if exc.code == "local_only":
            return (
                f"this folder stays on this Mac, and {name} is a hosted model, so this step"
                " does not use it"
            )
        return not_set_up(name)
    return None


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
        """The profile a wish or a model name gets.

        ``None`` is golem's default model (a local one when the folder is local-only and the
        default is hosted: nothing was written, so nothing is refused). A name is used as it
        is, or the step stops: it is not set up, or the folder is local-only and it is hosted.
        A wish word in a local-only folder only ever gets a local model.
        """
        if wish is None:
            default = self._router.default
            if default is None:
                return self._role(local_only)
            if local_only:
                try:
                    self._router.ensure_local(default)
                except ModelConfigError:
                    return self._role(True)
            return default
        if wish not in WISHES:
            problem = named_model_problem(self._router, wish, local_only)
            if problem is not None:
                raise WorkflowError(problem)
            return wish
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
