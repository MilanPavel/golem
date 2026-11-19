"""``golem models check``: run the tool-calling cases against one model.

:func:`run_cases` asks a model each case of :mod:`golem.models.check_cases` and judges the
replies. No tool runs: a tool result, when a case needs one, is canned. :class:`CheckManager`
runs a check as a daemon task, sends ``model.check.progress`` after each case and
``model.check.done`` at the end (neither is stored), and leaves the result with the scoreboard
as a seed. A check writes nothing but that seed.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Literal

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolCall
from pydantic import BaseModel

from golem.config import ModelPrice
from golem.graphs.text_calls import recover, recover_json_tail, unwrapped
from golem.models.check_cases import (
    CASES,
    MAX_ROUNDS,
    SYSTEM,
    CheckCase,
    Reply,
)
from golem.models.cost import cost_usd
from golem.models.dispatcher import Dispatcher, job_slot
from golem.models.errors import ModelUnreachable, failure_of, provider_error
from golem.models.ollama import LocalServers
from golem.models.router import ModelConfigError, ModelRouter
from golem.models.scores import Scores
from golem.tools import default_registry
from golem.tools.registry import ToolRegistry, ToolScope
from golem_protocol.commands import ModelCheckCase, ModelCheckDone, ModelCheckProgress
from golem_protocol.rpc import ModelCheckDoneNotification, ModelCheckProgressNotification

log = logging.getLogger(__name__)

Broadcast = Callable[[BaseModel], None]
Outcome = Literal["pass", "fail", "recovered"]
Verdict = Literal["reliable", "usable", "not_recommended"]

CASE_TIMEOUT = 180.0
"""Seconds one case may take. The first call of a local model includes loading it."""


class CheckError(Exception):
    """The check cannot go on. The message says what to do."""


@dataclass(frozen=True, slots=True)
class CaseResult:
    id: str
    title: str
    outcome: Outcome
    ms: int
    detail: str | None = None


@dataclass(slots=True)
class Report:
    cases: list[CaseResult] = field(default_factory=list[CaseResult])
    input_tokens: int = 0
    output_tokens: int = 0

    @property
    def passed(self) -> int:
        return sum(case.outcome == "pass" for case in self.cases)

    @property
    def recovered(self) -> int:
        return sum(case.outcome == "recovered" for case in self.cases)

    @property
    def working(self) -> int:
        """Cases where the model's call was usable: a real call, or a text call golem read."""
        return self.passed + self.recovered


def verdict_of(working: int, total: int) -> Verdict | None:
    """``reliable`` from 9 of 10, ``usable`` from 7 of 10, else ``not_recommended``."""
    if total <= 0:
        return None
    share = working / total
    if share >= 0.9:
        return "reliable"
    return "usable" if share >= 0.7 else "not_recommended"


Invoke = Callable[[CheckCase, list[BaseMessage], list[dict[str, object]]], Awaitable[AIMessage]]
"""Asks the model one question. Raises :class:`CheckError` when it cannot take tools."""

OnCase = Callable[[int, int, CaseResult], None]


async def run_cases(
    invoke: Invoke,
    tools: ToolRegistry,
    cases: Sequence[CheckCase] = CASES,
    *,
    timeout: float = CASE_TIMEOUT,
    on_case: OnCase | None = None,
    clock: Callable[[], float] = time.monotonic,
) -> Report:
    """Run ``cases`` one by one. A case that takes longer than ``timeout`` seconds fails."""
    report = Report()
    for index, case in enumerate(cases, start=1):
        started = clock()
        try:
            outcome, detail = await asyncio.wait_for(
                _one(invoke, tools, case, report), timeout=timeout
            )
        except TimeoutError:
            outcome, detail = "fail", f"no answer in {timeout:g} s"
        result = CaseResult(
            case.id, case.title, outcome, max(0, round((clock() - started) * 1000)), detail
        )
        report.cases.append(result)
        if on_case is not None:
            on_case(index, len(cases), result)
    return report


