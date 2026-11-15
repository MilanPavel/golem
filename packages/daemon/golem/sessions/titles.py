"""Short session titles, chosen once after the first completed run.

The model is asked outside the graph, so the question and its answer never
enter the checkpoint. When it fails or takes too long, the title is the first
line the user wrote.

The model is the one ``[routing.roles] titles`` picks (see ``golem.models.roles``).
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable, Mapping
from typing import Protocol

from langchain_core.messages import HumanMessage, SystemMessage

from golem.models.gate import ServerGate
from golem.models.roles import for_role
from golem.models.router import ModelConfigError, ModelRouter
from golem.models.tiers import Tier

log = logging.getLogger("golem.sessions")

TITLE_MAX_CHARS = 60
TITLE_TIMEOUT_SECONDS = 20.0

_INSTRUCTION = (
    "Name this conversation in at most six words. Reply with the name only:"
    " no quotes, no trailing punctuation."
)
_REPLY_CHARS = 2_000
TITLE_NUM_PREDICT = 64


class TitleGenerator(Protocol):
    """Proposes a title for a session from its first exchange."""

    async def title(
        self,
        model_profile: str,
        prompt: str,
        reply: str,
        options: Mapping[str, float | str] | None = None,
    ) -> str: ...


class ModelTitles:
    """Asks the model of the role ``titles``.

    That is the session's model on a local session, called with the session's own options
    so Ollama does not reload it. On a hosted session it is a ready budget model, when
    there is one. ``tier_of_ref`` and ``budget_refs`` read what discovery has cached, with
    no network call; until they are set, the session's model is used.
    """

    def __init__(self, router: ModelRouter, gate: ServerGate | None = None) -> None:
        self._router = router
        self._gate = gate
        self._tier_of_ref: Callable[[str], Tier | None] = lambda ref: None
        self._budget_refs: Callable[[], list[str]] = list

    def bind(
        self, tier_of_ref: Callable[[str], Tier | None], budget_refs: Callable[[], list[str]]
    ) -> None:
        """Use the cached listing to tell tiers and find ready budget models."""
        self._tier_of_ref = tier_of_ref
        self._budget_refs = budget_refs

    def _tier_of_profile(self, profile: str) -> Tier | None:
        try:
            return self._tier_of_ref(self._router.resolve(profile).ref)
        except ModelConfigError:
            return None

    async def title(
        self,
        model_profile: str,
        prompt: str,
        reply: str,
        options: Mapping[str, float | str] | None = None,
    ) -> str:
        role = for_role(
            "titles",
            session_profile=model_profile,
            settings=self._router.roles(),
            tier_of_profile=self._tier_of_profile,
            budget_models=self._budget_refs(),
        )
        overrides: dict[str, float | str] = dict(options or {}) if role.same_as_session else {}
        server = self._router.ollama_server(role.profile)
        if server is not None:
            # A title is six words. num_predict does not reload the model; num_ctx does.
            overrides["num_predict"] = TITLE_NUM_PREDICT
            model_id = self._router.resolve(role.profile).model_id
            if "off" in (self._router.think_values(model_id) or ()):
                overrides["think"] = "off"
        model = self._router.chat_model(role.profile, overrides)
        gate = self._gate or ServerGate()
        # A title waits behind the chat on the local server of the model it runs on.
        async with gate.hold(None if self._gate is None or server is None else server[1], "job"):
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
    options: Mapping[str, float | str] | None = None,
    timeout: float = TITLE_TIMEOUT_SECONDS,
) -> str:
    """A clean title from ``generator``, or from ``prompt`` when that fails."""
    try:
        async with asyncio.timeout(timeout):
            proposed = await generator.title(model_profile, prompt, reply, options)
    except Exception:
        log.warning("title generation failed; using the first line", exc_info=True)
        proposed = ""
    return clean_title(proposed) or clean_title(prompt) or "untitled"


_FORK_SUFFIX = " (fork)"


def fork_title(title: str) -> str:
    """``title (fork)``, with ``title`` cut so the whole fits in 60 characters."""
    room = TITLE_MAX_CHARS - len(_FORK_SUFFIX)
    base = title if len(title) <= room else title[: room - 1].rstrip() + "…"
    return base + _FORK_SUFFIX


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
    "fork_title",
]
