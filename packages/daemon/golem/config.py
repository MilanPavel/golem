"""Layered configuration.

Precedence, highest first:

1. ``overrides`` passed to :func:`load_settings`
2. Environment variables prefixed with ``GOLEM_``
3. ``<project>/.golem/config.toml``
4. ``$GOLEM_HOME/config.toml`` (default ``~/.golem/config.toml``)
5. Field defaults
"""

from __future__ import annotations

import re
import shlex
import tomllib
from contextvars import ContextVar
from dataclasses import dataclass
from fnmatch import fnmatchcase
from pathlib import Path
from typing import Annotated, Any, Literal, cast
from urllib.parse import urlsplit

from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    TypeAdapter,
    field_validator,
    model_validator,
)
from pydantic_settings import (
    BaseSettings,
    PydanticBaseSettingsSource,
    SettingsConfigDict,
    TomlConfigSettingsSource,
)

from golem.paths import resolve_paths
from golem.routines import ScheduleError, parse_schedule

LogLevel = Literal["DEBUG", "INFO", "WARNING", "ERROR"]
ModelProvider = Literal["anthropic", "openai", "openai_compat"]

# The hosted providers golem offers, and Ollama for models on this machine.
HOSTED_PROVIDERS = ("openai", "anthropic", "google", "deepseek", "xai", "moonshot")
PROVIDER_NAMES = frozenset({*HOSTED_PROVIDERS, "ollama"})


def unknown_provider_message(name: str) -> str:
    """The error for a provider name golem does not offer. It lists the six."""
    return f"unknown model provider: {name}. Choose one of {', '.join(HOSTED_PROVIDERS)}, or ollama"


ProviderKind = Literal["anthropic", "openai", "google", "xai", "ollama", "openai_compat"]
RuleAction = Literal["allow", "ask", "deny"]


def _normalize_log_level(value: object) -> object:
    if isinstance(value, str):
        return value.strip().upper()
    return value


def _blank_to_none(value: object) -> object:
    if isinstance(value, str) and value.strip() == "":
        return None
    return value


SECRET_KEY = re.compile(
    r"(^|_)(api_?key|key|token|password|passwd|secret|credentials?|authorization|bearer)$",
    re.IGNORECASE,
)
INLINE_SECRET = (
    "{key} looks like a secret, and golem keeps secrets out of config files: "
    "store a provider key with `golem auth set` or /login, and name an environment "
    "variable with api_key_env"
)


def _no_inline_secrets(data: object) -> object:
    """Refuse a table with a key such as ``api_key`` or ``token`` before anything else."""
    if isinstance(data, dict):
        for key in cast(dict[object, object], data):
            if isinstance(key, str) and SECRET_KEY.search(key):
                raise ValueError(INLINE_SECRET.format(key=key))
    return cast(object, data)


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

    _no_secrets = model_validator(mode="before")(_no_inline_secrets)

    kind: ProviderKind | None = None
    base_url: Annotated[str | None, BeforeValidator(_blank_to_none)] = None
    api_key_env: str | None = Field(default=None, min_length=1)
    at_once: int = Field(default=4, ge=1)  # calls to this provider at once, for any model


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


PermissionMode = Literal["careful", "balanced", "autopilot"]
"""How much the built-in default rules allow without asking (ADR-047)."""

PERMISSION_MODES: tuple[PermissionMode, ...] = ("careful", "balanced", "autopilot")


class PermissionSettings(BaseModel):
    """``[permissions]``. The mode new sessions start in, unless the session sets its own.

    The mode changes only the built-in default rules. Rules you write, in
    ``config.toml`` or a project's ``policy.toml``, are checked first.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    mode: PermissionMode = "balanced"


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


class CheckSettings(BaseModel):
    """``[[coding.check]]``. One command golem runs to check a project."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1, max_length=40)
    command: str = Field(min_length=1)
    timeout_seconds: int = Field(default=120, gt=0, le=1800)


