"""Server → client events.

``Ping`` is the result body of the ``ping`` command. Chat events are the
``params`` of an ``event`` notification. ``type`` discriminates that union.
"""

from typing import Annotated, Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, model_validator

_CONFIG = ConfigDict(extra="forbid", frozen=True)


class Ping(BaseModel):
    """Dummy heartbeat event. Proves Pydantic → JSON Schema → TypeScript."""

    model_config = _CONFIG

    type: Literal["system.ping"]
    nonce: str


PermissionMode = Literal["careful", "balanced", "autopilot"]
"""How much the built-in permission rules allow without asking. See ADR-047."""

RouteMode = Literal["pinned", "local", "auto"]
"""How a session picks the model of each turn. See ADR-055."""


class ForkedFrom(BaseModel):
    """The session and message a fork was copied from."""

    model_config = _CONFIG

    session_id: str = Field(min_length=1)
    message_id: str = Field(min_length=1)


class SessionCreatedData(BaseModel):
    """Profile stored for a new session.

    ``model_profile`` is a profile name or a ``provider/model`` ref.
    ``model_provider`` and ``model_name`` are set when the daemon can resolve
    it, and null otherwise. ``forked_from`` is set on a session made by
    ``session.fork``. ``cwd`` is the project folder the file tools work in,
    or null for a session without one. ``origin`` is who started the session:
    ``cli``, ``routine:<name>``, and so on. Null means ``user``, and an older
    daemon leaves it out. ``route`` is the session's route mode when it was
    made. Null means ``pinned``, and an older daemon leaves it out.
    """

    model_config = _CONFIG

    model_profile: str = Field(min_length=1)
    model_provider: str | None = Field(default=None, min_length=1)
    model_name: str | None = Field(default=None, min_length=1)
    forked_from: ForkedFrom | None = None
    cwd: str | None = Field(default=None, min_length=1)
    origin: str | None = Field(default=None, min_length=1)
    route: RouteMode | None = None


class MessageStartedData(BaseModel):
    """An assistant message is open and tokens may follow."""

    model_config = _CONFIG

    message_id: str = Field(min_length=1)
    role: Literal["assistant"]


class MessageDeltaData(BaseModel):
    """One incremental fragment of an assistant message."""

    model_config = _CONFIG

    message_id: str = Field(min_length=1)
    text: str


class MessageThinkingDeltaData(BaseModel):
    """One incremental fragment of the thinking a model did before or while it answered."""

    model_config = _CONFIG

    message_id: str = Field(min_length=1)
    text: str


class SkillCall(BaseModel):
    """A skill run once by name, with what was typed after it."""

    model_config = _CONFIG

    name: str = Field(min_length=1, max_length=64)
    args: str = Field(default="", max_length=100_000)


class MessageCompletedData(BaseModel):
    """Full text of a user or assistant message.

    ``interrupted`` is true when the run stopped before the model finished.
    ``text`` is then what had streamed so far. ``skill`` is set on a user
    message that invoked a skill: ``text`` is then the skill body the model
    got, with the arguments filled in, and a client can show the skill's name
    and arguments instead.

    ``thinking`` is the whole thinking text of an assistant message, None when
    the model did not think. ``thinking_ms`` is the time from the first
    thinking fragment to the first answer fragment, or to the end when no
    answer text came.
    """

    model_config = _CONFIG

    message_id: str = Field(min_length=1)
    role: Literal["user", "assistant"]
    text: str
    interrupted: bool = False
    skill: SkillCall | None = None
    thinking: str | None = None
    thinking_ms: int | None = Field(default=None, ge=0)


SkillSource = Literal["project", "user", "bundled"]
"""Where a skill was found: the session's project, the user's folders, or golem itself."""


class SkillActivatedData(BaseModel):
    """A skill is active in the session.

    ``how`` is ``invoked`` for a skill run once by name: its body is that
    turn's user message. It is ``pinned`` for a skill turned on for the whole
    session: its body is in the system prompt of every model call until it is
    unpinned. It is ``model`` for a skill the model loaded itself with
    ``load_skill``: its body is that tool's result. ``source`` is where it was
    found, ``path`` its folder, and ``hash`` the sha256 of its ``SKILL.md``.
    A pinned skill whose file changed, or that can be used again after it was
    skipped, is activated again in the run whose model call first reads the
    new body.
    """

    model_config = _CONFIG

    name: str = Field(min_length=1)
    source: SkillSource
    how: Literal["invoked", "pinned", "model"]
    path: str = Field(min_length=1)
    hash: str


class SkillDeactivatedData(BaseModel):
    """A pinned skill is off again. ``unpinned``: the user turned it off."""

    model_config = _CONFIG

    name: str = Field(min_length=1)
    reason: Literal["unpinned"]


class SkillSkippedData(BaseModel):
    """A pinned skill was left out of a model call. It stays pinned.

    ``reason`` is ``missing`` when the session finds no skill of that name,
    ``disabled`` when ``[skills]`` turns it off, and ``broken`` when its
    ``SKILL.md`` cannot be read or is not valid. ``message`` says it for a
    person.
    """

    model_config = _CONFIG

    name: str = Field(min_length=1)
    reason: Literal["missing", "disabled", "broken"]
    message: str = Field(min_length=1)


class EmptyEventData(BaseModel):
    """No payload. Used by ``run.started``, ``run.completed``, and ``session.closed``."""

    model_config = _CONFIG


