"""The benchmark: how fast a local model is at 1 to 4 calls at once.

Two shapes run at each count: a tool-calling loop and one 20K-token prompt. A level
starts its calls together and measures each call's tokens per second, the total
tokens per second across them, and the window (the seconds from the first start to the
last end). :func:`run_levels` knows nothing of a model or an engine. It takes a ``call``
that makes one call of a shape, so a fake engine can stand in.

:func:`bench` is the real run. With no local model it raises :class:`NoLocalModel` first
and starts and asks nothing. For a server golem owns it restarts the server with 4
slots for the run and puts the ``[ollama] parallel`` setting back after. For any
other server it runs up to ``limit`` calls at once, which the caller takes from the
overlap probe. The calls go straight to the engine and do not take dispatcher slots: the
point is to load the engine with exactly N calls.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from typing import Literal

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, ToolMessage

from golem.models.engine import OLLAMA
from golem.models.ollama import LocalServers
from golem.models.router import ModelRouter

Shape = Literal["tools", "prompt"]

SHAPES: tuple[Shape, ...] = ("tools", "prompt")
MAX_AT_ONCE = 4
PROMPT_TOKENS = 20_000
_CHARS_PER_TOKEN = 4
_TOOL_ROUNDS = 4
_TOOL_REPLY_TOKENS = 256
_PROMPT_REPLY_TOKENS = 128
_FILLER = "The quick brown fox jumps over the lazy dog while the clock keeps time. "
_LOOKUP: dict[str, object] = {
    "type": "function",
    "function": {
        "name": "lookup",
        "description": "Look up the value stored under a key.",
        "parameters": {
            "type": "object",
            "properties": {"key": {"type": "string", "description": "The key to look up."}},
            "required": ["key"],
        },
    },
}


class NoLocalModel(Exception):
    """There is no local model to measure. The message says so, and nothing was started."""


@dataclass(frozen=True, slots=True)
class Sample:
    """One call: the reply tokens it wrote and the seconds it took."""

    tokens: int
    seconds: float

    @property
    def tps(self) -> float:
        return self.tokens / self.seconds if self.seconds > 0 else 0.0


@dataclass(frozen=True, slots=True)
class Row:
    """One shape at one count: each call's speed, the total and the window."""

    shape: Shape
    at_once: int
    calls: tuple[Sample, ...]
    window: float  # seconds from the first start to the last end

    @property
    def each(self) -> tuple[float, ...]:
        """Tokens per second of each call."""
        return tuple(call.tps for call in self.calls)

    @property
    def total(self) -> float:
        """Tokens per second across all calls in the window."""
        tokens = sum(call.tokens for call in self.calls)
        return tokens / self.window if self.window > 0 else 0.0


@dataclass(frozen=True, slots=True)
class Result:
    """What the run measured for one model."""

    model: str
    rows: tuple[Row, ...]

    def table(self) -> str:
        """The rows as text: shape, calls at once, each call, total and window."""
        lines = [
            f"{self.model}",
            f"{'shape':<7}{'at once':>8}{'each tok/s':>22}{'total':>9}{'window':>9}",
        ]
        for row in self.rows:
            each = " ".join(f"{tps:.1f}" for tps in row.each)
            lines.append(
                f"{row.shape:<7}{row.at_once:>8}{each:>22}{row.total:>9.1f}{row.window:>8.1f}s"
            )
        return "\n".join(lines)


Call = Callable[[Shape], Awaitable[Sample]]
"""Makes one call of a shape and says what it wrote and how long it took."""

OnRow = Callable[[int, int, Row], None]
"""Hears each finished row: its place from 1, the number of rows, and the row."""


async def run_levels(
    call: Call,
    levels: Sequence[int],
    shapes: Sequence[Shape] = SHAPES,
    *,
    on_row: OnRow | None = None,
    clock: Callable[[], float] = time.monotonic,
) -> list[Row]:
    """Run each shape at each count in ``levels``. A level's calls start together."""
    rows: list[Row] = []
    total = len(shapes) * len(levels)
    for shape in shapes:
        for at_once in levels:
            started = clock()
            samples = await asyncio.gather(*(call(shape) for _ in range(at_once)))
            rows.append(Row(shape, at_once, tuple(samples), clock() - started))
            if on_row is not None:
                on_row(len(rows), total, rows[-1])
    return rows


