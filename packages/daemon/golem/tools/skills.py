"""``load_skill``: the model asks for the body of a skill from the index.

The result is the skill's body, filled in like a skill run with no arguments,
and the skill's folder, so the body's ``references/`` paths can be read. A
second load of the same skill in a session says "already loaded" instead of
repeating the body. The folder is then readable for the session, as it is for
a skill the user runs by name ([ADR-030](docs/adr/030-skill-read-roots.md)).
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from golem.skills.expand import expand
from golem.skills.parse import read_body
from golem.tools.registry import Tool, ToolContext, ToolError, ToolResult


class LoadSkillArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, description="A skill named in your list of skills.")


async def _load_skill(args: LoadSkillArgs, ctx: ToolContext) -> ToolResult:
    if ctx.skills is None:
        raise ToolError("skills cannot be loaded here")
    skill = ctx.skills.get(args.name)
    if skill is None or not skill.model_invocable:
        raise ToolError(f"no skill named {args.name} that you can load")
    if skill.path in ctx.read_roots:
        return ToolResult(
            output=f"The skill {args.name} is already loaded. Use the instructions you have.",
            summary=f"{args.name} already loaded",
        )
    try:
        body = read_body(skill)
    except OSError as exc:
        raise ToolError(f"cannot read {skill.file}: {exc.strerror or exc}") from exc
    text = expand(body, "", skill_dir=skill.path, session_id=ctx.session_id or "").strip()
    if not text:
        raise ToolError(f"skill {args.name} has an empty body")
    origin = next(
        entry.origin for entry in ctx.skills.listed if entry.usable and entry.skill is skill
    )
    return ToolResult(
        output=f'Skill folder: {skill.path}\n\n<skill name="{args.name}">\n{text}\n</skill>',
        summary=f"loaded {args.name}",
        update={
            "skill_folders": [str(skill.path)],
            "skill_activated": {
                "name": args.name,
                "source": origin,
                "path": str(skill.path),
                "hash": skill.hash,
            },
        },
    )


LOAD_SKILL = Tool(
    name="load_skill",
    description=(
        "Load the instructions of one skill from your list of skills, when the task fits it. "
        "You get its instructions and its folder, where files it mentions can be read. "
        "Loading a skill twice is not needed."
    ),
    args=LoadSkillArgs,
    run=_load_skill,
    internal=True,
)

__all__ = ["LOAD_SKILL", "LoadSkillArgs"]