class RunFailedData(BaseModel):
    """Why a run stopped. No traceback.

    ``code`` names a failure a client can act on. ``model_unreachable``: the
    model's server did not answer. ``not_installed``: the model needs a local
    server that is not installed, such as Ollama. ``budget_spent``: a cap in
    ``[budget]`` is spent, so a paid call was not made. ``provider`` is the
    provider whose server it was, and ``hint`` says how to fix it, such as
    ``run ollama serve``. ``context_full``: the prompt does not fit the model's window,
    even after clearing and summarising, and nothing was sent.
    """

    model_config = _CONFIG

    message: str = Field(min_length=1)
    code: Literal["model_unreachable", "not_installed", "context_full", "budget_spent"] | None = (
        None
    )
    provider: str | None = Field(default=None, min_length=1)
    hint: str | None = Field(default=None, min_length=1)


class RunCancelledData(BaseModel):
    """Who stopped the run. ``user`` is ``run.cancel``, ``shutdown`` the daemon stopping."""

    model_config = _CONFIG

    reason: Literal["user", "shutdown"]


class SessionAllowance(BaseModel):
    """A tool allowed for the rest of a session. ``subject`` null allows every call of it."""

    model_config = _CONFIG

    tool: str = Field(min_length=1)
    subject: str | None = None


class SessionUpdatedData(BaseModel):
    """A session attribute changed: its title, folder, allowed tools, MCP servers, or route.

    A field left null did not change. ``route`` is the session's route mode after
    ``session.set_route``. ``cwd`` is set once, on a session made
    before sessions had a folder, by the first ``message.send`` that names one.
    ``allowed_tools`` is the whole list after ``session.revoke``, and
    ``mcp_servers`` the on-demand MCP servers the session turned on, after
    ``mcp.enable`` or ``mcp.disable``.
    """

    model_config = _CONFIG

    title: str | None = Field(default=None, min_length=1)
    cwd: str | None = Field(default=None, min_length=1)
    allowed_tools: list[SessionAllowance] | None = None
    mcp_servers: list[str] | None = None
    route: RouteMode | None = None

    @model_validator(mode="after")
    def _changes_something(self) -> Self:
        fields = (self.title, self.cwd, self.allowed_tools, self.mcp_servers, self.route)
        if all(field is None for field in fields):
            raise ValueError(
                "session.updated needs a title, a cwd, allowed_tools, mcp_servers, or a route"
            )
        return self


class SessionModeChangedData(BaseModel):
    """The session's permission mode override, after a change.

    ``mode`` null means the session has no override and follows ``[permissions]
    mode`` in ``config.toml``. The last event holds what applies from the next
    tool call, so a replayed session gets its mode back.
    """

    model_config = _CONFIG

    mode: PermissionMode | None


class ModelSelectedData(BaseModel):
    """The model the session's next run uses.

    ``model_profile`` is the name asked for, a profile or a ``provider/model``
    ref. ``model_provider`` and ``model_name`` are what it resolved to when it
    was chosen. ``reason`` ``user`` is ``session.set_model``.
    """

    model_config = _CONFIG

    model_profile: str = Field(min_length=1)
    model_provider: str | None = Field(default=None, min_length=1)
    model_name: str | None = Field(default=None, min_length=1)
    reason: Literal["user"]


class ModelRejection(BaseModel):
    """A candidate the pick left out, and why in plain words."""

    model_config = _CONFIG

    ref: str = Field(min_length=1)
    tier: Literal["local", "budget", "frontier"]
    why: str = Field(min_length=1)


class ModelRoutedData(BaseModel):
    """Which model a run uses, and why golem picked it.

    Sent right after ``run.started`` in a session whose route is not ``pinned``.
    ``model_profile`` is the profile that runs. ``provider`` and ``model`` are what
    it resolves to, null when it does not resolve. ``reason`` is why this model
    (ADR-055), ``detail`` one short sentence, and ``rejected`` the candidates the
    pick dropped. The session's own model does not change.
    """

    model_config = _CONFIG

    model_profile: str = Field(min_length=1)
    provider: str | None = Field(default=None, min_length=1)
    model: str | None = Field(default=None, min_length=1)
    tier: Literal["local", "budget", "frontier"]
    reason: Literal[
        "pinned", "privacy", "fit", "budget", "cheapest", "escalated", "fallback", "user"
    ]
    detail: str
    rejected: list[ModelRejection] = Field(default_factory=list[ModelRejection])


class ModelOptionsChangedData(BaseModel):
    """The session's option overrides, whole, after a change.

    The last event holds what applies from the next run, so a replayed session
    gets its options back. An empty ``options`` means no overrides.
    """

    model_config = _CONFIG

    options: dict[str, float | str]


class ToolRequestedData(BaseModel):
    """The model asked for one tool call.

    ``message_id`` is the assistant message that asked. ``args`` are the
    arguments as the model wrote them.
    """

    model_config = _CONFIG

    call_id: str = Field(min_length=1)
    message_id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    args: dict[str, Any]


class SessionChecksChangedData(BaseModel):
    """Whether the session lets golem run the project's checks, after a change.

    ``on`` true is the user's yes and false their no. The last event holds the
    answer, so a replayed session gets it back. A session without one has not
    been asked.
    """

    model_config = _CONFIG

    on: bool


class CheckInfo(BaseModel):
    """One check: its name and the shell command it runs."""

    model_config = _CONFIG

    name: str = Field(min_length=1)
    command: str = Field(min_length=1)


class SessionPlanChangedData(BaseModel):
    """Whether the session is in plan first, after a change.

    The last event holds the switch, so a replayed session gets it back.
    """

    model_config = _CONFIG

    on: bool


