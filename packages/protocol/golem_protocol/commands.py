"""Client → daemon commands.

``Ping`` in :mod:`golem_protocol.events` is the result of ``ping``.
"""

from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, SecretStr, model_validator

from golem_protocol.events import SkillCall, SkillSource


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


class LocalServer(BaseModel):
    """A model server on this machine that answers, such as Ollama.

    ``owner`` ``golem`` started it and stops it when it is unused, and
    ``external`` runs on its own, for example from ``brew services`` or the
    Ollama app. ``pid`` and ``memory_mb`` (the server and its model processes)
    are known only for one golem started.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    provider: str = Field(min_length=1)
    base_url: str = Field(min_length=1)
    owner: Literal["golem", "external"]
    pid: int | None = None
    memory_mb: float | None = Field(default=None, ge=0)


class ModelServerStatus(BaseModel):
    """A local model server changed state. ``message`` says why it ``failed``."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    provider: str = Field(min_length=1)
    base_url: str = Field(min_length=1)
    state: Literal["starting", "ready", "failed", "stopped"]
    message: str | None = Field(default=None, min_length=1)


class DaemonStatus(BaseModel):
    """Result of ``daemon.status``.

    ``model_profile``, ``model_provider``, and ``model_name`` describe the
    model a new session gets. Provider and name are null when that model does
    not resolve. ``local_servers`` are the local model servers golem has
    used since it started, while they run.
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
    local_servers: list[LocalServer] = Field(default_factory=list[LocalServer])


class PingParams(BaseModel):
    """Client heartbeat. The daemon echoes ``nonce`` on a ``Ping`` event."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    nonce: str


class SessionCreateParams(BaseModel):
    """``session.create``. An empty profile uses the daemon's configured one.

    ``cwd`` is the session's project folder, an absolute path. File tools work
    only inside it, and a session without one has no file tools.

    ``model_profile`` is a profile name or a ``provider/model`` ref, and null
    uses the default. The daemon checks it as ``session.set_model`` does, so a
    model that does not resolve, or whose provider has no key, fails here with
    the same error code and message.

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

    With ``cwd``, an absolute path, only the sessions in that project folder
    are listed. It does not go with ``watch``.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    limit: int = Field(default=50, ge=1, le=500)
    watch: bool = False
    cwd: str | None = Field(default=None, min_length=1)

    @model_validator(mode="after")
    def _cwd_without_watch(self) -> Self:
        if self.watch and self.cwd is not None:
            raise ValueError("session.list takes cwd or watch, not both")
        return self


class SessionSummary(BaseModel):
    """One session as ``session.list`` reports it.

    ``status`` is ``running`` while a run is open, ``waiting`` while a run
    waits for a tool approval, and ``closed`` after ``session.close``. ``last_seq`` is the newest
    stored event, so a client can tell what it has not seen, and which of
    two summaries of one session is newer. ``cwd`` is the session's project
    folder, null for a session that has not been given one. ``forked_from`` is
    the id of the session this one was forked from, null for a session that is
    not a fork. An older daemon leaves it out.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    model_profile: str = Field(min_length=1)
    title: str | None = Field(default=None, min_length=1)
    status: Literal["idle", "running", "waiting", "closed"]
    created_at: str = Field(min_length=1)
    updated_at: str = Field(min_length=1)
    last_seq: int = Field(ge=0)
    cwd: str | None = Field(default=None, min_length=1)
    forked_from: str | None = Field(default=None, min_length=1)


class SessionListResult(BaseModel):
    """Sessions, newest activity first."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    sessions: list[SessionSummary]


class MessageSendParams(BaseModel):
    """``message.send``. Starts one graph run for this session.

    The run's events go to the connections attached to the session.
    ``cwd`` is the sender's folder, an absolute path. A session without a
    project folder takes it, and keeps it. A session with one ignores it.

    ``skill`` runs a skill once: the model gets the skill's body with
    ``skill.args`` filled in, instead of ``text``. ``text`` is then what the
    user typed, such as ``/ship fix the mcp restart``. A skill the session
    does not see, or one that is disabled, broken, or not user-invocable, is
    error ``-32013``.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    text: str = Field(min_length=1, max_length=100_000)
    cwd: str | None = Field(default=None, min_length=1)
    skill: SkillCall | None = None


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


class SessionSetSkillsParams(BaseModel):
    """``session.set_skills``. Pin skills for the whole session, or unpin them.

    A pinned skill's body is in the system prompt of every model call. Names
    in ``pin`` are added in order, after the ones already pinned. A name may
    not be in both lists.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    pin: list[str] = Field(default_factory=list[str])
    unpin: list[str] = Field(default_factory=list[str])


class SessionSetSkillsResult(BaseModel):
    """The skills pinned in the session now, in the order they were pinned."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    skills: list[str]


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
    """The conversation stored for this session, as the next model call sees it.

    When golem has a system prompt for the session, it is the first of
    ``messages``, with role ``system``. It is built for each call and never
    stored, so ``message_count`` counts only the stored messages. Provider and
    name are null when the daemon cannot resolve ``model_profile``.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    model_profile: str = Field(min_length=1)
    model_provider: str | None = Field(default=None, min_length=1)
    model_name: str | None = Field(default=None, min_length=1)
    message_count: int = Field(ge=0)
    messages: list[InspectMessage]


class TraceGetParams(BaseModel):
    """``trace.get``. Read one session as a tree of spans. Does not call the model."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)


