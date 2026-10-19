"""Client → daemon commands.

``Ping`` in :mod:`golem_protocol.events` is the result of ``ping``.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, SecretStr


class HelloParams(BaseModel):
    """First command on a connection. Negotiates the protocol version."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    protocol_major: int
    protocol_minor: int
    client: str = Field(min_length=1, max_length=32)


class HelloResult(BaseModel):
    """Daemon's protocol version and build."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    protocol_major: int
    protocol_minor: int
    daemon_version: str


class DaemonStatus(BaseModel):
    """Result of ``daemon.status``.

    ``model_profile``, ``model_provider``, and ``model_name`` describe the
    model a new session gets. Provider and name are null when that model does
    not resolve.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    pid: int
    version: str
    protocol_major: int
    protocol_minor: int
    uptime_seconds: float
    state: Literal["running", "draining"]
    model_profile: str | None = Field(default=None, min_length=1)
    model_provider: str | None = Field(default=None, min_length=1)
    model_name: str | None = Field(default=None, min_length=1)


class PingParams(BaseModel):
    """Client heartbeat. The daemon echoes ``nonce`` on a ``Ping`` event."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    nonce: str


class SessionCreateParams(BaseModel):
    """``session.create``. An empty profile uses the daemon's configured one.

    ``cwd`` is the session's project folder, an absolute path. File tools work
    only inside it, and a session without one has no file tools.

    The caller is not attached. ``session.attach`` replays ``session.created``.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    model_profile: str | None = Field(default=None, min_length=1)
    cwd: str | None = Field(default=None, min_length=1)


class SessionCreateResult(BaseModel):
    """The id of the session the daemon just created."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)


class SessionAttachParams(BaseModel):
    """``session.attach``. Replay events after ``after_seq``, then stream live ones.

    Events reach a connection only for sessions it attached. Replayed events
    are written before any live event, with no gap and no repeat.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    after_seq: int = Field(default=0, ge=0)


class SessionAttachResult(BaseModel):
    """``last_seq`` is the newest event when the replay was read."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    last_seq: int = Field(ge=0)


class SessionDetachParams(BaseModel):
    """``session.detach``. Stop live events for this session on this connection."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)


class SessionDetachResult(BaseModel):
    """No payload. Detaching a session that was not attached is not an error."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class SessionListParams(BaseModel):
    """``session.list``. Newest activity first.

    With ``watch``, the connection also gets a ``session.summary``
    notification whenever a session's summary changes, until it closes.
    Watching again is not an error.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    limit: int = Field(default=50, ge=1, le=500)
    watch: bool = False


class SessionSummary(BaseModel):
    """One session as ``session.list`` reports it.

    ``status`` is ``running`` while a run is open, ``waiting`` while a run
    waits for a tool approval, and ``closed`` after ``session.close``. ``last_seq`` is the newest
    stored event, so a client can tell what it has not seen, and which of
    two summaries of one session is newer.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    model_profile: str = Field(min_length=1)
    title: str | None = Field(default=None, min_length=1)
    status: Literal["idle", "running", "waiting", "closed"]
    created_at: str = Field(min_length=1)
    updated_at: str = Field(min_length=1)
    last_seq: int = Field(ge=0)


class SessionListResult(BaseModel):
    """Sessions, newest activity first."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    sessions: list[SessionSummary]


class MessageSendParams(BaseModel):
    """``message.send``. Starts one graph run for this session.

    The run's events go to the connections attached to the session.
    ``cwd`` is the sender's folder, an absolute path. A session without a
    project folder takes it, and keeps it. A session with one ignores it.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    text: str = Field(min_length=1, max_length=100_000)
    cwd: str | None = Field(default=None, min_length=1)


class MessageSendResult(BaseModel):
    """The run that is now streaming events for this send."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    run_id: str = Field(min_length=1)