class PlanStep(BaseModel):
    """One step of a plan: what to do, and the files it will touch."""

    model_config = _CONFIG

    text: str = Field(min_length=1, max_length=300)
    files: list[str] = Field(default_factory=list[str], max_length=20)


class PlanProposedData(BaseModel):
    """The plan a plan first run ended with, sent for the user to read.

    ``plan_id`` names this plan. ``call_id`` is the ``propose_plan`` call.
    """

    model_config = _CONFIG

    plan_id: str = Field(min_length=1)
    call_id: str = Field(min_length=1)
    title: str = Field(min_length=1, max_length=120)
    steps: list[PlanStep] = Field(min_length=1, max_length=20)


class CheckOfferedData(BaseModel):
    """The turn changed files and the session has not said whether golem may run checks.

    Sent once per session. Nothing ran. ``session.set_checks`` answers it.
    """

    model_config = _CONFIG

    checks: list[CheckInfo]


class CheckStartedData(BaseModel):
    """A check began. ``round`` is 0 for the first run after a turn."""

    model_config = _CONFIG

    check_id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    command: str = Field(min_length=1)
    round: int = Field(default=0, ge=0)


class CheckCompletedData(BaseModel):
    """A check ended. ``exit_code`` is null when it timed out.

    ``output`` is the last 4,000 characters. When there was more, the whole
    output is in the artifact ``artifact_id``.
    """

    model_config = _CONFIG

    check_id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    status: Literal["passed", "failed", "timed_out"]
    exit_code: int | None
    duration_ms: int = Field(ge=0)
    output: str
    artifact_id: str | None = Field(default=None, min_length=1)
    round: int = Field(default=0, ge=0)


class ToolStartedData(BaseModel):
    """A requested tool call is running."""

    model_config = _CONFIG

    call_id: str = Field(min_length=1)


class ToolOutputData(BaseModel):
    """Text a running tool call printed. Stored only until the call ends."""

    model_config = _CONFIG

    call_id: str = Field(min_length=1)
    text: str = Field(min_length=1)


class ToolWritingData(BaseModel):
    """How far the model got writing a ``write_file`` or ``edit_file`` call.

    Stored only until its message completes. ``index`` is the call's place in the reply.
    ``path`` is None until the model has written the whole path. ``lines`` and ``chars``
    count the file text written so far.
    """

    model_config = _CONFIG

    message_id: str = Field(min_length=1)
    index: int = Field(ge=0)
    name: str = Field(min_length=1)
    path: str | None = None
    lines: int = Field(ge=0)
    chars: int = Field(ge=0)


class ModelWaitingData(BaseModel):
    """A chat call waits, or no longer waits, for its turn on a local model server.

    Sent for the reply ``message_id`` only, so other sessions never show it. Stored only
    until its message completes.
    """

    model_config = _CONFIG

    message_id: str = Field(min_length=1)
    waiting: bool


class PromptSectionInfo(BaseModel):
    """One non-empty section of the system prompt sent with a model call.

    ``chars`` is the length of the section's text after strip, counted as
    Python counts it (Unicode code points). The prompt is the sections' texts,
    in order, joined with "\\n\\n", so the lengths split the stored prompt
    exactly.
    """

    model_config = _CONFIG

    name: str = Field(min_length=1)
    chars: int = Field(ge=0)


class ModelCallStartedData(BaseModel):
    """A request went to the model.

    ``message_id`` is the assistant reply's id, which identifies the model
    call. ``index`` counts the calls of this run from 1. ``provider`` and
    ``model`` are None when the profile does not resolve.

    ``tier`` is the model's tier when the call was sent (``local``, ``budget`` or
    ``frontier``), and None on an older event or when the profile does not resolve.

    ``system_prompt_sha`` and ``tools_sha`` are the sha256 of the system
    prompt and of the tool schemas (compact JSON, sorted keys) sent with the
    call, which the daemon keeps by hash. Each is None when it was not sent.
    ``message_ids`` are the history messages sent, in order, not counting the
    system prompt.

    ``window_estimated`` is true when golem did not send the window and read it
    from Ollama (the loaded context or the Modelfile). An older event has no
    field and reads as False. ``window_planned`` is true when golem chose the ``num_ctx`` it
    sent (``[context] window``), and false for one that someone set or that golem did not send.

    The size fields count what was sent, in UTF-8 bytes and in characters: the
    system text, the tool schemas as compact JSON, and each history message in
    ``message_ids`` order (its text and its tool calls as JSON). ``message_chars``
    and ``message_bytes`` have one number per message sent. Each is None on an
    event recorded before they existed.
    """

    model_config = _CONFIG

    message_id: str = Field(min_length=1)
    index: int = Field(ge=1)
    profile: str = Field(min_length=1)
    provider: str | None = None
    model: str | None = None
    tier: Literal["local", "budget", "frontier"] | None = None
    system_prompt_sha: str | None = None
    tools_sha: str | None = None
    message_ids: list[str] = Field(default_factory=list[str])
    context_window: int | None = Field(default=None, ge=1)
    num_ctx: int | None = Field(default=None, ge=1)
    window_estimated: bool = False
    window_planned: bool = False
    system_sections: list[PromptSectionInfo] | None = None
    system_chars: int | None = Field(default=None, ge=0)
    system_bytes: int | None = Field(default=None, ge=0)
    tools_chars: int | None = Field(default=None, ge=0)
    tools_bytes: int | None = Field(default=None, ge=0)
    message_chars: list[int] | None = None
    message_bytes: list[int] | None = None
    cleared_ids: list[str] = Field(default_factory=list[str])
    """Tool results sent as a one-line stub on this call."""
    summary_chars: int | None = Field(default=None, ge=0)
    """The length of the summary of old turns sent as the first message. None when none was."""
    estimated_tokens: int | None = Field(default=None, ge=0)
    """What golem estimated the prompt at, in tokens, before sending it. None when the window
    was unknown or on an older event."""


