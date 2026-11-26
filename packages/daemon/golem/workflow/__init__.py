"""The module a workflow file imports: ``from golem.workflow import workflow, Run, schedule``.

A workflow file is plain Python. ``@workflow`` only labels a function: it attaches a
frozen :class:`WorkflowSpec` as ``__golem_workflow__`` and returns the function unchanged.
The registry reads that label in a short-lived subprocess, so listing never runs the
workflow.
"""

from __future__ import annotations

import asyncio
import hashlib
from collections.abc import Awaitable, Callable, Iterable, Mapping
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any, Literal, Protocol, TypeVar

from golem.routines import parse_schedule

F = TypeVar("F", bound=Callable[..., Any])

SPEC_ATTR = "__golem_workflow__"


@dataclass(frozen=True, slots=True)
class Schedule:
    """Start on a schedule, in the format routines use (cron or ``weekly mon 06:00``)."""

    expr: str
    kind: Literal["schedule"] = "schedule"


@dataclass(frozen=True, slots=True)
class OnFile:
    """Start when the file or glob changes."""

    path: str
    kind: Literal["on_file"] = "on_file"


@dataclass(frozen=True, slots=True)
class Manual:
    """Start only when a person asks."""

    kind: Literal["manual"] = "manual"


Trigger = Schedule | OnFile | Manual


def schedule(expr: str) -> Schedule:
    """A schedule trigger. Raises ``ScheduleError`` for an expression that does not fire."""
    parse_schedule(expr)
    return Schedule(expr)


def on_file(path: str) -> OnFile:
    return OnFile(path)


def manual() -> Manual:
    return Manual()


OnRestart = Literal["resume", "fail", "ask"]
RESTART_POLICIES: tuple[str, ...] = ("resume", "fail", "ask")


@dataclass(frozen=True, slots=True)
class WorkflowSpec:
    name: str
    trigger: Trigger | None
    inputs: tuple[tuple[str, str], ...]
    """Input name and type name, in declared order."""
    description: str
    line: int
    """Line of the function in its file."""
    on_restart: OnRestart = "resume"
    """What the daemon does with a run it finds ``running`` after a restart."""


class WorkflowError(Exception):
    """A workflow broke a rule of the engine, for example it used a step key twice."""


class WorkflowWaiting(BaseException):
    """Raised by ``run.review`` when the run must stop and wait for a person.

    A ``BaseException``, so a workflow's own ``except Exception`` does not swallow it. The
    engine catches it, sets the run ``waiting`` and ends the task; nothing is held meanwhile.
    """


class StepBackend(Protocol):
    """What :class:`Run` needs from the engine. The engine implements it."""

    async def run_step(
        self,
        workflow_run_id: str,
        key: str,
        kind: str,
        title: str,
        group_key: str | None,
        fn: Callable[..., Any],
        args: tuple[Any, ...],
        kwargs: dict[str, Any],
        keyed: bool = False,
        retries: int = 0,
        backoff: float = 0.0,
    ) -> Any: ...

    async def notify(self, workflow_run_id: str, title: str | None, text: str) -> None:
        """Tell the person ``text`` (through the Notifier, when the engine has one)."""
        ...

    async def review(
        self,
        workflow_run_id: str,
        key: str,
        ask: str,
        group_key: str | None,
        draft: Any,
    ) -> Any: ...

    async def agent(
        self,
        workflow_run_id: str,
        key: str,
        agent_type: str,
        brief: str,
        model: str | None,
        group_key: str | None,
        position: int | None = None,
        gets: tuple[str, ...] = (),
        budget: float | None = None,
        worktree: str | None = None,
    ) -> dict[str, Any]:
        """Run an agent as a helper of the run's session (the ``agent`` step).

        ``group_key`` and ``position`` say which ``run.parallel`` group the agent is in and its
        place there: the agents of one group start as one batch.
        """
        ...

    async def skill(
        self, workflow_run_id: str, key: str, name: str, args: str, group_key: str | None
    ) -> dict[str, Any]:
        """Run a skill as a helper of the run's session (the ``skill`` step)."""
        ...

    async def llm(
        self,
        workflow_run_id: str,
        key: str,
        prompt: str,
        schema: dict[str, Any] | None,
        wish: str | None,
        check: Callable[[dict[str, Any]], dict[str, Any]] | None,
    ) -> Any:
        """One model call; saves the model and the cost on the step ``key``."""
        ...

    async def tool(
        self,
        workflow_run_id: str,
        key: str,
        name: str,
        args: dict[str, Any],
        group_key: str | None,
        keyed: bool,
    ) -> Any:
        """Call a golem or MCP tool through the permission engine (the ``tool`` step)."""
        ...


