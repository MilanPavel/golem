"""Chat models that never call the network."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Iterator
from typing import Any

from langchain_core.callbacks import AsyncCallbackManagerForLLMRun, CallbackManagerForLLMRun
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, AIMessageChunk, BaseMessage, ToolCall, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult
from pydantic import Field, PrivateAttr


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
        return ChatResult(generations=[ChatGeneration(message=message)])


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
