"""The system prompt section that carries the user's instruction lines from ``[chat]``."""

from __future__ import annotations

from golem.config import ChatSettings
from golem.graphs.prompt import PromptContext, Section
from golem.models.router import ModelRouter

INSTRUCTIONS_SECTION = "instructions"

INSTRUCTIONS_HEAD = (
    "How the user wants you to answer. Follow these unless the user asks otherwise in the chat:"
)


def instructions_text(chat: ChatSettings) -> str | None:
    """The head and one ``- line`` per instruction, or None with no lines."""
    if not chat.instructions:
        return None
    return "\n".join([INSTRUCTIONS_HEAD, *(f"- {line}" for line in chat.instructions)])


def instructions_section(router: ModelRouter) -> Section:
    """The section that reads ``[chat] instructions`` on each call, so a change shows at once."""

    def build(_context: PromptContext) -> str | None:
        return instructions_text(router.chat_settings())

    return Section(INSTRUCTIONS_SECTION, build)


__all__ = [
    "INSTRUCTIONS_HEAD",
    "INSTRUCTIONS_SECTION",
    "instructions_section",
    "instructions_text",
]