class TraceTokens(BaseModel):
    """Tokens one model call used. A field is null when the provider did not report it."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    input: int | None = None
    output: int | None = None
    cache_read: int | None = None
    cache_write: int | None = None


class TraceSpan(BaseModel):
    """One run, model call, or tool call, without its children.

    ``id`` is the run id for a run, the assistant ``message_id`` for a model
    call, and the ``call_id`` for a tool call. ``end`` is null while the span
    is open, or when its run was cut off. ``duration_ms`` is the model's
    latency or the tool's own time when the daemon measured it, else
    ``end - start``. ``approval_wait_ms`` is the time a tool call waited for
    the user. ``recorded`` is false for a model span rebuilt from the message
    events of a session that has no ``model.call.*`` events.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(min_length=1)
    kind: Literal["run", "model", "tool"]
    name: str
    start: str = Field(min_length=1)
    end: str | None = None
    duration_ms: int | None = Field(default=None, ge=0)
    status: Literal["ok", "failed", "cancelled", "denied", "running"]
    model: str | None = None
    tokens: TraceTokens | None = None
    first_token_ms: int | None = Field(default=None, ge=0)
    approval_wait_ms: int | None = Field(default=None, ge=0)
    preview: str = Field(default="", max_length=200)
    recorded: bool = True


class TraceToolSpan(TraceSpan):
    """A tool call. It has no children."""


class TraceModelSpan(TraceSpan):
    """A model call, with the tool calls it asked for, in request order."""

    children: list[TraceToolSpan] = Field(default_factory=list[TraceToolSpan])


class TraceRunSpan(TraceSpan):
    """A run, with its model calls in order."""

    children: list[TraceModelSpan] = Field(default_factory=list[TraceModelSpan])


class TraceGetResult(BaseModel):
    """Runs of a session, oldest first.

    The tree is run, then model call, then tool call. A client picks a span
    by ``id`` and loads it with ``trace.span``.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    title: str | None = None
    runs: list[TraceRunSpan]


class TraceSpanParams(BaseModel):
    """``trace.span``. Read the full input and output of one model or tool span."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    span_id: str = Field(min_length=1)


class TraceMessage(BaseModel):
    """One checkpoint message with its id, as plain text."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str | None = None
    role: Literal["user", "assistant", "tool"]
    text: str
    tool_calls: list[dict[str, Any]] = Field(default_factory=list[dict[str, Any]])
    call_id: str | None = None


class TraceSpanResult(BaseModel):
    """What a span took in and gave out. ``span`` has no children.

    For a model span, ``messages`` is the context sent, in order, and
    ``new_from`` is where the part new since the previous model call
    begins. ``system_prompt`` and ``tools`` are null when they were not
    recorded. For a tool span, ``result`` is the text the model got back, and
    ``artifact_id`` is set when the output was too big for the model: open it
    with ``artifact.read``.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    span: TraceSpan
    system_prompt: str | None = None
    tools: list[dict[str, Any]] | None = None
    messages: list[TraceMessage] = Field(default_factory=list[TraceMessage])
    new_from: int | None = Field(default=None, ge=0)
    reply: TraceMessage | None = None
    args: dict[str, Any] | None = None
    result: str | None = None
    artifact_id: str | None = Field(default=None, min_length=1)
    approval: dict[str, Any] | None = None
    stop_reason: str | None = None
    provider: str | None = None


class AuthSetParams(BaseModel):
    """``auth.set``. Store an API key for ``provider`` in the OS credential store.

    A client never logs or displays ``key``. With ``check``, a model
    provider's key is tried against the provider first, and a key it rejects
    is not stored.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    provider: str = Field(min_length=1)
    key: SecretStr = Field(min_length=1, max_length=4096)
    check: bool = True


class AuthSetResult(BaseModel):
    """The provider whose key was stored. ``models``: how many models a checked key opens."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    provider: str = Field(min_length=1)
    models: int | None = Field(default=None, ge=0)


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
    """``model.list``.

    ``refresh`` fetches hosted model lists and prices again, past their cache. A hosted model is
    listed when the provider's live list and the catalog both have it. ``show_all`` adds the live
    chat models that call tools. A model past its retirement date is never listed.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    refresh: bool = False
    show_all: bool = False


class ModelPriceInfo(BaseModel):
    """USD per million tokens. A local model is zero."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    input: float = Field(ge=0)
    output: float = Field(ge=0)
    cached_input: float | None = Field(default=None, ge=0)


ModelCategory = Literal["general", "coding", "reasoning", "vision", "fast", "long-context"]


class ListedModel(BaseModel):
    """One model, by ``provider/model`` ref.

    ``source`` is where golem found it: ``installed`` on a local server,
    ``catalog`` for a local model to download, ``remote`` from a provider's
    list, or ``profile`` when only config names it. ``progress`` is set while
    it is ``pulling``. ``profiles`` are the profile names that point at it.
    ``fit`` says whether a local model fits in this machine's memory.
    ``tags`` are a catalog model's tags, such as ``coding``, and
    ``recommended`` marks the one catalog model golem suggests for this Mac.
    ``categories`` say what the model is for, in a fixed order: the catalog's
    own for a model it lists, else what Ollama's ``capabilities`` and
    LiteLLM's ``supports_*`` fields and context size show.
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
    tags: list[str] = Field(default_factory=list)
    categories: list[ModelCategory] = Field(default_factory=list[ModelCategory])
    recommended: bool = False


class ListedProvider(BaseModel):
    """``unlisted`` is a provider golem does not ask for models: nothing uses it yet.

    ``not_installed`` is a local server whose program is missing, such as an
    Ollama with no ``ollama`` binary on this machine.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    provider: str = Field(min_length=1)
    status: Literal["ready", "needs_key", "server_down", "not_installed", "unlisted"]
    stale: bool = False


