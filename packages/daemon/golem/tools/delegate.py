"""``delegate``: hand a reading or searching job to a helper that starts with an empty context.

The helper is a session with a parent (ADR-059). It reads, searches and answers; it changes
nothing. The tools node starts it through the session manager and parks the lead, so the tool
itself never runs: this file knows nothing of the graph.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import cast

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from golem.tools.registry import Tool, ToolContext, ToolError, ToolResult
from golem_protocol.events import HelperEndedData

MODEL_MAX = 100
"""The longest ``model`` a call may name."""
MODELS_SHOWN = 8
"""How many models the description lists."""
LABEL_MAX = 60
"""The longest ``label`` a batch item may carry."""


def _checked_model(value: str | None) -> str | None:
    if value is None:
        return None
    if value.strip() == "":
        raise ValueError("model is empty: name a model or leave it out")
    if value != value.strip() or any(c.isspace() for c in value):
        raise ValueError("model must be one name with no spaces, such as local or ollama/qwen3")
    if len(value) > MODEL_MAX:
        raise ValueError(f"model is longer than {MODEL_MAX} characters")
    return value


class BatchItem(BaseModel):
    """One helper of a batch."""

    model_config = ConfigDict(extra="forbid")

    agent: str = Field(min_length=1, description="The agent type of this helper.")
    brief: str = Field(min_length=1, description="What this helper finds out and returns.")
    label: str = Field(
        default="",
        max_length=LABEL_MAX,
        description="Optional short name for this helper's section of the result.",
    )
    model: str | None = Field(default=None, description="Optional: the model of this helper.")

    @field_validator("model")
    @classmethod
    def _named(cls, value: str | None) -> str | None:
        return _checked_model(value)


class DelegateArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")

    agent: str | None = Field(
        default=None,
        description=(
            "Which helper to use: the name of one agent type listed in this tool. "
            "Required with brief, unless batch is given."
        ),
    )
    brief: str | None = Field(
        default=None,
        min_length=1,
        description="What to find out, and what to return. The helper sees only this.",
    )
    model: str | None = Field(
        default=None,
        description=(
            "Optional: the model of this one helper. A tier (local, budget, frontier), "
            "a model name listed in this tool, or provider/model. Leave it out to use the "
            "helper's own choice."
        ),
    )
    batch: list[BatchItem] | None = Field(
        default=None,
        min_length=1,
        description=(
            "Several independent jobs that run at the same time: a list of "
            "{agent, brief, label, model}. Use it instead of agent and brief, not with them."
        ),
    )

    @field_validator("model")
    @classmethod
    def _named(cls, value: str | None) -> str | None:
        return _checked_model(value)

    @model_validator(mode="after")
    def _one_form(self) -> DelegateArgs:
        single = self.agent is not None or self.brief is not None or self.model is not None
        if self.batch is not None and single:
            raise ValueError("give either batch or agent and brief, not both")
        if self.batch is None and (self.agent is None or self.brief is None):
            raise ValueError("give agent and brief, or a batch of helpers")
        return self

    def helpers(self) -> list[HelperSpec]:
        """The helpers this call asks for, in call order."""
        if self.batch is not None:
            return [HelperSpec(i.agent, i.brief, i.label, i.model) for i in self.batch]
        assert self.agent is not None and self.brief is not None
        return [HelperSpec(agent=self.agent, brief=self.brief, model=self.model)]


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
    covered: str = ""
    """What the helper covered when it did not simply answer, such as
    ``stopped at 25 calls, read 5 of 7 files``. Empty when it answered."""
    changes: str = ""
    """The line on a worker's diff and checks, such as ``+38 -12 in 3 files``. Empty for a
    helper that works in no copy."""
    worker: HelperEndedData | None = None
    """The ``helper.ended`` data of the helper: its diff artifact, files and checks when it worked
    in a copy. None while no ``helper.ended`` is stored."""


def _section(done: HelperOutcome) -> str:
    answer = done.text.strip()
    if done.artifact_id is not None:
        note = (
            f"[the answer is long: it is in artifact {done.artifact_id}. "
            "Read it with read_artifact(artifact_id, offset, limit).]"
        )
        answer = f"{answer}\n{note}" if answer else note
    answer = answer or "(the helper gave no answer)"
    if done.changes:
        answer = f"{answer}\n\n{done.changes}"
    if done.stopped == "done":
        return answer
    lead = f"{done.covered}\n\n" if done.covered else ""
    return f"{done.agent} finished: {done.stopped}\n\n{lead}{answer}"


IN_COPIES = (
    "These changes are in the workers' own copies, not in this folder yet. The user reviews "
    "each diff and applies it or not. Do not make the same changes yourself: tell the user "
    "which changes are ready to apply."
)
"""The note after the sections when a worker changed files, so the lead does not redo them."""


def _changed_files(done: HelperOutcome) -> bool:
    return bool(done.worker is not None and done.worker.files) or (
        bool(done.changes) and not done.changes.startswith("The worker changed no file")
    )


def results_text(ended: Sequence[HelperOutcome]) -> str:
    """The tool result of a ``delegate`` call: one section per helper, in the order of the call,
    then :data:`IN_COPIES` when a worker changed files."""
    if len(ended) == 1:
        text = _section(ended[0])
    else:
        text = "\n\n".join(
            f"### {n}. {done.label or done.agent}\n{_section(done)}"
            for n, done in enumerate(ended, 1)
        )
    if any(_changed_files(done) for done in ended):
        text = f"{text}\n\n{IN_COPIES}"
    return text


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
    "A reading helper changes nothing. A helper that writes works in a copy of the folder: its "
    "changes reach this folder only when the user applies them. "
    "For several independent jobs, give batch: a list of {agent, brief, label}. "
    "They run at the same time, and no order is promised."
)


def describe(types: Sequence[tuple[str, str]], models: Sequence[str] = ()) -> str:
    """The description of ``delegate`` with the agent types a session may name, one to a line,
    and the models it may ask for: tiers and names, the first :data:`MODELS_SHOWN` of them."""
    text = DESCRIPTION
    if types:
        lines = "\n".join(f"- {name}: {about}" for name, about in types)
        text = (
            f"{text}\nThe agent argument (or the agent of each batch item) "
            f"is one of these types:\n{lines}"
        )
    if models:
        shown = ", ".join(models[:MODELS_SHOWN])
        text = (
            f"{text}\nThe model argument is optional and picks the model of one helper: "
            f"one of {shown}. Do not invent other names."
        )
    return text


def _parameters() -> dict[str, object]:
    """The schema of :class:`DelegateArgs` with no ``$defs`` or ``$ref``: small models read it as
    text, and some providers handle references poorly."""
    schema = DelegateArgs.model_json_schema()
    defs = cast(dict[str, dict[str, object]], schema.pop("$defs", {}))

    def inline(node: object) -> object:
        if isinstance(node, dict):
            found = cast(dict[str, object], node)
            ref = found.get("$ref")
            if isinstance(ref, str):
                return inline(defs[ref.rsplit("/", 1)[-1]])
            return {k: inline(v) for k, v in found.items() if k != "title"}
        if isinstance(node, list):
            return [inline(v) for v in cast(list[object], node)]
        return node

    return cast(dict[str, object], inline(schema))


DELEGATE = Tool(
    name="delegate",
    description=DESCRIPTION,
    args=DelegateArgs,
    parameters=_parameters(),
    run=_delegate,
    read_only=True,
)

__all__ = [
    "DELEGATE",
    "DESCRIPTION",
    "LABEL_MAX",
    "MODELS_SHOWN",
    "MODEL_MAX",
    "BatchItem",
    "DelegateArgs",
    "HelperOutcome",
    "HelperSpec",
    "describe",
    "results_summary",
    "results_text",
]
