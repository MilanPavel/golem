"""Layered configuration.

Precedence, highest first:

1. ``overrides`` passed to :func:`load_settings`
2. Environment variables prefixed with ``GOLEM_``
3. ``<project>/.golem/config.toml``
4. ``$GOLEM_HOME/config.toml`` (default ``~/.golem/config.toml``)
5. Field defaults
"""

from __future__ import annotations

from contextvars import ContextVar
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field
from pydantic_settings import (
    BaseSettings,
    PydanticBaseSettingsSource,
    SettingsConfigDict,
    TomlConfigSettingsSource,
)

from golem.paths import resolve_paths

LogLevel = Literal["DEBUG", "INFO", "WARNING", "ERROR"]
ModelProvider = Literal["anthropic", "openai", "openai_compat"]
ProviderKind = Literal["anthropic", "openai", "ollama", "openai_compat"]


def _normalize_log_level(value: object) -> object:
    if isinstance(value, str):
        return value.strip().upper()
    return value


def _blank_to_none(value: object) -> object:
    if isinstance(value, str) and value.strip() == "":
        return None
    return value


@dataclass(frozen=True, slots=True)
class _ConfigFiles:
    user_config: Path
    project_config: Path


_config_files: ContextVar[_ConfigFiles | None] = ContextVar("golem_config_files", default=None)


class ProviderSettings(BaseModel):
    """``[providers.<name>]``. For a built-in provider, each set field overrides its preset.

    A new name needs ``base_url``, and ``kind`` defaults to ``openai_compat``.
    ``api_key_env`` names the environment variable that holds the key.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    kind: ProviderKind | None = None
    base_url: Annotated[str | None, BeforeValidator(_blank_to_none)] = None
    api_key_env: str | None = Field(default=None, min_length=1)


class ModelSettings(BaseModel):
    """``[models.<name>]``, a named alias for a ``provider/model`` ref."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    model: str = Field(min_length=3, pattern=r"^[^/\s]+/\S+$")
    ctx: int | None = Field(default=None, gt=0)


class GolemSettings(BaseSettings):
    """Runtime settings for the daemon.

    Construct this through :func:`load_settings`. Calling it directly applies
    environment variables and defaults, and skips the TOML files.
    """

    model_config = SettingsConfigDict(
        env_prefix="GOLEM_",
        extra="forbid",
        env_ignore_empty=True,
    )

    log_level: Annotated[LogLevel, BeforeValidator(_normalize_log_level)] = "INFO"
    default_model: str | None = Field(default=None, min_length=1)
    providers: dict[str, ProviderSettings] = Field(default_factory=dict)
    models: dict[str, ModelSettings] = Field(default_factory=dict)
    # The flat settings from before named profiles. They load as one profile named model_profile.
    model_profile: str = Field(default="remote", min_length=1)
    model_provider: ModelProvider | None = None
    model_name: str | None = Field(default=None, min_length=1)
    model_base_url: Annotated[str | None, BeforeValidator(_blank_to_none)] = None
    session_titles: bool = True

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        # Init, then env, then project toml, then user toml. No dotenv file and no secrets dir.
        del dotenv_settings, file_secret_settings
        sources: list[PydanticBaseSettingsSource] = [init_settings, env_settings]
        files = _config_files.get()
        if files is not None:
            for path in (files.project_config, files.user_config):
                if path.is_file():
                    sources.append(TomlConfigSettingsSource(settings_cls, toml_file=path))
        return tuple(sources)


def load_settings(
    *,
    home: Path | None = None,
    project_dir: Path | None = None,
    log_level: LogLevel | None = None,
) -> GolemSettings:
    """Load settings for ``home`` and an optional project directory.

    ``project_dir`` defaults to the current working directory.
    ``log_level`` is the session override and wins over files and the environment.
    """
    paths = resolve_paths(home)
    project = (project_dir if project_dir is not None else Path.cwd()).expanduser().resolve()
    token = _config_files.set(
        _ConfigFiles(
            user_config=paths.config_file,
            project_config=project / ".golem" / "config.toml",
        )
    )
    try:
        if log_level is None:
            return GolemSettings()
        return GolemSettings(log_level=log_level)
    finally:
        _config_files.reset(token)