async def _one(
    invoke: Invoke, tools: ToolRegistry, case: CheckCase, report: Report
) -> tuple[Outcome, str | None]:
    offered = tools if case.tools is None else tools.scoped(ToolScope(only=frozenset(case.tools)))
    schemas = offered.schemas()
    messages: list[BaseMessage] = [
        SystemMessage(content=SYSTEM),
        HumanMessage(content=case.prompt),
        *case.before,
    ]
    replies: list[Reply] = []
    for _ in range(MAX_ROUNDS):
        message = await invoke(case, list(messages), schemas)
        usage = message.usage_metadata
        if usage:
            report.input_tokens += usage.get("input_tokens", 0)
            report.output_tokens += usage.get("output_tokens", 0)
        reply = _reply_of(message, schemas)
        replies.append(reply)
        if "<function=" in reply.text:
            return "fail", "wrote a call as text that golem cannot read"
        more = case.follow(reply) if case.follow is not None else None
        if more is None:
            break
        messages += [AIMessage(content=message.text, tool_calls=list(reply.calls)), *more]
    problem = case.check(replies, offered)
    if problem is not None:
        return "fail", problem
    if any(reply.recovered for reply in replies):
        return "recovered", "written as text, recovered"
    return "pass", None


def _reply_of(message: AIMessage, schemas: list[dict[str, object]]) -> Reply:
    """What the chat graph would make of ``message``: the same reading of calls written as text."""
    text = message.text
    if message.tool_calls:
        calls: list[ToolCall] = []
        for call in message.tool_calls:
            inner = unwrapped(call["name"], call["args"], schemas)
            calls.append(call if inner is None else {**call, "args": inner})
        return Reply(text, tuple(calls))
    if "<function=" in text:
        found = recover(text, schemas)
        if found is not None:
            return Reply(found[0], tuple(found[1]), recovered=True)
        return Reply(text)
    tail = recover_json_tail(text, schemas)
    if tail is not None and tail != "unread":
        return Reply(tail[0], tuple(tail[1]), recovered=True)
    return Reply(text)


def _case_wire(result: CaseResult) -> ModelCheckCase:
    return ModelCheckCase(
        id=result.id,
        title=result.title,
        outcome=result.outcome,
        ms=result.ms,
        detail=result.detail,
    )


