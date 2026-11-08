"""The system prompt: built for each model call, and never stored.

A prompt is a list of sections. Each section reads the session's state and
folder and returns its text, or None when it has nothing to say. The sections
are joined with a blank line. With nothing to say, there is no system message
at all, so the model sees exactly the stored history.

The message goes in front of the history for one model call only. It is not
returned from the node, so it never reaches the checkpoint, and an edit to
what a section reads shows on the next call.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass

from langchain_core.messages import SystemMessage

PINNED_KEY = "golem_pinned_skills"
"""The ``configurable`` key that carries the session's pinned skills to each model call."""


@dataclass(frozen=True, slots=True)
class PromptContext:
    """What a section may read: the checkpoint values, the session folder, and the pins.

    ``pinned`` are the names of the skills pinned in the session, in pin order.
    They are the daemon's, not the checkpoint's, so a pin made between turns
    applies to the next call. ``report`` takes what a section wants the run's
    log to know, such as a pinned skill it left out. It is set during a model
    call only, so building the prompt for ``/debug model`` logs nothing.
    """

    state: Mapping[str, object]
    cwd: str | None = None
    pinned: tuple[str, ...] = ()
    report: Callable[[Mapping[str, object]], None] | None = None


SectionFn = Callable[[PromptContext], str | None]


@dataclass(frozen=True, slots=True)
class Section:
    """One named part of the system prompt. None or blank text leaves it out."""

    name: str
    build: SectionFn

    def __call__(self, context: PromptContext) -> str | None:
        return self.build(context)


@dataclass(frozen=True, slots=True)
class SystemPrompt:
    """The sections of the system prompt, in order. No sections means no prompt.

    A bare function is named ``section_<n>``, where ``n`` is its 1-based place
    in ``sections``.
    """

    sections: tuple[Section | SectionFn, ...] = ()

    def parts(self, context: PromptContext) -> list[tuple[str, str]]:
        """The non-empty ``(name, text)`` pairs in order, with each text stripped.

        Calls each section exactly once.
        """
        found: list[tuple[str, str]] = []
        for number, section in enumerate(self.sections, start=1):
            name = section.name if isinstance(section, Section) else f"section_{number}"
            part = section(context)
            if part is not None and part.strip():
                found.append((name, part.strip()))
        return found

    def text(self, context: PromptContext) -> str:
        """The prompt for ``context``, or ``""`` when no section has anything to say."""
        return "\n\n".join(text for _, text in self.parts(context))

    def message(self, context: PromptContext) -> SystemMessage | None:
        """The system message for one model call, or None when the prompt is empty."""
        text = self.text(context)
        return SystemMessage(content=text) if text else None


__all__ = ["PINNED_KEY", "PromptContext", "Section", "SectionFn", "SystemPrompt"]
