"""Short session titles, chosen once after the first completed run.

The model is asked outside the graph, so the question and its answer never
enter the checkpoint. When it fails or takes too long, the title is the first
line the user wrote.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Protocol

from langchain_core.messages import HumanMessage, SystemMessage

from golem.models.router import ModelRouter

log = logging.getLogger("golem.sessions")

TITLE_MAX_CHARS = 60
TITLE_TIMEOUT_SECONDS = 20.0

_INSTRUCTION = (
    "Name this conversation in at most six words. Reply with the name only:"
    " no quotes, no trailing punctuation."
)
_REPLY_CHARS = 2_000


class TitleGenerator(Protocol):
    """Proposes a title for a session from its first exchange."""

    async def title(self, model_profile: str, prompt: str, reply: str) -> str: ...


class ModelTitles:
    """Asks the session's own model. Phase 6 moves this to a cheap profile."""

    def __init__(self, router: ModelRouter) -> None:
        self._router = router

    async def title(self, model_profile: str, prompt: str, reply: str) -> str:
        model = self._router.chat_model(model_profile)
        answer = await model.ainvoke(
            [
                SystemMessage(content=_INSTRUCTION),
                HumanMessage(content=f"User: {prompt}\n\nAssistant: {reply[:_REPLY_CHARS]}"),
            ]
        )
        return answer.text


async def choose_title(
    generator: TitleGenerator,
    *,
    model_profile: str,
    prompt: str,
    reply: str,
    timeout: float = TITLE_TIMEOUT_SECONDS,
) -> str:
    """A clean title from ``generator``, or from ``prompt`` when that fails."""
    try:
        async with asyncio.timeout(timeout):
            proposed = await generator.title(model_profile, prompt, reply)
    except Exception:
        log.warning("title generation failed; using the first line", exc_info=True)
        proposed = ""
    return clean_title(proposed) or clean_title(prompt) or "untitled"


def clean_title(text: str) -> str:
    """The first non-blank line, unquoted, one space between words, at most 60 chars.

    Returns ``""`` when nothing is left.
    """
    line = next((line for line in text.splitlines() if line.strip()), "")
    words = " ".join(line.split()).strip("\"'`*#").strip()
    words = words.removeprefix("Title:").strip().rstrip(".")
    if len(words) <= TITLE_MAX_CHARS:
        return words
    return words[: TITLE_MAX_CHARS - 1].rstrip() + "…"


__all__ = [
    "TITLE_MAX_CHARS",
    "ModelTitles",
    "TitleGenerator",
    "choose_title",
    "clean_title",
]
