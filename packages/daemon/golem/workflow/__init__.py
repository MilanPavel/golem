"""The module a workflow file imports: ``from golem.workflow import workflow, Run, schedule``.

A workflow file is plain Python. ``@workflow`` only labels a function: it attaches a
frozen :class:`WorkflowSpec` as ``__golem_workflow__`` and returns the function unchanged.
The registry reads that label in a short-lived subprocess, so listing never runs the
workflow.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any, Literal, TypeVar

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


@dataclass(frozen=True, slots=True)
class WorkflowSpec:
    name: str
    trigger: Trigger | None
    inputs: tuple[tuple[str, str], ...]
    """Input name and type name, in declared order."""
    description: str
    line: int
    """Line of the function in its file."""


class Run:
    """The handle a workflow function receives.

    Placeholder: 3.1.1 (#1758) adds ``run.step`` and ``run.parallel``.
    """


def _type_name(t: object) -> str:
    return t if isinstance(t, str) else getattr(t, "__name__", str(t))


def workflow(
    trigger: Trigger | None = None,
    inputs: Mapping[str, object] | None = None,
    description: str | None = None,
) -> Callable[[F], F]:
    """Mark a function as a workflow."""

    def mark(fn: F) -> F:
        doc = (fn.__doc__ or "").strip()
        code = getattr(fn, "__code__", None)
        spec = WorkflowSpec(
            name=fn.__name__,
            trigger=trigger,
            inputs=tuple((k, _type_name(v)) for k, v in (inputs or {}).items()),
            description=description if description is not None else doc,
            line=code.co_firstlineno if code is not None else 0,
        )
        setattr(fn, SPEC_ATTR, spec)
        return fn

    return mark


__all__ = [
    "Manual",
    "OnFile",
    "Run",
    "Schedule",
    "Trigger",
    "WorkflowSpec",
    "manual",
    "on_file",
    "schedule",
    "workflow",
]
