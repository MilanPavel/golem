"""``ChatOllama`` with the ``min_p`` option, which the library does not carry yet."""

from __future__ import annotations

from typing import Any

from langchain_core.messages import BaseMessage
from langchain_ollama import ChatOllama


class OllamaChat(ChatOllama):
    """``ChatOllama`` that also sends ``min_p`` in the request's options."""

    min_p: float | None = None

    def _chat_params(
        self, messages: list[BaseMessage], stop: list[str] | None = None, **kwargs: Any
    ) -> dict[str, Any]:
        params = super()._chat_params(messages, stop, **kwargs)
        if self.min_p is not None:
            params["options"] = {**(params.get("options") or {}), "min_p": self.min_p}
        return params