class ModelSetup(BaseModel):
    """Where the user is in setting up a model, for a first-run screen.

    ``keys`` are the providers with a key, from the environment or the
    Keychain. ``default_status`` is the default model's status, ``unknown``
    when it names a model golem does not list, and null when no default is
    chosen.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    ollama_installed: bool
    ollama_running: bool
    keys: list[str] = Field(default_factory=list)
    default_status: (
        Literal["ready", "needs_key", "not_installed", "server_down", "pulling", "unknown"] | None
    ) = None


class ModelListResult(BaseModel):
    """``default`` is the model a new session gets, null before one is chosen.

    ``ram_gb`` is this machine's memory, and ``disk_free_gb`` the free space
    in the home folder, where Ollama keeps its models.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    default: str | None = Field(min_length=1)
    ram_gb: float | None = Field(default=None, gt=0)
    disk_free_gb: float | None = Field(default=None, ge=0)
    models: list[ListedModel]
    providers: list[ListedProvider]
    setup: ModelSetup


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


class SkillRegistryChanged(BaseModel):
    """Skills changed on disk. List them again for the folders it covers.

    ``root`` is the session folder whose project skills changed. ``None`` means
    the user's or golem's skills, or ``[skills]`` in ``config.toml``, changed,
    which every folder sees.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    root: str | None = None


class SkillListParams(BaseModel):
    """``skill.list``. The skills a session in ``cwd`` sees, or only the user's without it."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    cwd: str | None = Field(default=None, min_length=1)


class ListedSkill(BaseModel):
    """One skill folder, valid or not.

    ``usable`` is false when the skill has ``errors``, is in ``[skills]
    disabled``, or lost its name to another skill, whose folder
    ``shadowed_by`` names. ``model_invocable`` is false for
    ``disable-model-invocation: true``. ``allowed_tools`` and ``model`` are
    the frontmatter as written.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)
    description: str
    source: SkillSource
    path: str
    usable: bool
    shadowed_by: str | None = None
    disabled: bool = False
    errors: list[str] = Field(default_factory=list[str])
    warnings: list[str] = Field(default_factory=list[str])
    user_invocable: bool = True
    model_invocable: bool = True
    argument_hint: str | None = None
    allowed_tools: list[str] = Field(default_factory=list[str])
    model: str | None = None


class SkillListResult(BaseModel):
    """Every skill found, highest source first, winners and losers."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    skills: list[ListedSkill]


class McpListParams(BaseModel):
    """``mcp.list``. The user's MCP servers and their state.

    With ``session_id``, also the servers of that session's trusted project,
    and whether each one is on for the session.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str | None = Field(default=None, min_length=1)


McpServerState = Literal["idle", "starting", "running", "failed", "disabled"]


class McpServer(BaseModel):
    """One MCP server from ``[mcp.<name>]``.

    ``command`` is the command line golem runs, or the URL it reaches.
    ``project`` is the folder whose ``.golem/config.toml`` names the server,
    or null for the user's own. ``on_demand`` servers are ``idle`` until a
    session turns one on, and ``enabled`` says whether the asking session
    has it, when ``mcp.list`` named one. ``tools`` are the names the model
    sees, ``mcp__<server>__<tool>``, while it is ``running``, and
    ``schema_tokens`` roughly what their schemas cost in each prompt.
    ``error`` says why it is ``failed``, and ``retry_seconds`` when golem
    tries again. ``config`` is the file that names the server. ``tools_hidden``
    counts the tools its ``tools`` filter keeps from the model, and
    ``approval`` is ``"allow"`` when its calls run without asking.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)
    state: McpServerState
    command: str
    tools: list[str] = Field(default_factory=list[str])
    error: str | None = None
    project: str | None = None
    on_demand: bool = False
    enabled: bool | None = None
    schema_tokens: int | None = Field(default=None, ge=0)
    retry_seconds: float | None = Field(default=None, ge=0)
    config: str | None = None
    tools_hidden: int = Field(default=0, ge=0)
    approval: Literal["ask", "allow"] = "ask"


class McpServerParams(BaseModel):
    """``mcp.tools`` and ``mcp.restart``: one server, as ``session_id``'s project sees it."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)
    session_id: str | None = Field(default=None, min_length=1)


class McpToolInfo(BaseModel):
    """One of a server's tools: the name the model sees, and what it says it does.

    A ``hidden`` tool is one the server's ``tools`` filter keeps from the model.
    ``schema_tokens`` roughly what its schema costs in each prompt.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)
    description: str
    hidden: bool = False
    schema_tokens: int = Field(default=0, ge=0)


class McpToolsResult(BaseModel):
    """The running server's tools, in its order. Empty while it is not running."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)
    tools: list[McpToolInfo]


class McpToolFilterConfig(BaseModel):
    """``tools`` of ``[mcp.<name>]``: ``fnmatch`` patterns on the server's own tool names.

    An empty ``include`` means every tool, and ``exclude`` wins.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    include: list[str] = Field(default_factory=list[str])
    exclude: list[str] = Field(default_factory=list[str])


class McpServerConfig(BaseModel):
    """Every field of ``[mcp.<name>]``, as it goes over the wire.

    The daemon's settings model has the same fields, and a test keeps the two
    equal. A value in ``env`` or ``headers`` names a secret as
    ``keychain:mcp/<name>``, never the secret itself.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    command: str | None = Field(default=None, min_length=1)
    args: list[str] = Field(default_factory=list[str])
    env: dict[str, str] = Field(default_factory=dict[str, str])
    cwd: str | None = Field(default=None, min_length=1)
    url: str | None = Field(default=None, min_length=1)
    headers: dict[str, str] = Field(default_factory=dict[str, str])
    enabled: bool | Literal["on_demand"] = True
    timeout_seconds: int = Field(default=120, gt=0, le=3600)
    tools: McpToolFilterConfig = Field(default_factory=McpToolFilterConfig)
    approval: Literal["ask", "allow"] = "ask"
    env_passthrough: list[str] = Field(default_factory=list[str])


class McpSecretInfo(BaseModel):
    """A secret a server names, ``ref`` as ``mcp/<name>``, and whether the store has it.

    The value is never sent.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    ref: str = Field(min_length=1)
    stored: bool