class ContextChangedData(BaseModel):
    """What golem sends of the history changed before a model call.

    ``cleared`` means old tool results are now sent as one line each: ``count`` is how
    many, and ``before_tokens`` and ``after_tokens`` are rough sizes of the history before
    and after. For ``summarised``, ``count`` is the messages a summary now stands for.
    ``grew`` is for a later change: ``window_from`` and ``window_to`` are the window
    before and after, and ``reload_ms`` the time the model took to load again. The
    checkpoint keeps every message, so no transcript event changes. A field a change
    does not use is None.
    """

    model_config = _CONFIG

    action: Literal["cleared", "summarised", "grew"]
    before_tokens: int | None = Field(default=None, ge=0)
    after_tokens: int | None = Field(default=None, ge=0)
    count: int | None = Field(default=None, ge=0)
    window_from: int | None = Field(default=None, ge=1)
    window_to: int | None = Field(default=None, ge=1)
    reload_ms: int | None = Field(default=None, ge=0)


class TokenUsage(BaseModel):
    """Tokens one model call used. A field is None when the provider did not report it."""

    model_config = _CONFIG

    input: int | None = Field(default=None, ge=0)
    output: int | None = Field(default=None, ge=0)
    cache_read: int | None = Field(default=None, ge=0)
    cache_write: int | None = Field(default=None, ge=0)


class CallPrice(BaseModel):
    """USD per million tokens, as golem knew it when the call ended."""

    model_config = _CONFIG

    input: float | None = Field(default=None, ge=0)
    output: float | None = Field(default=None, ge=0)
    cached_input: float | None = Field(default=None, ge=0)


class ModelCallCompletedData(BaseModel):
    """A model call ended.

    ``first_token_ms`` is the time from the request to the first text, and
    None when no text came. ``latency_ms`` is the time to the end.
    ``failed`` is true when the call raised or was stopped.

    ``context_window`` is the window the call ran with, read from the model server
    after the call. Exact. None when it could not be read.

    ``text_tool_calls`` is set when the model wrote a tool call as text in its
    reply. ``recovered`` means golem turned the text into tool calls. ``unread``
    means the text held a call golem could not read, so the reply stayed text.
    None when the reply had no such text.

    ``cost_usd`` is the cost of this call at ``price``. Both are None when the
    price is not known. A local model costs 0.

    ``load_ms``, ``prompt_ms`` and ``reply_ms`` are the time the model server spent loading
    the model, reading the prompt and writing the reply. From the model server's own clock.
    Ollama only.
    """

    model_config = _CONFIG

    message_id: str = Field(min_length=1)
    usage: TokenUsage | None = None
    stop_reason: str | None = None
    first_token_ms: int | None = Field(default=None, ge=0)
    latency_ms: int = Field(ge=0)
    failed: bool = False
    context_window: int | None = Field(default=None, gt=0)
    text_tool_calls: Literal["recovered", "unread"] | None = None
    cost_usd: float | None = Field(default=None, ge=0)
    price: CallPrice | None = None
    load_ms: int | None = Field(default=None, ge=0)
    prompt_ms: int | None = Field(default=None, ge=0)
    reply_ms: int | None = Field(default=None, ge=0)


class ToolCompletedData(BaseModel):
    """A tool call finished.

    ``summary`` is one short line, such as ``42 lines``. ``preview`` is the
    start of the output, cut at a few kilobytes, and ``truncated`` says
    whether it was cut. Output too long for the model is stored whole in the
    artifact ``artifact_id``, which ``artifact.read`` reads.

    ``failed`` is true when the call ran but what it ran did not succeed,
    such as a shell command that exited non-zero or timed out. The model
    still gets the output.

    ``duration_ms`` is how long the tool ran, from ``tool.started`` to its
    result, without the wait for an approval. None means it was not measured.

    ``diff`` is the change a file tool made, as a unified diff.
    """

    model_config = _CONFIG

    call_id: str = Field(min_length=1)
    summary: str
    preview: str
    truncated: bool = False
    artifact_id: str | None = Field(default=None, min_length=1)
    failed: bool = False
    duration_ms: int | None = Field(default=None, ge=0)
    diff: str | None = None


class ToolFailedData(BaseModel):
    """A tool call did not run, or stopped with an error. The model sees the same message.

    ``duration_ms`` is how long the tool ran before it raised. None means a
    call that was denied or cut off, which never ran or was not timed.
    """

    model_config = _CONFIG

    call_id: str = Field(min_length=1)
    message: str = Field(min_length=1)
    duration_ms: int | None = Field(default=None, ge=0)


class FileChangedData(BaseModel):
    """One change to one file, recorded before this event was sent.

    ``path`` is relative to the session folder. ``call_id`` is the tool call that
    made the change, and null for a shell change or an undo. ``reverts`` is the
    change an undo took back. The texts are not sent; read them by ``change_id``.
    """

    model_config = _CONFIG

    change_id: str = Field(min_length=1)
    call_id: str | None = Field(default=None, min_length=1)
    path: str = Field(min_length=1)
    status: Literal["created", "modified", "deleted"]
    added: int = Field(ge=0)
    removed: int = Field(ge=0)
    source: Literal["tool", "shell", "revert"]
    reverts: str | None = Field(default=None, min_length=1)


ApprovalDecision = Literal["allow", "allow_session", "allow_always", "deny"]