_group: ContextVar[str | None] = ContextVar("golem_workflow_group", default=None)
_position: ContextVar[int | None] = ContextVar("golem_workflow_position", default=None)
IDEMPOTENCY_KEY: ContextVar[str | None] = ContextVar("golem_workflow_key", default=None)
MAY_HAVE_RUN: ContextVar[bool] = ContextVar("golem_workflow_may_have_run", default=False)


def idempotency_key() -> str | None:
    """The key of the step that is running, or None outside a step.

    Pass it to the receiver (an ``Idempotency-Key`` header, a branch name) so a second try
    after a crash does not repeat the action.
    """
    return IDEMPOTENCY_KEY.get()


def may_have_run() -> bool:
    """True when this is a second try of a keyed step that was running when golem stopped."""
    return MAY_HAVE_RUN.get()


class Run:
    """The handle a workflow function receives.

    A workflow is run again from the top after a restart. ``run.step`` returns the saved
    result of a step that finished, so its function is not called twice.
    """

    def __init__(
        self, backend: StepBackend, workflow_run_id: str, inputs: Mapping[str, Any] | None = None
    ) -> None:
        self._backend = backend
        self.workflow_run_id = workflow_run_id
        self.inputs: dict[str, Any] = dict(inputs or {})
        self._keys: set[str] = set()
        self._groups = 0

    async def step(
        self,
        name: str,
        fn: Callable[..., Any],
        *args: Any,
        key: str | None = None,
        retries: int = 0,
        backoff: float = 0.0,
        **kwargs: Any,
    ) -> Any:
        """Run ``fn(*args, **kwargs)`` once and keep its JSON result under ``key or name``.

        Each key may be used once per run; inside a loop pass distinct names or keys.
        An explicit ``key=`` marks a step that changes something outside golem: if golem
        stops during it, the step is ``in_doubt`` and runs again with ``may_have_run()`` true.
        ``retries=N`` runs the function up to N more times after an exception, waiting
        ``backoff`` seconds before each.
        """
        step_key = key or name
        self._use_key(step_key, name)
        return await self._backend.run_step(
            self.workflow_run_id,
            step_key,
            "step",
            name,
            _group.get(),
            fn,
            args,
            kwargs,
            keyed=key is not None,
            retries=max(0, retries),
            backoff=max(0.0, backoff),
        )

    def _use_key(self, step_key: str, name: str) -> None:
        if step_key in self._keys:
            raise WorkflowError(
                f"step key {step_key!r} used twice in one run; give each step in a loop its own"
                f" name or key=, for example f'{name}-{{item}}'"
            )
        self._keys.add(step_key)

    async def parallel(self, aws: Iterable[Awaitable[Any]]) -> list[Any]:
        """Run the awaitables (usually ``run.step(...)``) together; results keep their order.

        When one fails the others finish and keep their results, then the first error is raised.
        """
        self._groups += 1
        group = f"parallel-{self._groups}"

        async def member(position: int, aw: Awaitable[Any]) -> Any:
            _group.set(group)
            _position.set(position)
            return await aw

        outcomes = await asyncio.gather(
            *(member(position, aw) for position, aw in enumerate(aws)), return_exceptions=True
        )
        waiting: BaseException | None = None
        for outcome in outcomes:
            if isinstance(outcome, WorkflowWaiting):
                waiting = waiting or outcome
            elif isinstance(outcome, BaseException):
                raise outcome
        if waiting is not None:
            # Every member finished and each review has its row; now the run waits.
            raise waiting
        return list(outcomes)

    async def review(
        self, draft: Any, ask: str = "Review this", key: str | None = None
    ) -> dict[str, str]:
        """Stop and wait for a person to look at ``draft``; return ``{"verdict", "text"}``.

        The first time the run is ``waiting`` (it holds no task), and the question is in the
        Inbox. After the answer (``golem workflow answer``) the workflow runs again from the top
        and this call returns the answer: ``verdict`` is ``approve``, ``edit`` (``text`` is the
        person's version) or ``reject`` (the workflow decides what that means). ``draft`` must be
        JSON. The step key is ``key`` or ``review:<ask>``; use ``key=`` for two reviews with the
        same ask.
        """
        step_key = key or f"review:{ask}"
        self._use_key(step_key, ask)
        return await self._backend.review(self.workflow_run_id, step_key, ask, _group.get(), draft)

    async def notify(self, text: str, title: str | None = None, key: str | None = None) -> None:
        """Tell you ``text`` through the Notifier, once per run.

        A step of kind ``notify`` keyed ``key or f"notify:{text}"``: a run that is executed
        again does not send it twice. Each key may be used once per run, so a notice inside a
        loop needs its own ``key=``. The click on the banner opens the run's session.
        """
        step_key = key or f"notify:{text}"
        if step_key in self._keys:
            raise WorkflowError(
                f"step key {step_key!r} used twice in one run; give each notify in a loop its"
                " own key="
            )
        self._keys.add(step_key)
        await self._backend.run_step(
            self.workflow_run_id,
            step_key,
            "notify",
            title or text,
            _group.get(),
            self._backend.notify,
            (self.workflow_run_id, title, text),
            {},
        )

    async def agent(
        self,
        type: str,
        brief: str,
        model: str | None = None,
        key: str | None = None,
        gets: Iterable[str] = (),
        budget: str | float | None = None,
        worktree: str | None = None,
    ) -> dict[str, Any]:
        """Run an agent of this ``type`` on ``brief``.

        Returns ``{"status", "answer", "session_id"}``. An agent with tools that change files
        (``worker``) works in its own git copy of the run's folder, and its result also has
        ``worktree`` (the copy's name), ``diff`` (the artifact id of its diff, or None for no
        change), ``files`` (``[{"path", "status", "added", "removed"}]``), ``added``,
        ``removed``, ``checks`` (``passed``, ``failed`` or ``none``), ``checks_failed`` (the
        failing checks) and ``checks_note``. ``worktree="upgrade/httpx"`` names the copy in the
        step and the result; it fails the step for an agent that only reads.
        The agent is a helper of the run's session, with golem's permissions, and ``session_id``
        is its session. ``model`` is a wish (``cheapest``, ``stronger``, ...), never a model
        name. A helper that fails or is stopped fails the step. A step of kind ``agent`` keyed
        ``key or f"agent:{type}"``: each key may be used once per run, so two agents of one type
        need their own ``key=``. After a restart the same agent is waited for, not started again.

        Agents inside one ``run.parallel`` start as one batch, like several helpers of one
        ``delegate``: the same helper cap, queue and wait reasons apply. ``gets=["diff"]`` hands
        the agent what ``delegate`` hands a helper whose file says ``gets``. ``budget="$0.50"``
        (or a number of dollars) caps this agent's cost: a helper that reaches it stops and
        fails the step.
        """
        step_key = key or f"agent:{type}"
        self._use_key(step_key, f"agent {type}")
        wanted = _gets_of(gets)
        cap = _budget_of(budget)
        if worktree is not None and not worktree.strip():
            raise WorkflowError(
                f"run.agent worktree= is a name such as 'upgrade/httpx'; got {worktree!r}"
            )
        # Only the first agent of a parallel member takes the member's place in the batch; a
        # second agent in the same member would otherwise find the first one's helper again.
        position = _position.get()
        _position.set(None)
        return await self._backend.agent(
            self.workflow_run_id,
            step_key,
            type,
            brief,
            model,
            _group.get(),
            position,
            wanted,
            cap,
            worktree,
        )

    async def llm(
        self,
        prompt: str,
        schema: Any = None,
        model: str | None = None,
        key: str | None = None,
    ) -> Any:
        """Ask a model one question, with no tools, as one step.

        Without ``schema`` the answer is the text. ``schema`` is a Pydantic model class or a
        JSON-schema dict; the answer is then a dict that follows it. ``model`` is a wish
        (``cheapest``, ``same``, ``stronger``, ``local``, ...), never a model name:
        routing picks the model, and a local-only folder only ever gets a local one. The step
        saves the model and the cost; a run that is executed again does not ask again. The
        step key is ``key`` or ``llm:<short hash of the prompt>``, once per run.
        """
        step_key = key or f"llm:{hashlib.sha256(prompt.encode()).hexdigest()[:8]}"
        self._use_key(step_key, "llm")
        schema_dict: dict[str, Any] | None = None
        check: Callable[[dict[str, Any]], dict[str, Any]] | None = None
        if schema is not None:
            validate = getattr(schema, "model_validate", None)
            if validate is not None:
                schema_dict = schema.model_json_schema()
                check = lambda value: validate(value).model_dump(mode="json")  # noqa: E731
            elif isinstance(schema, dict):
                schema_dict = dict(schema)  # pyright: ignore[reportUnknownArgumentType]
            else:
                raise WorkflowError("run.llm: schema must be a Pydantic model class or a dict")
        title = " ".join(prompt.split())
        return await self._backend.run_step(
            self.workflow_run_id,
            step_key,
            "llm",
            title if len(title) <= 60 else title[:59] + "\u2026",
            _group.get(),
            self._backend.llm,
            (self.workflow_run_id, step_key, prompt, schema_dict, model, check),
            {},
        )

    async def tool(self, name: str, /, key: str | None = None, **args: Any) -> str:
        """Call the golem or MCP tool ``name`` with ``args`` and return its output as text.

        The rules are the chat's: ``allow`` runs it, ``deny`` fails the step with the rule's
        reason, and ``ask`` makes the run ``waiting`` until you answer in the Inbox (approve
        runs it, anything else fails the step). A step of kind ``tool`` keyed
        ``key or f"tool:{name}"``: each key may be used once per run, so two calls of one tool
        need their own ``key=``. An explicit ``key=`` marks the call as a real-world action
        (see ``run.step``), and ``idempotency_key()`` works inside the tool. Output over a few
        KB is kept as an artifact of the run's session; the step keeps a one-line summary and
        the artifact id, and this call still returns all of it. ``key`` is not a tool argument.
        """
        step_key = key or f"tool:{name}"
        self._use_key(step_key, f"tool {name}")
        return await self._backend.tool(
            self.workflow_run_id, step_key, name, args, _group.get(), key is not None
        )

    async def skill(self, name: str, args: str = "", key: str | None = None) -> str:
        """Run the skill ``name`` with ``args`` as one short agent turn and return its answer.

        The skill's body, with the arguments filled in, is the brief of a helper of the run's
        session. The helper gets the skill's own tools and golem's permissions, so it has a
        thread you can open, and ``child_session_id`` is set on the step. An unknown skill fails
        the step and names the known ones. A step of kind ``skill`` keyed
        ``key or f"skill:{name}"``: each key may be used once per run. After a restart the same
        helper is waited for, not started again.
        """
        step_key = key or f"skill:{name}"
        self._use_key(step_key, f"skill {name}")
        found = await self._backend.skill(self.workflow_run_id, step_key, name, args, _group.get())
        return found["answer"]


