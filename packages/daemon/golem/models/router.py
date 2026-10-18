"""Resolve a model name to a chat model.

A name is a profile from ``[models.<name>]`` or a ``provider/model`` ref, such
as ``ollama/qwen3:8b`` or ``openrouter/qwen/qwen3-235b-a22b``. A ref splits on
its first ``/``. The flat settings from before profiles load as one profile
named ``model_profile``, so sessions that stored that name keep resolving.

A provider with ``api_key_env`` reads its key from the process environment at
call time. Neither the key nor the base URL is stored in graph state.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from pathlib import Path

from langchain_core.language_models import BaseChatModel

from golem.config import (
    GolemSettings,
    ModelSettings,
    ProviderKind,
    ProviderSettings,
    load_settings,
)
from golem.paths import resolve_paths

log = logging.getLogger(__name__)


class ModelConfigError(Exception):
    """The model name, provider, or API key is missing or unknown."""


@dataclass(frozen=True, slots=True)
class Provider:
    """Where a provider's models live and which environment variable holds its key."""

    kind: ProviderKind
    base_url: str | None = None
    api_key_env: str | None = None


OLLAMA_BASE_URL = "http://127.0.0.1:11434"

PRESETS: dict[str, Provider] = {
    "anthropic": Provider(kind="anthropic", api_key_env="ANTHROPIC_API_KEY"),
    "openai": Provider(kind="openai", api_key_env="OPENAI_API_KEY"),
    "ollama": Provider(kind="ollama", base_url=OLLAMA_BASE_URL),
    "openrouter": Provider(
        kind="openai_compat",
        base_url="https://openrouter.ai/api/v1",
        api_key_env="OPENROUTER_API_KEY",
    ),
    "groq": Provider(
        kind="openai_compat",
        base_url="https://api.groq.com/openai/v1",
        api_key_env="GROQ_API_KEY",
    ),
    "together": Provider(
        kind="openai_compat",
        base_url="https://api.together.xyz/v1",
        api_key_env="TOGETHER_API_KEY",
    ),
    "lmstudio": Provider(kind="openai_compat", base_url="http://127.0.0.1:1234/v1"),
}

# The flat settings with any other base_url talk to it through this provider.
_LEGACY_PROVIDER = "legacy"
_OLLAMA_OPENAI_URLS = frozenset(
    {
        "http://127.0.0.1:11434",
        "http://127.0.0.1:11434/v1",
        "http://localhost:11434",
        "http://localhost:11434/v1",
    }
)


@dataclass(frozen=True, slots=True)
class ResolvedModel:
    """A name after profile lookup: the provider, the model id, and overrides."""

    name: str
    provider_name: str
    provider: Provider
    model_id: str
    ctx: int | None = None

    @property
    def ref(self) -> str:
        return f"{self.provider_name}/{self.model_id}"


@dataclass(frozen=True, slots=True)
class ModelIdentity:
    """A name the router answers, plus provider and model id when it resolves.

    ``provider`` and ``name`` are None when the name does not resolve, or when
    this router wraps a test double.
    """

    profile: str
    provider: str | None
    name: str | None


@dataclass(frozen=True, slots=True)
class _Catalog:
    default: str
    providers: dict[str, Provider]
    models: dict[str, ModelSettings]