class RunCancelParams(BaseModel):
    """``run.cancel``. Stop a run that is still in progress."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    run_id: str = Field(min_length=1)


class RunCancelResult(BaseModel):
    """Whether the run was stopped.

    ``cancelled`` is false when the run had already ended. When it is true,
    ``run.cancelled`` is already in the log.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    cancelled: bool


class SessionCloseParams(BaseModel):
    """``session.close``. Hide the session from ``session.list``.

    Its events stay in the log. A run still in progress is cancelled first.
    Closing a session that is already closed is not an error.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)


class SessionCloseResult(BaseModel):
    """The session that is now hidden."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)


class SessionRenameParams(BaseModel):
    """``session.rename``. Set the title by hand. An automatic title never replaces it."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    title: str = Field(min_length=1, max_length=500)


class SessionRenameResult(BaseModel):
    """The title as stored: its first line, at most 60 characters."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    title: str = Field(min_length=1)


class SessionForkParams(BaseModel):
    """``session.fork``. A new session with this one's history up to ``at_message_id``.

    The source may be running: the fork reads completed checkpoints. The
    caller is not attached to the new session.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    at_message_id: str = Field(min_length=1)


class SessionForkResult(BaseModel):
    """The new session's id."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)


class SessionInspectParams(BaseModel):
    """``session.inspect``. Read the checkpoint for one session. Does not call the model."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)


class InspectMessage(BaseModel):
    """One checkpoint message as plain text."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    role: Literal["user", "assistant", "system", "tool"]
    text: str


class SessionInspectResult(BaseModel):
    """The conversation stored for this session.

    ``message_count`` is the length of ``messages``. Provider and name are
    null when the daemon cannot resolve ``model_profile``.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    model_profile: str = Field(min_length=1)
    model_provider: str | None = Field(default=None, min_length=1)
    model_name: str | None = Field(default=None, min_length=1)
    message_count: int = Field(ge=0)
    messages: list[InspectMessage]


class AuthSetParams(BaseModel):
    """``auth.set``. Store an API key for ``provider`` in the OS credential store.

    A client never logs or displays ``key``.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    provider: str = Field(min_length=1)
    key: SecretStr = Field(min_length=1, max_length=4096)


class AuthSetResult(BaseModel):
    """The provider whose key was stored."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    provider: str = Field(min_length=1)


class AuthRemoveParams(BaseModel):
    """``auth.remove``. Delete the stored key for ``provider``. An environment variable stays."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    provider: str = Field(min_length=1)


class AuthRemoveResult(BaseModel):
    """``removed`` is false when no key was stored."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    provider: str = Field(min_length=1)
    removed: bool


class AuthListParams(BaseModel):
    """``auth.list``. Key status for every known provider. Never returns a key."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class AuthKeyStatus(BaseModel):
    """One provider's key.

    ``takes_key`` is false for a provider that never uses one, such as
    ``ollama``. ``needs_key`` means a model call fails without one.
    ``source`` is where the key was found, or null when there is none.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    provider: str = Field(min_length=1)
    takes_key: bool
    needs_key: bool
    env_var: str | None = Field(default=None, min_length=1)
    source: Literal["env", "keychain"] | None = None


class AuthListResult(BaseModel):
    """Providers sorted by name."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    providers: list[AuthKeyStatus]


class ModelListParams(BaseModel):
    """``model.list``. ``refresh`` fetches hosted model lists and prices again, past their cache."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    refresh: bool = False


class ModelPriceInfo(BaseModel):
    """USD per million tokens. A local model is zero."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    input: float = Field(ge=0)
    output: float = Field(ge=0)
    cached_input: float | None = Field(default=None, ge=0)