class McpServerDetail(BaseModel):
    """``mcp.get``. One server's status, its whole config, and where it is written.

    ``scope`` is ``"project"`` for a server in a project's ``.golem/config.toml``,
    and ``path`` is the file that names it.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    server: McpServer
    config: McpServerConfig
    scope: Literal["user", "project"]
    path: str
    secrets: list[McpSecretInfo]


McpTestStepName = Literal["resolve", "spawn", "connect", "initialize", "tools", "ping"]
McpTestStepState = Literal["running", "ok", "failed", "skipped"]


class McpTestStep(BaseModel):
    """One step of ``mcp.test``: what it was, how it ended, and how long it took.

    A stdio server goes ``resolve`` (the command is found), ``spawn``,
    ``initialize``, ``tools``, ``ping``. An HTTP server goes ``resolve`` (the
    host is found), ``connect``, then the same three. A step after a failed one
    is ``skipped``.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    step: McpTestStepName
    state: McpTestStepState
    elapsed_ms: int = Field(default=0, ge=0)
    detail: str | None = None


class McpTestParams(BaseModel):
    """``mcp.test``. Start a server, list its tools, and ping it, without saving anything.

    There are three forms, and sending more than one is an error. ``name`` is a
    saved server. ``config`` is one not saved yet, with ``secrets`` by reference
    (``mcp/github``). ``catalog_id`` is a catalog entry, with ``inputs`` and
    ``secrets`` by input id as in ``mcp.add``, and ``name`` (optional) naming the
    draft. Secrets are used for this test first and then, for a saved server,
    the Keychain, and are never stored. ``test_id`` ties the
    ``mcp.test.progress`` notifications to this call.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    test_id: str = Field(min_length=1)
    name: str | None = Field(default=None, min_length=1)
    config: McpServerConfig | None = None
    catalog_id: str | None = Field(default=None, min_length=1)
    inputs: dict[str, str] = Field(default_factory=dict[str, str])
    secrets: dict[str, SecretStr] = Field(default_factory=dict[str, SecretStr])
    session_id: str | None = Field(default=None, min_length=1)

    @model_validator(mode="after")
    def _one_source(self) -> Self:
        if self.catalog_id is not None:
            if self.config is not None:
                raise ValueError("send either catalog_id or config, not both")
            return self
        if self.inputs:
            raise ValueError("inputs are for a catalog_id")
        if (self.name is None) == (self.config is None):
            raise ValueError("send either name or config")
        return self


class McpTestProgress(BaseModel):
    """``mcp.test.progress``: a step of a running test started or ended. Not stored."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    test_id: str = Field(min_length=1)
    step: McpTestStepName
    state: McpTestStepState
    elapsed_ms: int = Field(default=0, ge=0)
    detail: str | None = None


class McpImplementation(BaseModel):
    """The server's own name and version, from its ``initialize`` answer."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str
    version: str | None = None


class McpTestResult(BaseModel):
    """What ``mcp.test`` found.

    ``steps`` has every step, with the ones after a failure ``skipped``.
    ``stderr_tail`` is the server's last 50 lines of stderr, with secrets
    replaced by ``•••``. ``hint`` is one next step for the person, and
    ``runtime`` says which runtime (``node`` or ``uv``) a UI can offer to
    install when that is the hint.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    test_id: str = Field(min_length=1)
    ok: bool
    steps: list[McpTestStep]
    server_info: McpImplementation | None = None
    protocol_version: str | None = None
    tools: list[McpToolInfo] = Field(default_factory=list[McpToolInfo])
    stderr_tail: list[str] = Field(default_factory=list[str])
    hint: str | None = None
    runtime: Literal["node", "uv"] | None = None


class McpLogLine(BaseModel):
    """One line of a server's log: its stderr, or something golem did to it."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    ts: float
    kind: Literal["stderr", "event"]
    text: str


class McpLogsParams(BaseModel):
    """``mcp.logs``. The last ``limit`` lines of a server's log, oldest first."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)
    session_id: str | None = Field(default=None, min_length=1)
    limit: int = Field(default=200, ge=1, le=500)


class McpLogsResult(BaseModel):
    """The log lines of one server. The daemon keeps 500, across restarts."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)
    lines: list[McpLogLine]


class McpServerLog(BaseModel):
    """``mcp.server.log``: new log lines of one server, at most one batch every 250 ms."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)
    project: str | None = None
    lines: list[McpLogLine]


class McpCallParams(BaseModel):
    """``mcp.call``. Run one tool of a running server, by the server's own tool name.

    It is for a form where a person presses Run, so it asks no approval. It is
    recorded in no session and the model never sees it.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)
    tool: str = Field(min_length=1)
    arguments: dict[str, Any] = Field(default_factory=dict[str, Any])
    session_id: str | None = Field(default=None, min_length=1)


class McpCallResult(BaseModel):
    """The tool's text, whether it failed, and its structured result when it has one."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    text: str
    is_error: bool
    structured: Any | None = None


McpCatalogCategory = Literal["files", "code", "web", "data", "productivity", "other"]


