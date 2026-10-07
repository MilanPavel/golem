"""One chat model, chosen by profile name.

A remote provider reads its API key from the process environment at call time.
``openai_compat`` talks to a local OpenAI-compatible server and does not read a key.
Neither the key nor the base URL is stored in graph state.
"""

from __future__ import annotations

import os

from langchain_core.language_models import BaseChatModel

from golem.config import GolemSettings


class ModelConfigError(Exception):
    """The profile, provider, model name, or API key is missing."""


_OLLAMA_BASE_URL = "http://127.0.0.1:11434/v1"


class ModelRouter:
    """Resolve a profile name to a chat model.

    ``model`` is a test double. When it is set, :meth:`chat_model` returns it
    for :attr:`profile_name` and does not read the environment.
    """

    def __init__(
        self,
        settings: GolemSettings | None = None,
        *,
        model: BaseChatModel | None = None,
    ) -> None:
        if settings is None and model is None:
            raise ValueError("ModelRouter needs settings or a model")
        self._settings = settings
        self._model = model

    @property
    def profile_name(self) -> str:
        if self._settings is not None:
            return self._settings.model_profile
        return "remote"

    def chat_model(self, profile: str) -> BaseChatModel:
        """Return the chat model for ``profile``.

        Raises :class:`ModelConfigError` when the profile is unknown or the
        provider, model name, or API key is not configured. ``openai_compat``
        does not require an API key.
        """
        if profile != self.profile_name:
            raise ModelConfigError(f"unknown model profile: {profile}")
        if self._model is not None:
            return self._model
        settings = self._settings
        if settings is None:
            raise ModelConfigError("model settings are not configured")
        provider = settings.model_provider
        name = settings.model_name
        if provider is None or name is None:
            raise ModelConfigError("model_provider and model_name are not configured")
        if provider == "anthropic":
            return self._anthropic(name)
        if provider == "openai":
            return self._openai(name)
        return self._openai_compat(name, settings.model_base_url)

    def _anthropic(self, name: str) -> BaseChatModel:
        key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
        if key == "":
            raise ModelConfigError("ANTHROPIC_API_KEY is not set")
        from langchain_anthropic import ChatAnthropic

        return ChatAnthropic.model_validate({"model": name, "api_key": key})

    def _openai(self, name: str) -> BaseChatModel:
        key = os.environ.get("OPENAI_API_KEY", "").strip()
        if key == "":
            raise ModelConfigError("OPENAI_API_KEY is not set")
        from langchain_openai import ChatOpenAI

        return ChatOpenAI.model_validate({"model": name, "api_key": key})

    def _openai_compat(self, name: str, base_url: str | None) -> BaseChatModel:
        url = _OLLAMA_BASE_URL
        if base_url is not None and base_url.strip() != "":
            url = base_url.strip()
        from langchain_openai import ChatOpenAI

        return ChatOpenAI.model_validate(
            {"model": name, "base_url": url, "api_key": "ollama"},
        )
