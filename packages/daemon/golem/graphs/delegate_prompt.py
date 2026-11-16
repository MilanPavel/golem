"""The system prompt section that tells a model with a small window when to call ``delegate``."""

from __future__ import annotations

from golem.graphs.prompt import PromptContext, Section

DELEGATE_SECTION = "delegate"

SMALL_WINDOW = 65_536
"""A window at or below this many tokens is small."""

DELEGATE_TEXT = (
    "Your context is small. For a question that needs many files read or searched\n"
    "(what a project is, where something is used, how parts fit together), call\n"
    "delegate with a clear brief instead of reading the files yourself. Read a file\n"
    "yourself only when you know which one you need."
)


def delegate_section(context: PromptContext) -> str | None:
    """The text when ``delegate`` is offered and the window is known and small, else None.

    A helper is never offered ``delegate``, and a model that takes no tools is offered nothing,
    so neither gets the text. The text is fixed, so it is the same on every call of a session.
    """
    if "delegate" not in context.tools:
        return None
    if context.window is None or context.window > SMALL_WINDOW:
        return None
    return DELEGATE_TEXT


DELEGATE_PROMPT = Section(DELEGATE_SECTION, delegate_section)

__all__ = [
    "DELEGATE_PROMPT",
    "DELEGATE_SECTION",
    "DELEGATE_TEXT",
    "SMALL_WINDOW",
    "delegate_section",
]
