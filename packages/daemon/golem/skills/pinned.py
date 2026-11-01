"""Pinned skills: which ones a session may pin, and their part of the system prompt.

A pinned skill's body is read from disk for each model call, so the next call
uses an edited body. It is filled in like an invoked skill with no arguments:
``$ARGUMENTS`` is empty, and the skill folder and session ID are filled in.
"""

from __future__ import annotations

from pathlib import Path

from golem.graphs.prompt import PromptContext, Section
from golem.skills.expand import expand
from golem.skills.parse import read_body
from golem.skills.registry import Listed, SkillRegistry, SkillView

PINNED_INTRO = "The user pinned these skills for this session. Follow them whenever they apply."


class SkillPinError(Exception):
    """The session cannot pin this skill. The message says why."""


def pinnable(view: SkillView, name: str) -> Listed:
    """The entry that ``name`` means in ``view``. Raises :class:`SkillPinError`.

    Unlike running a skill by name, a skill with ``user-invocable: false`` may
    be pinned: such skills are background knowledge, which is what a pin is for.
    """
    entries = [entry for entry in view.listed if entry.skill.name == name]
    entry = next((entry for entry in entries if entry.usable), None)
    if entry is not None:
        return entry
    if not entries:
        raise SkillPinError(f"no skill named {name}")
    if any(entry.disabled for entry in entries):
        raise SkillPinError(f"skill {name} is disabled in [skills]")
    broken = entries[0].skill
    reason = broken.errors[0] if broken.errors else "it cannot be used"
    raise SkillPinError(f"skill {name} is broken: {reason}")


def pinned_section(registry: SkillRegistry) -> Section:
    """The system prompt part that holds the bodies of the pinned skills, in pin order.

    A pinned skill that is gone, broken, or empty is left out of the prompt.
    It stays pinned until the user unpins it.
    """

    def section(context: PromptContext) -> str | None:
        if not context.pinned:
            return None
        view = registry.view(None if context.cwd is None else Path(context.cwd))
        session_id = context.state.get("session_id")
        blocks = [
            block
            for name in context.pinned
            if (block := _block(view, name, session_id if isinstance(session_id, str) else ""))
        ]
        if not blocks:
            return None
        return "\n\n".join([PINNED_INTRO, *blocks])

    return section


def _block(view: SkillView, name: str, session_id: str) -> str | None:
    try:
        skill = pinnable(view, name).skill
        body = read_body(skill)
    except (SkillPinError, OSError):
        return None
    text = expand(body, "", skill_dir=skill.path, session_id=session_id).strip()
    if not text:
        return None
    return f'<skill name="{name}">\n{text}\n</skill>'


__all__ = ["PINNED_INTRO", "SkillPinError", "pinnable", "pinned_section"]