class ListedModel(BaseModel):
    """One model, by ``provider/model`` ref.

    ``source`` is where golem found it: ``installed`` on a local server,
    ``catalog`` for a local model to download, ``remote`` from a provider's
    list, or ``profile`` when only config names it. ``progress`` is set while
    it is ``pulling``. ``profiles`` are the profile names that point at it.
    ``fit`` says whether a local model fits in this machine's memory.
    ``stale`` means a cached list was shown because the provider did not
    answer in time.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    ref: str = Field(min_length=3)
    label: str = Field(min_length=1)
    provider: str = Field(min_length=1)
    source: Literal["installed", "catalog", "remote", "profile"]
    status: Literal["ready", "needs_key", "not_installed", "server_down", "pulling"]
    progress: float | None = Field(default=None, ge=0, le=1)
    profiles: list[str] = Field(default_factory=list)
    ctx: int | None = Field(default=None, gt=0)
    tools: bool | None = None
    price: ModelPriceInfo | None = None
    size_gb: float | None = Field(default=None, ge=0)
    fit: Literal["fits", "tight", "too_big"] | None = None
    stale: bool = False


class ListedProvider(BaseModel):
    """``unlisted`` is a provider golem does not ask for models: nothing uses it yet."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    provider: str = Field(min_length=1)
    status: Literal["ready", "needs_key", "server_down", "unlisted"]
    stale: bool = False


class ModelListResult(BaseModel):
    """``default`` is the model a new session gets. ``ram_gb`` is this machine's memory."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    default: str = Field(min_length=1)
    ram_gb: float | None = Field(default=None, gt=0)
    models: list[ListedModel]
    providers: list[ListedProvider]


class SessionSetModelParams(BaseModel):
    """``session.set_model``. ``model`` is a profile name or a ``provider/model`` ref.

    The switch applies from the session's next run. The daemon emits
    ``model.selected``.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    model: str = Field(min_length=1)


class SessionSetModelResult(BaseModel):
    """The model the session now uses, and what it resolves to."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    model_profile: str = Field(min_length=1)
    model_provider: str | None = Field(default=None, min_length=1)
    model_name: str | None = Field(default=None, min_length=1)


class ModelSetDefaultParams(BaseModel):
    """``model.set_default``. Write ``default_model`` to the user's ``config.toml``.

    New sessions start on it. Comments and the rest of the file stay as they are.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    model: str = Field(min_length=1)


class ModelSetDefaultResult(BaseModel):
    """The default as stored."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    default: str = Field(min_length=1)


class ModelProbeParams(BaseModel):
    """``model.probe``. Look up a local model before downloading it.

    ``name`` is an Ollama name (``qwen3:8b``) or a ref (``ollama/qwen3:8b``).
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)


class ModelProbeResult(BaseModel):
    """What a download would be.

    ``exists`` is false when the registry has no such model, and null when
    it could not be asked. ``disk_free_gb`` is the space where Ollama keeps
    models, when golem can see that disk.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    ref: str = Field(min_length=3)
    installed: bool
    exists: bool | None = None
    size_gb: float | None = Field(default=None, ge=0)
    fit: Literal["fits", "tight", "too_big"] | None = None
    disk_free_gb: float | None = Field(default=None, ge=0)


class ModelPullParams(BaseModel):
    """``model.pull``. Download a local model. Progress arrives as ``model.pull.progress``."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)


class ModelPullResult(BaseModel):
    """``started`` is false when the model was already downloading."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    ref: str = Field(min_length=3)
    started: bool


class ModelPullCancelParams(BaseModel):
    """``model.pull_cancel``. Stop a download. Ollama keeps what it fetched for the next try."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)


class ModelPullCancelResult(BaseModel):
    """``cancelled`` is false when nothing was downloading."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    ref: str = Field(min_length=3)
    cancelled: bool


class ModelDeleteParams(BaseModel):
    """``model.delete``. Remove an installed local model from Ollama."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)


