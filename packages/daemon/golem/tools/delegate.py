"""``delegate``: hand a reading or searching job to a helper that starts with an empty context.

The helper is a session with a parent (ADR-059). It reads, searches and answers; it changes
nothing. The tools node starts it through the session manager and parks the lead, so the tool
itself never runs: this file knows nothing of the graph.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from pydantic import BaseModel, ConfigDict, Field, field_validator

from golem.tools.registry import Tool, ToolContext, ToolError, ToolResult

MODEL_MAX = 100
"""The longest ``model`` a call may name."""
MODELS_SHOWN = 8
"""How many models the description lists."""


class DelegateArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")

    agent: str = Field(
        description=(
            "Which helper to use: the name of one agent type listed in this tool. Required."
        ),
    )
    brief: str = Field(
        min_length=1, description="What to find out, and what to return. The helper sees only this."
    )
    model: str | None = Field(
        default=None,
        description=(
            "Optional: the model of this one helper. A tier (local, budget, frontier), "
            "a model name listed in this tool, or provider/model. Leave it out to use the "
            "helper's own choice."
        ),
    )

    @field_validator("model")
    @classmethod
    def _named(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if value.strip() == "":
            raise ValueError("model is empty: name a model or leave it out")
        if value != value.strip() or any(c.isspace() for c in value):
            raise ValueError("model must be one name with no spaces, such as local or ollama/qwen3")
        if len(value) > MODEL_MAX:
            raise ValueError(f"model is longer than {MODEL_MAX} characters")
        return value


@dataclass(frozen=True, slots=True)
class HelperSpec:
    """One helper to start for a ``delegate`` call."""

    agent: str
    brief: str
    label: str = ""
    model: str | None = None
    """The model the lead named for this helper: a wish for this one call."""


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


DESCRIPTION = (
    "Hand a reading or searching job to a helper that starts with an empty context. "
    "Use it for wide questions about many files. It returns a short answer, not the files. "
    "It cannot change anything."
)


def describe(types: Sequence[tuple[str, str]], models: Sequence[str] = ()) -> str:
    """The description of ``delegate`` with the agent types a session may name, one to a line,
    and the models it may ask for: tiers and names, the first :data:`MODELS_SHOWN` of them."""
    text = DESCRIPTION
    if types:
        lines = "\n".join(f"- {name}: {about}" for name, about in types)
        text = f"{text}\nThe agent argument is required and is one of these types:\n{lines}"
    if models:
        shown = ", ".join(models[:MODELS_SHOWN])
        text = (
            f"{text}\nThe model argument is optional and picks the model of one helper: "
            f"one of {shown}. Do not invent other names."
        )
    return text


DELEGATE = Tool(
    name="delegate",
    description=DESCRIPTION,
    args=DelegateArgs,
    run=_delegate,
    read_only=True,
)

__all__ = [
    "DELEGATE",
    "DESCRIPTION",
    "MODELS_SHOWN",
    "MODEL_MAX",
    "DelegateArgs",
    "HelperOutcome",
    "HelperSpec",
    "describe",
    "results_summary",
    "results_text",
]