class McpCatalogInput(BaseModel):
    """One thing a catalog entry asks for. A ``secret`` is never stored in the config file."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(min_length=1)
    kind: Literal["path", "text", "secret", "choice"]
    label: str = Field(min_length=1)
    hint: str | None = None
    default: str | None = None
    choices: list[str] = Field(default_factory=list[str])
    required: bool = True


class McpCatalogEntry(BaseModel):
    """A server ``mcp.catalog`` offers, and whether it can be added here and now.

    ``name`` is the server name it adds. ``runtime`` is what runs it (``npx``,
    ``uvx``, ``docker``) or ``url``, and ``auth`` is ``none``, ``token``, or
    ``oauth``. ``missing`` names the program (``node``, ``uv``, ``docker``)
    that is not installed, so a UI can offer ``runtime.install``. ``available``
    is false, with a ``reason``, for an entry that cannot be added yet.
    ``added`` is true when a server of that name exists. ``on_demand`` entries
    cost no tokens until a chat turns them on, and ``starter`` ones are
    offered in the setup window.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    title: str = Field(min_length=1)
    description: str
    category: McpCatalogCategory
    homepage: str
    runtime: Literal["npx", "uvx", "docker", "url"]
    auth: Literal["none", "token", "oauth"]
    inputs: list[McpCatalogInput] = Field(default_factory=list[McpCatalogInput])
    starter: bool = False
    on_demand: bool = True
    available: bool = True
    reason: str | None = None
    missing: Literal["node", "uv", "docker"] | None = None
    added: bool = False


class McpCatalogParams(BaseModel):
    """``mcp.catalog``. With ``session_id``, ``{folder}`` and ``added`` are about its project."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str | None = Field(default=None, min_length=1)


class McpCatalogResult(BaseModel):
    """The entries, in the catalog's order."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    entries: list[McpCatalogEntry]


class McpImportScanParams(BaseModel):
    """``mcp.import.scan``. Find the MCP servers other apps have, or read pasted JSON.

    Without ``text``, the daemon reads the config files of Claude Desktop, Claude
    Code, Cursor, VS Code, and Windsurf that exist, and with ``session_id`` also
    that project's files. With ``text``, it reads only the text: any of those
    files' shapes, or one bare server. Nothing is written, and no file of
    another app is ever changed.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str | None = Field(default=None, min_length=1)
    text: str | None = Field(default=None, min_length=1, max_length=1_000_000)


class McpImportCandidate(BaseModel):
    """A server found in another app, as golem would add it.

    ``config`` names a secret as ``keychain:mcp/<name>``, never its value.
    ``secret_refs`` are all the secrets it names, and ``missing_refs`` the ones
    the source did not hold a value for (a ``${input:token}``): send them in
    ``secrets`` of ``mcp.import.apply``, or set them later. ``clash`` says
    ``name`` was changed to fit an existing server or another candidate, and
    ``already_same`` says golem has a server with the same command or url.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    key: str
    name: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9-]{0,31}$")
    original_name: str
    scope: Literal["user", "project"]
    config: McpServerConfig
    secret_refs: list[str] = Field(default_factory=list[str])
    missing_refs: list[str] = Field(default_factory=list[str])
    warnings: list[str] = Field(default_factory=list[str])
    clash: bool = False
    already_same: bool = False


class McpImportSource(BaseModel):
    """One file of another app, or the pasted text, and the servers in it.

    ``skipped`` lists servers that could not be turned into a golem server, with
    the reason. ``error`` is set when the file could not be read.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str
    label: str
    path: str | None = None
    candidates: list[McpImportCandidate] = Field(default_factory=list[McpImportCandidate])
    skipped: list[str] = Field(default_factory=list[str])
    error: str | None = None


class McpImportScanResult(BaseModel):
    """The sources found. Secret values stay in the daemon under ``scan_id`` for ten minutes."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    scan_id: str
    sources: list[McpImportSource]


class McpImportPick(BaseModel):
    """A candidate to add, by ``key``, under ``name`` (the candidate's own, or another)."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    key: str
    name: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9-]{0,31}$")
    scope: Literal["user", "project"] = "user"


class McpImportApplyParams(BaseModel):
    """``mcp.import.apply``. Add the picked candidates of a scan, once.

    Each pick stores its secrets, writes ``[mcp.<name>]``, and the daemon reloads
    the servers once. A pick that fails, such as a name already in use, is
    reported in ``failed`` and the others are still added. ``secrets`` gives
    values by reference for a candidate's ``missing_refs``. ``scope = "project"``
    needs ``session_id`` of a trusted project. The scan is used up by the call.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    scan_id: str = Field(min_length=1)
    picks: list[McpImportPick] = Field(min_length=1, max_length=200)
    secrets: dict[str, SecretStr] = Field(default_factory=dict[str, SecretStr])
    session_id: str | None = Field(default=None, min_length=1)


class McpImportFailure(BaseModel):
    """A pick that was not added, and why."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    key: str
    error: str


class McpImportApplyResult(BaseModel):
    """The servers added, and the picks that failed."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    added: list[McpServer]
    failed: list[McpImportFailure] = Field(default_factory=list[McpImportFailure])


RuntimeName = Literal["node", "uv"]


class RuntimeInstallParams(BaseModel):
    """``runtime.install``. Install Node or uv with Homebrew. Output: ``runtime.install.output``."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: RuntimeName


class RuntimeInstallResult(BaseModel):
    """``started`` is false when that install was already running."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: RuntimeName
    started: bool


class RuntimeInstallCancelParams(BaseModel):
    """``runtime.install_cancel``. Stop a running install."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: RuntimeName


class RuntimeInstallCancelResult(BaseModel):
    """``cancelled`` is false when that install was not running."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: RuntimeName
    cancelled: bool


class RuntimeInstallOutput(BaseModel):
    """Output from ``brew install`` as it came, carriage returns included."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: RuntimeName
    text: str


class RuntimeInstallDone(BaseModel):
    """The install ended. ``error`` says why when ``ok`` is false, and is null when stopped."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: RuntimeName
    ok: bool
    error: str | None = None


