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
    or null for a session without one.
    """

    model_config = _CONFIG

    model_profile: str = Field(min_length=1)
    model_provider: str | None = Field(default=None, min_length=1)
    model_name: str | None = Field(default=None, min_length=1)
    forked_from: ForkedFrom | None = None
    cwd: str | None = Field(default=None, min_length=1)


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
    """

    model_config = _CONFIG

    message_id: str = Field(min_length=1)
    role: Literal["user", "assistant"]
    text: str
    interrupted: bool = False
    skill: SkillCall | None = None


SkillSource = Literal["project", "user", "bundled"]
"""Where a skill was found: the session's project, the user's folders, or golem itself."""


class SkillActivatedData(BaseModel):
    """A skill is active in the session.

    ``how`` is ``invoked`` for a skill run once by name: its body is that
    turn's user message. It is ``pinned`` for a skill turned on for the whole
    session: its body is in the system prompt of every model call until it is
    unpinned. ``source`` is where it was found, ``path`` its folder, and
    ``hash`` the sha256 of its ``SKILL.md``. A pinned skill whose file changed,
    or that can be used again after it was skipped, is activated again in the
    run whose model call first reads the new body.
    """

    model_config = _CONFIG

    name: str = Field(min_length=1)
    source: SkillSource
    how: Literal["invoked", "pinned"]
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
    server that is not installed, such as Ollama. ``provider`` is the provider
    whose server it was, and ``hint`` says how to fix it, such as
    ``run ollama serve``.
    """

    model_config = _CONFIG

    message: str = Field(min_length=1)
    code: Literal["model_unreachable", "not_installed"] | None = None
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
    """A session attribute changed: its title, folder, allowed tools, or MCP servers.

    A field left null did not change. ``cwd`` is set once, on a session made
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

    @model_validator(mode="after")
    def _changes_something(self) -> Self:
        fields = (self.title, self.cwd, self.allowed_tools, self.mcp_servers)
        if all(field is None for field in fields):
            raise ValueError("session.updated needs a title, a cwd, allowed_tools, or mcp_servers")
        return self


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


class ToolStartedData(BaseModel):
    """A requested tool call is running."""

    model_config = _CONFIG

    call_id: str = Field(min_length=1)


class ToolOutputData(BaseModel):
    """Text a running tool call printed. Stored only until the call ends."""

    model_config = _CONFIG

    call_id: str = Field(min_length=1)
    text: str = Field(min_length=1)


class ToolCompletedData(BaseModel):
    """A tool call finished.

    ``summary`` is one short line, such as ``42 lines``. ``preview`` is the
    start of the output, cut at a few kilobytes, and ``truncated`` says
    whether it was cut. Output too long for the model is stored whole in the
    artifact ``artifact_id``, which ``artifact.read`` reads.
    """

    model_config = _CONFIG

    call_id: str = Field(min_length=1)
    summary: str
    preview: str
    truncated: bool = False
    artifact_id: str | None = Field(default=None, min_length=1)


class ToolFailedData(BaseModel):
    """A tool call did not run, or stopped with an error. The model sees the same message."""

    model_config = _CONFIG

    call_id: str = Field(min_length=1)
    message: str = Field(min_length=1)


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


class MessageCompletedEvent(BaseModel):
    """The full text of one message. Replaces any deltas for that id."""

    model_config = _CONFIG

    seq: int = Field(ge=1)
    session_id: str = Field(min_length=1)
    run_id: str = Field(min_length=1)
    ts: str = Field(min_length=1)
    type: Literal["message.completed"]
    data: MessageCompletedData


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
    "model.selected",
    "message.started",
    "message.delta",
    "message.completed",
    "run.started",
    "run.completed",
    "run.failed",
    "run.cancelled",
    "tool.requested",
    "tool.started",
    "tool.output",
    "tool.completed",
    "tool.failed",
    "approval.needed",
    "approval.resolved",
    "todos.updated",
    "skill.activated",
    "skill.deactivated",
    "skill.skipped",
]
"""The ``type`` of each :data:`ChatEvent` member."""


ChatEvent = Annotated[
    SessionCreatedEvent
    | SessionUpdatedEvent
    | SessionClosedEvent
    | ModelSelectedEvent
    | MessageStartedEvent
    | MessageDeltaEvent
    | MessageCompletedEvent
    | RunStartedEvent
    | RunCompletedEvent
    | RunFailedEvent
    | RunCancelledEvent
    | ToolRequestedEvent
    | ToolStartedEvent
    | ToolOutputEvent
    | ToolCompletedEvent
    | ToolFailedEvent
    | ApprovalNeededEvent
    | ApprovalResolvedEvent
    | TodosUpdatedEvent
    | SkillActivatedEvent
    | SkillDeactivatedEvent
    | SkillSkippedEvent,
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
    "ChatEvent",
    "EmptyEventData",
    "EventType",
    "ForkedFrom",
    "MessageCompletedData",
    "MessageCompletedEvent",
    "MessageDeltaData",
    "MessageDeltaEvent",
    "MessageStartedData",
    "MessageStartedEvent",
    "ModelSelectedData",
    "ModelSelectedEvent",
    "Ping",
    "RunCancelledData",
    "RunCancelledEvent",
    "RunCompletedEvent",
    "RunFailedData",
    "RunFailedEvent",
    "RunStartedEvent",
    "SessionAllowance",
    "SessionClosedEvent",
    "SessionCreatedData",
    "SessionCreatedEvent",
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
]
