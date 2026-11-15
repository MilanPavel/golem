"""``propose_plan``: how a plan first run ends, with a plan the user reads.

The tool is offered only while the session is in plan first. It changes
nothing outside golem. Its result goes to the graph, which sends the plan
as a ``plan.proposed`` event.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from golem.sessions.ids import new_id
from golem.tools.registry import Tool, ToolContext, ToolResult

PLAN_REPLY = "The plan is shown to the user. Stop here and wait for their answer."


class PlanStep(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1, max_length=300, description="The step, in a few words.")
    files: list[str] = Field(
        default_factory=list[str], max_length=20, description="The files the step will touch."
    )


class ProposePlanArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=120, description="What the plan does.")
    steps: list[PlanStep] = Field(min_length=1, max_length=20, description="The steps, in order.")


async def _propose_plan(args: ProposePlanArgs, ctx: ToolContext) -> ToolResult:
    del ctx
    plan = {
        "plan_id": new_id("p"),
        "title": args.title,
        "steps": [step.model_dump() for step in args.steps],
    }
    return ToolResult(output=PLAN_REPLY, summary=f"{len(args.steps)} steps", update={"plan": plan})


PROPOSE_PLAN = Tool(
    name="propose_plan",
    description=(
        "End a plan first run: show the user the plan. Give a short title and the steps in "
        "order, each with the files it will touch. Call it once, after you have read what "
        "you need, then stop."
    ),
    args=ProposePlanArgs,
    run=_propose_plan,
    internal=True,
    plan_only=True,
)

__all__ = ["PLAN_REPLY", "PROPOSE_PLAN", "PlanStep", "ProposePlanArgs"]
