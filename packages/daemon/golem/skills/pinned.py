"""Pinned skills: which ones a session may pin, and their part of the system prompt.

A pinned skill's body is read from disk for each model call, so the next call
uses an edited body. It is filled in like an invoked skill with no arguments:
``$ARGUMENTS`` is empty, and the skill folder and session ID are filled in.

Each model call also reports what it found for every pin: the ``SKILL.md``
hash it read, or why it left the skill out. :class:`PinMemory` keeps what the
session log last said, so the log gets a new event only when that changes.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from golem.graphs.adapter import PIN_READ_KIND, PIN_SKIPPED_KIND, STREAM_KEY
from golem.graphs.prompt import PromptContext, Section
from golem.skills.expand import expand
from golem.skills.model import SKILL_FILE
from golem.skills.parse import read_body
from golem.skills.registry import Listed, SkillRegistry, SkillView
from golem_protocol.events import (
    ChatEvent,
    SkillActivatedEvent,
    SkillDeactivatedEvent,
    SkillSkippedEvent,
)

PINNED_INTRO = "The user pinned these skills for this session. Follow them whenever they apply."

SkipReason = Literal["missing", "disabled", "broken"]


class SkillPinError(Exception):
    """The session cannot pin this skill. The message says why.

    ``reason`` is set when the skill itself is the problem, and None when the
    request is.
    """

    def __init__(self, message: str, reason: SkipReason | None = None) -> None:
        super().__init__(message)
        self.reason: SkipReason | None = reason


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
        raise SkillPinError(f"no skill named {name}", "missing")
    if any(entry.disabled for entry in entries):
        raise SkillPinError(f"skill {name} is disabled in [skills]", "disabled")
    broken = entries[0].skill
    reason = broken.errors[0] if broken.errors else "it cannot be used"
    raise SkillPinError(f"skill {name} is broken: {reason}", "broken")


def pinned_section(registry: SkillRegistry) -> Section:
    """The system prompt part that holds the bodies of the pinned skills, in pin order.

    A pinned skill that is gone, broken, or empty is left out of the prompt.
    It stays pinned until the user unpins it. During a model call, the
    section reports each pin to ``context.report``.
    """

    def section(context: PromptContext) -> str | None:
        if not context.pinned:
            return None
        view = registry.view(None if context.cwd is None else Path(context.cwd))
        session_id = context.state.get("session_id")
        blocks = [
            block
            for name in context.pinned
            if (
                block := _block(
                    view, name, session_id if isinstance(session_id, str) else "", context
                )
            )
        ]
        if not blocks:
            return None
        return "\n\n".join([PINNED_INTRO, *blocks])

    return section


def pinned_folders(registry: SkillRegistry, cwd: str | None, names: Iterable[str]) -> list[str]:
    """The folders of the pinned skills the session can use now. The read tools may read them."""
    view = registry.view(None if cwd is None else Path(cwd))
    folders: list[str] = []
    for name in names:
        try:
            folders.append(str(pinnable(view, name).skill.path))
        except SkillPinError:
            continue
    return folders


@dataclass
class PinMemory:
    """What the session log last said about each pinned skill.

    The value is the ``SKILL.md`` hash of its newest ``skill.activated``, or
    ``skipped:<reason>`` after a ``skill.skipped``. One per session, shared by
    its runs, so a change is logged once, by the run that first sees it.
    """

    last: dict[str, str] = field(default_factory=dict[str, str])

    @classmethod
    def from_events(cls, events: Iterable[ChatEvent]) -> PinMemory:
        """Rebuild it from a session's stored events, after a restart."""
        memory = cls()
        for event in events:
            if isinstance(event, SkillActivatedEvent) and event.data.how == "pinned":
                memory.last[event.data.name] = event.data.hash
            elif isinstance(event, SkillSkippedEvent):
                memory.last[event.data.name] = _skipped(event.data.reason)
            elif isinstance(event, SkillDeactivatedEvent):
                memory.last.pop(event.data.name, None)
        return memory

    def read(self, name: str, hash: str) -> bool:
        """Note that a call read ``hash``. True when the log should say so."""
        return self._note(name, hash)

    def skipped(self, name: str, reason: SkipReason) -> bool:
        """Note that a call left the skill out. True when the log should say so."""
        return self._note(name, _skipped(reason))

    def forget(self, name: str) -> None:
        """The skill was unpinned."""
        self.last.pop(name, None)

    def _note(self, name: str, key: str) -> bool:
        if self.last.get(name) == key:
            return False
        self.last[name] = key
        return True


def _skipped(reason: SkipReason) -> str:
    return f"skipped:{reason}"


def _block(view: SkillView, name: str, session_id: str, context: PromptContext) -> str | None:
    try:
        entry = pinnable(view, name)
    except SkillPinError as exc:
        _report_skip(context, name, exc.reason or "broken", str(exc))
        return None
    skill = entry.skill
    try:
        body = read_body(skill)
    except OSError as exc:
        _report_skip(
            context, name, "broken", f"cannot read {SKILL_FILE} of {name}: {exc.strerror or exc}"
        )
        return None
    if context.report is not None:
        context.report(
            {
                STREAM_KEY: PIN_READ_KIND,
                "name": name,
                "source": entry.origin,
                "path": str(skill.path),
                "hash": skill.hash,
            }
        )
    text = expand(body, "", skill_dir=skill.path, session_id=session_id).strip()
    if not text:
        return None
    return f'<skill name="{name}">\n{text}\n</skill>'


def _report_skip(context: PromptContext, name: str, reason: SkipReason, message: str) -> None:
    if context.report is not None:
        context.report(
            {STREAM_KEY: PIN_SKIPPED_KIND, "name": name, "reason": reason, "message": message}
        )


__all__ = [
    "PINNED_INTRO",
    "PinMemory",
    "SkillPinError",
    "SkipReason",
    "pinnable",
    "pinned_folders",
    "pinned_section",
]
