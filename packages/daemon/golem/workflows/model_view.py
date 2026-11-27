"""Which model a workflow's steps would use, read from the source (3.13.7, ADR-062 amended).

The order is this run's choice, then the step's ``model=``, then ``@workflow(model=)``, then
golem's default model. A run's own choice does not exist before a run, so this module answers for
"a run with no choice of its own": the step's, the workflow's, golem's default. Nothing here runs
a model or reads a key; it only asks the setup whether a name is known.
"""

from __future__ import annotations

from dataclasses import dataclass

from golem.agents.model import WISHES
from golem.workflows.check import CheckEnv
from golem.workflows.outline import OutlineStep

MODEL_KINDS = frozenset({"llm", "agent", "skill"})
"""The steps that ask a model."""


@dataclass(frozen=True, slots=True)
class StepModel:
    written: str | None
    """The ``model=`` as the file says it (the source text when it is computed)."""
    now: str | None
    ready: bool
    note: str | None = None


def _ready(name: str | None, env: CheckEnv) -> tuple[bool, str | None]:
    if name is None or name in WISHES or env.model_problem is None:
        return True, None
    problem = env.model_problem(name)
    return problem is None, problem


def workflow_model(written: str | None, env: CheckEnv) -> StepModel:
    """What a model step with no ``model=`` of its own would use."""
    default = None if env.default_model is None else env.default_model()
    now = written or default
    ready, note = _ready(now, env)
    return StepModel(written, now, ready, note)


def step_model(step: OutlineStep, written_workflow: str | None, env: CheckEnv) -> StepModel | None:
    """The model of one step, or None for a step that asks no model."""
    if step.kind not in MODEL_KINDS:
        return None
    arg = next((a for a in step.args if a.name == "model"), None)
    if arg is not None and not arg.literal:
        return StepModel(arg.source, None, True)
    written = None if arg is None else arg.value
    base = workflow_model(written_workflow, env)
    now = written or base.now
    ready, note = _ready(now, env)
    return StepModel(written, now, ready, note)