def _gets_of(gets: Iterable[str]) -> tuple[str, ...]:
    from golem.agents.model import GETS

    if isinstance(gets, str):
        gets = (gets,)
    found = tuple(dict.fromkeys(gets))
    for item in found:
        if item not in GETS:
            raise WorkflowError(f"run.agent gets= is a list of {', '.join(GETS)}; got {item!r}")
    return found


def _budget_of(budget: str | float | None) -> float | None:
    """``"$0.50"``, ``"0.5"`` or ``0.5`` as dollars. Raises for text that is not a price."""
    if budget is None:
        return None
    message = f"run.agent budget= is dollars, such as '$0.50'; got {budget!r}"
    if isinstance(budget, bool):
        raise WorkflowError(message)
    try:
        usd = float(budget.strip().removeprefix("$")) if isinstance(budget, str) else float(budget)
    except ValueError:
        raise WorkflowError(message) from None
    if not 0 < usd < float("inf"):
        raise WorkflowError(f"run.agent budget= must be more than $0; got {budget!r}")
    return usd


def _type_name(t: object) -> str:
    return t if isinstance(t, str) else getattr(t, "__name__", str(t))


def workflow(
    trigger: Trigger | None = None,
    inputs: Mapping[str, object] | None = None,
    description: str | None = None,
    on_restart: OnRestart = "resume",
) -> Callable[[F], F]:
    """Mark a function as a workflow.

    ``on_restart`` says what happens to a run the daemon stopped in the middle of: ``"resume"``
    continues it (finished steps are not run again), ``"fail"`` fails it, ``"ask"`` leaves it
    ``waiting`` until a person runs ``golem workflow resume``.
    """
    if on_restart not in RESTART_POLICIES:
        raise ValueError(
            f"on_restart must be one of {', '.join(RESTART_POLICIES)}, not {on_restart!r}"
        )

    def mark(fn: F) -> F:
        doc = (fn.__doc__ or "").strip()
        code = getattr(fn, "__code__", None)
        spec = WorkflowSpec(
            name=fn.__name__,
            trigger=trigger,
            inputs=tuple((k, _type_name(v)) for k, v in (inputs or {}).items()),
            description=description if description is not None else doc,
            line=code.co_firstlineno if code is not None else 0,
            on_restart=on_restart,
        )
        setattr(fn, SPEC_ATTR, spec)
        return fn

    return mark


__all__ = [
    "Manual",
    "OnFile",
    "OnRestart",
    "Run",
    "Schedule",
    "StepBackend",
    "Trigger",
    "WorkflowError",
    "WorkflowSpec",
    "WorkflowWaiting",
    "idempotency_key",
    "manual",
    "may_have_run",
    "on_file",
    "schedule",
    "workflow",
]