TodoStatus = Literal["pending", "in_progress", "done"]


class Todo(BaseModel):
    """One step of the agent's plan."""

    model_config = _CONFIG

    id: str = Field(min_length=1, max_length=40)
    text: str = Field(min_length=1, max_length=300)
    status: TodoStatus


class TodosUpdatedData(BaseModel):
    """The agent's todo list, whole, after ``todo_write`` replaced it.

    ``call_id`` is the call that wrote it. It is null for a list a fork copied.
    An empty list clears it.
    """

    model_config = _CONFIG

    call_id: str | None = Field(default=None, min_length=1)
    todos: list[Todo]


class SessionCompletedData(BaseModel):
    """A run in a session that no user typed into has ended.

    ``status`` is how the run ended. ``summary`` is the last assistant message
    cut to a few lines, null when the run left no reply (a failed or cancelled
    run). A run that stops on an approval does not emit this: it is
    ``approval.needed``.
    """

    model_config = _CONFIG

    run_id: str = Field(min_length=1)
    status: Literal["completed", "failed", "cancelled"]
    summary: str | None = None


class ApprovalNeededData(BaseModel):
    """A tool call waits for the user. The run is paused until ``approval.respond``.

    ``source`` is the rule that asked, such as ``built-in default``.
    ``subject`` is what rules match for this tool, such as the shell command.
    ``diff`` is the change a file tool would make, as a unified diff, when it
    has one. Approving the call approves that change and no other.
    """

    model_config = _CONFIG

    call_id: str = Field(min_length=1)
    message_id: str | None = Field(default=None, min_length=1)
    name: str = Field(min_length=1)
    args: dict[str, Any]
    source: str = Field(min_length=1)
    subject: str | None = None
    diff: str | None = None


class ApprovalResolvedData(BaseModel):
    """The user answered.

    ``allow_session`` also allows ``name`` with this ``subject`` for the rest of
    the session, or every call of ``name`` when ``subject`` is null.
    ``allow_always`` wrote an allow rule, and ``rule`` names it. ``args`` are
    the arguments the user edited the call to, when they did.
    """

    model_config = _CONFIG

    call_id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    decision: ApprovalDecision
    subject: str | None = None
    rule: str | None = None
    args: dict[str, Any] | None = None


class SessionCreatedEvent(BaseModel):
    """A session exists. ``run_id`` is null because no run has started."""

    model_config = _CONFIG

    seq: int = Field(ge=1)
    session_id: str = Field(min_length=1)
    run_id: None
    ts: str = Field(min_length=1)
    type: Literal["session.created"]
    data: SessionCreatedData


class SessionUpdatedEvent(BaseModel):
    """The session got a title. ``run_id`` is null: no run owns the change."""

    model_config = _CONFIG

    seq: int = Field(ge=1)
    session_id: str = Field(min_length=1)
    run_id: None
    ts: str = Field(min_length=1)
    type: Literal["session.updated"]
    data: SessionUpdatedData


class SessionCompletedEvent(BaseModel):
    """A run of a session whose origin is not ``user`` ended. It is also in the log."""

    model_config = _CONFIG

    seq: int = Field(ge=1)
    session_id: str = Field(min_length=1)
    run_id: str = Field(min_length=1)
    ts: str = Field(min_length=1)
    type: Literal["session.completed"]
    data: SessionCompletedData


class SessionClosedEvent(BaseModel):
    """The session left the list. ``run_id`` is null: no run owns the change.

    The earlier events stay in the log. ``session.list`` hides the session.
    """

    model_config = _CONFIG

    seq: int = Field(ge=1)
    session_id: str = Field(min_length=1)
    run_id: None
    ts: str = Field(min_length=1)
    type: Literal["session.closed"]
    data: EmptyEventData


class ModelSelectedEvent(BaseModel):
    """The session switched models.

    It applies from the next run. A run in progress keeps its model.
    """

    model_config = _CONFIG

    seq: int = Field(ge=1)
    session_id: str = Field(min_length=1)
    run_id: None
    ts: str = Field(min_length=1)
    type: Literal["model.selected"]
    data: ModelSelectedData


class ModelRoutedEvent(BaseModel):
    """The pick for this run: the model that runs it and why."""

    model_config = _CONFIG

    seq: int = Field(ge=1)
    session_id: str = Field(min_length=1)
    run_id: str = Field(min_length=1)
    ts: str = Field(min_length=1)
    type: Literal["model.routed"]
    data: ModelRoutedData


class ModelOptionsChangedEvent(BaseModel):
    """``session.set_options`` changed the session's option overrides."""

    model_config = _CONFIG

    seq: int = Field(ge=1)
    session_id: str = Field(min_length=1)
    run_id: None
    ts: str = Field(min_length=1)
    type: Literal["model.options.changed"]
    data: ModelOptionsChangedData


class SessionModeChangedEvent(BaseModel):
    """``session.set_mode`` changed the session's permission mode."""

    model_config = _CONFIG

    seq: int = Field(ge=1)
    session_id: str = Field(min_length=1)
    run_id: None
    ts: str = Field(min_length=1)
    type: Literal["session.mode.changed"]
    data: SessionModeChangedData


class SessionChecksChangedEvent(BaseModel):
    """``session.set_checks`` changed whether the session lets golem run checks."""

    model_config = _CONFIG

    seq: int = Field(ge=1)
    session_id: str = Field(min_length=1)
    run_id: None
    ts: str = Field(min_length=1)
    type: Literal["session.checks.changed"]
    data: SessionChecksChangedData