class McpSetEnabledParams(BaseModel):
    """``mcp.set_enabled``. Write ``enabled`` into the file that names the server.

    ``true`` is for every session, ``"on_demand"`` for the sessions that turn it
    on, and ``false`` stops it everywhere. The change applies at once.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)
    enabled: bool | Literal["on_demand"]
    session_id: str | None = Field(default=None, min_length=1)


class McpAddParams(BaseModel):
    """``mcp.add``. Write ``[mcp.<name>]`` into a config file, and start the server.

    There are two forms, and sending both is an error.

    The short form gives a ``command`` with its ``args`` for a stdio server, or a
    ``url`` for an HTTP one, and writes the user's file. A ``token`` goes into
    the OS credential store as ``mcp/<name>``, never into the file: an HTTP
    server sends it as a Bearer header, and a command gets it in the variable
    ``token_env``.

    The catalog form gives a ``catalog_id`` from ``mcp.catalog``, with the typed
    ``inputs`` and the secret ones in ``secrets``, both by input id, and the
    entry's own ``name`` (or another one). The daemon fills the entry's template,
    checks it, and stores each secret as ``mcp/<name>`` (``mcp/<name>-<id>`` for
    an input other than ``token``).

    The full form gives the whole ``config``, and ``secrets`` by reference
    (``mcp/github``). Each secret must appear in ``config`` as
    ``keychain:<ref>``, and may only be ``mcp/<name>`` or ``mcp/<name>-…`` for
    this server. ``scope = "project"`` writes the trusted project of
    ``session_id``. A client never logs or displays a token.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9-]{0,31}$")
    command: str | None = Field(default=None, min_length=1)
    args: list[str] = Field(default_factory=list[str])
    url: str | None = Field(default=None, min_length=1)
    token: SecretStr | None = Field(default=None, min_length=1, max_length=4096)
    token_env: str | None = Field(default=None, pattern=r"^[A-Za-z_][A-Za-z0-9_]*$")
    config: McpServerConfig | None = None
    catalog_id: str | None = Field(default=None, min_length=1)
    inputs: dict[str, str] = Field(default_factory=dict[str, str])
    secrets: dict[str, SecretStr] = Field(default_factory=dict[str, SecretStr])
    scope: Literal["user", "project"] = "user"
    session_id: str | None = Field(default=None, min_length=1)

    @model_validator(mode="after")
    def _one_form(self) -> Self:
        short = (
            self.command is not None
            or self.url is not None
            or self.token is not None
            or self.token_env is not None
            or bool(self.args)
        )
        forms = sum([short, self.config is not None, self.catalog_id is not None])
        if forms > 1:
            raise ValueError(
                "send one form: command, args, url, token, and token_env; or config; or catalog_id"
            )
        if (
            self.config is None
            and self.catalog_id is None
            and (self.secrets or self.scope != "user")
        ):
            raise ValueError("secrets and scope go with config or catalog_id")
        if self.catalog_id is None and self.inputs:
            raise ValueError("inputs go with catalog_id")
        return self


class McpUpdateParams(BaseModel):
    """``mcp.update``. Replace the ``[mcp.<name>]`` table in the file that names it.

    ``secrets`` are stored first, and only the ones sent change. A secret the
    server already names and the request leaves out is kept, unless the request
    changes the server's address (``url``, ``command``, ``args``, or ``cwd``):
    then it must be sent again. ``new_name`` renames the server and moves its
    ``mcp/<name>`` secrets.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)
    config: McpServerConfig
    secrets: dict[str, SecretStr] = Field(default_factory=dict[str, SecretStr])
    new_name: str | None = Field(default=None, pattern=r"^[A-Za-z0-9][A-Za-z0-9-]{0,31}$")
    session_id: str | None = Field(default=None, min_length=1)


class McpRemoveParams(BaseModel):
    """``mcp.remove``. Delete ``[mcp.<name>]`` from the user's config, and stop the server.

    The server's ``mcp/<name>`` secrets go from the credential store too, unless
    another server names them. With ``session_id``, a trusted project's server
    can be removed.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)
    session_id: str | None = Field(default=None, min_length=1)


class McpRemoveResult(BaseModel):
    """The server that was removed. ``secret``: whether a stored token went with it."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)
    secret: bool


class McpToggleParams(BaseModel):
    """``mcp.enable`` and ``mcp.disable``: an on-demand server, for one session."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    name: str = Field(min_length=1)


class McpToggleResult(BaseModel):
    """The on-demand servers the session has on now, sorted."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    mcp_servers: list[str]


class McpListResult(BaseModel):
    """The servers, sorted by name."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    servers: list[McpServer]


class ConfigRawGetParams(BaseModel):
    """``config.raw.get``. The text of ``config.toml``, with ``keychain:`` references as written.

    ``scope = "project"`` reads the trusted project of ``session_id``.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    scope: Literal["user", "project"] = "user"
    session_id: str | None = Field(default=None, min_length=1)


class ConfigRawGetResult(BaseModel):
    """The file's path and text, and its ``mtime_ns`` for a later ``config.raw.set``."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    path: str
    text: str
    mtime_ns: int | None = None
    exists: bool


class ConfigRawSetParams(BaseModel):
    """``config.raw.set`` and ``config.raw.set_protected``. Check a new text, and write it.

    ``base_mtime_ns`` is the ``mtime_ns`` the text was read at, null for a file
    that did not exist. A file changed since is refused. ``dry_run`` checks and
    writes nothing. ``config.raw.set`` refuses a change inside the protected
    sections (providers, trusted projects, shell, web, skill folders), and
    ``config.raw.set_protected``, which only a local client may call, does not.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    scope: Literal["user", "project"] = "user"
    session_id: str | None = Field(default=None, min_length=1)
    text: str
    base_mtime_ns: int | None = None
    dry_run: bool = False


class ConfigError(BaseModel):
    """One problem in a config text. ``line`` and ``column`` count from 1, when known.

    ``path`` is the setting, as ``mcp.github.headers.Authorization``.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    line: int | None = Field(default=None, ge=1)
    column: int | None = Field(default=None, ge=1)
    path: str | None = None
    message: str


