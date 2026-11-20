"""``delegate``: hand a reading or searching job to a helper that starts with an empty context.

The helper is a session with a parent (ADR-059). It reads, searches and answers; it changes
nothing. The tools node starts it through the session manager and parks the lead, so the tool
itself never runs: this file knows nothing of the graph.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from golem.tools.registry import Tool, ToolContext, ToolError, ToolResult

AGENT = "explorer"


class DelegateArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")

    brief: str = Field(
        min_length=1, description="What to find out, and what to return. The helper sees only this."
    )
    agent: Literal["explorer"] = Field(default=AGENT, description="Which helper to use.")


@dataclass(frozen=True, slots=True)
class HelperSpec:
    """One helper to start for a ``delegate`` call."""

    agent: str
    brief: str
    label: str = ""


@dataclass(frozen=True, slots=True)
class HelperOutcome:
    """How one helper ended. ``text`` is its answer, or its head when ``artifact_id`` is set."""

    agent: str
    stopped: str
    text: str
    artifact_id: str | None = None
    label: str = ""


def _section(done: HelperOutcome) -> str:
    answer = done.text.strip()
    if done.artifact_id is not None:
        note = (
            f"[the answer is long: it is in artifact {done.artifact_id}. "
            "Read it with read_artifact(artifact_id, offset, limit).]"
        )
        answer = f"{answer}\n{note}" if answer else note
    answer = answer or "(the helper gave no answer)"
    if done.stopped == "done":
        return answer
    return f"{done.agent} finished: {done.stopped}\n\n{answer}"


def results_text(ended: Sequence[HelperOutcome]) -> str:
    """The tool result of a ``delegate`` call: one section per helper, in the order of the call."""
    if len(ended) == 1:
        return _section(ended[0])
    parts = [
        f"### {n}. {done.label or done.agent}\n{_section(done)}" for n, done in enumerate(ended, 1)
    ]
    return "\n\n".join(parts)


def results_summary(ended: Sequence[HelperOutcome]) -> str:
    """One short line for the screen."""
    if len(ended) == 1:
        done = ended[0]
        return (
            f"{done.agent} finished" if done.stopped == "done" else f"{done.agent}: {done.stopped}"
        )
    stopped = sum(done.stopped != "done" for done in ended)
    return f"{len(ended)} helpers finished" + (f", {stopped} stopped early" if stopped else "")


async def _delegate(args: DelegateArgs, ctx: ToolContext) -> ToolResult:
    """Reached only when the run has no helper host: the tools node starts helpers itself."""
    del args, ctx
    raise ToolError("a helper cannot be started here")


DELEGATE = Tool(
    name="delegate",
    description=(
        "Hand a reading or searching job to a helper that starts with an empty context. "
        "Use it for wide questions about many files. It returns a short answer, not the files. "
        "It cannot change anything."
    ),
    args=DelegateArgs,
    run=_delegate,
    read_only=True,
)

__all__ = [
    "AGENT",
    "DELEGATE",
    "DelegateArgs",
    "HelperOutcome",
    "HelperSpec",
    "results_summary",
    "results_text",
]