class SessionPlanChangedEvent(BaseModel):
    """``session.set_plan`` put the session in plan first, or took it out."""

    model_config = _CONFIG

    seq: int = Field(ge=1)
    session_id: str = Field(min_length=1)
    run_id: None
    ts: str = Field(min_length=1)
    type: Literal["session.plan.changed"]
    data: SessionPlanChangedData


class PlanProposedEvent(BaseModel):
    """A plan first run proposed its plan with ``propose_plan``."""

    model_config = _CONFIG

    seq: int = Field(ge=1)
    session_id: str = Field(min_length=1)
    run_id: str = Field(min_length=1)
    ts: str = Field(min_length=1)
    type: Literal["plan.proposed"]
    data: PlanProposedData


class CheckOfferedEvent(BaseModel):
    """The turn changed files and golem asks whether it may run the project's checks."""

    model_config = _CONFIG

    seq: int = Field(ge=1)
    session_id: str = Field(min_length=1)
    run_id: str = Field(min_length=1)
    ts: str = Field(min_length=1)
    type: Literal["check.offered"]
    data: CheckOfferedData


class CheckStartedEvent(BaseModel):
    """A check is running."""

    model_config = _CONFIG

    seq: int = Field(ge=1)
    session_id: str = Field(min_length=1)
    run_id: str = Field(min_length=1)
    ts: str = Field(min_length=1)
    type: Literal["check.started"]
    data: CheckStartedData


class CheckCompletedEvent(BaseModel):
    """A check ended."""

    model_config = _CONFIG

    seq: int = Field(ge=1)
    session_id: str = Field(min_length=1)
    run_id: str = Field(min_length=1)
    ts: str = Field(min_length=1)
    type: Literal["check.completed"]
    data: CheckCompletedData


class MessageStartedEvent(BaseModel):
    """The assistant bubble is open."""

    model_config = _CONFIG

    seq: int = Field(ge=1)
    session_id: str = Field(min_length=1)
    run_id: str = Field(min_length=1)
    ts: str = Field(min_length=1)
    type: Literal["message.started"]
    data: MessageStartedData


class MessageDeltaEvent(BaseModel):
    """Tokens to append to the open assistant message."""

    model_config = _CONFIG

    seq: int = Field(ge=1)
    session_id: str = Field(min_length=1)
    run_id: str = Field(min_length=1)
    ts: str = Field(min_length=1)
    type: Literal["message.delta"]
    data: MessageDeltaData


class MessageThinkingDeltaEvent(BaseModel):
    """Thinking text to append to the open assistant message. It is not part of the answer."""

    model_config = _CONFIG

    seq: int = Field(ge=1)
    session_id: str = Field(min_length=1)
    run_id: str = Field(min_length=1)
    ts: str = Field(min_length=1)
    type: Literal["message.thinking.delta"]
    data: MessageThinkingDeltaData


class MessageCompletedEvent(BaseModel):
    """The full text of one message. Replaces any deltas for that id."""

    model_config = _CONFIG

    seq: int = Field(ge=1)
    session_id: str = Field(min_length=1)
    run_id: str = Field(min_length=1)
    ts: str = Field(min_length=1)
    type: Literal["message.completed"]
    data: MessageCompletedData


class ModelCallStartedEvent(BaseModel):
    """The request for one assistant message went to the model."""

    model_config = _CONFIG

    seq: int = Field(ge=1)
    session_id: str = Field(min_length=1)
    run_id: str = Field(min_length=1)
    ts: str = Field(min_length=1)
    type: Literal["model.call.started"]
    data: ModelCallStartedData


class ContextChangedEvent(BaseModel):
    """What golem sends of the history changed, before the model call that follows.

    ``run_id`` is null when ``session.compact`` made the change: no run owns it.
    """

    model_config = _CONFIG

    seq: int = Field(ge=1)
    session_id: str = Field(min_length=1)
    run_id: str | None = Field(default=None, min_length=1)
    ts: str = Field(min_length=1)
    type: Literal["context.changed"]
    data: ContextChangedData


class ModelCallCompletedEvent(BaseModel):
    """The model call ended. Comes before the call's ``tool.requested`` events."""

    model_config = _CONFIG

    seq: int = Field(ge=1)
    session_id: str = Field(min_length=1)
    run_id: str = Field(min_length=1)
    ts: str = Field(min_length=1)
    type: Literal["model.call.completed"]
    data: ModelCallCompletedData


class RunStartedEvent(BaseModel):
    """A graph run is in progress for this session."""

    model_config = _CONFIG

    seq: int = Field(ge=1)
    session_id: str = Field(min_length=1)
    run_id: str = Field(min_length=1)
    ts: str = Field(min_length=1)
    type: Literal["run.started"]
    data: EmptyEventData


class RunCompletedEvent(BaseModel):
    """The graph run finished and the checkpoint is current."""

    model_config = _CONFIG

    seq: int = Field(ge=1)
    session_id: str = Field(min_length=1)
    run_id: str = Field(min_length=1)
    ts: str = Field(min_length=1)
    type: Literal["run.completed"]
    data: EmptyEventData


class RunFailedEvent(BaseModel):
    """The graph run stopped with an error."""

    model_config = _CONFIG

    seq: int = Field(ge=1)
    session_id: str = Field(min_length=1)
    run_id: str = Field(min_length=1)
    ts: str = Field(min_length=1)
    type: Literal["run.failed"]
    data: RunFailedData


class RunCancelledEvent(BaseModel):
    """The run was stopped before the model finished. The partial reply is kept."""

    model_config = _CONFIG

    seq: int = Field(ge=1)
    session_id: str = Field(min_length=1)
    run_id: str = Field(min_length=1)
    ts: str = Field(min_length=1)
    type: Literal["run.cancelled"]
    data: RunCancelledData


