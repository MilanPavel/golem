"""Run a skill once by name: find it in the session's view, read its body, fill it in.

The result is the turn's user message. A name the session cannot run is a
:class:`SkillInvokeError` that says why, so the user never gets an empty turn.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from golem.skills.expand import expand
from golem.skills.parse import read_body
from golem.skills.registry import Listed, SkillView
from golem_protocol.events import SkillCall, SkillSource


class SkillInvokeError(Exception):
    """The session cannot run this skill. The message says why."""


@dataclass(frozen=True, slots=True)
class Invocation:
    """One skill run once, with its body already filled in."""

    call: SkillCall
    source: SkillSource
    path: Path
    hash: str
    text: str
    """The body with the arguments filled in. The model gets it as the user message."""


def invoke(view: SkillView, call: SkillCall, *, session_id: str) -> Invocation:
    """The skill ``call`` names, ready to send. Raises :class:`SkillInvokeError`."""
    entries = [entry for entry in view.listed if entry.skill.name == call.name]
    entry = next((entry for entry in entries if entry.usable), None)
    if entry is None:
        raise SkillInvokeError(_why_not(call.name, entries))
    skill = entry.skill
    if not skill.user_invocable:
        raise SkillInvokeError(f"skill {call.name} has user-invocable: false")
    try:
        body = read_body(skill)
    except OSError as exc:
        raise SkillInvokeError(f"skill {call.name}: cannot read {skill.file}: {exc}") from exc
    text = expand(body, call.args, skill_dir=skill.path, session_id=session_id)
    if not text.strip():
        raise SkillInvokeError(f"skill {call.name} has an empty body")
    return Invocation(call=call, source=entry.origin, path=skill.path, hash=skill.hash, text=text)


def _why_not(name: str, entries: list[Listed]) -> str:
    if not entries:
        return f"no skill named {name}"
    if any(entry.disabled for entry in entries):
        return f"skill {name} is disabled in [skills]"
    broken = entries[0].skill
    reason = broken.errors[0] if broken.errors else "it cannot be used"
    return f"skill {name} is broken: {reason}"


__all__ = ["Invocation", "SkillInvokeError", "invoke"]