def local_profile(router: ModelRouter, model: str | None = None) -> str:
    """The profile to measure: ``model``, or the default when local, or the first local one.

    Raises :class:`NoLocalModel` when there is none.
    """
    if model is not None:
        if router.ollama_server(model) is None:
            raise NoLocalModel(f"{model} is not a local model")
        return model
    default = router.default
    if default is not None and router.ollama_server(default) is not None:
        return default
    for name in router.profiles():
        if router.ollama_server(name) is not None:
            return name
    raise NoLocalModel("there is no local model to measure")


async def bench(
    router: ModelRouter,
    local: LocalServers,
    model: str | None = None,
    *,
    limit: int = 1,
    shapes: Sequence[Shape] = SHAPES,
    on_row: OnRow | None = None,
    clock: Callable[[], float] = time.monotonic,
) -> Result:
    """Measure a local model at 1 to 4 calls at once.

    ``limit`` is how many calls at once an external server took in the probe. It is
    used only for a server golem does not own. ``on_row`` hears each row as it ends.
    Raises :class:`NoLocalModel` before anything starts when there is no local model.
    """
    profile = local_profile(router, model)
    target = router.ollama_server(profile)
    server = None if target is None else local.get(*target)
    if server is None:
        raise NoLocalModel(f"{profile} does not run on this machine")
    saved = local.settings
    # A server golem owns takes the new count when it is held next, between calls.
    local.settings = saved.model_copy(update={"parallel": MAX_AT_ONCE})
    try:
        async with server.hold():
            top = MAX_AT_ONCE if server.owner == "golem" else min(max(limit, 1), MAX_AT_ONCE)
            top = min(top, OLLAMA.max_slots)
            call = _model_call(router, profile)
            await _warm(router, profile)
            rows = await run_levels(call, range(1, top + 1), shapes, on_row=on_row, clock=clock)
    finally:
        local.settings = saved
    return Result(router.resolve(profile).ref, tuple(rows))


def _chat(router: ModelRouter, profile: str, num_predict: int) -> BaseChatModel:
    return router.chat_model(profile, {"temperature": 0.0, "num_predict": num_predict})


async def _warm(router: ModelRouter, profile: str) -> None:
    """Load the model before the first measure, so a load is not counted as speed."""
    await _chat(router, profile, 1).ainvoke("Say hi.")


def _model_call(router: ModelRouter, profile: str) -> Call:
    async def call(shape: Shape) -> Sample:
        started = time.monotonic()
        if shape == "tools":
            tokens = await _tool_loop(_chat(router, profile, _TOOL_REPLY_TOKENS))
        else:
            tokens = await _long_prompt(_chat(router, profile, _PROMPT_REPLY_TOKENS))
        return Sample(tokens, time.monotonic() - started)

    return call


def _written(message: AIMessage) -> int:
    usage = message.usage_metadata
    return usage["output_tokens"] if usage else 0


async def _tool_loop(chat: BaseChatModel) -> int:
    """A few rounds of a model calling a tool and reading a canned result. Returns tokens."""
    bound = chat.bind_tools([_LOOKUP])
    messages: list[BaseMessage] = [
        HumanMessage(
            "Look up the keys alpha, beta and gamma with the lookup tool, one call at a "
            "time, then say which value is the largest."
        )
    ]
    tokens = 0
    for round_ in range(_TOOL_ROUNDS):
        reply = await bound.ainvoke(messages)
        assert isinstance(reply, AIMessage)
        tokens += _written(reply)
        if not reply.tool_calls:
            break
        messages.append(reply)
        messages += [
            ToolMessage(content=str(10 * (round_ + 1)), tool_call_id=found["id"] or "call")
            for found in reply.tool_calls
        ]
    return tokens


async def _long_prompt(chat: BaseChatModel) -> int:
    """One prompt of about 20K tokens. Returns tokens written."""
    # A different first line per call, so one slot's prompt cache does not serve another.
    text = _FILLER * (PROMPT_TOKENS * _CHARS_PER_TOKEN // len(_FILLER))
    prompt = f"Run {uuid.uuid4().hex}.\n{text}\n\nWrite a short poem about the text above."
    reply = await chat.ainvoke(prompt)
    assert isinstance(reply, AIMessage)
    return _written(reply)


__all__ = [
    "MAX_AT_ONCE",
    "SHAPES",
    "Call",
    "NoLocalModel",
    "OnRow",
    "Result",
    "Row",
    "Sample",
    "Shape",
    "bench",
    "local_profile",
    "run_levels",
]
