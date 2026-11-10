"""``ChatOllama`` with the ``min_p`` option and the thinking Ollama returns.

The library keeps ``message.thinking`` only when ``reasoning`` is set, and then
it also sends ``think`` to Ollama. golem sends no ``think``. A thinking model
thinks by default, so :class:`OllamaChat` keeps what comes back and leaves the
request as it was.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Iterator
from typing import Any

from langchain_core.messages import BaseMessage
from langchain_core.outputs import ChatGenerationChunk
from langchain_ollama import ChatOllama

_UNSENT = "_golem_think_unsent"
"""Call option: the ``think`` to send when the library was told to keep thinking."""


class OllamaChat(ChatOllama):
    """``ChatOllama`` that sends ``min_p`` and keeps thinking as ``reasoning_content``."""

    min_p: float | None = None

    def _chat_params(
        self, messages: list[BaseMessage], stop: list[str] | None = None, **kwargs: Any
    ) -> dict[str, Any]:
        keep = _UNSENT in kwargs
        think = kwargs.pop(_UNSENT, None)
        params = super()._chat_params(messages, stop, **kwargs)
        if keep:
            params["think"] = think
        if self.min_p is not None:
            params["options"] = {**(params.get("options") or {}), "min_p": self.min_p}
        return params

    def _iterate_over_stream(
        self, messages: list[BaseMessage], stop: list[str] | None = None, **kwargs: Any
    ) -> Iterator[ChatGenerationChunk]:
        return super()._iterate_over_stream(messages, stop, **self._keeping_thinking(kwargs))

    def _aiterate_over_stream(
        self, messages: list[BaseMessage], stop: list[str] | None = None, **kwargs: Any
    ) -> AsyncIterator[ChatGenerationChunk]:
        return super()._aiterate_over_stream(messages, stop, **self._keeping_thinking(kwargs))

    def _keeping_thinking(self, kwargs: dict[str, Any]) -> dict[str, Any]:
        """``kwargs`` that make the library keep thinking, with the request unchanged.

        The library tests ``reasoning`` once to decide whether to keep thinking and
        once to build ``think``. With ``reasoning`` unset, the first test is made to
        pass and ``think`` is put back to the value it had, so Ollama gets what it did
        before.
        """
        reasoning = kwargs.get("reasoning", self.reasoning)
        if reasoning:
            return kwargs
        return {**kwargs, "reasoning": True, _UNSENT: reasoning}