class CheckManager:
    """Starts checks and follows them. One check per model at a time."""

    def __init__(
        self,
        router: ModelRouter,
        scores: Scores,
        *,
        tools: ToolRegistry | None = None,
        broadcast: Broadcast | None = None,
        dispatcher: Dispatcher | None = None,
        local: LocalServers | None = None,
        learn_window: Callable[[str], Awaitable[None]] | None = None,
        price_of: Callable[[str], ModelPrice | None] | None = None,
        timeout: float = CASE_TIMEOUT,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._router = router
        self._scores = scores
        self._tools = tools or default_registry()
        self.broadcast: Broadcast = broadcast or (lambda _model: None)
        self._dispatcher = dispatcher
        self.local = local
        self._learn_window = learn_window
        self._price_of = price_of
        self._timeout = timeout
        self._clock = clock
        self._runs: dict[str, asyncio.Task[None]] = {}

    def checking(self) -> list[str]:
        return list(self._runs)

    async def aclose(self) -> None:
        tasks = list(self._runs.values())
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    def start(self, name: str) -> tuple[str, bool]:
        """Start a check. Returns ``(ref, started)``; ``started`` is false when one already runs.

        Raises :class:`CheckError` when ``name`` is no model golem knows.
        """
        profile = self._profile(name)
        ref = self._router.resolve(profile).ref
        if ref in self._runs:
            return ref, False
        task = asyncio.create_task(self._run(profile, ref), name=f"golem-check-{ref}")
        self._runs[ref] = task
        log.info("check started ref=%s", ref)
        return ref, True

    async def wait(self, ref: str) -> None:
        task = self._runs.get(ref)
        if task is not None:
            await asyncio.wait([task])

    def _profile(self, name: str) -> str:
        text = name.strip()
        try:
            self._router.resolve(text)
            return text
        except ModelConfigError as exc:
            if "/" in text:
                raise CheckError(str(exc)) from exc
        try:
            self._router.resolve(f"ollama/{text}")
        except ModelConfigError as exc:
            raise CheckError(str(exc)) from exc
        return f"ollama/{text}"

    async def _run(self, profile: str, ref: str) -> None:
        report = Report()
        error: str | None = None
        try:
            report = await self._check(profile, ref)
            await self._scores.seed(ref, report.working, len(report.cases))
        except asyncio.CancelledError:
            error = "cancelled"
        except CheckError as exc:
            error = str(exc)
        except Exception as exc:
            error = await self._error_text(profile, exc)
        finally:
            self._runs.pop(ref, None)
            self._send(ModelCheckDoneNotification(params=self._done(ref, profile, report, error)))
            log.info("check ended ref=%s error=%s", ref, error)

    async def _check(self, profile: str, ref: str) -> Report:
        if self._learn_window is not None:
            with contextlib.suppress(Exception):
                await self._learn_window(profile)
        server = None
        target = self._router.ollama_server(profile)
        if self.local is not None and target is not None:
            server = self.local.get(*target)

        async def invoke(
            case: CheckCase, messages: list[BaseMessage], schemas: list[dict[str, object]]
        ) -> AIMessage:
            return await self._ask(profile, case, messages, schemas)

        def progress(index: int, total: int, result: CaseResult) -> None:
            note = ModelCheckProgress(ref=ref, index=index, total=total, result=_case_wire(result))
            self._send(ModelCheckProgressNotification(params=note))

        line = self._router.local_line(profile)
        async with contextlib.AsyncExitStack() as stack:
            await stack.enter_async_context(job_slot(self._dispatcher, line, None, "a model check"))
            if server is not None:
                await stack.enter_async_context(server.hold())
            return await run_cases(
                invoke, self._tools, timeout=self._timeout, on_case=progress, clock=self._clock
            )

    async def _ask(
        self,
        profile: str,
        case: CheckCase,
        messages: list[BaseMessage],
        schemas: list[dict[str, object]],
    ) -> AIMessage:
        chat = self._chat(profile, case)
        try:
            bound = chat.bind_tools(schemas)
        except NotImplementedError as exc:
            raise CheckError(f"{profile} cannot be offered tools") from exc
        try:
            reply = await bound.ainvoke(messages)
        except Exception as exc:
            if "does not support tools" in str(exc).lower():
                raise CheckError(f"{profile} does not take tools") from exc
            raise
        return reply

    def _chat(self, profile: str, case: CheckCase) -> BaseChatModel:
        """The model with temperature 0, and the case's reply limit when it has one."""
        overrides: dict[str, float | str] = {"temperature": 0.0}
        if case.num_predict is not None:
            overrides["num_predict"] = case.num_predict
        chat = self._router.chat_model(profile, overrides)
        if self._router.ollama_server(profile) is None:
            # Hosted models take these as fields, not as Ollama options.
            _set(chat, "temperature", 0.0)
            if case.num_predict is not None:
                _set(chat, "max_tokens", case.num_predict)
        return chat

    async def _error_text(self, profile: str, exc: Exception) -> str:
        down = self._router.unreachable(profile, exc) or await self._router.refused(profile, exc)
        if down is not None:
            return f"{down.message}: {down.hint}"
        failure = failure_of(exc)
        if failure != "other":
            provider = self._router.identity(profile).provider or "the provider"
            error: ModelUnreachable = provider_error(provider, failure)
            return f"{error.message}: {error.hint}"
        return str(exc) or type(exc).__name__

    def _done(self, ref: str, profile: str, report: Report, error: str | None) -> ModelCheckDone:
        cost = None
        if error is None and self._price_of is not None:
            usage: Mapping[str, int | None] = {
                "input": report.input_tokens,
                "output": report.output_tokens,
            }
            cost = cost_usd(usage, self._price_of(profile))
        total = len(report.cases)
        return ModelCheckDone(
            ref=ref,
            ok=error is None,
            error=error,
            cases=[_case_wire(case) for case in report.cases],
            passed=report.passed,
            recovered=report.recovered,
            total=total,
            verdict=verdict_of(report.working, total) if error is None else None,
            cost_usd=cost,
        )

    def _send(self, notification: BaseModel) -> None:
        try:
            self.broadcast(notification)
        except Exception:
            log.debug("broadcast failed", exc_info=True)


def _set(chat: BaseChatModel, name: str, value: float) -> None:
    if name in type(chat).model_fields:
        with contextlib.suppress(Exception):
            setattr(chat, name, value if name == "temperature" else int(value))


__all__ = [
    "CASE_TIMEOUT",
    "CaseResult",
    "CheckError",
    "CheckManager",
    "Report",
    "run_cases",
    "verdict_of",
]