class ConfigRawResult(BaseModel):
    """``ok`` is false when anything was wrong, and the file is then untouched.

    ``restart_needed`` names the top-level sections that changed and are read
    only when the daemon starts. ``mtime_ns`` is the new file's.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    ok: bool
    errors: list[ConfigError] = Field(default_factory=list[ConfigError])
    restart_needed: list[str] = Field(default_factory=list[str])
    mtime_ns: int | None = None


class ConfigGetParams(BaseModel):
    """``config.get``. The settings the daemon uses, and the tool rules for ``cwd``.

    ``cwd`` is an absolute folder. Without it, no project rules are listed.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    cwd: str | None = Field(default=None, min_length=1)
    session_id: str | None = Field(default=None, min_length=1)


class ConfigRule(BaseModel):
    """One tool rule, in the order rules are checked.

    ``source`` names the file and the rule's number in it, or ``built-in
    default``. ``ignored`` says why a listed rule never matches. ``file`` and
    ``index`` are what ``policy.update`` and ``policy.remove`` take.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    tool: str = Field(min_length=1)
    match: str | None = None
    path: str | None = None
    action: Literal["allow", "ask", "deny"]
    source: str = Field(min_length=1)
    ignored: str | None = None
    file: Literal["user", "project", "default"] = "default"
    index: int | None = Field(default=None, ge=1)


class ConfigAllowance(BaseModel):
    """A tool allowed for the rest of the session asked about."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    tool: str = Field(min_length=1)
    subject: str | None = None


class ConfigGetResult(BaseModel):
    """Resolved settings. Keys are never included.

    ``project_policy`` is the project's ``.golem/policy.toml`` when it exists,
    and ``project_trusted`` whether its allow rules count. Both are null
    without a ``cwd``.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    config_file: str = Field(min_length=1)
    default_model: str | None = Field(min_length=1)
    log_level: str = Field(min_length=1)
    session_titles: bool
    trusted_projects: list[str]
    project_policy: str | None = None
    project_trusted: bool | None = None
    rules: list[ConfigRule]
    session_allowed: list[ConfigAllowance] = Field(default_factory=list[ConfigAllowance])


class PolicyUpdateParams(BaseModel):
    """``policy.update``. Set the ``action`` of rule ``index``.

    ``target`` is the user's ``config.toml`` or the project's ``policy.toml``.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    target: Literal["user", "project"]
    cwd: str | None = Field(default=None, min_length=1)
    index: int = Field(ge=1)
    action: Literal["allow", "ask", "deny"]


class PolicyRemoveParams(BaseModel):
    """``policy.remove``. Delete rule ``index`` from the user's or the project's file."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    target: Literal["user", "project"]
    cwd: str | None = Field(default=None, min_length=1)
    index: int = Field(ge=1)


class PolicyEditResult(BaseModel):
    """The file that was written."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    file: str = Field(min_length=1)


class SessionRevokeParams(BaseModel):
    """``session.revoke``. Stop allowing ``tool`` (with ``subject``) for the rest of the session."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    tool: str = Field(min_length=1)
    subject: str | None = None


class SessionRevokeResult(BaseModel):
    """Whether that allowance was there."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    revoked: bool


class ArtifactReadParams(BaseModel):
    """``artifact.read``. ``limit`` characters of a session's artifact, from ``offset``."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    artifact_id: str = Field(min_length=1)
    offset: int = Field(default=0, ge=0)
    limit: int = Field(default=1_000_000, ge=1, le=5_000_000)


class ArtifactReadResult(BaseModel):
    """``text`` starts at ``offset`` of an artifact ``size`` characters long."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    text: str
    offset: int = Field(ge=0)
    size: int = Field(ge=0)


class ApprovalRespondParams(BaseModel):
    """``approval.respond``. Answer the tool call a session's run waits on.

    ``allow`` runs it once, ``allow_session`` runs it and allows the same call
    for the rest of the session, ``allow_always`` runs it and writes an allow
    rule for it first in the user's ``config.toml``, and ``deny`` tells the
    model it may not.

    ``args`` replaces the call's arguments, edited by the user, and goes only
    with ``allow``: an edited call runs once.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    call_id: str = Field(min_length=1)
    decision: Literal["allow", "allow_session", "allow_always", "deny"]
    args: dict[str, Any] | None = None

    @model_validator(mode="after")
    def _edited_runs_once(self) -> Self:
        if self.args is not None and self.decision != "allow":
            raise ValueError("edited args go only with decision allow")
        return self


class ApprovalRespondResult(BaseModel):
    """The run that goes on. Its events go to the attached connections."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    run_id: str = Field(min_length=1)


SetupPart = Literal["service", "socket", "config", "engine", "model", "tools", "disk"]
SetupState = Literal["ok", "warn", "fail"]
SetupAction = Literal["install_ollama", "start_ollama", "pick_model", "set_key", "edit_config"]


class SetupStatusParams(BaseModel):
    """``setup.status``. What is set up and what is broken, as ``golem doctor`` sees it."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class SetupRow(BaseModel):
    """One check. ``fix`` is a command to type; ``action`` is what a setup screen offers instead.

    ``target`` is what the action is about: a provider for ``set_key``, a
    model ref for ``pick_model``.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    part: SetupPart
    name: str = Field(min_length=1)
    state: SetupState
    detail: str
    fix: str | None = None
    action: SetupAction | None = None
    target: str | None = Field(default=None, min_length=1)


class SetupStatusResult(BaseModel):
    """The rows in the order ``golem doctor`` prints them."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    rows: list[SetupRow]


class OllamaInstallParams(BaseModel):
    """``ollama.install``. Install Ollama with Homebrew. Output: ``ollama.install.output``."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class OllamaInstallResult(BaseModel):
    """``started`` is false when an install was already running."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    started: bool


class OllamaInstallCancelParams(BaseModel):
    """``ollama.install_cancel``. Stop a running install."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class OllamaInstallCancelResult(BaseModel):
    """``cancelled`` is false when no install was running."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    cancelled: bool


class OllamaInstallOutput(BaseModel):
    """Output from ``brew install ollama`` as it came, carriage returns included."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    text: str


