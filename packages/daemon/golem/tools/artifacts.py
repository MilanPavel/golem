"""``read_artifact``: the model reads big output that went to an artifact, one page at a time."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from golem.tools.registry import Tool, ToolContext, ToolError, ToolResult
from golem.tools.untrusted import wrap

UNTRUSTED_KIND = "untrusted"

PAGE_CHARS = 20_000


class ReadArtifactArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")

    artifact_id: str = Field(min_length=1, description="The id from a cut tool result.")
    offset: int = Field(default=0, ge=0, description="First character to read, from 0.")
    limit: int = Field(default=PAGE_CHARS, ge=1, le=PAGE_CHARS, description="Characters to read.")


async def _read_artifact(args: ReadArtifactArgs, ctx: ToolContext) -> ToolResult:
    if ctx.artifacts is None or ctx.session_id is None:
        raise ToolError("artifacts are not available here")
    page = await ctx.artifacts.read(ctx.session_id, args.artifact_id, args.offset, args.limit)
    if page is None:
        raise ToolError(f"no artifact {args.artifact_id} in this session")
    if page.offset >= page.size and page.size > 0:
        raise ToolError(f"{args.artifact_id} has {page.size} characters; offset is past the end")
    end = page.offset + len(page.text)
    more = f"\n[characters {page.offset}-{end} of {page.size}]" if end < page.size else ""
    output = f"{page.text}{more}"
    if page.kind == UNTRUSTED_KIND:
        output = wrap(output, artifact=args.artifact_id)
    return ToolResult(output=output, summary=f"{page.offset}-{end} of {page.size}")


READ_ARTIFACT = Tool(
    name="read_artifact",
    description=(
        "Read more of a tool result that was too long and was cut. "
        f"Reads up to {PAGE_CHARS} characters from offset."
    ),
    args=ReadArtifactArgs,
    run=_read_artifact,
    read_only=True,
)

__all__ = ["PAGE_CHARS", "READ_ARTIFACT", "UNTRUSTED_KIND", "ReadArtifactArgs"]
