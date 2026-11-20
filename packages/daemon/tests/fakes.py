"""Chat models that never call the network."""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator, Callable, Iterator, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from langchain_core.callbacks import AsyncCallbackManagerForLLMRun, CallbackManagerForLLMRun
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import (
    AIMessage,
    AIMessageChunk,
    BaseMessage,
    HumanMessage,
    SystemMessage,
    ToolCall,
    ToolMessage,
)
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult
from pydantic import Field, PrivateAttr

from golem.config import ModelPrice
from golem.models.facts import ModelFacts
from golem.models.tiers import Tier, blended


def _no_prompts() -> list[list[str]]:
    return []


class ScriptedChatModel(BaseChatModel):
    """Yields one character at a time from ``replies`` and records each prompt."""

    replies: list[str]
    seen: list[list[str]] = Field(default_factory=_no_prompts)

    @property
    def _llm_type(self) -> str:
        return "scripted"

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        del stop, run_manager, kwargs
        text = self._take(messages)
        return ChatResult(generations=[ChatGeneration(message=AIMessage(content=text))])

    def _stream(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> Iterator[ChatGenerationChunk]:
        del stop, run_manager, kwargs
        text = self._take(messages)
        for char in text:
            yield ChatGenerationChunk(message=AIMessageChunk(content=char))

    def _take(self, messages: list[BaseMessage]) -> str:
        self.seen.append([message.text for message in messages])
        if not self.replies:
            raise RuntimeError("no scripted reply")
        return self.replies.pop(0)


Calls = list[tuple[str, dict[str, Any]]]


def _no_histories() -> list[list[BaseMessage]]:
    return []


class ToolCallingChatModel(BaseChatModel):
    """Answers with ``replies`` in order: a string is text, a list is tool calls.

    Like a provider, it refuses a history where a tool call has no result.
    ``bind_tools`` records the tool names and returns the model itself.
    """

    replies: list[str | Calls]
    seen: list[list[BaseMessage]] = Field(default_factory=_no_histories)
    bound: list[str] = Field(default_factory=list[str])
    calls_made: int = 0
    usage: dict[str, Any] | None = None
    response_metadata: dict[str, Any] = Field(default_factory=dict[str, Any])

    @property
    def _llm_type(self) -> str:
        return "tool-calling"

    def bind_tools(self, tools: Any, **kwargs: Any) -> Any:
        del kwargs
        self.bound = [tool["function"]["name"] for tool in tools]
        return self

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        del stop, run_manager, kwargs
        _check_answered(messages)
        self.seen.append(list(messages))
        if not self.replies:
            raise RuntimeError("no scripted reply")
        reply = self.replies.pop(0)
        if isinstance(reply, str):
            message = AIMessage(content=reply)
        else:
            calls: list[ToolCall] = []
            for name, args in reply:
                self.calls_made += 1
                calls.append(ToolCall(name=name, args=args, id=f"call_{self.calls_made}"))
            message = AIMessage(content="", tool_calls=calls)
        message.usage_metadata = self.usage  # type: ignore[assignment]
        message.response_metadata = dict(self.response_metadata)
        return ChatResult(generations=[ChatGeneration(message=message)])


def _no_calls() -> list[WindowCall]:
    return []


@dataclass(frozen=True, slots=True)
class WindowCall:
    """One request a :class:`WindowedChatModel` took: what it counted and what it reported."""

    chars: int
    tokens: int
    cut: bool
    messages: list[BaseMessage]


Script = Callable[[int, int], "str | Calls"]
"""``(turn, done)`` to the reply: ``done`` is the tool results of this turn so far."""

SUMMARISER_ASK = "Reply with one JSON object"


class WindowedChatModel(ToolCallingChatModel):
    """A model that knows its window and reports ``input_tokens`` from what it was sent.

    It counts the characters of the messages, the tool calls in them, the system text and the
    bound tool schemas. It reports ``min(round(chars * tokens_per_char), window)`` and marks a
    call as cut when ``chars * tokens_per_char`` is over the window. The turn number is the
    ``N`` of the last message that starts ``ask N``. A summary request is answered with a valid
    summary and kept in ``summaries``, apart from ``calls``.
    """

    window: int
    tokens_per_char: float = 0.3
    script: Script
    calls: list[WindowCall] = Field(default_factory=_no_calls)
    summaries: list[WindowCall] = Field(default_factory=_no_calls)
    schema_chars: int = 0

    def bind_tools(self, tools: Any, **kwargs: Any) -> Any:
        self.schema_chars = len(json.dumps(tools, sort_keys=True))
        return super().bind_tools(tools, **kwargs)

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        del stop, run_manager, kwargs
        _check_answered(messages)
        summing = any(isinstance(m, SystemMessage) and SUMMARISER_ASK in m.text for m in messages)
        chars = sum(len(m.text) for m in messages)
        chars += sum(
            len(json.dumps(call["args"])) + len(call["name"])
            for m in messages
            if isinstance(m, AIMessage)
            for call in m.tool_calls
        )
        chars += 0 if summing else self.schema_chars
        wanted = chars * self.tokens_per_char
        tokens = min(round(wanted), self.window)
        record = WindowCall(chars, tokens, wanted > self.window, list(messages))
        if summing:
            self.summaries.append(record)
            body = {
                "request": f"SUMMARY-{len(self.summaries)}",
                "done": ["did things"],
                "files": [],
                "facts": [],
                "open": [],
            }
            message = AIMessage(content=json.dumps(body))
        else:
            self.calls.append(record)
            turn, done = _turn_of(messages)
            reply = self.script(turn, done)
            if isinstance(reply, str):
                message = AIMessage(content=reply)
            else:
                calls: list[ToolCall] = []
                for name, args in reply:
                    self.calls_made += 1
                    calls.append(ToolCall(name=name, args=args, id=f"call_{self.calls_made}"))
                message = AIMessage(content="", tool_calls=calls)
        message.usage_metadata = {  # type: ignore[assignment]
            "input_tokens": tokens,
            "output_tokens": 1,
            "total_tokens": tokens + 1,
        }
        return ChatResult(generations=[ChatGeneration(message=message)])

    def with_structured_output(self, schema: Any, **kwargs: Any) -> Any:
        raise NotImplementedError


def _turn_of(messages: list[BaseMessage]) -> tuple[int, int]:
    """The number ``N`` of the last ``ask N`` message and the tool results after it."""
    done = 0
    for message in reversed(messages):
        if isinstance(message, ToolMessage):
            done += 1
        elif isinstance(message, HumanMessage) and message.text.startswith("ask "):
            return int(message.text.split()[1]), done
    raise RuntimeError("no ask in the request")


class StreamingToolChatModel(ToolCallingChatModel):
    """:class:`ToolCallingChatModel` that streams each tool call as pieces of its JSON text.

    A call comes as one chunk with its name and id, then its arguments ``piece`` characters
    at a time, like a hosted provider. Text replies stream one character at a time.
    """

    piece: int = 8

    def _stream(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> Iterator[ChatGenerationChunk]:
        message = self._generate(messages, stop, run_manager, **kwargs).generations[0].message
        assert isinstance(message, AIMessage)
        for char in message.text:
            yield ChatGenerationChunk(message=AIMessageChunk(content=char))
        for index, call in enumerate(message.tool_calls):
            head = {"name": call["name"], "args": "", "id": call.get("id"), "index": index}
            yield ChatGenerationChunk(message=AIMessageChunk(content="", tool_call_chunks=[head]))  # type: ignore[list-item]
            text = json.dumps(call["args"])
            for start in range(0, len(text), self.piece):
                args = text[start : start + self.piece]
                part = {"name": None, "args": args, "id": None, "index": index}
                yield ChatGenerationChunk(
                    message=AIMessageChunk(content="", tool_call_chunks=[part])  # type: ignore[list-item]
                )


def _check_answered(messages: list[BaseMessage]) -> None:
    answered = {message.tool_call_id for message in messages if isinstance(message, ToolMessage)}
    for message in messages:
        if isinstance(message, AIMessage):
            for call in message.tool_calls:
                if call.get("id") not in answered:
                    raise RuntimeError(f"tool call {call.get('id')} has no result")


class GatedChatModel(BaseChatModel):
    """Streams ``streamed`` one character at a time, then blocks until :attr:`release`.

    Records each prompt in ``seen``.
    """

    reply: str = "ok"
    streamed: str = ""
    seen: list[list[str]] = Field(default_factory=_no_prompts)
    _started: asyncio.Event = PrivateAttr(default_factory=asyncio.Event)
    _release: asyncio.Event = PrivateAttr(default_factory=asyncio.Event)

    @property
    def started(self) -> asyncio.Event:
        return self._started

    @property
    def release(self) -> asyncio.Event:
        return self._release

    @property
    def _llm_type(self) -> str:
        return "gated"

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        del messages, stop, run_manager, kwargs
        return ChatResult(generations=[ChatGeneration(message=AIMessage(content=self.reply))])

    async def _astream(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: AsyncCallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> AsyncIterator[ChatGenerationChunk]:
        del stop, run_manager, kwargs
        self.seen.append([message.text for message in messages])
        for char in self.streamed:
            yield ChatGenerationChunk(message=AIMessageChunk(content=char))
        self._started.set()
        await self._release.wait()
        yield ChatGenerationChunk(message=AIMessageChunk(content=self.reply))


def model_facts(
    ref: str, tier: Tier, window: int = 32000, price: float | None = None
) -> ModelFacts:
    """The facts of one ready model that takes tools. ``price`` is per million, in and out."""
    model_price = None if price is None else ModelPrice(input=price, output=price)
    return ModelFacts(
        ref=ref,
        profile=ref,
        tier=tier,
        ready=True,
        why_not_ready=None,
        window=window,
        window_exact=True,
        tools=True,
        vision=False,
        price=model_price,
        blended=None if model_price is None else blended(model_price),
        prompt_tps=None,
        reply_tps=None,
        tool_score=None,
    )


class FixedFacts:
    """A fixed list of model facts, whatever refs are asked for."""

    def __init__(self, *models: ModelFacts) -> None:
        self.models = list(models)

    async def facts(
        self, refs: Sequence[str], *, overrides: Mapping[str, float | str] | None = None
    ) -> list[ModelFacts]:
        del refs, overrides
        return list(self.models)
