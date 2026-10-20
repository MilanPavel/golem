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
RuleAction = Literal["allow", "ask", "deny"]


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


class ModelPrice(BaseModel):
    """USD per million tokens."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    input: float = Field(ge=0)
    output: float = Field(ge=0)
    cached_input: float | None = Field(default=None, ge=0)


class ModelSettings(BaseModel):
    """``[models.<name>]``, a named alias for a ``provider/model`` ref.

    ``price`` overrides the price golem discovers for the model.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    model: str = Field(min_length=3, pattern=r"^[^/\s]+/\S+$")
    ctx: int | None = Field(default=None, gt=0)
    price: ModelPrice | None = None


class PolicyRule(BaseModel):
    """One ``[[rule]]``: which tool calls it covers, and what happens to them.

    ``tool`` is a glob on the tool name. ``match`` is a glob on the tool's
    subject, such as a search pattern or later a shell command, with ``|``
    between alternatives. ``path`` is a glob on the resolved path the call
    touches: ``*`` stays inside one folder, ``**`` crosses folders, ``~`` is
    the home folder, and a relative glob is relative to the session folder.
    A rule matches when every field it sets matches.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    tool: str = Field(default="*", min_length=1)
    match: str | None = Field(default=None, min_length=1)
    path: str | None = Field(default=None, min_length=1)
    action: RuleAction


class ShellSettings(BaseModel):
    """``[shell]``. What a ``shell`` command may reach besides the session folder.

    ``network`` lets commands use the network. ``writable`` adds folders they
    may write to, with ``~`` for the home folder. ``timeout_seconds`` is the
    longest a command may run before it is killed, unless the call asks for
    less.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    network: bool = False
    writable: list[str] = Field(default_factory=list[str])
    timeout_seconds: int = Field(default=120, gt=0, le=3600)


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
    rule: list[PolicyRule] = Field(default_factory=list[PolicyRule])
    # Project folders whose .golem/policy.toml may allow tools. Ask and deny rules apply anywhere.
    trusted_projects: list[str] = Field(default_factory=list[str])
    shell: ShellSettings = Field(default_factory=ShellSettings)

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
