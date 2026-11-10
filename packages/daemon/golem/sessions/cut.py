"""Whether Ollama cut a prompt that did not fit, worked out from what the events recorded.

Pure: no I/O, no clock. Ollama cuts a prompt silently, and no reply field says so, so
golem proves what it can from exact numbers and says "likely" for the rest.

For a call of an Ollama model with an exact window ``W`` and input tokens ``C``:

1. ``no`` (proven): the bytes sent, ``B``, are below ``W``. A token is at least one byte.
2. ``yes`` (proven), ``older_messages``: an earlier call of the same model and window sent a
   strict prefix of these messages, with the same system prompt and tools, and took in more
   tokens than ``C``. The prompt grew, but fewer tokens arrived.
3. ``likely``: not 1 or 2, and the estimate ``E`` (characters times a tokens-per-character
   ratio) is at least ``W``. ``middle`` when ``C`` is at most ``0.6 * W``, else ``older_messages``.
4. Otherwise nothing is said.

The size of a cut is always an estimate, even for ``yes``.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

from golem_protocol.events import ModelCallStartedData

Cut = Literal["no", "yes", "likely"]
Kind = Literal["older_messages", "middle"]

OLLAMA = "ollama"
"""The provider name of a local Ollama. A call of any other provider is never judged: hosted
models reject a prompt that is too long, and a server under another name is not known to cut."""

PER_MESSAGE_BYTES = 16
"""Bytes added to each message in the bound ``B``, for the chat template around it."""

DEFAULT_TOKENS_PER_CHAR = 1 / 4
"""The ratio when no earlier call of the model is proven uncut."""

MIDDLE_SHARE = 0.6
"""At most this share of the window arriving means the prompt was cut to about half."""


@dataclass(frozen=True, slots=True)
class CallFacts:
    """One model call of a session, as the events recorded it.

    ``window`` is None unless it is exact. ``used`` is the input tokens, None when not reported.
    """

    started: ModelCallStartedData
    model: str | None
    window: int | None
    used: int | None


@dataclass(frozen=True, slots=True)
class PromptCut:
    """What is known about a cut. ``cut`` None means golem cannot tell."""

    cut: Cut | None = None
    kind: Kind | None = None
    dropped_message_ids: tuple[str, ...] = ()
    dropped_tokens: int | None = None


def _sized(data: ModelCallStartedData) -> bool:
    return (
        data.system_bytes is not None
        and data.system_chars is not None
        and data.tools_bytes is not None
        and data.tools_chars is not None
        and data.message_bytes is not None
        and data.message_chars is not None
    )


def sent_bytes(data: ModelCallStartedData) -> int | None:
    """``B``: the UTF-8 bytes sent, plus 16 for each message. None when not recorded."""
    if not _sized(data):
        return None
    messages = data.message_bytes or []
    return (
        (data.system_bytes or 0)
        + (data.tools_bytes or 0)
        + sum(messages)
        + PER_MESSAGE_BYTES * len(messages)
    )


def sent_chars(data: ModelCallStartedData) -> int | None:
    """The characters sent: system text, tool schemas, and every message. None when not recorded."""
    if not _sized(data):
        return None
    return (data.system_chars or 0) + (data.tools_chars or 0) + sum(data.message_chars or [])


def _uncut(call: CallFacts) -> bool:
    """Rule 1: the bytes sent are below the exact window."""
    if call.model is None or call.window is None:
        return False
    sent = sent_bytes(call.started)
    return sent is not None and sent < call.window


def tokens_per_char(earlier: Sequence[CallFacts], model: str | None) -> float:
    """``C / chars`` of the latest earlier call of ``model`` that rule 1 proved uncut, else 1/4."""
    if model is None:
        return DEFAULT_TOKENS_PER_CHAR
    for call in reversed(earlier):
        if call.model != model or not _uncut(call) or call.used is None:
            continue
        chars = sent_chars(call.started)
        if chars:
            return call.used / chars
    return DEFAULT_TOKENS_PER_CHAR


def _grown_from(call: CallFacts, here: CallFacts, used: int) -> bool:
    before = call.started.message_ids
    now = here.started.message_ids
    return (
        call.model == here.model
        and call.window == here.window
        and call.used is not None
        and call.used > used
        and 0 < len(before) < len(now)
        and now[: len(before)] == before
        and call.started.system_prompt_sha == here.started.system_prompt_sha
        and call.started.tools_sha == here.started.tools_sha
    )


def _dropped(here: CallFacts, used: int, ratio: float) -> tuple[tuple[str, ...], int | None]:
    """The oldest messages to mark as not seen, and an estimate of their tokens.

    Messages go oldest first, never the last one. Each is weighed by its characters times
    ``ratio``, the system prompt and tools the same way. Marking stops when what is left is
    estimated at ``used`` tokens or fewer.
    """
    data = here.started
    ids, chars = data.message_ids, data.message_chars or []
    if len(ids) != len(chars) or len(ids) < 2:
        return (), None
    left = ((data.system_chars or 0) + (data.tools_chars or 0) + sum(chars)) * ratio
    gone: list[str] = []
    freed = 0.0
    for message_id, size in zip(ids[:-1], chars[:-1], strict=True):
        if left <= used:
            break
        gone.append(message_id)
        left -= size * ratio
        freed += size * ratio
    return tuple(gone), round(freed)


def judge(here: CallFacts, earlier: Sequence[CallFacts]) -> PromptCut:
    """What is known about a cut of ``here``, given the calls of the session before it."""
    data = here.started
    if data.provider != OLLAMA or here.model is None or here.window is None:
        return PromptCut()
    sent = sent_bytes(data)
    chars = sent_chars(data)
    if sent is None or chars is None:
        return PromptCut()
    window, used = here.window, here.used
    if sent < window:
        return PromptCut("no")
    if used is None:
        return PromptCut()
    ratio = tokens_per_char(earlier, here.model)
    proven = next((c for c in reversed(earlier) if _grown_from(c, here, used)), None)
    if proven is not None:
        ids, tokens = _dropped(here, used, ratio)
        return PromptCut("yes", "older_messages", ids, tokens)
    if chars * ratio < window:
        return PromptCut()
    if used <= MIDDLE_SHARE * window:
        return PromptCut("likely", "middle")
    ids, tokens = _dropped(here, used, ratio)
    return PromptCut("likely", "older_messages", ids, tokens)