class KeychainWait(BaseModel):
    """A Keychain read is slow, as when macOS asks whether golem may use the item.

    ``waiting`` is true when the read has taken a moment, and false once it
    ended. ``provider`` is set for a provider's API key.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str
    provider: str | None = None
    waiting: bool


class OllamaInstallDone(BaseModel):
    """The install ended. ``reason`` says why when it ``failed``."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    outcome: Literal["installed", "failed", "stopped"]
    reason: str | None = None


class OllamaStartParams(BaseModel):
    """``ollama.start``. Start the local Ollama now, as a model call would."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class OllamaStartResult(BaseModel):
    """``running`` is false when golem may not start it: no Ollama, or ``[ollama] start`` off."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    running: bool


class FsListDirsParams(BaseModel):
    """``fs.list_dirs``. The folders directly under ``path``, for a folder picker.

    ``path`` is an absolute path under the user's home folder. Null lists the
    home folder. The daemon resolves it first (symlinks and ``..``), and refuses
    one outside home or one that is not a folder (ADR-040).
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    path: str | None = Field(default=None, min_length=1)


class DirEntry(BaseModel):
    """A folder in a listing. ``git`` is true when it has a ``.git`` entry."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)
    path: str = Field(min_length=1)
    git: bool


class FsListDirsResult(BaseModel):
    """The folders under ``path``, sorted without regard to case.

    ``home`` is the user's home folder and ``parent`` is the folder above
    ``path``, or null at home. Only folders are listed: no file names, sizes,
    times, or contents. Dot-folders, ``~/Library``, secret folders, and entries
    that resolve outside home are left out. A list stops at 500 entries, and
    ``truncated`` says it was cut.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    path: str = Field(min_length=1)
    home: str = Field(min_length=1)
    parent: str | None = Field(default=None, min_length=1)
    entries: list[DirEntry]
    truncated: bool


__all__ = [
    "ApprovalRespondParams",
    "ApprovalRespondResult",
    "ArtifactReadParams",
    "ArtifactReadResult",
    "AuthKeyStatus",
    "AuthListParams",
    "AuthListResult",
    "AuthRemoveParams",
    "AuthRemoveResult",
    "AuthSetParams",
    "AuthSetResult",
    "ConfigAllowance",
    "ConfigError",
    "ConfigGetParams",
    "ConfigGetResult",
    "ConfigRawGetParams",
    "ConfigRawGetResult",
    "ConfigRawResult",
    "ConfigRawSetParams",
    "ConfigRule",
    "DaemonStatus",
    "DirEntry",
    "FsListDirsParams",
    "FsListDirsResult",
    "HelloParams",
    "HelloResult",
    "InspectMessage",
    "KeychainWait",
    "ListedModel",
    "ListedProvider",
    "ListedSkill",
    "McpAddParams",
    "McpCallParams",
    "McpCallResult",
    "McpCatalogCategory",
    "McpCatalogEntry",
    "McpCatalogInput",
    "McpCatalogParams",
    "McpCatalogResult",
    "McpImplementation",
    "McpImportApplyParams",
    "McpImportApplyResult",
    "McpImportCandidate",
    "McpImportFailure",
    "McpImportPick",
    "McpImportScanParams",
    "McpImportScanResult",
    "McpImportSource",
    "McpListParams",
    "McpListResult",
    "McpLogLine",
    "McpLogsParams",
    "McpLogsResult",
    "McpRemoveParams",
    "McpRemoveResult",
    "McpSecretInfo",
    "McpServer",
    "McpServerConfig",
    "McpServerDetail",
    "McpServerLog",
    "McpServerParams",
    "McpServerState",
    "McpSetEnabledParams",
    "McpTestParams",
    "McpTestProgress",
    "McpTestResult",
    "McpTestStep",
    "McpTestStepName",
    "McpTestStepState",
    "McpToggleParams",
    "McpToggleResult",
    "McpToolFilterConfig",
    "McpToolInfo",
    "McpToolsResult",
    "McpUpdateParams",
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
    "OllamaInstallCancelParams",
    "OllamaInstallCancelResult",
    "OllamaInstallDone",
    "OllamaInstallOutput",
    "OllamaInstallParams",
    "OllamaInstallResult",
    "OllamaStartParams",
    "OllamaStartResult",
    "PingParams",
    "PolicyEditResult",
    "PolicyRemoveParams",
    "PolicyUpdateParams",
    "RunCancelParams",
    "RunCancelResult",
    "RuntimeInstallCancelParams",
    "RuntimeInstallCancelResult",
    "RuntimeInstallDone",
    "RuntimeInstallOutput",
    "RuntimeInstallParams",
    "RuntimeInstallResult",
    "RuntimeName",
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
    "SessionRevokeParams",
    "SessionRevokeResult",
    "SessionSetModelParams",
    "SessionSetModelResult",
    "SessionSetSkillsParams",
    "SessionSetSkillsResult",
    "SessionSummary",
    "SetupAction",
    "SetupPart",
    "SetupRow",
    "SetupState",
    "SetupStatusParams",
    "SetupStatusResult",
    "SkillListParams",
    "SkillListResult",
    "SkillRegistryChanged",
    "SkillSource",
    "TraceGetParams",
    "TraceGetResult",
    "TraceMessage",
    "TraceModelSpan",
    "TraceRunSpan",
    "TraceSpan",
    "TraceSpanParams",
    "TraceSpanResult",
    "TraceTokens",
    "TraceToolSpan",
]