class CodingSettings(BaseModel):
    """``[coding]``. Checks golem runs after it changed files.

    ``checks`` says whether it asks first, runs them on its own, or never runs
    them. ``fix_rounds`` is how many times it may fix what a check found.
    ``check`` lists the commands. With none, golem detects them from the project.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    checks: Literal["ask", "auto", "off"] = "ask"
    fix_rounds: int = Field(default=2, ge=0, le=5)
    check: list[CheckSettings] = Field(default_factory=list[CheckSettings])


class SkillSettings(BaseModel):
    """``[skills]``. Which skill folders golem reads, and which skills it leaves off.

    ``disabled`` names skills that are listed but never used. ``claude_dirs``
    reads Claude Code's ``.claude/skills`` folders, in the project and in the
    home folder. ``extra_dirs`` adds folders of skills, with ``~`` for the home
    folder, after the user's own. ``index_budget`` is how many characters the
    skill index in the system prompt may use. Skills that do not fit are left
    out of it, and ``skill.list`` says so.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    index_budget: int = Field(default=4000, gt=0)
    disabled: list[str] = Field(default_factory=list[str])
    claude_dirs: bool = True
    extra_dirs: list[str] = Field(default_factory=list[str])


class ModelOptions(BaseModel):
    """``[ollama.models."<name>"]``. The Ollama options saved for one model.

    Each field is one row of ``golem.models.options.OPTIONS``. A field left out
    is not set, so the model's own default applies. The daemon writes this
    table, and checks each value against the table's range first.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    temperature: float | None = None
    top_p: float | None = None
    top_k: int | None = None
    min_p: float | None = None
    repeat_penalty: float | None = None
    num_ctx: int | None = None
    num_predict: int | None = None
    seed: int | None = None
    keep_alive: str | int | None = None
    think: Literal["off", "on", "low", "medium", "high"] | None = None


class OllamaSettings(BaseModel):
    """``[ollama]``. Whether golem starts a local Ollama, and when it stops it.

    ``start`` lets golem run ``ollama serve`` when a local model is needed and
    nothing answers. ``idle_stop_minutes`` stops a server golem started after
    that long unused, and 0 keeps it running. A server golem did not start is
    never stopped. ``parallel`` is how many generations golem sends to a local server at
    once, 1 to 8 (the default is 1), or ``"auto"``: the most slots, up to 4, for which the
    model still fits in memory with its planned window. golem passes a number to the
    ``ollama serve`` it starts as ``OLLAMA_NUM_PARALLEL`` and restarts that server between
    calls when it changes. A server golem did not start keeps whatever it was started with,
    so set ``OLLAMA_NUM_PARALLEL`` there yourself.
    ``models`` holds the options saved for each model, by its Ollama name, such as
    ``qwen3:8b``.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    start: bool = True
    idle_stop_minutes: int = Field(default=30, ge=0)
    # "auto" loads but is not the default yet: it needs the real KV size of a model (from
    # /api/ps), or a higher KV_GB_PER_1K_TOKENS, or it picks too many slots (ADR-060).
    parallel: Annotated[int, Field(ge=1, le=8)] | Literal["auto"] = 1
    models: dict[str, ModelOptions] = Field(default_factory=dict[str, ModelOptions])

    @property
    def fixed_parallel(self) -> int:
        """The number in ``parallel``, or 1 for ``"auto"``, which a server start does not read."""
        return 1 if self.parallel == "auto" else self.parallel


Role = Literal["titles", "summarise", "explore"]
"""An internal job golem runs with a model of its own choosing."""


