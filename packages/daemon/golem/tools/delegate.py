"""``delegate``: hand a reading or searching job to a helper that starts with an empty context.

The helper is a child run (ADR-058). It reads, searches and answers; it changes nothing. The
tools node gives the tool its way to run one, so this file knows nothing of the graph.
"""

from __future__ import annotations

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


def result_text(text: str, stopped: str) -> str:
    """The tool result: the answer, with a first line naming the limit when one stopped it."""
    answer = text.strip() or "(the helper gave no answer)"
    if stopped == "done":
        return answer
    return f"{AGENT} finished: {stopped}\n\n{answer}"


async def _delegate(args: DelegateArgs, ctx: ToolContext) -> ToolResult:
    if ctx.delegate is None:
        raise ToolError("a helper cannot be started here")
    done = await ctx.delegate(args.brief)
    summary = (
        f"{args.agent} finished" if done.stopped == "done" else f"{args.agent}: {done.stopped}"
    )
    return ToolResult(output=result_text(done.text, done.stopped), summary=summary)


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

__all__ = ["AGENT", "DELEGATE", "DelegateArgs", "result_text"]