class ModelDeleteResult(BaseModel):
    """``deleted`` is false when Ollama did not have the model."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    ref: str = Field(min_length=3)
    deleted: bool


class ModelPullProgress(BaseModel):
    """One step of a download. ``progress`` is the share of bytes fetched, when known."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    ref: str = Field(min_length=3)
    status: str
    completed: int | None = Field(default=None, ge=0)
    total: int | None = Field(default=None, ge=0)
    progress: float | None = Field(default=None, ge=0, le=1)


class ModelPullDone(BaseModel):
    """A download ended. ``error`` says why when ``ok`` is false; ``cancelled`` for a stop."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    ref: str = Field(min_length=3)
    ok: bool
    error: str | None = None


class ConfigGetParams(BaseModel):
    """``config.get``. The settings the daemon uses, and the tool rules for ``cwd``.

    ``cwd`` is an absolute folder. Without it, no project rules are listed.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    cwd: str | None = Field(default=None, min_length=1)


class ConfigRule(BaseModel):
    """One tool rule, in the order rules are checked.

    ``source`` names the file and the rule's number in it, or ``built-in
    default``. ``ignored`` says why a listed rule never matches.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    tool: str = Field(min_length=1)
    match: str | None = None
    path: str | None = None
    action: Literal["allow", "ask", "deny"]
    source: str = Field(min_length=1)
    ignored: str | None = None


class ConfigGetResult(BaseModel):
    """Resolved settings. Keys are never included.

    ``project_policy`` is the project's ``.golem/policy.toml`` when it exists,
    and ``project_trusted`` whether its allow rules count. Both are null
    without a ``cwd``.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    config_file: str = Field(min_length=1)
    default_model: str = Field(min_length=1)
    log_level: str = Field(min_length=1)
    session_titles: bool
    trusted_projects: list[str]
    project_policy: str | None = None
    project_trusted: bool | None = None
    rules: list[ConfigRule]


class ApprovalRespondParams(BaseModel):
    """``approval.respond``. Answer the tool call a session's run waits on.

    ``allow`` runs it once, ``allow_session`` runs it and allows the tool for
    the rest of the session, and ``deny`` tells the model it may not.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    call_id: str = Field(min_length=1)
    decision: Literal["allow", "allow_session", "deny"]


class ApprovalRespondResult(BaseModel):
    """The run that goes on. Its events go to the attached connections."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    run_id: str = Field(min_length=1)


__all__ = [
    "ApprovalRespondParams",
    "ApprovalRespondResult",
    "AuthKeyStatus",
    "AuthListParams",
    "AuthListResult",
    "AuthRemoveParams",
    "AuthRemoveResult",
    "AuthSetParams",
    "AuthSetResult",
    "ConfigGetParams",
    "ConfigGetResult",
    "ConfigRule",
    "DaemonStatus",
    "HelloParams",
    "HelloResult",
    "InspectMessage",
    "ListedModel",
    "ListedProvider",
    "MessageSendParams",
    "MessageSendResult",
    "ModelDeleteParams",
    "ModelDeleteResult",
    "ModelListParams",
    "ModelListResult",
    "ModelPriceInfo",
    "ModelProbeParams",
    "ModelProbeResult",
    "ModelPullCancelParams",
    "ModelPullCancelResult",
    "ModelPullDone",
    "ModelPullParams",
    "ModelPullProgress",
    "ModelPullResult",
    "ModelSetDefaultParams",
    "ModelSetDefaultResult",
    "PingParams",
    "RunCancelParams",
    "RunCancelResult",
    "SessionAttachParams",
    "SessionAttachResult",
    "SessionCloseParams",
    "SessionCloseResult",
    "SessionCreateParams",
    "SessionCreateResult",
    "SessionDetachParams",
    "SessionDetachResult",
    "SessionForkParams",
    "SessionForkResult",
    "SessionInspectParams",
    "SessionInspectResult",
    "SessionListParams",
    "SessionListResult",
    "SessionRenameParams",
    "SessionRenameResult",
    "SessionSetModelParams",
    "SessionSetModelResult",
    "SessionSummary",
]