class RoleSettings(BaseModel):
    """``[routing.roles]``. The model for each internal job.

    A value is ``"session"``, a profile name, or a ``provider/model`` ref. ``"session"``
    means the session's own model, or a ready budget model when the session is hosted.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    titles: str = Field(default="session", min_length=1)
    summarise: str = Field(default="session", min_length=1)
    explore: str = Field(default="session", min_length=1)


RouteMode = Literal["pinned", "local", "auto"]
"""How a session picks its model: the one it names, a local one only, or by the rules."""


class LadderSettings(BaseModel):
    """``[routing.ladder]``. The model to use in each tier. None means golem chooses."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    local: str | None = Field(default=None, min_length=1)
    budget: str | None = Field(default=None, min_length=1)
    frontier: str | None = Field(default=None, min_length=1)


class RoutingSettings(BaseModel):
    """``[routing]``. How golem files models into tiers and picks between them.

    ``budget_max_price`` is the most a hosted model may cost, in USD per million tokens and
    blended as ``(3 * input + output) / 4``, to be in the budget tier. A model above it is
    frontier. ``roles`` picks the model for each internal job. ``mode`` is the default route
    mode, ``paid`` says when to ask before a paid model, ``local_only`` lists folders that
    stay on this Mac, and ``ladder`` names the model of each tier.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    mode: RouteMode = "pinned"
    paid: Literal["ask", "always_ask", "never"] = "ask"
    budget_max_price: float = Field(default=1.50, gt=0)
    local_only: list[str] = Field(default_factory=list[str])
    ladder: LadderSettings = Field(default_factory=LadderSettings)
    roles: RoleSettings = Field(default_factory=RoleSettings)


class ContextSettings(BaseModel):
    """``[context]``. The window golem asks Ollama for.

    ``window`` is ``"auto"`` (golem plans it from the model and this Mac's memory),
    ``"ollama"`` (golem sends none and Ollama picks), or a number of tokens.
    ``keep_alive`` is sent with a planned window when no other ``keep_alive`` is set.

    ``reply_reserve`` is the tokens kept free for the reply. When the history passes
    ``clear_at`` of the rest of the window, old tool results go out as one line each
    until it is down to ``clear_to``. The newest ``keep_results`` results are kept.
    When clearing is not enough and the history is still past ``compact_at``, every turn
    but the last ``keep_turns`` is replaced by a summary in what is sent.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    window: Literal["auto", "ollama"] | Annotated[int, Field(ge=512, le=262144)] = "auto"
    keep_alive: str | None = "30m"
    reply_reserve: int = Field(default=4096, ge=0)
    clear_at: float = 0.70
    clear_to: float = 0.40
    compact_at: float = 0.85
    keep_results: int = Field(default=4, ge=0)
    keep_turns: int = Field(default=4, ge=1)

    @model_validator(mode="after")
    def _ordered(self) -> ContextSettings:
        if not 0 < self.clear_to < self.clear_at < self.compact_at < 1:
            raise ValueError("[context] needs 0 < clear_to < clear_at < compact_at < 1")
        return self


class BudgetSettings(BaseModel):
    """``[budget]``. Caps on paid models, in USD. None means no cap."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    daily_usd: float | None = Field(default=None, ge=0)
    session_usd: float | None = Field(default=None, ge=0)
    over: Literal["local", "ask"] = "local"


MemoryScope = Literal["you", "project", "history"]
MemoryPrivacyLevel = Literal["chat", "local"]


class MemorySettings(BaseModel):
    """``[memory]``. Long-term memory (ADR-061).

    ``enabled`` turns it on. ``share`` is the part of the model's window the memory block may
    use, between ``min_tokens`` and ``max_tokens``; a helper gets ``helper_share``. ``you``,
    ``projects`` and ``history`` set the privacy of each scope: ``chat`` goes where the chat
    goes, ``local`` goes to local models only. ``auto_keep`` lists folders where a note with
    sources is kept without asking. It is read from the user's file only.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    enabled: bool = True
    share: float = Field(default=0.02, gt=0, le=1)
    min_tokens: int = Field(default=200, ge=1)
    max_tokens: int = Field(default=1500, ge=1)
    helper_share: float = Field(default=0.01, gt=0, le=1)
    you: MemoryPrivacyLevel = "chat"
    projects: MemoryPrivacyLevel = "chat"
    history: MemoryPrivacyLevel = "chat"
    auto_keep: list[str] = Field(default_factory=list[str])

    @model_validator(mode="after")
    def _ordered(self) -> MemorySettings:
        if self.min_tokens > self.max_tokens:
            raise ValueError("[memory] needs min_tokens <= max_tokens")
        return self


def _relay_url(value: str | None) -> str | None:
    if value is None:
        return None
    parts = urlsplit(value)
    if parts.scheme not in ("wss", "ws") or not parts.hostname:
        raise ValueError("[relay] url must be a wss:// address")
    if parts.username is not None or parts.password is not None or parts.query or parts.fragment:
        raise ValueError("[relay] url has no user, query, or fragment")
    if parts.scheme == "ws" and parts.hostname not in ("localhost", "127.0.0.1", "::1"):
        raise ValueError("[relay] url must be wss://; ws:// is for a loopback address in tests")
    return value


class RelaySettings(BaseModel):
    """``[relay]``. The relay a paired phone reaches this Mac through (ADR-051).

    ``url`` is its ``wss://`` address, or a loopback ``ws://`` address for tests. Without it the
    gateway opens no connection. It is read from the user's file only, and the browser may
    not change it.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    url: Annotated[str | None, AfterValidator(_relay_url)] = None


TerminalApp = Literal["Terminal", "iTerm", "Ghostty"]
TERMINAL_APPS: tuple[TerminalApp, ...] = ("Terminal", "iTerm", "Ghostty")
"""The terminal apps a click can open a session in."""


class NotificationSettings(BaseModel):
    """``[notifications]``. What tells you, and where a click on a notice lands.

    ``needs_you`` cannot be turned off: ``false`` is an error. ``failed`` and ``finished``
    say whether a failed or a finished run of a session nobody watches is announced. A
    ``[[routine]]`` may override those two with ``notify_failed`` and ``notify_finished``.
    ``open_in`` is where a click lands: the web page on that session (``web``, the default)
    or the terminal chat (``terminal``), opened in ``terminal_app``.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    needs_you: bool = True
    failed: bool = True
    finished: bool = False
    open_in: Literal["web", "terminal"] = "web"
    terminal_app: TerminalApp = "Terminal"

    @field_validator("needs_you")
    @classmethod
    def _needs_you_stays_on(cls, value: bool) -> bool:
        if not value:
            raise ValueError("needs_you cannot be turned off; a session that waits for you says so")
        return value


class AgentModelSettings(BaseModel):
    """``[agents.<name>]`` of a bundled type: the wish its file has, unless a file of yours wins.

    ``model`` is a wish word or a model name (ADR-059, section 4). Only the wish is a key: the
    prompt, tools and limits stay the bundled ones of the running release.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    model: str | None = None

    @field_validator("model")
    @classmethod
    def _model_is_one_word(cls, value: str | None) -> str | None:
        if value is not None and (value != value.strip() or not value or len(value.split()) != 1):
            raise ValueError("model is a wish or a model name, with no spaces")
        return value


class ExplorerSettings(AgentModelSettings):
    """``[agents.explorer]``. What bounds the explorer, over the limits in its agent file."""

    max_calls: int = Field(default=15, ge=1, le=50)
    timeout_seconds: int = Field(default=300, ge=1)
    answer_chars: int = Field(default=6_000, ge=1)
    max_per_turn: int = Field(default=3, ge=1)


BUNDLED_TYPES = ("explorer", "worker", "reviewer", "advisor")
"""The agent types that ship with golem: the names ``[agents.<name>]`` may set a wish for."""


class AgentSettings(BaseModel):
    """``[agents]``. One table for each kind of helper, and where agent files are read.

    ``extra_dirs`` adds folders of ``<name>.md`` agent files, with ``~`` for
    the home folder, after ``~/.golem/agents``.

    A finished helper keeps its steps for ``keep_days`` days from its end, then only a receipt
    stays. One that failed, was cancelled or asked you something keeps them for
    ``keep_problem_days``. 0 keeps them for ever.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    extra_dirs: list[str] = Field(default_factory=list[str])
    keep_days: int = Field(default=7, ge=0)
    keep_problem_days: int = Field(default=30, ge=0)
    explorer: ExplorerSettings = Field(default_factory=ExplorerSettings)
    worker: AgentModelSettings = Field(default_factory=AgentModelSettings)
    reviewer: AgentModelSettings = Field(default_factory=AgentModelSettings)
    advisor: AgentModelSettings = Field(default_factory=AgentModelSettings)

    def wish_for(self, name: str) -> str | None:
        """``model`` of ``[agents.<name>]``, or None when unset or not a bundled type."""
        table = cast(object, getattr(self, name, None)) if name in BUNDLED_TYPES else None
        return table.model if isinstance(table, AgentModelSettings) else None


class WebSettings(BaseModel):
    """``[web]``. What ``web_fetch`` may reach and how much it reads, and who searches.

    ``allow_private`` lets it reach loopback, private, and link-local
    addresses, such as a dev server on ``localhost``. ``max_bytes`` is the most
    of a response it reads, and ``timeout_seconds`` the longest it waits.
    ``search`` names the provider ``web_search`` asks, or ``"off"``, which
    leaves the tool out.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    allow_private: bool = False
    max_bytes: int = Field(default=5_000_000, gt=0, le=50_000_000)
    timeout_seconds: int = Field(default=20, gt=0, le=300)
    search: Literal["duckduckgo", "off"] = "duckduckgo"


MCP_SECRET = re.compile(r"keychain:(mcp/[A-Za-z0-9][A-Za-z0-9._-]*)")
"""A secret an MCP setting names. Only ``mcp/…``: a server never gets a model provider's key."""

McpEnabled = bool | Literal["on_demand"]

ENV_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class McpToolFilter(BaseModel):
    """``tools`` of a server: which of its tools the model gets.

    Both lists are ``fnmatch`` patterns on the server's own tool name, not the
    ``mcp__<server>__<tool>`` name. An empty ``include`` means every tool, and
    ``exclude`` wins over ``include``.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    include: list[str] = Field(default_factory=list[str])
    exclude: list[str] = Field(default_factory=list[str])

    def allows(self, name: str) -> bool:
        if any(fnmatchcase(name, pattern) for pattern in self.exclude):
            return False
        return not self.include or any(fnmatchcase(name, pattern) for pattern in self.include)


McpApproval = Literal["ask", "read-only", "allow"]


class McpOAuthSettings(BaseModel):
    """``oauth`` in an HTTP server's table: a client id for a server that cannot register one.

    A hosted server that signs in with OAuth needs nothing here when it
    registers clients by itself. ``client_id`` is for one that does not, and
    ``scopes`` asks for scopes other than the server's own list. The tokens are
    kept in the Keychain as ``mcp/<name>-oauth``, never in the file.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    client_id: str | None = Field(default=None, min_length=1)
    scopes: list[str] = Field(default_factory=list[str])


class McpServerSettings(BaseModel):
    """``[mcp.<name>]``. An MCP server golem starts over stdio, or reaches over HTTP.

    A stdio server has ``command``, a program on ``PATH`` or an absolute path,
    with ``args``, ``env``, and ``cwd`` (home by default, ``~`` for home). An
    HTTP server has ``url`` and ``headers``. A value in ``env`` or ``headers``
    can name a secret, ``keychain:mcp/<name>``, alone or inside the text, as in
    ``Bearer keychain:mcp/github``. A variable or header whose name looks like a
    secret must name one, so a token never sits in the file.

    ``enabled`` is ``true`` for every session, ``"on_demand"`` for the sessions
    that turn it on with ``/mcp enable``, or ``false``. ``timeout_seconds`` is
    the longest one tool call may take. ``auto_enable`` (default true) lets the
    model see an on-demand server in the system prompt and ask to turn it on;
    ``false`` keeps it out, so only you turn it on.

    ``tools`` hides some of the server's tools from the model. ``approval`` is
    ``"ask"`` (every call asks, the default), ``"read-only"`` (a tool the server
    marks ``readOnlyHint`` runs without asking in balanced and autopilot), or
    ``"allow"`` (every call runs without asking), all after the user's own
    ``[[rule]]``s. ``env_passthrough``
    names variables of the daemon's own environment to hand to a stdio server;
    a secret goes through the Keychain instead.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    _no_secrets = model_validator(mode="before")(_no_inline_secrets)

    command: str | None = Field(default=None, min_length=1)
    args: list[str] = Field(default_factory=list[str])
    env: dict[str, str] = Field(default_factory=dict[str, str])
    cwd: str | None = Field(default=None, min_length=1)
    url: str | None = Field(default=None, pattern=r"^https?://\S+$")
    headers: dict[str, str] = Field(default_factory=dict[str, str])
    enabled: McpEnabled = True
    timeout_seconds: int = Field(default=120, gt=0, le=3600)
    tools: McpToolFilter = Field(default_factory=McpToolFilter)
    approval: McpApproval = "ask"
    env_passthrough: list[str] = Field(default_factory=list[str])
    oauth: McpOAuthSettings | None = None
    auto_enable: bool = True

    @model_validator(mode="after")
    def _one_transport(self) -> McpServerSettings:
        if (self.command is None) == (self.url is None):
            raise ValueError("an MCP server needs either command (stdio) or url (HTTP)")
        if self.url is not None and (self.args or self.env or self.cwd):
            raise ValueError("args, env, and cwd are for a command; an HTTP server takes headers")
        if self.command is not None and self.headers:
            raise ValueError("headers are for an HTTP server; a command takes env")
        if self.url is not None and self.env_passthrough:
            raise ValueError("env_passthrough is for a command; an HTTP server takes headers")
        if self.command is not None and self.oauth is not None:
            raise ValueError("oauth is for an HTTP server; a command takes env")
        for name in self.env_passthrough:
            if ENV_NAME.match(name) is None:
                raise ValueError(f"{name!r} is not a variable name in env_passthrough")
            if SECRET_KEY.search(name):
                raise ValueError(
                    f"{name} looks like a secret: set it in env as keychain:mcp/<name> "
                    "instead of passing it through"
                )
        for table in (self.env, self.headers):
            for key, value in table.items():
                if SECRET_KEY.search(key) and MCP_SECRET.search(value) is None:
                    raise ValueError(
                        f"{key} looks like a secret: set it to keychain:mcp/<name> and store "
                        "the value with golem auth set mcp/<name>"
                    )
                if "keychain:" in value and MCP_SECRET.search(value) is None:
                    raise ValueError(f"{key} names a secret outside mcp/: use keychain:mcp/<name>")
        return self

    @property
    def secrets(self) -> list[str]:
        """The secrets this server needs, as ``mcp/<name>``."""
        values = [*self.env.values(), *self.headers.values()]
        return sorted({found for value in values for found in MCP_SECRET.findall(value)})

    @property
    def target(self) -> str:
        """What golem runs or reaches: the command line, or the URL."""
        if self.url is not None:
            return self.url
        return shlex.join([self.command or "", *self.args])


MCP_SERVER_NAME = r"^[A-Za-z0-9][A-Za-z0-9-]{0,31}$"
"""Server names go into tool names, ``mcp__<server>__<tool>``, so no ``_`` and no dots."""

McpServers = dict[Annotated[str, Field(pattern=MCP_SERVER_NAME)], McpServerSettings]
_MCP_SERVERS: TypeAdapter[McpServers] = TypeAdapter(McpServers)


def load_mcp(path: Path) -> McpServers:
    """The ``[mcp.*]`` tables of one TOML file, and nothing else of it.

    A missing file has none. Raises ``ValueError`` when the file or a table
    does not validate.
    """
    try:
        data = tomllib.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    return _MCP_SERVERS.validate_python(data.get("mcp", {}))


ROUTINE_NAME = r"^[a-z0-9][a-z0-9-]{0,39}$"
"""A routine name: lowercase letters, digits and dashes. It becomes part of a session origin."""

RoutineMissed = Literal["skip", "run_once"]


class RoutineWatch(BaseModel):
    """``on = { watch, glob }``. Start when a file matching ``glob`` appears in ``watch`` (4.3)."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    watch: str = Field(min_length=1)
    glob: str = Field(default="*", min_length=1)


class RoutineSettings(BaseModel):
    """One ``[[routine]]``: a trigger, and what to run when it fires (ADR-050).

    Exactly one of ``schedule`` (cron, or ``every 15m``, ``daily 08:30``,
    ``weekdays 08:30``, ``weekly mon 06:00``) and ``on`` sets the trigger. ``prompt``
    is the text or the ``/skill`` the session starts with, in ``folder`` with
    ``model`` and the on-demand MCP servers in ``mcp``. ``missed`` says what happens
    to a firing that came due while the daemon was down or the Mac asleep:
    ``skip`` drops it, ``run_once`` fires it once, late. ``notify_finished`` and
    ``notify_failed`` override the notification settings for this routine.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    _no_secrets = model_validator(mode="before")(_no_inline_secrets)

    name: str = Field(pattern=ROUTINE_NAME)
    schedule: str | None = Field(default=None, min_length=1)
    on: RoutineWatch | None = None
    prompt: str = Field(min_length=1)
    folder: str | None = Field(default=None, min_length=1)
    model: str | None = Field(default=None, min_length=1)
    mcp: list[str] = Field(default_factory=list[str])
    missed: RoutineMissed = "skip"
    enabled: bool = True
    notify_finished: bool | None = None
    notify_failed: bool | None = None

    @field_validator("schedule")
    @classmethod
    def _schedule_parses(cls, value: str | None) -> str | None:
        if value is not None:
            try:
                parse_schedule(value)
            except ScheduleError as exc:
                raise ValueError(str(exc)) from exc
        return value

    @model_validator(mode="after")
    def _one_trigger(self) -> RoutineSettings:
        if (self.schedule is None) == (self.on is None):
            raise ValueError("a routine needs exactly one of schedule and on")
        return self


PROTECTED_SETTINGS = frozenset(
    {
        "providers",
        "model_provider",
        "model_name",
        "model_profile",
        "model_base_url",
        "trusted_projects",
        "shell",
        "web",
        "permissions",
        "coding",
        "relay",
    }
)
"""Top-level settings the browser's ``config.raw.set`` may not change (ADR-037).

Each one decides where a key goes, what a project may run, or where a sandbox's
walls are. ``skills.extra_dirs`` and ``skills.claude_dirs`` are protected too,
see ``PROTECTED_SKILL_SETTINGS``.
"""

PROTECTED_SKILL_SETTINGS = frozenset({"extra_dirs", "claude_dirs"})

PROTECTED_MEMORY_SETTINGS = frozenset({"auto_keep"})
"""``[memory]`` keys the browser may not change: they widen what golem trusts (ADR-061)."""

BROWSER_SETTINGS = frozenset(
    {
        "log_level",
        "default_model",
        "models",
        "session_titles",
        "rule",
        "mcp",
        "routine",
        "skills",
        "ollama",
        "routing",
        "notifications",
        "context",
        "budget",
        "memory",
        "agents",
    }
)
"""Top-level settings the browser may edit. Every ``GolemSettings`` field is in one list."""


class _ProjectToml(TomlConfigSettingsSource):
    """A project's ``.golem/config.toml``, without its ``[[routine]]`` list.

    A list from a higher layer replaces the user's whole list, and this layer is read
    whether or not the folder is trusted. A project's routines reach the daemon only
    through ``golem.routine_files``, which checks trust (ADR-050).

    ``[routing] local_only`` is a flag there (``true``), not the user's list of folders. The
    flag is read by ``golem.models.project_privacy``, so it is dropped here. The whole
    ``[memory]`` table is dropped too: a project may only set ``private = true``, which
    ``golem.memory.project_privacy`` reads, and never ``auto_keep`` or the budget. So is
    ``[relay]``: a project never chooses where a phone connects.
    """

    def __call__(self) -> dict[str, Any]:
        data = dict(super().__call__())
        data.pop("routine", None)
        data.pop("memory", None)
        data.pop("relay", None)
        routing = data.get("routing")
        if isinstance(routing, dict) and "local_only" in routing:
            data["routing"] = {k: v for k, v in routing.items() if k != "local_only"}  # pyright: ignore[reportUnknownVariableType]
        return data


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

    @field_validator("providers")
    @classmethod
    def _known_providers(cls, value: dict[str, ProviderSettings]) -> dict[str, ProviderSettings]:
        for name in value:
            if name not in PROVIDER_NAMES:
                raise ValueError(unknown_provider_message(name))
        return value

    models: dict[str, ModelSettings] = Field(default_factory=dict)
    # The flat settings from before named profiles. They load as one profile named model_profile.
    model_profile: str | None = Field(default=None, min_length=1)
    model_provider: ModelProvider | None = None
    model_name: str | None = Field(default=None, min_length=1)
    model_base_url: Annotated[str | None, BeforeValidator(_blank_to_none)] = None
    session_titles: bool = True
    rule: list[PolicyRule] = Field(default_factory=list[PolicyRule])
    # Project folders whose .golem/policy.toml may allow tools. Ask and deny rules apply anywhere.
    trusted_projects: list[str] = Field(default_factory=list[str])
    shell: ShellSettings = Field(default_factory=ShellSettings)
    coding: CodingSettings = Field(default_factory=CodingSettings)
    permissions: PermissionSettings = Field(default_factory=PermissionSettings)
    web: WebSettings = Field(default_factory=WebSettings)
    mcp: McpServers = Field(default_factory=dict)
    skills: SkillSettings = Field(default_factory=SkillSettings)
    ollama: OllamaSettings = Field(default_factory=OllamaSettings)
    routing: RoutingSettings = Field(default_factory=RoutingSettings)
    context: ContextSettings = Field(default_factory=ContextSettings)
    budget: BudgetSettings = Field(default_factory=BudgetSettings)
    memory: MemorySettings = Field(default_factory=MemorySettings)
    relay: RelaySettings = Field(default_factory=RelaySettings)
    agents: AgentSettings = Field(default_factory=AgentSettings)
    notifications: NotificationSettings = Field(default_factory=NotificationSettings)
    routine: list[RoutineSettings] = Field(default_factory=list[RoutineSettings])

    @field_validator("routine")
    @classmethod
    def _unique_routines(cls, value: list[RoutineSettings]) -> list[RoutineSettings]:
        seen: set[str] = set()
        for routine in value:
            if routine.name in seen:
                raise ValueError(f"two routines are called {routine.name}")
            seen.add(routine.name)
        return value

    _no_secrets = model_validator(mode="before")(_no_inline_secrets)

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
                    source: PydanticBaseSettingsSource = (
                        _ProjectToml(settings_cls, toml_file=path)
                        if path == files.project_config and path != files.user_config
                        else TomlConfigSettingsSource(settings_cls, toml_file=path)
                    )
                    sources.append(source)
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