class ToolRequestedEvent(BaseModel):
    """The model asked for a tool. Follows the asking message's ``message.completed``."""

    model_config = _CONFIG

    seq: int = Field(ge=1)
    session_id: str = Field(min_length=1)
    run_id: str = Field(min_length=1)
    ts: str = Field(min_length=1)
    type: Literal["tool.requested"]
    data: ToolRequestedData


class ToolStartedEvent(BaseModel):
    """The tool call is running."""

    model_config = _CONFIG

    seq: int = Field(ge=1)
    session_id: str = Field(min_length=1)
    run_id: str = Field(min_length=1)
    ts: str = Field(min_length=1)
    type: Literal["tool.started"]
    data: ToolStartedData


class ToolOutputEvent(BaseModel):
    """More output from a running call. ``tool.completed`` or ``tool.failed`` replaces it."""

    model_config = _CONFIG

    seq: int = Field(ge=1)
    session_id: str = Field(min_length=1)
    run_id: str = Field(min_length=1)
    ts: str = Field(min_length=1)
    type: Literal["tool.output"]
    data: ToolOutputData


class ToolWritingEvent(BaseModel):
    """The model is still writing a file call. A live signal: ``message.completed`` replaces it."""

    model_config = _CONFIG

    seq: int = Field(ge=1)
    session_id: str = Field(min_length=1)
    run_id: str = Field(min_length=1)
    ts: str = Field(min_length=1)
    type: Literal["tool.writing"]
    data: ToolWritingData


class ModelWaitingEvent(BaseModel):
    """A chat call waits for the local model. A live signal: ``message.completed`` replaces it."""

    model_config = _CONFIG

    seq: int = Field(ge=1)
    session_id: str = Field(min_length=1)
    run_id: str = Field(min_length=1)
    ts: str = Field(min_length=1)
    type: Literal["model.waiting"]
    data: ModelWaitingData


class ToolCompletedEvent(BaseModel):
    """The tool call finished, and its result went back to the model."""

    model_config = _CONFIG

    seq: int = Field(ge=1)
    session_id: str = Field(min_length=1)
    run_id: str = Field(min_length=1)
    ts: str = Field(min_length=1)
    type: Literal["tool.completed"]
    data: ToolCompletedData


class ToolFailedEvent(BaseModel):
    """The tool call was refused, raised, or was cut off by a stopped run."""

    model_config = _CONFIG

    seq: int = Field(ge=1)
    session_id: str = Field(min_length=1)
    run_id: str = Field(min_length=1)
    ts: str = Field(min_length=1)
    type: Literal["tool.failed"]
    data: ToolFailedData


class ApprovalNeededEvent(BaseModel):
    """The run is waiting for an answer about one tool call."""

    model_config = _CONFIG

    seq: int = Field(ge=1)
    session_id: str = Field(min_length=1)
    run_id: str = Field(min_length=1)
    ts: str = Field(min_length=1)
    type: Literal["approval.needed"]
    data: ApprovalNeededData


class ApprovalResolvedEvent(BaseModel):
    """The waiting tool call was answered, and the run goes on."""

    model_config = _CONFIG

    seq: int = Field(ge=1)
    session_id: str = Field(min_length=1)
    run_id: str = Field(min_length=1)
    ts: str = Field(min_length=1)
    type: Literal["approval.resolved"]
    data: ApprovalResolvedData


class FileChangedEvent(BaseModel):
    """A file in the session folder changed. Sent before the ``tool.completed`` of its call.

    ``run_id`` is null for an undo, which is made between runs.
    """

    model_config = _CONFIG

    seq: int = Field(ge=1)
    session_id: str = Field(min_length=1)
    run_id: str | None = Field(min_length=1)
    ts: str = Field(min_length=1)
    type: Literal["file.changed"]
    data: FileChangedData


class TodosUpdatedEvent(BaseModel):
    """The agent's todo list changed. ``run_id`` is null for a list a fork copied."""

    model_config = _CONFIG

    seq: int = Field(ge=1)
    session_id: str = Field(min_length=1)
    run_id: str | None = Field(min_length=1)
    ts: str = Field(min_length=1)
    type: Literal["todos.updated"]
    data: TodosUpdatedData


class SkillActivatedEvent(BaseModel):
    """A skill became active.

    An invoked skill's event comes just before the user message that invoked
    it, in that run. A pin is not part of a run, so its ``run_id`` is null.
    """

    model_config = _CONFIG

    seq: int = Field(ge=1)
    session_id: str = Field(min_length=1)
    run_id: str | None = Field(default=None, min_length=1)
    ts: str = Field(min_length=1)
    type: Literal["skill.activated"]
    data: SkillActivatedData


class SkillDeactivatedEvent(BaseModel):
    """A pinned skill was turned off. Not part of a run, so ``run_id`` is null."""

    model_config = _CONFIG

    seq: int = Field(ge=1)
    session_id: str = Field(min_length=1)
    run_id: str | None = Field(default=None, min_length=1)
    ts: str = Field(min_length=1)
    type: Literal["skill.deactivated"]
    data: SkillDeactivatedData


class SkillSkippedEvent(BaseModel):
    """A pinned skill was left out of the run's model calls.

    Logged once when it becomes unusable, not for every call.
    """

    model_config = _CONFIG

    seq: int = Field(ge=1)
    session_id: str = Field(min_length=1)
    run_id: str | None = Field(default=None, min_length=1)
    ts: str = Field(min_length=1)
    type: Literal["skill.skipped"]
    data: SkillSkippedData