class ModelRouter:
    """Resolve a model name to a chat model.

    ``model`` is a test double. When it is set, :meth:`chat_model` returns it
    for :attr:`profile_name` and does not read the environment.

    ``home`` makes the router re-read ``config.toml`` when the file changes,
    so a new profile needs no daemon restart. A file that no longer validates
    keeps the last good settings.
    """

    def __init__(
        self,
        settings: GolemSettings | None = None,
        *,
        model: BaseChatModel | None = None,
        home: Path | None = None,
    ) -> None:
        if settings is None and model is None:
            raise ValueError("ModelRouter needs settings or a model")
        self._model = model
        self._home = home
        self._config_file = resolve_paths(home).config_file if home is not None else None
        self._stamp = self._file_stamp()
        self._catalog = _catalog(settings) if settings is not None else None

    @property
    def profile_name(self) -> str:
        """The name a new session gets when it asks for none."""
        catalog = self._current()
        if catalog is None:
            return "remote"
        return catalog.default

    def resolve(self, name: str) -> ResolvedModel:
        """Look ``name`` up as a profile, then parse it as a ref.

        Raises :class:`ModelConfigError` for an unknown profile or provider.
        """
        catalog = self._current()
        if catalog is None:
            raise ModelConfigError("model settings are not configured")
        profile = catalog.models.get(name)
        ref = name if profile is None else profile.model
        provider_name, _, model_id = ref.partition("/")
        if model_id == "":
            if name == catalog.default:
                raise ModelConfigError("no model is configured: set default_model in config.toml")
            raise ModelConfigError(f"unknown model: {name}")
        provider = catalog.providers.get(provider_name)
        if provider is None:
            raise ModelConfigError(f"unknown model provider: {provider_name}")
        return ResolvedModel(
            name=name,
            provider_name=provider_name,
            provider=provider,
            model_id=model_id,
            ctx=None if profile is None else profile.ctx,
        )

    def identity(self, profile: str | None = None) -> ModelIdentity:
        """Provider and model id for ``profile``, or for :attr:`profile_name`."""
        active = self.profile_name if profile is None else profile
        if self._model is not None:
            return ModelIdentity(profile=active, provider=None, name=None)
        try:
            resolved = self.resolve(active)
        except ModelConfigError:
            return ModelIdentity(profile=active, provider=None, name=None)
        return ModelIdentity(
            profile=active, provider=resolved.provider_name, name=resolved.model_id
        )

    def chat_model(self, profile: str) -> BaseChatModel:
        """Return the chat model for ``profile``.

        Raises :class:`ModelConfigError` when the name does not resolve or the
        provider's API key is not set.
        """
        if self._model is not None:
            if profile != self.profile_name:
                raise ModelConfigError(f"unknown model: {profile}")
            return self._model
        resolved = self.resolve(profile)
        provider = resolved.provider
        key = _api_key(provider)
        if provider.kind == "anthropic":
            from langchain_anthropic import ChatAnthropic

            return ChatAnthropic.model_validate({"model": resolved.model_id, "api_key": key})
        if provider.kind == "openai":
            from langchain_openai import ChatOpenAI

            options: dict[str, object] = {"model": resolved.model_id, "api_key": key}
            if provider.base_url is not None:
                options["base_url"] = provider.base_url
            return ChatOpenAI.model_validate(options)
        if provider.kind == "ollama":
            from langchain_ollama import ChatOllama

            options = {
                "model": resolved.model_id,
                "base_url": _ollama_url(provider.base_url),
            }
            if resolved.ctx is not None:
                options["num_ctx"] = resolved.ctx
            return ChatOllama.model_validate(options)
        from langchain_openai import ChatOpenAI

        if provider.base_url is None:
            raise ModelConfigError(f"provider {resolved.provider_name} needs base_url")
        # A local OpenAI-compatible server ignores the key, and the client needs one.
        return ChatOpenAI.model_validate(
            {"model": resolved.model_id, "base_url": provider.base_url, "api_key": key or "none"},
        )

    def _current(self) -> _Catalog | None:
        if self._config_file is not None:
            stamp = self._file_stamp()
            if stamp != self._stamp:
                self._stamp = stamp
                self._reload()
        return self._catalog

    def _reload(self) -> None:
        try:
            settings = load_settings(home=self._home, project_dir=self._home)
        except (OSError, ValueError) as exc:
            log.warning("config.toml is invalid, keeping the previous models: %s", exc)
            return
        self._catalog = _catalog(settings)
        log.info("reloaded models from %s", self._config_file)

    def _file_stamp(self) -> tuple[int, int] | None:
        if self._config_file is None:
            return None
        try:
            stat = self._config_file.stat()
        except OSError:
            return None
        return stat.st_mtime_ns, stat.st_size


def _catalog(settings: GolemSettings) -> _Catalog:
    providers = dict(PRESETS)
    for name, configured in settings.providers.items():
        providers[name] = _merge(PRESETS.get(name), configured)
    models = dict(settings.models)
    legacy = _legacy_model(settings, providers)
    if legacy is not None and settings.model_profile not in models:
        models[settings.model_profile] = legacy
    default = settings.default_model or settings.model_profile
    return _Catalog(default=default, providers=providers, models=models)


def _merge(preset: Provider | None, configured: ProviderSettings) -> Provider:
    if preset is None:
        return Provider(
            kind=configured.kind or "openai_compat",
            base_url=configured.base_url,
            api_key_env=configured.api_key_env,
        )
    return Provider(
        kind=configured.kind or preset.kind,
        base_url=configured.base_url or preset.base_url,
        api_key_env=configured.api_key_env or preset.api_key_env,
    )


def _ollama_url(base_url: str | None) -> str:
    url = (base_url or OLLAMA_BASE_URL).strip().rstrip("/")
    return url.removesuffix("/v1")


def _legacy_model(settings: GolemSettings, providers: dict[str, Provider]) -> ModelSettings | None:
    kind = settings.model_provider
    name = settings.model_name
    if kind is None or name is None:
        return None
    if kind != "openai_compat":
        return ModelSettings(model=f"{kind}/{name}")
    url = (settings.model_base_url or "").strip().rstrip("/")
    if url == "" or url in _OLLAMA_OPENAI_URLS:
        return ModelSettings(model=f"ollama/{name}")
    providers[_LEGACY_PROVIDER] = Provider(kind="openai_compat", base_url=url)
    return ModelSettings(model=f"{_LEGACY_PROVIDER}/{name}")


def _api_key(provider: Provider) -> str | None:
    if provider.api_key_env is None:
        return None
    key = os.environ.get(provider.api_key_env, "").strip()
    if key == "":
        raise ModelConfigError(f"{provider.api_key_env} is not set")
    return key