EventType = Literal[
    "session.created",
    "session.updated",
    "session.closed",
    "session.completed",
    "model.selected",
    "model.routed",
    "model.options.changed",
    "session.mode.changed",
    "session.checks.changed",
    "session.plan.changed",
    "message.started",
    "message.delta",
    "message.thinking.delta",
    "message.completed",
    "model.call.started",
    "model.call.completed",
    "context.changed",
    "run.started",
    "run.completed",
    "run.failed",
    "run.cancelled",
    "tool.requested",
    "tool.writing",
    "model.waiting",
    "tool.started",
    "tool.output",
    "tool.completed",
    "tool.failed",
    "approval.needed",
    "approval.resolved",
    "todos.updated",
    "plan.proposed",
    "file.changed",
    "skill.activated",
    "skill.deactivated",
    "skill.skipped",
    "check.offered",
    "check.started",
    "check.completed",
]
"""The ``type`` of each :data:`ChatEvent` member."""


ChatEvent = Annotated[
    SessionCreatedEvent
    | SessionUpdatedEvent
    | SessionClosedEvent
    | SessionCompletedEvent
    | ModelSelectedEvent
    | ModelRoutedEvent
    | ModelOptionsChangedEvent
    | SessionModeChangedEvent
    | SessionChecksChangedEvent
    | SessionPlanChangedEvent
    | MessageStartedEvent
    | MessageDeltaEvent
    | MessageThinkingDeltaEvent
    | MessageCompletedEvent
    | ModelCallStartedEvent
    | ModelCallCompletedEvent
    | ContextChangedEvent
    | RunStartedEvent
    | RunCompletedEvent
    | RunFailedEvent
    | RunCancelledEvent
    | ToolRequestedEvent
    | ToolWritingEvent
    | ModelWaitingEvent
    | ToolStartedEvent
    | ToolOutputEvent
    | ToolCompletedEvent
    | ToolFailedEvent
    | ApprovalNeededEvent
    | ApprovalResolvedEvent
    | TodosUpdatedEvent
    | PlanProposedEvent
    | FileChangedEvent
    | SkillActivatedEvent
    | SkillDeactivatedEvent
    | SkillSkippedEvent
    | CheckOfferedEvent
    | CheckStartedEvent
    | CheckCompletedEvent,
    Field(discriminator="type"),
]

CHAT_EVENT: TypeAdapter[ChatEvent] = TypeAdapter(ChatEvent)
"""Validates a plain mapping or JSON into one :data:`ChatEvent`."""


__all__ = [
    "CHAT_EVENT",
    "ApprovalDecision",
    "ApprovalNeededData",
    "ApprovalNeededEvent",
    "ApprovalResolvedData",
    "ApprovalResolvedEvent",
    "CallPrice",
    "ChatEvent",
    "CheckCompletedData",
    "CheckCompletedEvent",
    "CheckInfo",
    "CheckOfferedData",
    "CheckOfferedEvent",
    "CheckStartedData",
    "CheckStartedEvent",
    "ContextChangedData",
    "ContextChangedEvent",
    "EmptyEventData",
    "EventType",
    "FileChangedData",
    "FileChangedEvent",
    "ForkedFrom",
    "MessageCompletedData",
    "MessageCompletedEvent",
    "MessageDeltaData",
    "MessageDeltaEvent",
    "MessageStartedData",
    "MessageStartedEvent",
    "MessageThinkingDeltaData",
    "MessageThinkingDeltaEvent",
    "ModelCallCompletedData",
    "ModelCallCompletedEvent",
    "ModelCallStartedData",
    "ModelCallStartedEvent",
    "ModelOptionsChangedData",
    "ModelOptionsChangedEvent",
    "ModelRejection",
    "ModelRoutedData",
    "ModelRoutedEvent",
    "ModelSelectedData",
    "ModelSelectedEvent",
    "ModelWaitingData",
    "ModelWaitingEvent",
    "PermissionMode",
    "Ping",
    "PlanProposedData",
    "PlanProposedEvent",
    "PlanStep",
    "PromptSectionInfo",
    "RouteMode",
    "RunCancelledData",
    "RunCancelledEvent",
    "RunCompletedEvent",
    "RunFailedData",
    "RunFailedEvent",
    "RunStartedEvent",
    "SessionAllowance",
    "SessionChecksChangedData",
    "SessionChecksChangedEvent",
    "SessionClosedEvent",
    "SessionCompletedData",
    "SessionCompletedEvent",
    "SessionCreatedData",
    "SessionCreatedEvent",
    "SessionModeChangedData",
    "SessionModeChangedEvent",
    "SessionPlanChangedData",
    "SessionPlanChangedEvent",
    "SessionUpdatedData",
    "SessionUpdatedEvent",
    "SkillActivatedData",
    "SkillActivatedEvent",
    "SkillCall",
    "SkillDeactivatedData",
    "SkillDeactivatedEvent",
    "SkillSkippedData",
    "SkillSkippedEvent",
    "SkillSource",
    "Todo",
    "TodoStatus",
    "TodosUpdatedData",
    "TodosUpdatedEvent",
    "TokenUsage",
    "ToolCompletedData",
    "ToolCompletedEvent",
    "ToolFailedData",
    "ToolFailedEvent",
    "ToolOutputData",
    "ToolOutputEvent",
    "ToolRequestedData",
    "ToolRequestedEvent",
    "ToolStartedData",
    "ToolStartedEvent",
    "ToolWritingData",
    "ToolWritingEvent",
]
