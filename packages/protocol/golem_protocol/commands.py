"""Client → daemon commands.

``Ping`` in :mod:`golem_protocol.events` is the result of ``ping``.
"""

from typing import Annotated, Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, SecretStr, model_validator

from golem_protocol.events import (
    HELPER_BRIEF_MAX_CHARS,
    AgentLimits,
    AgentOrigin,
    ConsentAnswer,
    ModelRejection,
    PermissionMode,
    PromptSectionInfo,
    RouteMode,
    SkillCall,
    SkillSource,
    WaitReason,
)


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
    local_ui: bool = False
    """True when this connection is a page on the daemon's own Mac and the platform can show
    the macOS folder dialog, so ``fs.choose_folder`` is offered. False for a paired phone
    that comes through the relay, and for any platform but macOS."""


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

    ``plan_first`` starts the session in plan first (true) or not (false). Left out, the
    session follows ``[chat] plan_first``.

    ``origin`` says who started the session: ``user`` (the default) or ``cli``
    for ``golem ask --detach``. Only the daemon itself starts a ``routine:*``
    session, and any other value is refused.

    ``branch`` asks the daemon to switch ``cwd`` to that git branch before the
    session starts (``git switch``), or to create it first with
    ``create_branch`` (``git switch -c``). Uncommitted changes go along, as in
    git. A ``cwd`` that is not a repository is refused with ``not_a_repo``, and
    a failed switch with ``branch_switch_failed`` carrying git's own message;
    no session is made then. Both errors put that name in ``error.data.code``.

    The caller is not attached. ``session.attach`` replays ``session.created``.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    model_profile: str | None = Field(default=None, min_length=1)
    cwd: str | None = Field(default=None, min_length=1)
    origin: Literal["user", "cli"] | None = None
    branch: str | None = Field(default=None, min_length=1)
    create_branch: bool = False
    plan_first: bool | None = None


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


ShortText = Annotated[str, Field(min_length=1, max_length=120)]
"""One short line of the paid question: what is sent, or what is not."""


UseHelpers = Literal["when_needed", "ask", "never"]
"""``[agents] use_helpers``, the setting "Use helpers": ``when_needed`` lets the lead start helpers
for a stated reason, ``ask`` shows a batch card to confirm first, ``never`` starts none."""


class PendingHelper(BaseModel):
    """The helper a pending item belongs to: its session, its agent type, its label and its
    place (``index``) in the ``delegate`` call. For a grouped item (``count`` above 1) it is the
    first of the helpers that ask."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    agent: str = Field(min_length=1)
    label: str | None = Field(default=None, max_length=120)
    index: int = Field(ge=0)


class PendingItem(BaseModel):
    """What a waiting session waits for, in a form a client can list without opening it.

    ``kind`` is ``approval`` for a tool call that needs a yes, and ``consent`` for the paid
    step-up question. ``since`` is the ``ts`` of the event that asked
    (``approval.needed`` or ``route.consent.needed``). For an approval, ``call_id``, ``name``,
    ``subject`` and ``source`` are those of the ``approval.needed`` event, and ``added`` and
    ``removed`` count the lines its diff adds and removes (null when the call has no diff).
    For a consent, ``alternatives`` is the number of answers the user may give. A helper's
    consent also carries ``helper_id``, ``agent``, ``label``, ``sent``, ``not_sent``, ``brief``
    and ``diff_artifact_id`` of its ``route.consent.needed`` event. The full diff
    stays in the session's events: a summary goes to every watcher on every event, so it
    carries counts only. An older daemon leaves ``pending`` out of the summary.

    In ``SessionSummary.pending_items`` an item of a lead's helper also carries ``helper``
    (the helper's ``session_id``, ``agent``, ``label`` and ``index``). ``count`` is the number
    of helpers that ask this same question (the same ``kind``, ``name`` and ``subject``), which
    the lead lists once; null for a single item. An older daemon leaves both out.

    A ``batch`` item is the card that asks the user to confirm a ``delegate`` batch before its
    helpers start ("Use helpers: Ask me first"). ``call_id`` is the ``delegate`` call, the id an
    answer names. ``helper_count`` is how many helpers the batch starts and ``agents`` their agent
    type names, one for each helper, in the order of the call. It is only ever in
    ``SessionSummary.pending_items``: ``SessionSummary.pending`` never holds one, because an
    older client reads that field and knows only ``approval`` and ``consent``.

    A ``batch`` item with ``estimate_usd`` is the estimate card: ``estimate_usd`` is what the
    batch is estimated to cost, ``allowed_usd`` the ``[agents] per_message_cost`` the user allows
    per message, ``ask_over_usd`` the ``[agents] estimate_over`` amount above which it asks,
    ``model`` the model the helpers would run on (the first helper's when they differ) and
    ``cheaper_model`` the model "Use a cheaper model" would use (null hides that answer). The
    card may appear even when ``use_helpers`` is not ``ask``. It is answered by
    ``helpers.respond``. These five fields mean something only for a ``batch`` item; an older
    daemon leaves them out.

    A ``review`` item is a workflow run waiting for your answer (``run.review``). ``ask`` is
    its question, ``preview`` the first characters of the draft, ``workflow_run_id`` the run
    and ``key`` the review's step key; ``workflow.review.answer`` names the last two. ``since``
    is when the review was asked. Like ``batch``, a ``review`` is only ever in
    ``SessionSummary.pending_items``, never in ``pending``. A client that does not know the
    kind shows ``ask`` or ignores the item.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    kind: Literal["approval", "consent", "batch", "review"]
    since: str = Field(min_length=1)
    call_id: str | None = Field(default=None, min_length=1)
    name: str | None = Field(default=None, min_length=1)
    subject: str | None = None
    source: str | None = Field(default=None, min_length=1)
    added: int | None = Field(default=None, ge=0)
    removed: int | None = Field(default=None, ge=0)
    alternatives: int | None = Field(default=None, ge=0)
    helper_id: str | None = Field(default=None, min_length=1)
    agent: str | None = Field(default=None, min_length=1)
    label: str | None = Field(default=None, max_length=120)
    sent: list[ShortText] | None = Field(default=None, max_length=10)
    not_sent: list[ShortText] | None = Field(default=None, max_length=10)
    brief: str | None = Field(default=None, max_length=HELPER_BRIEF_MAX_CHARS)
    diff_artifact_id: str | None = Field(default=None, min_length=1)
    helper: PendingHelper | None = None
    count: int | None = Field(default=None, ge=2)
    helper_count: int | None = Field(default=None, ge=1, le=100)
    estimate_usd: float | None = Field(default=None, ge=0)
    allowed_usd: float | None = Field(default=None, ge=0)
    ask_over_usd: float | None = Field(default=None, ge=0)
    model: str | None = Field(default=None, min_length=1)
    cheaper_model: str | None = Field(default=None, min_length=1)
    agents: list[str] | None = Field(default=None, max_length=100)
    ask: str | None = Field(default=None, max_length=500)
    preview: str | None = Field(default=None, max_length=500)
    workflow_run_id: str | None = Field(default=None, min_length=1)
    key: str | None = Field(default=None, min_length=1)


class SessionSummary(BaseModel):
    """One session as ``session.list`` reports it.

    ``status`` is ``running`` while a run is open, ``waiting`` while a run
    waits for a tool approval, and ``closed`` after ``session.close``. ``last_seq`` is the newest
    stored event, so a client can tell what it has not seen, and which of
    two summaries of one session is newer. ``cwd`` is the session's project
    folder, null for a session that has not been given one. ``forked_from`` is
    the id of the session this one was forked from, null for a session that is
    not a fork. An older daemon leaves it out. ``origin`` is who started the
    session: ``user``, ``cli``, ``routine:<name>``. A session never changes it.
    ``route`` is the session's route mode. An older daemon leaves it out.
    ``plan_first`` is true while the session is in plan first (``session.set_plan``).
    ``local_only`` is true while the session's folder stays on this Mac: only a local model
    reads its chat. It follows the settings of the moment, so it can change without an event.
    An older daemon leaves it out.
    ``pending`` says what a ``waiting`` session waits for, null otherwise. An older daemon
    leaves it out.
    ``pending_items`` is the list of everything the session waits for, oldest first: for a lead
    its own items and those of its helpers (a question several helpers ask is one item with a
    ``count``). ``pending`` is its first item. An older daemon leaves ``pending_items`` out, and
    a client then reads ``[pending]``.
    ``parent_session_id`` and ``agent`` are set on a helper session: the id of the
    session. An older daemon leaves them out.
    ``wait_reason`` and ``wait_line`` say that the running run's model call waits in line:
    the reason (``slot``, ``provider`` or ``load``) and the plain name of the model or provider.
    Null when no call waits, and for the waits the status already shows. An older daemon
    leaves them out.
    ``helpers_running`` and ``helpers_waiting`` are set on a lead: how many of its helpers have
    a run in progress, and how many wait for an answer. Null for a session with no helpers.
    ``step`` is set on a helper: its newest step as one line (the ``summary`` of its last
    ``helper.step``), at most 200 characters. Null before the first step. An older daemon
    leaves all three out.
    ``trimmed_at`` is set on a helper whose steps were removed after its keep days
    (``session.trimmed``): the time of the trim. Null for any other session. An older daemon
    leaves it out.
    ``branch`` is the branch checked out in the session's ``cwd``. Null outside a repo, when
    the head is detached, and for a session with no folder. It follows the folder, so it can
    change without an event. An older daemon leaves it out.
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
    origin: str = Field(default="user", min_length=1)
    route: RouteMode = "pinned"
    plan_first: bool = False
    local_only: bool = False
    pending: PendingItem | None = None
    pending_items: list[PendingItem] = Field(default_factory=list[PendingItem], max_length=200)
    parent_session_id: str | None = Field(default=None, min_length=1)
    agent: str | None = Field(default=None, min_length=1)
    wait_reason: WaitReason | None = None
    wait_line: str | None = Field(default=None, min_length=1)
    helpers_running: int | None = Field(default=None, ge=0)
    helpers_waiting: int | None = Field(default=None, ge=0)
    step: str | None = Field(default=None, min_length=1, max_length=200)
    trimmed_at: str | None = Field(default=None, min_length=1)
    branch: str | None = Field(default=None, min_length=1)

    @model_validator(mode="after")
    def _pending_is_not_a_batch(self) -> Self:
        if self.pending is not None and self.pending.kind == "batch":
            raise ValueError("pending never holds a batch item; it is only in pending_items")
        return self


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

    ``stronger`` runs this one turn on the tier above the model that wrote the last
    answer (ADR-055). The session's model and route do not change. It needs route
    ``auto``. When no stronger model may be used, the send fails and no turn starts.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    text: str = Field(min_length=1, max_length=100_000)
    cwd: str | None = Field(default=None, min_length=1)
    skill: SkillCall | None = None
    stronger: bool = False


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
    caller is not attached to the new session. Without ``at_message_id`` the
    history runs to the source's last completed message. A helper may be the
    source: the fork is an ordinary chat that has no lead, which is how
    "Continue as chat" works. A helper whose steps were removed cannot be forked.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    at_message_id: str | None = Field(default=None, min_length=1)


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


class CostGetParams(BaseModel):
    """``cost.get``. What model calls cost: today, the last 7 days, and one session.

    Days are the user's local days. Does not call a model.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str | None = Field(default=None, min_length=1)


class CostTotals(BaseModel):
    """Calls, tokens and money over one span.

    ``cost_usd`` is what paid calls cost, at the price golem knew then. ``saved_usd`` is what
    the tokens of ``local`` calls would have cost at the reference model's price, and 0 when
    there is no reference. Money is a float on purpose: sub-cent amounts. Round to show it.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    calls: int = Field(ge=0)
    input: int = Field(ge=0)
    output: int = Field(ge=0)
    cost_usd: float = Field(ge=0)
    saved_usd: float = Field(ge=0)


class CostModelRow(BaseModel):
    """One model's calls over the last 7 days.

    ``provider``, ``model`` and ``tier`` are null for a call whose model was not known.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    provider: str | None = None
    model: str | None = None
    tier: Literal["local", "budget", "frontier"] | None = None
    calls: int = Field(ge=0)
    input: int = Field(ge=0)
    output: int = Field(ge=0)
    cost_usd: float = Field(ge=0)


class CostRoleRow(BaseModel):
    """One job's calls over the last 7 days: ``chat``, ``explore`` (a helper), ``title``..."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    role: str = Field(min_length=1)
    calls: int = Field(ge=0)
    input: int = Field(ge=0)
    output: int = Field(ge=0)
    cost_usd: float = Field(ge=0)


class CostAgentRow(BaseModel):
    """One agent type's helper calls over the last 7 days. A lead's own calls are in no row.
    ``cost_usd`` is 0 for a local model."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    agent: str = Field(min_length=1)
    calls: int = Field(ge=0)
    input: int = Field(ge=0)
    output: int = Field(ge=0)
    cost_usd: float = Field(ge=0)


class CostDayRow(BaseModel):
    """One local day. ``local_tokens`` are input plus output of ``local`` calls, and
    ``paid_tokens`` those of every other call."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    day: str = Field(min_length=10, max_length=10)
    local_tokens: int = Field(ge=0)
    paid_tokens: int = Field(ge=0)
    cost_usd: float = Field(ge=0)


class CostGetResult(BaseModel):
    """``week`` is the last 7 local days, today included. ``session`` is set when the
    request named a session. ``by_model`` is sorted by cost, highest first, and ``by_day``
    has one row for each of the 7 days, oldest first. ``by_role`` is sorted by cost, highest
    first. ``by_agent`` splits the helpers' calls by agent type, highest cost first; it is
    empty from a daemon that does not split them. ``saved_reference`` is the
    ``provider/model`` ref whose prices ``saved_usd`` uses, or null when there is none."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    today: CostTotals
    week: CostTotals
    session: CostTotals | None = None
    by_model: list[CostModelRow] = Field(default_factory=list[CostModelRow])
    by_day: list[CostDayRow] = Field(default_factory=list[CostDayRow])
    by_role: list[CostRoleRow] = Field(default_factory=list[CostRoleRow])
    by_agent: list[CostAgentRow] = Field(default_factory=list[CostAgentRow])
    saved_reference: str | None = None


class EvalRoutingParams(BaseModel):
    """``eval.routing``. What the recorded sessions of the last ``days`` days would have cost
    on a frontier model, on a local model and on ``auto``. A calculation over the stored
    events: it calls no model. With ``session_id``, only that session. Not for a browser."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    days: int = Field(default=14, ge=1, le=3650)
    session_id: str | None = Field(default=None, min_length=1)


class EvalScenarioRow(BaseModel):
    """One scenario over every session asked for.

    ``cuts`` are prompts that would not fit the model's window. ``step_ups`` is null for a
    scenario that never steps up. ``peak_share`` is the largest share of a window one prompt
    took, from 0 to 1, and null when no window was known.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)
    calls: int = Field(ge=0)
    input: int = Field(ge=0)
    output: int = Field(ge=0)
    cost_usd: float = Field(ge=0)
    cuts: int = Field(ge=0)
    step_ups: int | None = Field(default=None, ge=0)
    clears: int = Field(ge=0)
    summaries: int = Field(ge=0)
    peak_share: float | None = Field(default=None, ge=0, le=1)


class EvalTopSession(BaseModel):
    """A session where ``auto`` would have spent much. No title and no text."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    calls: int = Field(ge=0)
    cost_usd: float = Field(ge=0)


class EvalHelperRow(BaseModel):
    """One helper of a recorded session, and the model ``pick_helper`` gives it in this setup.

    ``ran`` and ``ran_why`` are what ``helper.started`` recorded: the model, and the reason
    in plain words. ``would`` and ``would_why`` are the pick made again now, on the models
    that are ready. ``would_asks`` is true when that pick is paid and the chat has not agreed,
    so the daemon would ask first. No title and no text.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    agent: str = Field(min_length=1)
    wish: str = Field(min_length=1)
    ran: str = Field(min_length=1)
    ran_why: str
    would: str = Field(min_length=1)
    would_tier: str = Field(min_length=1)
    would_why: str
    would_asks: bool = False


class EvalRoutingResult(BaseModel):
    """``scenarios`` are the what-if rows, ``actual`` is what really ran. ``skipped`` counts the
    model calls that could not be sized (an old event, or a failed call) and are in no row.
    ``top`` are the sessions where ``auto`` would have spent most, the dearest first.
    ``helpers`` are the helpers of those sessions, one row per ``helper.started``."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    days: int = Field(ge=1)
    sessions: int = Field(ge=0)
    calls: int = Field(ge=0)
    skipped: int = Field(ge=0)
    scenarios: list[EvalScenarioRow] = Field(default_factory=list[EvalScenarioRow])
    actual: EvalScenarioRow
    top: list[EvalTopSession] = Field(default_factory=list[EvalTopSession])
    helpers: list[EvalHelperRow] = Field(default_factory=list[EvalHelperRow])


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


class _TraceModelFields(TraceSpan):
    """A model call, with the tool calls it asked for, in request order.

    ``prompt_cut`` says whether Ollama cut the prompt that did not fit: "no"
    and "yes" are proven from exact numbers, "likely" is an estimate, and null
    means golem cannot tell. ``prompt_cut_kind`` is set with "yes" and
    "likely". ``dropped_message_ids`` are the messages the model probably did
    not see (older messages only), and ``dropped_tokens`` is an estimate of
    their size.

    ``cost_usd`` is what the call cost, as its ``model.call.completed`` recorded
    it. Null when the price was not known or the call has no token counts.

    ``load_ms``, ``prompt_ms`` and ``reply_ms`` are from the model server's own clock.
    Ollama only.
    """

    cost_usd: float | None = Field(default=None, ge=0)
    load_ms: int | None = Field(default=None, ge=0)
    prompt_ms: int | None = Field(default=None, ge=0)
    reply_ms: int | None = Field(default=None, ge=0)
    context_window: int | None = Field(default=None, ge=1)
    num_ctx: int | None = Field(default=None, ge=1)
    context_window_estimated: bool = False
    window_planned: bool = False
    prompt_cut: Literal["no", "yes", "likely"] | None = None
    prompt_cut_kind: Literal["older_messages", "middle"] | None = None
    dropped_message_ids: list[str] = Field(default_factory=list[str])
    dropped_tokens: int | None = Field(default=None, ge=0)


class TraceHelperToolSpan(TraceSpan):
    """A tool call of a helper. It has no children."""


class TraceHelperModelSpan(_TraceModelFields):
    """A model call of a helper, with the helper's tool calls it asked for, in request order."""

    children: list[TraceHelperToolSpan] = Field(default_factory=list[TraceHelperToolSpan])


class TraceToolSpan(TraceSpan):
    """A tool call.

    A ``delegate`` call has the model calls of its helper in ``children``, in order, each with
    the helper's own tool calls. Any other tool call has none. A helper's calls have a context
    of their own, so they are not part of the run's context series.
    """

    children: list[TraceHelperModelSpan] = Field(default_factory=list[TraceHelperModelSpan])


class TraceModelSpan(_TraceModelFields):
    """A model call, with the tool calls it asked for, in request order.

    The tool calls are the run's own, so a ``delegate`` call has its helper's model calls
    under it.
    """

    children: list[TraceToolSpan] = Field(default_factory=list[TraceToolSpan])


class TraceRoute(BaseModel):
    """Why a run used the model it did: the pick of a session that is not ``pinned``.

    ``reason`` and ``detail`` are those of ``model.routed``, and ``rejected`` the
    candidates the pick dropped. ``model`` and ``tier`` are the pick itself. An older
    daemon leaves them out.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    model: str | None = Field(default=None, min_length=1)
    tier: Literal["local", "budget", "frontier"] | None = None
    reason: Literal[
        "pinned",
        "privacy",
        "fit",
        "budget",
        "cheapest",
        "escalated",
        "fallback",
        "user",
        "same",
        "stronger",
        "tier",
        "named",
        "nearest",
        "lead",
    ]
    detail: str
    rejected: list[ModelRejection] = Field(default_factory=list[ModelRejection])


class TraceRunSpan(TraceSpan):
    """A run, with its model calls in order.

    ``route`` is the pick for the run, null for a run of a ``pinned`` session.
    """

    route: TraceRoute | None = None
    children: list[TraceModelSpan] = Field(default_factory=list[TraceModelSpan])


class TraceContextEvent(BaseModel):
    """One ``context.changed`` of the session, for the trace.

    ``call_id`` is the model call that came right after the change, null when none has yet.
    The other fields are those of ``context.changed``.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    seq: int = Field(ge=1)
    action: Literal["cleared", "summarised", "grew"]
    call_id: str | None = Field(default=None, min_length=1)
    run_id: str | None = Field(default=None, min_length=1)
    before_tokens: int | None = Field(default=None, ge=0)
    after_tokens: int | None = Field(default=None, ge=0)
    count: int | None = Field(default=None, ge=0)
    window_from: int | None = Field(default=None, ge=1)
    window_to: int | None = Field(default=None, ge=1)
    reload_ms: int | None = Field(default=None, ge=0)
    room: int | None = Field(default=None, ge=1)


class TraceGetResult(BaseModel):
    """Runs of a session, oldest first.

    The tree is run, then model call, then tool call. A client picks a span
    by ``id`` and loads it with ``trace.span``. ``context_events`` are the
    session's ``context.changed`` events, oldest first.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    title: str | None = None
    runs: list[TraceRunSpan]
    context_events: list[TraceContextEvent] = Field(default_factory=list[TraceContextEvent])


class TraceSpanParams(BaseModel):
    """``trace.span``. Read the full input and output of one model or tool span."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    span_id: str = Field(min_length=1)


class TraceContextItem(BaseModel):
    """One tool or one prompt section, with its share of the tokens."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)
    group: str | None = None
    tokens: int = Field(ge=0)


class TraceContextPart(BaseModel):
    """One kind of content in the context."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    key: Literal["system", "tools", "user", "assistant", "tool_results", "summary"]
    tokens: int = Field(ge=0)
    chars: int = Field(ge=0)
    items: list[TraceContextItem] = Field(default_factory=list[TraceContextItem])


class TraceContextCleared(BaseModel):
    """Tool results the call sent as a one-line stub, and the tokens that saved."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    count: int = Field(default=0, ge=0)
    tokens: int = Field(default=0, ge=0)


class TraceContext(BaseModel):
    """What filled one model call's context, and how big the window was.

    ``parts`` always has the six keys, in order. ``summary`` is the summary of old turns
    that was sent as the first message, and 0 when none was. They add up to ``used``
    when it is known. The split between them is an estimate (about four
    characters a token, scaled to ``used``), so ``estimated`` is always true.
    The ``prompt_cut`` fields are those of the model span. A cleared result counts as its
    stub in ``tool_results``, and ``cleared`` says how many there were and the tokens
    not sent because of it.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    used: int | None = Field(default=None, ge=0)
    window: int | None = Field(default=None, ge=1)
    window_estimated: bool = False
    num_ctx: int | None = Field(default=None, ge=1)
    estimated: bool = True
    parts: list[TraceContextPart]
    prompt_cut: Literal["no", "yes", "likely"] | None = None
    prompt_cut_kind: Literal["older_messages", "middle"] | None = None
    dropped_message_ids: list[str] = Field(default_factory=list[str])
    dropped_tokens: int | None = Field(default=None, ge=0)
    cleared: TraceContextCleared = Field(default_factory=TraceContextCleared)
    window_planned: bool = False
    reserve: int | None = Field(default=None, ge=0)
    """Tokens kept free for the reply (``reply_reserve``). Null when the window is unknown."""


class TraceMessage(BaseModel):
    """One checkpoint message with its id, as plain text."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str | None = None
    role: Literal["user", "assistant", "tool"]
    text: str
    tool_calls: list[dict[str, Any]] = Field(default_factory=list[dict[str, Any]])
    call_id: str | None = None
    tokens: int | None = Field(default=None, ge=0)
    original: str | None = None
    """For a tool result sent as a stub, ``text`` is the stub and this is the full result."""


class TraceSpanResult(BaseModel):
    """What a span took in and gave out. ``span`` has no children.

    For a model span, ``messages`` is the context sent, in order, and
    ``new_from`` is where the part new since the previous model call
    begins. ``system_prompt`` and ``tools`` are null when they were not
    recorded. For a tool span, ``result`` is the text the model got back, and
    ``artifact_id`` is set when the output was too big for the model: open it
    with ``artifact.read``. ``context`` is set for every model span, and
    ``system_sections`` is null when the call recorded none. ``text_tool_calls``
    is what ``model.call.completed`` said about a tool call written as text.
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
    text_tool_calls: Literal["recovered", "unread"] | None = None
    provider: str | None = None
    context: TraceContext | None = None
    system_sections: list[PromptSectionInfo] | None = None
    summary_of: int | None = Field(default=None, ge=0)
    """For a model span that was sent a summary, how many earlier messages it stands for."""


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


class ModelSpeedInfo(BaseModel):
    """Typical speed of a local model: the median of its recent calls.

    From the model server's own clock. ``samples`` is how many calls it rests on.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    prompt_tps: float | None = Field(default=None, ge=0)
    reply_tps: float | None = Field(default=None, ge=0)
    samples: int = Field(ge=0)


class ModelScoreInfo(BaseModel):
    """How a model did on this Mac, from real use.

    ``tool_score`` is the share of its last 200 tool calls that were valid, or null with
    fewer than 20. ``calls`` is its model calls, ``runs`` the runs that used it, ``stepped_up``
    the runs that left it for a stronger model, and ``retried`` the answers the user asked a
    stronger model to redo.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    tool_score: float | None = Field(default=None, ge=0, le=1)
    calls: int = Field(ge=0)
    runs: int = Field(ge=0)
    stepped_up: int = Field(ge=0)
    retried: int = Field(ge=0)
    tool_calls: int = Field(ge=0)


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
    ``recommended_for`` lists the categories this catalog model is the pick for on
    this Mac: the largest model of that category it has the memory for.
    ``think_values`` is what the ``think`` option takes for this model: ``off`` and
    ``on``, or ``low``, ``medium`` and ``high``. It is empty when the model cannot think.
    ``tier`` is ``local`` for Ollama, ``budget`` for a hosted model whose blended price is at
    or below ``[routing] budget_max_price``, and ``frontier`` otherwise.
    ``stale`` means a cached list was shown because the provider did not
    answer in time. ``speed`` is set for a local model golem has timed. ``score`` is set
    for a model golem has used on this Mac. ``starred`` is true for a model in the model menu:
    in ``[model_menu] starred``, or, while that key is unset, a curated hosted model or an
    installed local one.
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
    recommended_for: list[ModelCategory] = Field(default_factory=list[ModelCategory])
    think_values: list[str] = Field(default_factory=list[str])
    tier: Literal["local", "budget", "frontier"]
    speed: ModelSpeedInfo | None = None
    score: ModelScoreInfo | None = None
    starred: bool = False


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
    chosen. ``ollama_stray`` is true when a local Ollama answers but no
    ``ollama`` binary is installed: a server left from a removed install, which
    lists its models and cannot load them. It is then neither installed nor
    running here.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    ollama_installed: bool
    ollama_running: bool
    ollama_stray: bool = False
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


class ModelOption(BaseModel):
    """One row of the option table: what an option may be, and what it does.

    ``kind`` ``duration`` is a time such as ``5m``, or a number of seconds, and
    ``-1`` for always. ``choice`` is one of ``values``, which are the values this
    model takes, and has no range. ``default`` is Ollama's own, and ``None`` when
    it has none, as for the seed and for ``think``.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)
    label: str = Field(min_length=1)
    kind: Literal["float", "int", "duration", "choice"]
    minimum: float | None = None
    maximum: float | None = None
    step: float | None = Field(default=None, gt=0)
    values: list[str] = Field(default_factory=list[str])
    default: float | str | None = None
    short: str = Field(min_length=1)
    long: str = Field(min_length=1)


class ModelOptionsGetParams(BaseModel):
    """``model.options.get``. The option table and the values one model has.

    ``model`` is an Ollama name such as ``qwen3:8b``, or ``ollama/qwen3:8b``.
    With ``session_id`` the result also has that session's overrides.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    model: str = Field(min_length=1)
    session_id: str | None = Field(default=None, min_length=1)


class ModelMemory(BaseModel):
    """What a client needs to say whether a ``num_ctx`` fits in this machine's memory.

    A model needs ``size_gb``, plus ``kv_gb_per_1k_tokens`` for each 1024 tokens of
    context, plus ``overhead_gb``. It ``fits`` when that is at most ``fits_share`` of
    ``ram_gb``, is ``tight`` up to ``tight_share``, and is too big beyond.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    ram_gb: float = Field(gt=0)
    size_gb: float = Field(ge=0)
    kv_gb_per_1k_tokens: float = Field(ge=0)
    overhead_gb: float = Field(ge=0)
    fits_share: float = Field(gt=0)
    tight_share: float = Field(gt=0)


class ModelOptionsGetResult(BaseModel):
    """The table, and each option's value from the model's own default up.

    ``defaults`` are the model's own values from Ollama, and Ollama's for what the
    model leaves out. ``saved`` is what ``model.options.set`` stored for the model.
    ``session`` is the session's overrides, or ``None`` when no session was asked for.
    The value in use is the session's, else the saved, else the default. ``memory`` is
    ``None`` when golem does not know the RAM or the installed model's size.
    ``default_from`` says where a default came from when it is not Ollama's fixed one:
    ``modelfile`` for the model's own, ``ollama`` for the window Ollama gave the model
    on a call that sent no ``num_ctx``. ``num_ctx`` has no default until one of the two
    is known. ``golem`` is the window golem plans for the model, which it sends when nothing
    else sets ``num_ctx``.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    model: str = Field(min_length=1)
    options: list[ModelOption]
    defaults: dict[str, float | str]
    default_from: dict[str, Literal["modelfile", "ollama", "golem"]] = Field(default_factory=dict)
    saved: dict[str, float | str]
    session: dict[str, float | str] | None = None
    memory: ModelMemory | None = None


class ModelOptionsSetParams(BaseModel):
    """``model.options.set``. Save options for a model in the user's ``config.toml``.

    A value of ``null`` removes that option, so the model's default applies again.
    Options not named stay as they are. The values are checked against the table.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    model: str = Field(min_length=1)
    options: dict[str, float | str | None]


class ModelOptionsSetResult(BaseModel):
    """What is saved for the model now."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    model: str = Field(min_length=1)
    saved: dict[str, float | str]


class ModelOptionsSaved(BaseModel):
    """The options saved for a model changed. ``saved`` is what is saved for it now."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    model: str = Field(min_length=1)
    saved: dict[str, float | str]


class SessionSetOptionsParams(BaseModel):
    """``session.set_options``. Override options for one session only.

    A value of ``null`` removes that override. Options not named stay as they are.
    The daemon emits ``model.options.changed``, and the overrides apply from the
    session's next run. They are kept with the session, and are not written to
    ``config.toml``.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    options: dict[str, float | str | None]


class SessionSetOptionsResult(BaseModel):
    """The session's overrides now."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    options: dict[str, float | str]


class SessionSetModeParams(BaseModel):
    """``session.set_mode``. Set the permission mode of one session.

    ``mode`` ``null`` removes the session's override, so it follows
    ``[permissions] mode`` in ``config.toml`` again. The daemon emits
    ``session.mode.changed``, and the mode applies from the session's next tool
    call. It is kept with the session and is not written to ``config.toml``.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    mode: PermissionMode | None


class SessionSetModeResult(BaseModel):
    """The mode the session runs in now.

    ``mode`` is the effective mode, and ``override`` is true when the session
    set it, false when it is the default from ``config.toml``.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    mode: PermissionMode
    override: bool


class SessionSetRouteParams(BaseModel):
    """``session.set_route``. Set how this session picks the model of each turn.

    ``pinned`` runs the session's own model. ``local`` never uses a hosted model.
    ``auto`` starts local and uses a hosted model only when the routing rules allow
    it (ADR-055). The daemon emits ``session.updated`` with ``route``, and the mode
    applies from the session's next turn. It is kept with the session and is not
    written to ``config.toml``.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    mode: RouteMode


class SessionSetRouteResult(BaseModel):
    """The session's route mode after the change."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    mode: RouteMode


class SessionCompactParams(BaseModel):
    """``session.compact``. Shrink what the next model call sends, between turns.

    ``clear`` sends all but the newest tool results as one line each. ``summarise`` replaces
    the old turns with a summary written by the ``summarise`` role's model, and ``focus``, when
    given, says what the summary must keep. Nothing is deleted from the session: only the
    context view changes. The call can take a minute with a local model, and other requests
    go on meanwhile. Error ``-32004`` when the session has a run or is compacting.

    ``grow`` moves the planned window of a local model up one step, which the next turn's first
    call loads. It needs no test of how full the context is. Error ``-32602`` with the reason
    when this Mac cannot hold a larger window, or the window is set by the user.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    action: Literal["clear", "summarise", "grow"]
    focus: str | None = None


class SessionCompactResult(BaseModel):
    """What the compaction did.

    ``count`` is the tool results cleared, or the turns summarised, and 0 when there was
    nothing to do (``before_tokens`` and ``after_tokens`` are then equal, and no event is
    stored). ``window`` is the tokens the history may fill (the model's window less the
    reply reserve), None when it is unknown. ``model`` is the model that wrote a summary, or
    the model whose window ``grow`` moved. For ``grow``, ``count`` is 0, ``window_from`` and
    ``window_to`` are the planned windows before and after, and ``window`` is the room of the
    new one. Both are None for the other actions.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    before_tokens: int = Field(ge=0)
    after_tokens: int = Field(ge=0)
    count: int = Field(ge=0)
    window: int | None = Field(default=None, ge=1)
    model: str | None = None
    window_from: int | None = Field(default=None, ge=1)
    window_to: int | None = Field(default=None, ge=1)


class SessionSetChecksParams(BaseModel):
    """``session.set_checks``. Say whether golem may run the project's checks in this session.

    ``on`` true lets it run them after a turn that changed files, false stops
    it. The daemon emits ``session.checks.changed``. The answer is kept with
    the session and is not written to ``config.toml``. It matters when
    ``[coding] checks`` is ``ask``, and ``auto`` follows it only for a no.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    on: bool


class SessionSetChecksResult(BaseModel):
    """The session's answer after the change."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    on: bool


class SessionSetPlanParams(BaseModel):
    """``session.set_plan``. Put one session in plan first, or take it out.

    With ``on`` true the session's runs only read, and each ends with a plan
    sent as ``plan.proposed``. The daemon emits ``session.plan.changed``. It
    applies from the session's next turn, is kept with the session, and is
    not written to ``config.toml``. A new session starts with it off.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    on: bool


class SessionSetPlanResult(BaseModel):
    """Whether the session is in plan first after the change."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    on: bool


class PermissionsSetModeParams(BaseModel):
    """``permissions.set_mode``. Write ``[permissions] mode`` to the user's ``config.toml``.

    New sessions start in it, and a session that set no mode of its own follows it.
    Comments and the rest of the file stay as they are. A file that changed on disk
    while it was being written is refused.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    mode: PermissionMode


class PermissionsSetModeResult(BaseModel):
    """The default mode as stored, and the file it was written to."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    mode: PermissionMode
    path: str


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


class ModelStarParams(BaseModel):
    """``model.star``. Star a model for the model menu, or take its star away.

    The first change writes the whole list to ``[model_menu] starred``. A ref no provider lists
    can be starred: it shows as not ready.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    ref: str = Field(min_length=3)
    starred: bool


class ModelStarResult(BaseModel):
    """``starred`` is the list as stored, in order."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    starred: list[str]


class ModelScoreResetParams(BaseModel):
    """``model.score_reset``. Start a model's score from nothing.

    The score ignores the model's calls before now. Usage rows stay.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    ref: str = Field(min_length=3)


class ModelScoreResetResult(BaseModel):
    """``ref`` is the model whose score was reset."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    ref: str = Field(min_length=3)


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


class HfSearchParams(BaseModel):
    """``hf.search``. Look for GGUF models on Hugging Face. Only the query leaves this Mac.

    An empty ``query`` lists the most downloaded GGUF repos. A pasted link such as
    ``https://huggingface.co/<user>/<repo>`` or ``hf.co/<user>/<repo>`` is read as that repo's id.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    query: str = ""
    limit: int = Field(default=20, ge=1, le=100)


class HfRepo(BaseModel):
    """One repo in a search. ``gated`` repos need a Hugging Face token to download."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(min_length=1)
    downloads: int = Field(ge=0)
    likes: int = Field(ge=0)
    updated: str | None = None
    gated: bool


class HfSearchResult(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    repos: list[HfRepo]


class HfFilesParams(BaseModel):
    """``hf.files``. List the sizes (quantizations) of one repo, with a fit check for this Mac."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    repo: str = Field(min_length=3)


class HfSize(BaseModel):
    """One quantization. ``files`` is the number of parts summed into ``size_gb``.

    ``fit`` is null when golem cannot tell how much memory this Mac has. ``recommended`` marks
    the size to pick: ``Q4_K_M`` when it fits, else the largest that fits. ``problem`` is set
    only when Hugging Face answered that a file the download needs is missing; it is never set
    on doubt.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    quant: str = Field(min_length=1)
    size_gb: float = Field(ge=0)
    files: int = Field(ge=1)
    fit: Literal["fits", "tight", "too_big"] | None = None
    recommended: bool
    problem: str | None = None


class HfFilesResult(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    repo: str = Field(min_length=3)
    sizes: list[HfSize]


class OllamaLibraryParams(BaseModel):
    """``ollama.library``. Names of the Ollama library that contain ``query``, best match first.

    ``query`` may be empty, and then every shipped name comes back. A ``:tag`` after the name is
    ignored for the match. The list ships with golem, so this needs no network, except for a full
    name that is not in it: then the registry is asked for that one manifest.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    query: str = ""


class OllamaLibrarySize(BaseModel):
    """One tag of a library name. ``fit`` is null when golem cannot tell this Mac's memory.

    ``recommended`` marks the largest size that fits. ``installed`` is true when Ollama has it.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    tag: str = Field(min_length=1)
    size_gb: float = Field(ge=0)
    fit: Literal["fits", "tight", "too_big"] | None = None
    recommended: bool
    installed: bool


class OllamaLibraryModel(BaseModel):
    """One library name with a one-line ``blurb`` (empty for a name found in the registry)."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)
    blurb: str
    sizes: list[OllamaLibrarySize]


class OllamaLibraryResult(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    models: list[OllamaLibraryModel]


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
    """A download ended. ``error`` says why when ``ok`` is false; ``cancelled`` for a stop.

    ``error`` is plain words. ``detail`` is Ollama's own text when it differs. ``leftover_gb`` is
    the size of downloaded parts that no model uses, when a failed download left 0.1 GB or more;
    ``model.pull_cleanup`` removes them.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    ref: str = Field(min_length=3)
    ok: bool
    error: str | None = None
    detail: str | None = None
    leftover_gb: float | None = Field(default=None, ge=0)


class ModelPullCleanupParams(BaseModel):
    """``model.pull_cleanup``. Remove the parts a failed download of ``ref`` left behind.

    Only the parts named in that download's ``leftover_gb`` go, and only while no model uses them
    and no download of ``ref`` runs.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    ref: str = Field(min_length=3)


class ModelPullCleanupResult(BaseModel):
    """``freed_gb`` is 0 when nothing was left to remove."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    ref: str = Field(min_length=3)
    freed_gb: float = Field(ge=0)


class ModelBenchParams(BaseModel):
    """``model.bench``. Measure how fast a local model answers at 1 to 4 calls at once.

    ``ref`` is a local model ref (``ollama/qwen3:8b``); a hosted ref is an error. ``engine`` names
    the server that runs it when more than one could. Each count's row arrives as
    ``model.bench.progress`` and the end as ``model.bench.done``.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    ref: str = Field(min_length=3)
    engine: str | None = Field(default=None, min_length=1)


class ModelBenchResult(BaseModel):
    """``started`` is false when this model was already being measured."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    ref: str = Field(min_length=3)
    started: bool


class ModelBenchRow(BaseModel):
    """One shape at one count. ``each`` is the tokens per second of each call, ``total`` their sum,
    ``window`` the seconds from the first start to the last end."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    shape: Literal["tools", "prompt"]
    at_once: int = Field(ge=1)
    each: list[float]
    total: float = Field(ge=0)
    window: float = Field(ge=0)


class ModelBenchProgress(BaseModel):
    """One row finished. ``index`` counts from 1 of ``total``."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    ref: str = Field(min_length=3)
    index: int = Field(ge=1)
    total: int = Field(ge=1)
    row: ModelBenchRow


class ModelBenchDone(BaseModel):
    """A run ended. ``error`` says why when ``ok`` is false, and then ``rows`` may be short."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    ref: str = Field(min_length=3)
    ok: bool
    error: str | None = None
    rows: list[ModelBenchRow] = Field(default_factory=list[ModelBenchRow])


class ModelCheckParams(BaseModel):
    """``model.check``. Run golem's tool-calling test against a model.

    ``name`` is a profile, a ref (``ollama/qwen3:8b``), or an Ollama name. Each case's result
    arrives as ``model.check.progress`` and the end as ``model.check.done``. No tool is run.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)


class ModelCheckResult(BaseModel):
    """``started`` is false when this model was already being checked."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    ref: str = Field(min_length=3)
    started: bool


class ModelCheckCase(BaseModel):
    """How one case went. ``recovered``: the model wrote its call as text and golem read it."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    outcome: Literal["pass", "fail", "recovered"]
    ms: int = Field(ge=0)
    detail: str | None = None


class ModelCheckProgress(BaseModel):
    """One case finished. ``index`` counts from 1 of ``total``."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    ref: str = Field(min_length=3)
    index: int = Field(ge=1)
    total: int = Field(ge=1)
    result: ModelCheckCase


class ModelCheckDone(BaseModel):
    """A check ended. ``error`` says why when ``ok`` is false, and then ``cases`` may be short.

    ``verdict`` is ``reliable``, ``usable`` or ``not_recommended``. ``cost_usd`` is set for a
    model with a price, from the calls' usage.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    ref: str = Field(min_length=3)
    ok: bool
    error: str | None = None
    cases: list[ModelCheckCase] = Field(default_factory=list[ModelCheckCase])
    passed: int = Field(default=0, ge=0)
    recovered: int = Field(default=0, ge=0)
    total: int = Field(default=0, ge=0)
    verdict: Literal["reliable", "usable", "not_recommended"] | None = None
    cost_usd: float | None = Field(default=None, ge=0)


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
    the frontmatter as written. ``indexed`` is true when the skill is in the
    skill index of the system prompt: false for a skill the model may not
    load, and for one dropped because the index is over ``[skills]
    index_budget``.
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
    indexed: bool = False
    argument_hint: str | None = None
    allowed_tools: list[str] = Field(default_factory=list[str])
    model: str | None = None


class SkillListResult(BaseModel):
    """Every skill found, highest source first, winners and losers."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    skills: list[ListedSkill]


class SkillReadParams(BaseModel):
    """``skill.read``. The ``SKILL.md`` of the skill called ``name`` that a session in ``cwd`` sees.

    The usable skill of that name is read, or the first one listed when none is usable.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)
    cwd: str | None = Field(default=None, min_length=1)


class SkillReadResult(BaseModel):
    """The file's path and text, and its ``mtime_ns`` for a later ``skill.write``."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    path: str
    text: str
    mtime_ns: int
    source: SkillSource


class SkillWriteParams(BaseModel):
    """``skill.write`` and ``skill.write_protected``. Check a new ``SKILL.md``, and write it.

    ``path`` is a ``SKILL.md`` in a folder ``skill.list`` shows for ``cwd``,
    never a bundled one. ``base_mtime_ns`` is the ``mtime_ns`` the text was read
    at: a file changed since is refused. ``dry_run`` checks and writes nothing.
    ``skill.write`` refuses a project skill unless ``cwd`` is a trusted project;
    ``skill.write_protected``, which only a local client may call, does not.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    path: str = Field(min_length=1)
    text: str
    base_mtime_ns: int
    cwd: str | None = Field(default=None, min_length=1)
    dry_run: bool = False


class SkillIssue(BaseModel):
    """One problem in a ``SKILL.md``. ``line`` counts from 1, when known."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    line: int | None = Field(default=None, ge=1)
    message: str


class SkillWriteResult(BaseModel):
    """What the check found, and whether the file was written.

    ``ok`` is false when the write was refused because the file changed since it was
    read, and ``errors`` then says so. A text with errors is still written unless
    ``dry_run`` is set, and then lists as broken. ``mtime_ns`` is the file's now.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    ok: bool
    written: bool
    errors: list[SkillIssue] = Field(default_factory=list[SkillIssue])
    warnings: list[SkillIssue] = Field(default_factory=list[SkillIssue])
    mtime_ns: int | None = None


class SkillCreateParams(BaseModel):
    """``skill.create`` and ``skill.create_protected``. Make ``<folder>/<name>/SKILL.md``.

    ``scope = "user"`` is ``~/.golem/skills``. ``"project"`` is ``<cwd>/.agents/skills``
    and needs ``cwd``. ``skill.create`` refuses a project that is not trusted;
    ``skill.create_protected``, which only a local client may call, does not.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)
    scope: Literal["user", "project"]
    cwd: str | None = Field(default=None, min_length=1)
    description: str = Field(min_length=1)
    model_invocable: bool = True


class SkillCreateResult(BaseModel):
    """The new ``SKILL.md``'s path and ``mtime_ns``."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    path: str
    mtime_ns: int


class SkillSetDisabledParams(BaseModel):
    """``skill.set_disabled``. Add or remove ``name`` in ``[skills] disabled``."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)
    disabled: bool


class SkillSetDisabledResult(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str
    disabled: bool


class AgentRegistryChanged(BaseModel):
    """Agent type files changed on disk. List them again for the folders it covers.

    ``root`` is the session folder whose project agents changed. ``None`` means the
    user's or golem's agents, or ``[agents]`` in ``config.toml``, changed, which every
    folder sees.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    root: str | None = None


class WishResolution(BaseModel):
    """What a type's wish becomes in this setup.

    ``model`` is the model the wish picks now and ``tier`` its tier. ``reason`` is one plain
    line on why, at most 200 characters. ``fresh_window`` is true when the helper starts
    with an empty context window on that model. Every field may be left out.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    model: str | None = Field(default=None, min_length=1, max_length=200)
    tier: Literal["local", "budget", "frontier"] | None = None
    reason: str | None = Field(default=None, min_length=1, max_length=200)
    fresh_window: bool | None = None


class _AgentFields(BaseModel):
    """The fields of an agent type that every agent result has. See :class:`AgentInfo`."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)
    description: str
    origin: AgentOrigin
    wish: str = Field(min_length=1)
    tools: list[str] = Field(default_factory=list[str])
    limits: AgentLimits = Field(default_factory=AgentLimits)
    asks: bool = False
    errors: list[str] = Field(default_factory=list[str])
    shadowed: list[AgentOrigin] = Field(default_factory=list[AgentOrigin])
    trusted: bool = True
    used: int = Field(default=0, ge=0)
    finished: int | None = Field(default=None, ge=0)
    resolves_to: WishResolution | None = None
    path: str | None = None
    text: str | None = None
    changing_tools: list[str] = Field(default_factory=list[str])
    unavailable: str | None = None
    stopped: int | None = Field(default=None, ge=0)
    cost_usd: float | None = Field(default=None, ge=0)
    limits_from_config: list[str] = Field(default_factory=list[str])


class AgentInfo(_AgentFields):
    """One agent type: an ``agents/<name>.md`` file, valid or not.

    ``wish`` is the model wish as written: ``cheapest``, ``same``, ``stronger``, a tier
    or a model. ``tools`` are the tool names the helper may use, empty for none. ``asks``
    is true when the helper may ask you a question. ``errors`` are what is wrong with
    the file: a type with errors is never the one a name resolves to. ``shadowed`` lists
    the origins of lower files of the same name that this one hides. ``trusted`` is
    false for a project agent in a folder that is not trusted, which is listed and
    never started. ``used`` and ``finished`` count helpers of this type started and
    ended in the last 30 days (``helper.ended``). ``finished`` is ``None`` when the
    daemon cannot count them. ``stopped`` counts the ones of the last 30 days that ended
    early, for any reason other than done; ``None`` when the daemon cannot count them.
    ``cost_usd`` is what those helpers cost in the same days; ``None`` when the daemon
    cannot say. ``resolves_to`` is what ``wish`` becomes in this setup; ``None`` when the
    daemon does not say.

    ``path`` is the agent's file: ``~`` stands for the home folder, a bundled file is its
    package path (``golem/agents/bundled/explorer.md``) and a project file is relative to the
    project. ``text`` is the whole file as written and ``prompt`` is its body. Both are
    ``None`` for a project agent in a folder that is not trusted. ``changing_tools`` are the
    ``tools`` that change things; the rest only read. ``unavailable`` says in plain words why
    the agent cannot be started now, the same text ``delegate`` refuses with, and is ``None``
    when it can. An older daemon leaves out every field from ``resolves_to`` on.

    ``limits`` are the limits a helper of this type runs with now: ``[agents.<name>]`` of
    ``config.toml`` first, then the file, then ``[agents]``, then the built-in default. The file
    itself, in ``text``, is unchanged. ``limits_from_config`` names the limits that
    ``[agents.<name>]`` sets, among ``max_calls``, ``max_seconds``, ``max_cost_usd``,
    ``max_tokens`` and ``answer_chars``; it is empty for a type that has no such table.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    prompt: str | None = None


class AgentsListParams(BaseModel):
    """``agents.list``. The agent types a session in ``cwd`` sees, or the user's without it."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    cwd: str | None = Field(default=None, min_length=1)


class AgentsListResult(BaseModel):
    """Every agent type found, highest origin first."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    agents: list[AgentInfo]


class AgentsGetParams(BaseModel):
    """``agents.get``. The agent type called ``name`` that a session in ``cwd`` sees."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)
    cwd: str | None = Field(default=None, min_length=1)


class AgentsGetResult(_AgentFields):
    """The agent type and its prompt, the body of its file. ``prompt`` is empty when held back."""

    prompt: str


class AgentsSetWishParams(BaseModel):
    """``agents.set_wish``. Set the model wish of the agent type ``name``.

    ``wish`` is ``cheapest``, ``same``, ``stronger``, a tier or a model name.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)
    wish: str = Field(min_length=1, max_length=200)
    cwd: str | None = Field(default=None, min_length=1)


class AgentsSetWishResult(AgentInfo):
    """The agent type after the change."""


AgentLimitKey = Literal["max_calls", "working_seconds", "max_cost", "max_tokens"]
"""The limits of one helper that ``config.toml`` can set: the keys of ``[agents]`` and
``[agents.<name>]``."""


class AgentsSetLimitsParams(BaseModel):
    """``agents.set_limits``. Set or clear limits of the helpers of the agent type ``name``.

    A limit that is sent is set, and a key named in ``clear`` is removed so that the next place
    in the order applies again. A key that is in neither is left alone. A key in both is
    refused. For a built-in type the keys go in ``[agents.<name>]`` of ``config.toml``; for one
    of your own files they are the front matter lines ``max-calls``, ``max-seconds``,
    ``max-cost-usd`` and ``max-tokens``, and the same keys are then removed from
    ``[agents.<name>]`` of ``config.toml`` when your file has a built-in type's name, since that
    table would win over the file. A project agent is read-only here. ``max_calls`` and
    ``working_seconds`` are 1 or more, ``max_tokens`` is 1 or more, ``max_cost`` (US dollars) is
    0 or more, and the explorer's ``max_calls`` is at most 50. Nothing is written when one is
    wrong.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)
    cwd: str | None = Field(default=None, min_length=1)
    max_calls: int | None = None
    working_seconds: int | None = None
    max_cost: float | None = None
    max_tokens: int | None = None
    clear: list[AgentLimitKey] = Field(default_factory=list[AgentLimitKey])


class AgentsSetLimitsResult(AgentInfo):
    """The agent type after the change."""


class AgentsSetDefaultLimitsParams(BaseModel):
    """``agents.set_default_limits``. Set or clear the limits in ``[agents]`` that bound every
    helper its own table and its file leave open.

    ``clear`` works as in :class:`AgentsSetLimitsParams`. Answers with ``ok`` false and the
    wrong field when a value is out of range, and nothing is written.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    max_calls: int | None = None
    working_seconds: int | None = None
    max_cost: float | None = None
    max_tokens: int | None = None
    clear: list[AgentLimitKey] = Field(default_factory=list[AgentLimitKey])


class AgentsSaveParams(BaseModel):
    """``agents.save``. Save the text of a user agent file, and only when it is a good one.

    ``text`` is the whole file. ``name`` is the user agent it replaces; leave it out for a
    new agent. The name written inside ``text`` decides the file, ``~/.golem/agents/<name>.md``:
    when it differs from ``name``, the old file is removed, which is a rename. A name that
    another file of the user's already has is refused. The text is read by the parser the
    registry uses, and when it has problems nothing is written.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    text: str
    name: str | None = Field(default=None, min_length=1)
    cwd: str | None = Field(default=None, min_length=1)


class AgentsSaveProblem(BaseModel):
    """One thing wrong with a text. ``line`` is its line in the text, counted from 1, when
    the problem is in a frontmatter key; ``None`` when it is not about one line."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    message: str
    line: int | None = Field(default=None, ge=1)


class AgentsSaveResult(BaseModel):
    """``ok`` is false when the text was not saved: ``problems`` says why and no file changed.
    ``agent`` is the saved agent, set when ``ok``."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    ok: bool
    problems: list[AgentsSaveProblem] = Field(default_factory=list[AgentsSaveProblem])
    agent: AgentInfo | None = None


class AgentsCopyParams(BaseModel):
    """``agents.copy``. Copy the bundled agent ``name``, unchanged, to
    ``~/.golem/agents/<name>.md``. Refused when the user already has a file of that name."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)
    cwd: str | None = Field(default=None, min_length=1)


class AgentsCopyResult(AgentInfo):
    """The new user agent. ``shadowed`` shows ``bundled``."""


class AgentsDeleteParams(BaseModel):
    """``agents.delete``. Remove the user's file ``~/.golem/agents/<name>.md``. A bundled or
    project agent is refused."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)
    cwd: str | None = Field(default=None, min_length=1)


class AgentsDeleteResult(BaseModel):
    """``agent`` is the type the name means now, such as the bundled one that the deleted file
    hid, or ``None`` when no agent has the name any more."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    agent: AgentInfo | None = None


class HelperStopParams(BaseModel):
    """``helper.stop``. Cancel the run of a helper session.

    The lead goes on with ``stopped: cancelled`` as the helper's result (ADR-059).
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)


class HelperStopResult(BaseModel):
    """Whether a run was stopped.

    ``stopped`` is false when the helper had no run in progress.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    stopped: bool


class HelperApplyParams(BaseModel):
    """``helper.apply``. Take a worker's diff into the project.

    ``session_id`` is the lead's session and ``helper_id`` the worker's. The result lists the
    changes it wrote, and the lead's log gets ``helper.applied``. When a file changed in the
    project since the worker copied it, nothing is written and the call fails with the error
    code ``HELPER_CONFLICT`` (-32027), whose ``data`` names the ``path`` of the first file.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    helper_id: str = Field(min_length=1)


class HelperApplyResult(BaseModel):
    """The changes the diff wrote, in the order they were made."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    change_ids: list[str]


class HelperDiscardParams(BaseModel):
    """``helper.discard``. Drop a worker's diff and remove its copy.

    The lead's log gets ``helper.discarded``.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    helper_id: str = Field(min_length=1)


class HelperDiscardResult(BaseModel):
    """Nothing to report: the diff is gone."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class HelperRetryParams(BaseModel):
    """``helper.retry``. Run a worker's brief again on a stronger model ("Try again, stronger").

    The new helper is a sibling of the old one in the same ``delegate`` call. ``model`` has one
    value for now, ``stronger``: the daemon picks the model.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    helper_id: str = Field(min_length=1)
    model: Literal["stronger"]


class HelperRetryResult(BaseModel):
    """``helper_id`` is the session id of the new helper."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    helper_id: str = Field(min_length=1)


DeviceId = Annotated[str, Field(pattern=r"^[0-9a-f]{32}$")]
"""A device id: the first 16 bytes of the SHA-256 of its public key, in 32 lowercase hex."""

B64Message = Annotated[str, Field(min_length=1, max_length=65536, pattern=r"^[A-Za-z0-9_-]+$")]
"""Bytes of any length, base64url without padding (ADR-051, The wire in detail)."""

B64Key32 = Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{43}$")]
"""32 bytes (an X25519 key or a shared secret), base64url without padding."""

B64Key65 = Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{87}$")]
"""65 bytes (an uncompressed P-256 public key), base64url without padding."""

B64Key16 = Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{22}$")]
"""16 bytes (a pairing code), base64url without padding."""

B64Sig64 = Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{86}$")]
"""64 bytes (a raw ``r || s`` ECDSA signature), base64url without padding."""


class RelaySignParams(BaseModel):
    """``relay.sign``. The gateway asks the daemon to sign with the Mac's relay key.

    ``message`` is bytes. The daemon signs only a message that starts with
    ``golem-relay-v1\\0``, so the gateway cannot use the key for anything else. ``local``: only
    the gateway, on the Unix socket.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    message: B64Message


class RelaySignResult(BaseModel):
    """``sig`` is the 64-byte ECDSA P-256 signature, raw ``r || s``."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    sig: B64Sig64


class RelayDhParams(BaseModel):
    """``relay.dh``. A Diffie-Hellman of the Mac's Noise key with ``public_key``, an X25519 key."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    public_key: B64Key32


class RelayDhResult(BaseModel):
    """``shared`` is the 32-byte result. The daemon refuses a result of all zeros."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    shared: B64Key32


class DeviceSyncParams(BaseModel):
    """``device.sync``. What the gateway needs to serve phones. No params."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class RelayDevice(BaseModel):
    """A paired device that is not revoked: its id and its 65-byte public key."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: DeviceId
    key: B64Key65


class RelayPair(BaseModel):
    """An open pairing slot: ``SHA-256(code)`` and its expiry in unix seconds."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    slot: Annotated[str, Field(min_length=1)]
    exp: int = Field(ge=0)


class DeviceSyncResult(BaseModel):
    """The relay settings and the allow list.

    ``url`` is ``[relay] url``, or null when it is not set. ``room`` is the Mac's room id,
    the SHA-256 of ``mac_key``. ``noise_key`` is the public half of the Mac's Noise key.
    ``seq`` grows by one with each change and is the ``seq`` of the relay's ``allow``
    message. ``devices`` leaves out a revoked device.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    url: str | None = None
    room: B64Key32
    mac_key: B64Key65
    noise_key: B64Key32
    seq: int = Field(ge=0)
    devices: list[RelayDevice]
    pairs: list[RelayPair]


class ConnectionIdentifyParams(BaseModel):
    """``connection.identify``. The gateway names the device on this connection."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    device: DeviceId


class ConnectionIdentifyResult(BaseModel):
    """Empty. An unknown or revoked device gets an error instead."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class DeviceChanged(BaseModel):
    """The registry, the open pairings, or ``[relay] url`` changed. Call ``device.sync`` again."""

    model_config = ConfigDict(extra="forbid", frozen=True)


PairState = Literal["waiting", "words", "paired", "expired", "refused"]
"""Where a pairing stands: the QR is up (``waiting``), a phone showed the right code and the
owner compares ``words`` (``words``), the phone is stored (``paired``), or it ended."""


class DeviceInfo(BaseModel):
    """One phone in the registry. A revoked one stays, with ``revoked_at`` set.

    ``rules`` counts the "Always allow" rules the phone made, which stay after a revoke.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: DeviceId
    name: str
    paired_at: str
    last_seen: str | None = None
    revoked_at: str | None = None
    rules: int = Field(default=0, ge=0)


class DeviceListParams(BaseModel):
    """``device.list``. No params."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class DeviceListResult(BaseModel):
    """Every device, revoked ones last."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    devices: list[DeviceInfo]


class DevicePairBeginParams(BaseModel):
    """``device.pair.begin``. Opens a pairing. Only one is open at a time: it replaces the old."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class DevicePairBeginResult(BaseModel):
    """``uri`` is the ``golem://pair`` link for the QR code. It holds the one-time code, so
    show it and do not log it. ``expires_at`` is in unix seconds. ``pair`` names this pairing
    in ``device.pair.changed`` and ``device.pair.confirm``.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    pair: Annotated[str, Field(min_length=1, max_length=64)]
    uri: str
    expires_at: int = Field(ge=0)


class DevicePairRequestParams(BaseModel):
    """``device.pair.request``. The gateway has verified the phone's signature over the
    handshake and computed ``words`` from the handshake hash. The daemon checks ``code``.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    code: B64Key16
    key: B64Key65
    name: Annotated[str, Field(max_length=64)]
    model: Annotated[str, Field(max_length=64)] = ""
    words: Annotated[list[str], Field(min_length=3, max_length=3)]


class DevicePairRequestResult(BaseModel):
    """The code was right and is spent. The owner now compares ``words``."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    pair: str


class DevicePairConfirmParams(BaseModel):
    """``device.pair.confirm``. ``accept`` false refuses the phone, or cancels a pairing
    that no phone has joined.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    pair: str
    accept: bool = True


class DevicePairConfirmResult(BaseModel):
    """``device`` is the stored phone when accepted, else null."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    device: DeviceInfo | None = None


class DeviceRenameParams(BaseModel):
    """``device.rename``."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    device: DeviceId
    name: Annotated[str, Field(min_length=1, max_length=64)]


class DeviceRenameResult(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    device: DeviceInfo


class DeviceRule(BaseModel):
    """A rule a phone wrote with "Always allow", and when."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    rule: str
    at: str


class DeviceRevokeParams(BaseModel):
    """``device.revoke``."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    device: DeviceId


class DeviceRevokeResult(BaseModel):
    """``revoked`` is false when the device was already revoked. ``rules`` stay in Tool rules."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    device: DeviceInfo
    revoked: bool
    rules: list[DeviceRule]


class PairingDevice(BaseModel):
    """What the phone says about itself. Untrusted text, shown as plain text."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: DeviceId
    name: str
    model: str = ""


class DevicePairChanged(BaseModel):
    """A pairing moved on. ``words`` and ``device`` come with ``words`` and ``paired``."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    pair: str
    state: PairState
    words: list[str] | None = None
    device: PairingDevice | None = None


RoutineSource = Literal["user", "project"]
"""Where a routine is written: the user's ``config.toml``, or a project's."""

RoutineRunStatus = Literal[
    "queued", "running", "waiting", "succeeded", "failed", "skipped", "cancelled"
]
"""``waiting`` is never stored: it is a running session that waits for an answer."""

RoutineTrigger = Literal["schedule", "watch", "manual", "hook"]


class RoutineWatchConfig(BaseModel):
    """``on = { watch, glob }``: a new file in ``watch`` that matches ``glob``."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    watch: str = Field(min_length=1)
    glob: str = Field(default="*", min_length=1)


class RoutineConfig(BaseModel):
    """One ``[[routine]]`` as written. The daemon checks it when it loads.

    Exactly one of ``schedule`` and ``on`` is set, and exactly one of ``prompt`` and
    ``workflow``. ``workflow`` names a workflow to start, with ``inputs`` (a watch routine
    also passes ``path``); it takes no ``folder``, ``model`` or ``mcp``. ``schedule`` is cron, or
    ``every 15m``, ``every 1h``, ``daily 08:30``, ``weekdays 08:30``, ``weekly mon 06:00``.
    ``missed`` is what happens to a firing that came due while golem could not
    run it: ``skip`` drops it, ``run_once`` fires it once, late.
    ``notify_finished`` and ``notify_failed`` override the notification settings
    for this routine, and null keeps them.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)
    schedule: str | None = None
    on: RoutineWatchConfig | None = None
    prompt: str | None = Field(default=None, min_length=1)
    workflow: str | None = Field(default=None, min_length=1)
    inputs: dict[str, str | int | float | bool] = Field(
        default_factory=dict[str, str | int | float | bool]
    )
    folder: str | None = None
    model: str | None = None
    mcp: list[str] = Field(default_factory=list[str])
    missed: Literal["skip", "run_once"] = "skip"
    enabled: bool = True
    notify_finished: bool | None = None
    notify_failed: bool | None = None


class RoutineRunSummary(BaseModel):
    """One firing of a routine: a ``routine_run`` (ADR-050).

    The times are ISO 8601 with an offset. ``reason`` says why a firing was
    ``skipped``: ``missed``, ``paused``, ``untrusted``, ``still running`` or ``quiet``.
    ``scope`` is ``user`` or the project folder. ``summary`` is the last reply of a
    finished firing, cut short. ``status`` ``waiting`` is read from the session, it is
    never stored. ``watch_path`` is the file a ``watch`` firing is for.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    routine_run_id: str = Field(min_length=1)
    routine: str = Field(min_length=1)
    scope: str = Field(min_length=1)
    session_id: str | None = None
    trigger: RoutineTrigger
    due_at: str | None = None
    started_at: str | None = None
    ended_at: str | None = None
    status: RoutineRunStatus
    reason: str | None = None
    summary: str | None = None
    watch_path: str | None = None


class RoutineInfo(BaseModel):
    """A routine and what the daemon knows about it.

    ``source`` is ``user`` or ``project``, and ``folder`` is the project folder
    of a project routine. ``path`` is the file it is written in. ``next_at`` is
    the next firing in the Mac's time zone, or null for a routine with ``on``,
    one that is disabled or paused, or one that is blocked. ``last`` is its
    latest run. ``paused`` is runtime state, not config. ``blocked`` is true for
    a project routine in a folder that is not in ``trusted_projects``: it is
    listed, and never runs.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    config: RoutineConfig
    source: RoutineSource
    folder: str | None = None
    path: str
    next_at: str | None = None
    last: RoutineRunSummary | None = None
    paused: bool = False
    blocked: bool = False


class RoutineIssue(BaseModel):
    """A routine that did not load: the file, the line (from 1) when known, and why."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    file: str
    line: int | None = Field(default=None, ge=1)
    message: str


class RoutineListParams(BaseModel):
    """``routine.list``. The user's routines, and the project routines of ``folders``.

    A folder in ``trusted_projects`` lists its routines as they are. Any other
    folder that has some lists them ``blocked``. The daemon never looks at a
    folder it is not given.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    folders: list[str] = Field(default_factory=list[str])


class RoutineListResult(BaseModel):
    """The routines, user ones first, each group in file order, and the files' problems."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    routines: list[RoutineInfo]
    issues: list[RoutineIssue] = Field(default_factory=list[RoutineIssue])


class RoutineGetParams(BaseModel):
    """``routine.get``. A routine by name. ``folder`` picks a project routine."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)
    folder: str | None = Field(default=None, min_length=1)


class RoutineGetResult(BaseModel):
    """The routine and its last 50 runs, newest first."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    routine: RoutineInfo
    runs: list[RoutineRunSummary] = Field(default_factory=list[RoutineRunSummary])


class RoutineRunParams(BaseModel):
    """``routine.run``. Fire a routine now, with ``trigger`` ``manual``.

    It works while the routine is paused and still obeys trust. It is refused while
    the routine's previous run is still running or waiting.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)
    folder: str | None = Field(default=None, min_length=1)


class RoutineRunResult(BaseModel):
    """The firing ``routine.run`` started, and the session it runs in.

    ``session_id`` is null for a workflow routine whose run has no session yet: a run gets one
    only when a step needs it.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    routine_run_id: str = Field(min_length=1)
    session_id: str | None = Field(default=None, min_length=1)


class RoutineFired(BaseModel):
    """A routine started a run. ``scope`` is ``user`` or the project folder.

    ``session_id`` is null for a workflow run that has no session yet.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    routine: str = Field(min_length=1)
    routine_run_id: str = Field(min_length=1)
    session_id: str | None = Field(default=None, min_length=1)
    trigger: RoutineTrigger
    scope: str = Field(min_length=1)


class RoutineFinished(BaseModel):
    """A routine's run ended, or a due firing was skipped (then ``reason`` says why).

    ``status`` is ``succeeded``, ``failed``, ``cancelled`` or ``skipped``. A skipped
    firing sends this and no ``routine.fired``.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    routine: str = Field(min_length=1)
    routine_run_id: str = Field(min_length=1)
    status: RoutineRunStatus
    reason: str | None = None
    summary: str | None = None


RunKind = Literal["routine", "ask", "workflow"]
"""What a Runs row is: a routine's firing, a detached ask, or a workflow run. A client never
infers it from an id."""


class RunInfo(BaseModel):
    """One row of the Runs list: a headless session and how its run is going (ADR-050).

    One row for each session whose origin is not ``user``, and one for each workflow run that
    has no session (``session_id`` is null: a run gets a session only when a step needs one, so
    a client keys a workflow run by ``workflow_run_id``). ``kind`` is ``routine`` for a
    routine's firing, ``ask`` for ``golem ask --detach`` and ``workflow`` for a workflow run
    (``routine`` stays null; the name is in ``origin``, after ``workflow:``).
    ``routine`` is the routine's name, null for ``ask``. ``folder`` is the project folder of a
    project routine, null for a user routine, so ``routine.get(routine, folder)`` finds it.
    ``routine_run_id`` and ``trigger`` are null for ``ask``.
    ``status`` is read as ``RoutineRunSummary.status`` is:
    ``waiting`` is a session that waits for an answer, and an ``ask`` that is not open reads
    ``succeeded``, ``failed`` or ``cancelled`` from its last agent run. ``summary`` is one line:
    the question while ``waiting`` (``Allow <tool>``, with the subject), the last reply once
    finished. ``reason`` says why a firing failed or was skipped. ``approvals`` counts the
    approvals the session waits for. ``watch_path`` is the file a ``watch`` firing is for.
    ``steps`` is the number of steps of a workflow run, null for the other kinds. The times
    are ISO 8601 with an offset.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str | None = Field(default=None, min_length=1)
    kind: RunKind
    origin: str = Field(min_length=1)
    routine: str | None = Field(default=None, min_length=1)
    folder: str | None = Field(default=None, min_length=1)
    routine_run_id: str | None = Field(default=None, min_length=1)
    trigger: RoutineTrigger | None = None
    status: RoutineRunStatus
    started_at: str | None = None
    ended_at: str | None = None
    summary: str | None = None
    reason: str | None = None
    approvals: int = Field(default=0, ge=0)
    watch_path: str | None = None
    steps: int | None = Field(default=None, ge=0)
    workflow_run_id: str | None = Field(default=None, min_length=1)
    """The run id of a workflow run's row, which ``workflow.status`` takes. Null for the others."""


class RunListParams(BaseModel):
    """``run.list``. The newest runs, one for each headless session.

    ``limit`` is at most 500. ``session_id`` asks for that one session's row only (the banner
    of a routine's session), and it returns no row for a session that is not headless.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    limit: int = Field(default=100, ge=1, le=500)
    session_id: str | None = Field(default=None, min_length=1)


class RunListResult(BaseModel):
    """The runs, newest first by start. A firing that was skipped has no session and no row."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    runs: list[RunInfo]


class RoutineUpdateParams(BaseModel):
    """``routine.update``. Change keys of a user routine, or create it with ``create``.

    ``fields`` are the keys of ``RoutineConfig`` to set. A null value removes the
    key. ``fields.name`` renames the routine. With ``create`` the routine must
    not exist yet and ``fields`` must make a whole one. Only the user's
    ``config.toml`` is edited: ``folder`` names a project routine and is
    refused, because a project's file is edited in the project.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)
    fields: dict[str, Any]
    create: bool = False
    folder: str | None = Field(default=None, min_length=1)


class RoutineUpdateResult(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    routine: RoutineInfo


class RoutinePreviewParams(BaseModel):
    """``routine.preview``. The next three times a schedule fires, so the browser never parses cron.

    ``schedule`` is cron or a plain form, as in ``RoutineConfig``. A schedule that does not parse
    is refused with the reason, in words for a person. ``workflow`` and ``inputs`` are checked
    against the workflow's declared inputs, so an editor shows a wrong one before it saves:
    ``problems`` says what is wrong (empty when nothing is). ``on_watch`` says the routine
    watches a folder, which passes ``path``. ``folder`` is the project the routine belongs to.
    With no ``schedule``, ``next`` is empty.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    schedule: str | None = None
    workflow: str | None = Field(default=None, min_length=1)
    inputs: dict[str, str | int | float | bool] = Field(
        default_factory=dict[str, str | int | float | bool]
    )
    on_watch: bool = False
    folder: str | None = Field(default=None, min_length=1)


class RoutinePreviewResult(BaseModel):
    """The next three firings after now, soonest first, as ISO 8601 times with an offset."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    next: list[str]
    problems: list[str] = Field(default_factory=list[str])


class RoutineRemoveParams(BaseModel):
    """``routine.remove``. Delete a user routine from ``config.toml``."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)
    folder: str | None = Field(default=None, min_length=1)


class RoutineRemoveResult(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)


class RoutineChanged(BaseModel):
    """A routine was added, changed or removed. List the routines again.

    ``name`` is null when the file changed in a way that is not one routine.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str | None = None
    change: Literal["added", "updated", "removed", "reloaded"]


MemoryScope = Literal["you", "project", "history"]
MemoryAuthor = Literal["you", "lead", "helper"]
MemoryState = Literal["proposed", "kept", "stale"]
MemoryKeptBy = Literal["you", "auto"]
MemoryPrivacy = Literal["chat", "local"]


class MemorySource(BaseModel):
    """A file a note is about, as it was when the note was made or last accepted."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    path: str = Field(min_length=1)
    """Relative to the folder when inside it, else absolute."""
    sha256: str
    size: int = Field(ge=0)
    mtime_ns: int
    checked_at: str


class MemoryItem(BaseModel):
    """One memory, with its sources (ADR-061, decision 7).

    ``usable`` is false for a ``local`` memory when no local model is set up, so no
    chat can use it. It is null for a ``chat`` memory.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(min_length=1)
    scope: MemoryScope
    title: str
    text: str
    author: MemoryAuthor
    state: MemoryState
    created_at: str
    updated_at: str
    folder: str | None = None
    """The project folder for ``project``, else null."""
    session_id: str | None = None
    agent: str | None = None
    call_id: str | None = None
    kept_by: MemoryKeptBy | None = None
    """Null while ``proposed``."""
    privacy: MemoryPrivacy = "chat"
    always: bool = False
    uses: int = Field(default=0, ge=0)
    last_used_at: str | None = None
    sources: list[MemorySource] = Field(default_factory=list[MemorySource])
    usable: bool | None = None


class MemoryCounts(BaseModel):
    """How many memories there are, by scope and by state, over every folder."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    you: int = Field(default=0, ge=0)
    project: int = Field(default=0, ge=0)
    history: int = Field(default=0, ge=0)
    proposed: int = Field(default=0, ge=0)
    kept: int = Field(default=0, ge=0)
    stale: int = Field(default=0, ge=0)


class MemorySettings(BaseModel):
    """``[memory]`` of ``config.toml``.

    ``you``, ``projects`` and ``history`` are the privacy of each scope. ``auto_keep`` is
    the folders where a note with sources is kept without asking. It is read only here,
    because it widens trust.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    you: MemoryPrivacy = "chat"
    projects: MemoryPrivacy = "chat"
    history: MemoryPrivacy = "chat"
    auto_keep: list[str] = Field(default_factory=list[str])
    share: float = Field(default=0.02, gt=0, le=1)
    min_tokens: int = Field(default=200, ge=0)
    max_tokens: int = Field(default=1500, ge=0)


class MemoryListParams(BaseModel):
    """``memory.list``. Rows newest first, filtered, a page at a time.

    ``query`` is a word search over ``title`` and ``text``. ``proposed`` and ``stale``
    rows are listed too. ``limit`` is at most 200.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    scope: MemoryScope | None = None
    folder: str | None = Field(default=None, min_length=1)
    state: MemoryState | None = None
    query: str | None = Field(default=None, min_length=1)
    limit: int = Field(default=50, ge=1, le=200)
    after: str | None = Field(default=None, min_length=1)
    """The id of the last row of the page before. Null for the first page."""


class MemoryListResult(BaseModel):
    """One page. ``total`` is the rows the filters match, ``counts`` all rows."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    items: list[MemoryItem]
    total: int = Field(ge=0)
    counts: MemoryCounts
    settings: MemorySettings


class MemoryGetParams(BaseModel):
    """``memory.get``. One memory with its sources."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(min_length=1)


class MemoryGetResult(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    item: MemoryItem


class MemoryWriteParams(BaseModel):
    """``memory.write``. You write a memory: it is ``kept``, author ``you``.

    ``scope`` is ``you`` or ``project``; a ``project`` note needs ``folder``. ``text`` is
    at most 2000 characters. ``title`` defaults to the first line of ``text``, cut to 120
    characters. ``sources`` are paths, at most 20, hashed when the note is written.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    scope: Literal["you", "project"]
    text: str = Field(min_length=1, max_length=2000)
    title: str | None = Field(default=None, min_length=1, max_length=120)
    folder: str | None = Field(default=None, min_length=1)
    privacy: MemoryPrivacy = "chat"
    always: bool = False
    sources: list[str] = Field(default_factory=list[str], max_length=20)

    @model_validator(mode="after")
    def _folder_goes_with_project(self) -> Self:
        if self.scope == "project" and self.folder is None:
            raise ValueError("a project memory needs a folder")
        if self.scope != "project" and self.folder is not None:
            raise ValueError("only a project memory has a folder")
        return self


class MemoryWriteResult(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    item: MemoryItem


class MemoryUpdateParams(BaseModel):
    """``memory.update``. Edit ``text``, ``title``, ``privacy``, ``always`` or ``folder``.

    ``accept_sources`` hashes the sources again and makes a ``stale`` note ``kept``.
    At least one change is needed.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(min_length=1)
    text: str | None = Field(default=None, min_length=1, max_length=2000)
    title: str | None = Field(default=None, min_length=1, max_length=120)
    privacy: MemoryPrivacy | None = None
    always: bool | None = None
    folder: str | None = Field(default=None, min_length=1)
    accept_sources: bool = False

    @model_validator(mode="after")
    def _something_changes(self) -> Self:
        changes = (self.text, self.title, self.privacy, self.always, self.folder)
        if all(change is None for change in changes) and not self.accept_sources:
            raise ValueError("nothing to change")
        return self


class MemoryUpdateResult(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    item: MemoryItem


class MemoryDeleteParams(BaseModel):
    """``memory.delete``. Delete rows with their sources and search entries. No trash."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    ids: list[str] = Field(min_length=1, max_length=200)


class MemoryDeleteResult(BaseModel):
    """``deleted`` are the ids that were there. ``missing`` are the ones that were not."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    deleted: list[str]
    missing: list[str] = Field(default_factory=list[str])


class MemoryExportParams(BaseModel):
    """``memory.export``. The memories of a scope or a folder, as ``markdown`` or ``json``."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    format: Literal["markdown", "json"]
    scope: MemoryScope | None = None
    folder: str | None = Field(default=None, min_length=1)


class MemoryExportResult(BaseModel):
    """``text`` is the document: a section for each memory, or a JSON array of every field."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    format: Literal["markdown", "json"]
    text: str
    count: int = Field(ge=0)


class MemorySettingsParams(BaseModel):
    """``memory.settings``. Read ``[memory]``, or set the privacy of a scope.

    ``scope`` and ``privacy`` come together, or neither. ``auto_keep`` cannot be set here.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    scope: MemoryScope | None = None
    privacy: MemoryPrivacy | None = None

    @model_validator(mode="after")
    def _scope_and_privacy_together(self) -> Self:
        if (self.scope is None) != (self.privacy is None):
            raise ValueError("scope and privacy go together")
        return self


class MemorySettingsResult(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    settings: MemorySettings


class MemoryChanged(BaseModel):
    """A memory was made, edited, deleted, went stale or was resolved. List again.

    ``folder`` is the project folder of a ``project`` memory, else null.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(min_length=1)
    change: Literal["created", "updated", "deleted", "stale", "resolved"]
    scope: MemoryScope
    folder: str | None = None


class McpListParams(BaseModel):
    """``mcp.list``. The user's MCP servers and their state.

    With ``session_id``, also the servers of that session's trusted project,
    and whether each one is on for the session.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str | None = Field(default=None, min_length=1)


McpServerState = Literal["idle", "starting", "running", "failed", "disabled", "needs_auth"]


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
    ``approval`` is ``"allow"`` when its calls run without asking, and
    ``"read-only"`` when only the tools it marks read-only do.
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
    approval: Literal["ask", "read-only", "allow"] = "ask"


class McpServerParams(BaseModel):
    """``mcp.tools``, ``mcp.restart``, ``mcp.login``, ``mcp.logout``: one server of a session."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)
    session_id: str | None = Field(default=None, min_length=1)


class McpLoginResult(BaseModel):
    """``mcp.login``: the address to open in a browser. The sign-in ends with ``mcp.login.done``."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)
    authorize_url: str = Field(min_length=1)


class McpLoginDone(BaseModel):
    """``mcp.login.done``: a sign-in ended. On ``ok`` the server is starting again. Not stored."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)
    project: str | None = None
    ok: bool
    error: str | None = None


class McpToolInfo(BaseModel):
    """One of a server's tools: the name the model sees, and what it says it does.

    A ``hidden`` tool is one the server's ``tools`` filter keeps from the model.
    ``schema_tokens`` roughly what its schema costs in each prompt.
    ``input_schema`` is the JSON Schema of its arguments, for a form that tries it.
    ``read_only`` is the server's own ``readOnlyHint``: its word, not golem's check.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)
    description: str
    hidden: bool = False
    schema_tokens: int = Field(default=0, ge=0)
    input_schema: dict[str, Any] | None = None
    read_only: bool = False


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


class McpOAuthConfig(BaseModel):
    """``oauth`` in an HTTP server's table: a client id for a server with no registration."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    client_id: str | None = Field(default=None, min_length=1)
    scopes: list[str] = Field(default_factory=list[str])


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
    approval: Literal["ask", "read-only", "allow"] = "ask"
    env_passthrough: list[str] = Field(default_factory=list[str])
    oauth: McpOAuthConfig | None = None
    auto_enable: bool = True


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
    install when that is the hint. ``http_status`` is the HTTP status a hosted
    server refused with, 401 or 403 when it did not accept the token, and
    null for any other failure.
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
    http_status: int | None = Field(default=None, ge=100, le=599)


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
    on_demand: bool = False
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


class ConfigLadder(BaseModel):
    """``[routing.ladder]``: the model named for each tier. Null means golem chooses."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    local: str | None = None
    budget: str | None = None
    frontier: str | None = None


class ConfigRouting(BaseModel):
    """What a route chip needs from ``[routing]`` and ``[budget]``.

    ``daily_usd`` and ``session_usd`` are the caps on paid models, null for no cap.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    ladder: ConfigLadder = Field(default_factory=ConfigLadder)
    daily_usd: float | None = Field(default=None, ge=0)
    session_usd: float | None = Field(default=None, ge=0)


class ConfigGetResult(BaseModel):
    """Resolved settings. Keys are never included.

    ``project_policy`` is the project's ``.golem/policy.toml`` when it exists,
    and ``project_trusted`` whether its allow rules count. Both are null
    without a ``cwd``. ``default_permission_mode`` is ``[permissions] mode``,
    and ``permission_mode`` the mode the ``rules`` were built for: the session's
    when ``session_id`` is given, else the default. An older daemon leaves both out.
    ``routing`` is the ladder and the spending caps. ``notifications_open_in`` is
    ``[notifications] open_in``. An older daemon leaves both out.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    config_file: str = Field(min_length=1)
    default_model: str | None = Field(min_length=1)
    log_level: str = Field(min_length=1)
    session_titles: bool
    trusted_projects: list[str]
    project_policy: str | None = None
    project_trusted: bool | None = None
    default_permission_mode: PermissionMode = "balanced"
    permission_mode: PermissionMode = "balanced"
    rules: list[ConfigRule]
    session_allowed: list[ConfigAllowance] = Field(default_factory=list[ConfigAllowance])
    routing: ConfigRouting | None = None
    notifications_open_in: Literal["web", "terminal"] | None = None


class AgentsKeepParams(BaseModel):
    """``agents.keep``. Read how long a finished helper's steps are kept, or change it.

    Without keys it only reads. Only the keys sent change, in ``[agents]`` of the user's
    ``config.toml``, and the file keeps its comments. 0 keeps for ever. Both values are
    checked first, and when one is wrong nothing is written. The next trim pass uses them.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    keep_days: int | None = None
    keep_problem_days: int | None = None
    use_helpers: UseHelpers | None = None


class AgentsDelegateNumber(BaseModel):
    """One number of ``[agents.delegate]``: ``value`` is the one in force, ``default`` the one
    golem ships, and ``is_default`` is true when the two are equal."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    value: float
    default: float
    is_default: bool


class AgentsDelegateValues(BaseModel):
    """The four numbers of ``[agents.delegate]`` that say when a helper is worth starting.

    ``read_share``, ``fill_share`` and ``job_share`` are shares of the lead's window, and
    ``price_ratio`` is how many times dearer the lead must be. Read-only here: a measurement
    changes them (``evals.apply``), or the user edits ``config.toml``.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    read_share: AgentsDelegateNumber
    fill_share: AgentsDelegateNumber
    job_share: AgentsDelegateNumber
    price_ratio: AgentsDelegateNumber


class AgentsKeepValues(BaseModel):
    """``[agents] keep_days`` and ``keep_problem_days`` as golem uses them. 0 is for ever.

    ``max_calls``, ``working_seconds``, ``max_cost`` and ``max_tokens`` are the limits of
    ``[agents]`` that every helper gets when its own table and file leave them open; ``None`` when
    ``config.toml`` does not set one. ``agents.set_default_limits`` changes them.
    ``use_helpers`` is ``[agents] use_helpers``; ``when_needed`` when ``config.toml`` does not
    set it and for a daemon that does not know it. ``delegate`` is ``[agents.delegate]``, read-only
    (``agents.keep`` does not accept it); an older daemon leaves it out.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    keep_days: int = Field(ge=0)
    keep_problem_days: int = Field(ge=0)
    max_calls: int | None = None
    working_seconds: int | None = None
    max_cost: float | None = None
    max_tokens: int | None = None
    use_helpers: UseHelpers = "when_needed"
    delegate: AgentsDelegateValues | None = None


class AgentsKeepResult(BaseModel):
    """``ok`` is false when a value was wrong, and the file is then untouched. ``values`` is
    what is in force now, set when ``ok``."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    ok: bool
    errors: list[ConfigError] = Field(default_factory=list[ConfigError])
    values: AgentsKeepValues | None = None


class ChatGetParams(BaseModel):
    """``chat.get``. The defaults for every new chat, from ``[chat]``."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class ChatValues(BaseModel):
    """``[chat]`` as golem uses it. ``mode`` is ``[permissions] mode``, read only here: the
    page changes it with ``permissions.set_mode``."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    instructions: list[str]
    plan_first: bool
    mode: PermissionMode


class ChatSetParams(BaseModel):
    """``chat.set``. Change keys of ``[chat]`` in the user's ``config.toml``.

    Only the keys sent change. ``instructions`` has at most 30 lines of 1 to 300 characters
    after trimming, and blank lines are dropped. A bad line comes back as an error that
    names it by number, and nothing is written.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    instructions: list[str] | None = None
    plan_first: bool | None = None


class ChatSetResult(BaseModel):
    """``ok`` is false when a value was wrong, and the file is then untouched. ``values`` is
    what ``chat.get`` would now answer, set when ``ok``."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    ok: bool
    errors: list[ConfigError] = Field(default_factory=list[ConfigError])
    values: ChatValues | None = None


class ChatPromptParams(BaseModel):
    """``chat.prompt``. What the model of a new chat reads now.

    It is the default model, no folder, no pinned skills, no on-demand MCP servers, and plan
    first as ``[chat] plan_first`` says. ``instructions`` stand in for the saved lines for this
    answer only, and nothing is written. They are checked as ``chat.set`` checks them, and a
    bad line is an invalid params error.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    instructions: list[str] | None = None


class ChatPromptPart(BaseModel):
    """One named section of the system prompt. ``tokens`` is the characters over four, rounded
    up."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str
    text: str
    tokens: int


class ChatPromptResult(BaseModel):
    """``model`` is the default model, null when there is none (the memory block is then left
    out). ``tools_tokens`` is the size of the tool schemas the model would be offered, 0 for a
    model that takes no tools. ``total_tokens`` is the parts plus ``tools_tokens``."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    model: str | None
    parts: list[ChatPromptPart]
    tools_tokens: int
    total_tokens: int


class ChatDraftParams(BaseModel):
    """``chat.draft``. Golem drafts instruction lines from what the person says about how
    they like answers. Nothing is saved."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    description: str = Field(min_length=1, max_length=2000)


class ChatDraftResult(BaseModel):
    """3 to 8 short lines, one rule each, and the model that wrote them. At most 8 lines of
    300 characters; never empty."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    lines: list[str]
    model: str


class ChatSuggestionsParams(BaseModel):
    """``chat.suggestions``. Reads the kept suggestions and starts the job when they are
    older than a day."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class ChatSuggestion(BaseModel):
    """One instruction line golem suggests, and why. ``source`` is ``memory`` for a note and
    ``chats`` for what you keep asking."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    line: str
    reason: str
    source: Literal["memory", "chats"]


class ChatSuggestionsResult(BaseModel):
    """At most 5 suggestions, without the lines already in ``[chat] instructions`` and the
    dismissed ones. ``updated`` is when the job last ran, null before the first run.
    ``needs_local_model`` is true when there is no local model: the job reads your messages,
    so it runs on a local model only."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    suggestions: list[ChatSuggestion]
    updated: str | None
    needs_local_model: bool


class ChatSuggestionDismissParams(BaseModel):
    """``chat.suggestion_dismiss``. The line is never suggested again."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    line: str = Field(min_length=1, max_length=2000)


class ChatSuggestionDismissResult(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    ok: bool


class NotificationsGetParams(BaseModel):
    """``notifications.get``. The ``[notifications]`` settings as golem uses them."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class NotificationsValues(BaseModel):
    """``[notifications]``. ``needs_you`` is always true: it cannot be turned off.
    ``terminal_apps`` are the names ``terminal_app`` may take. ``finished_routines`` and
    ``failed_routines`` name the routines whose own ``notify_finished`` or ``notify_failed``
    says yes while the global setting says no, so the page can point to them."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    needs_you: bool
    failed: bool
    finished: bool
    open_in: Literal["web", "terminal"]
    terminal_app: str
    terminal_apps: list[str]
    finished_routines: list[str] = Field(default_factory=list[str])
    failed_routines: list[str] = Field(default_factory=list[str])


class NotificationsSetParams(BaseModel):
    """``notifications.set``. Change keys of ``[notifications]`` in the user's ``config.toml``.

    Only the keys sent change, and the file keeps its comments. A key set to its default
    stays in the file. Every value is checked first, and when any is wrong nothing is written.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    failed: bool | None = None
    finished: bool | None = None
    open_in: Literal["web", "terminal"] | None = None
    terminal_app: str | None = None


class NotificationsSetResult(BaseModel):
    """``ok`` is false when a value was wrong, and the file is then untouched. ``values`` is
    what ``notifications.get`` would now answer, set when ``ok``."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    ok: bool
    errors: list[ConfigError] = Field(default_factory=list[ConfigError])
    values: NotificationsValues | None = None


class OllamaSettingsGetParams(BaseModel):
    """``ollama.settings.get``. The ``[ollama]`` settings as golem uses them."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class OllamaSettingsValues(BaseModel):
    """``[ollama]`` without ``models``. ``parallel`` is 1 to 8 or ``"auto"``.
    ``running`` is true when a local server answers and ``started_by_golem`` when golem
    started it. A server you started keeps its own ``OLLAMA_NUM_PARALLEL``."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    start: bool
    idle_stop_minutes: int
    parallel: int | Literal["auto"]
    started_by_golem: bool
    running: bool


class OllamaSettingsSetParams(BaseModel):
    """``ollama.settings.set``. Change keys of ``[ollama]`` in the user's ``config.toml``.

    Only the keys sent change, and the file keeps its comments. ``[ollama.models]`` is not
    touched. Every value is checked first, and when any is wrong nothing is written.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    start: bool | None = None
    idle_stop_minutes: int | None = None
    parallel: int | Literal["auto"] | None = None


class OllamaSettingsSetResult(BaseModel):
    """``ok`` is false when a value was wrong, and the file is then untouched. ``values`` is
    what ``ollama.settings.get`` would now answer, set when ``ok``."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    ok: bool
    errors: list[ConfigError] = Field(default_factory=list[ConfigError])
    values: OllamaSettingsValues | None = None


class RoutingGetParams(BaseModel):
    """``routing.get``. The routing, budget and context settings as golem uses them."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class RoutingValues(BaseModel):
    """``[routing]``: the route mode of a new session, when to ask about paid models,
    the price that splits budget from frontier, and the folders that stay on this Mac."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    mode: Literal["pinned", "local", "auto"]
    paid: Literal["ask", "always_ask", "never"]
    budget_max_price: float
    local_only: list[str]


class RoutingLadder(BaseModel):
    """``[routing.ladder]``. The model named for each tier, null when golem chooses."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    local: str | None = None
    budget: str | None = None
    frontier: str | None = None


class RoutingRoles(BaseModel):
    """``[routing.roles]``. Each is ``session`` or a model name."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    titles: str
    summarise: str
    explore: str


class RoutingBudget(BaseModel):
    """``[budget]``. Caps in USD, null for no cap."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    daily_usd: float | None = None
    session_usd: float | None = None
    over: Literal["local", "ask"]


class RoutingContext(BaseModel):
    """``[context]``. ``window`` is ``auto``, ``ollama`` or a number of tokens."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    window: Literal["auto", "ollama"] | int
    keep_alive: str | None = None
    reply_reserve: int
    clear_at: float
    clear_to: float
    compact_at: float
    keep_results: int
    keep_turns: int


class RoutingPicked(BaseModel):
    """The model golem would take for each tier when its ``[routing.ladder]`` line is empty,
    as ``provider/model``, or null when none is ready."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    local: str | None = None
    budget: str | None = None
    frontier: str | None = None


class RoutingGetResult(BaseModel):
    """The effective values of the five tables, and what golem picks for an empty tier."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    routing: RoutingValues
    ladder: RoutingLadder
    roles: RoutingRoles
    budget: RoutingBudget
    context: RoutingContext
    picked: RoutingPicked


class RoutingPatch(BaseModel):
    """Keys of ``[routing]`` to change. A key left out stays; a null removes the key from the
    file, so the default applies again."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    mode: Literal["pinned", "local", "auto"] | None = None
    paid: Literal["ask", "always_ask", "never"] | None = None
    budget_max_price: float | None = None
    local_only: list[str] | None = None


class RoutingLadderPatch(BaseModel):
    """Keys of ``[routing.ladder]`` to change. A null removes the key."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    local: str | None = None
    budget: str | None = None
    frontier: str | None = None


class RoutingRolesPatch(BaseModel):
    """Keys of ``[routing.roles]`` to change. A null removes the key."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    titles: str | None = None
    summarise: str | None = None
    explore: str | None = None


class RoutingBudgetPatch(BaseModel):
    """Keys of ``[budget]`` to change. A null removes the key: no cap, or ``over = local``."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    daily_usd: float | None = None
    session_usd: float | None = None
    over: Literal["local", "ask"] | None = None


class RoutingContextPatch(BaseModel):
    """Keys of ``[context]`` to change. A null removes the key."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    window: Literal["auto", "ollama"] | int | None = None
    keep_alive: str | None = None
    reply_reserve: int | None = None
    clear_at: float | None = None
    clear_to: float | None = None
    compact_at: float | None = None
    keep_results: int | None = None
    keep_turns: int | None = None


class RoutingSetParams(BaseModel):
    """``routing.set``. Change keys of the five tables in the user's ``config.toml``.

    Only the keys sent change, and the file keeps its comments. Every value is checked
    first, and when any is wrong nothing is written.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    routing: RoutingPatch | None = None
    ladder: RoutingLadderPatch | None = None
    roles: RoutingRolesPatch | None = None
    budget: RoutingBudgetPatch | None = None
    context: RoutingContextPatch | None = None


class RoutingSetResult(BaseModel):
    """``ok`` is false when a value was wrong, and the file is then untouched. Each error's
    ``path`` is the setting, as ``context.clear_to``. ``values`` is what ``routing.get``
    would now answer, set when ``ok``."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    ok: bool
    errors: list[ConfigError] = Field(default_factory=list[ConfigError])
    values: RoutingGetResult | None = None


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


class ChangesListParams(BaseModel):
    """``changes.list``. The files a session changed, each as its net change."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)


class ChangedFile(BaseModel):
    """One changed file: first before against last after, as counts and flags.

    ``stale`` is true when the file on disk is not what golem last wrote, because
    someone else changed it since.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    path: str
    status: Literal["created", "modified", "deleted"]
    added: int = Field(ge=0)
    removed: int = Field(ge=0)
    change_ids: list[str]
    stale: bool


class ChangesListResult(BaseModel):
    """The changed files in order of first change. A session without a folder has none.

    ``shell`` says how files a shell command changes are found: ``git`` in a repository,
    ``files`` by comparing the folder before and after, ``off`` when the folder is too big
    to watch and is not a repository.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    files: list[ChangedFile]
    shell: Literal["git", "files", "off"] = "git"


class ChangesDiffParams(BaseModel):
    """``changes.diff``. The diff of a file or of one change: exactly one of the two is set."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    path: str | None = Field(default=None, min_length=1)
    change_id: str | None = Field(default=None, min_length=1)


class ChangesDiffResult(BaseModel):
    """A unified diff, cut when long, and whether it was cut."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    diff: str
    truncated: bool


class RevertTarget(BaseModel):
    """What ``changes.revert`` takes back. Each kind needs its own field and no other.

    ``change`` needs ``change_id``, ``file`` needs ``path``, ``hunk`` needs ``path`` and
    ``hunk`` (0-based, of the file's net diff), and ``run`` needs ``run_id``.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    kind: Literal["change", "file", "hunk", "run"]
    change_id: str | None = Field(default=None, min_length=1)
    path: str | None = Field(default=None, min_length=1)
    hunk: int | None = Field(default=None, ge=0)
    run_id: str | None = Field(default=None, min_length=1)


class ChangesRevertParams(BaseModel):
    """``changes.revert``. Put back what a change, a file, a hunk or a turn wrote.

    Without ``force``, a file that changed on disk since golem wrote it is left alone
    and listed as a conflict. Refused while the session has a run.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    target: RevertTarget
    force: bool = False


class RevertConflict(BaseModel):
    """A file a revert did not touch."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    path: str
    reason: Literal["changed_on_disk"]


class ChangesRevertResult(BaseModel):
    """The paths written, and the paths left alone. Each write is a change of its own."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    reverted: list[str]
    conflicts: list[RevertConflict]


class FileReadParams(BaseModel):
    """``file.read``. One text file of the session's folder."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    path: str = Field(min_length=1)


class FileReadResult(BaseModel):
    """The file's path relative to the folder, the start of its text, and its line count.

    ``truncated`` is true when the file is longer than the limit and ``text`` is its start.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    path: str
    text: str
    truncated: bool
    lines: int = Field(ge=0)


class FileListParams(BaseModel):
    """``file.list``. Files of the session's folder whose path holds ``query``, case-insensitive.

    Dot files and files in dot folders are listed only when ``hidden`` is true.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    query: str = ""
    limit: int = Field(default=50, ge=1, le=200)
    hidden: bool = False


class FileListResult(BaseModel):
    """Relative paths, shortest first, then alphabetical. ``more`` is true when others match."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    paths: list[str]
    more: bool


class ChangesCommitParams(BaseModel):
    """``changes.commit``. Commit these files of the session folder with the user's own git."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    paths: list[str] = Field(min_length=1, max_length=500)
    message: str = Field(min_length=1, max_length=10_000)


class ChangesCommitResult(BaseModel):
    """Whether git committed. ``sha`` is the short hash on success. ``output`` is git's text."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    ok: bool
    sha: str | None
    output: str = Field(max_length=4_000)


class ChangesCommitInfoParams(BaseModel):
    """``changes.commit_info``. What git says about the session folder and its changes."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)


class ChangesCommitInfoResult(BaseModel):
    """``repository`` is false outside a git work tree. ``paths`` are the changed files git sees."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    repository: bool
    branch: str | None
    paths: list[str]


class ChangesSuggestMessageParams(BaseModel):
    """``changes.suggest_message``. Ask the session's model for a commit message."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    paths: list[str] = Field(min_length=1, max_length=500)


class ChangesSuggestMessageResult(BaseModel):
    """The subject, then a blank line and the body when there is one."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    message: str


class ApprovalRespondParams(BaseModel):
    """``approval.respond``. Answer the tool call a session's run waits on.

    ``allow`` runs it once, ``allow_session`` runs it and allows the same call
    for the rest of the session, ``allow_always`` runs it and writes an allow
    rule for it first in the user's ``config.toml``, and ``deny`` tells the
    model it may not.

    ``args`` replaces the call's arguments, edited by the user, and goes only
    with ``allow``: an edited call runs once.

    ``scope`` is ``batch`` to answer for all the helpers of one ``delegate`` call: the
    decision applies to the same call in each unfinished helper of that call and answers those
    waiting on it. Without it the answer is for ``session_id`` alone (once, or for that session
    with ``allow_session``, which for a helper ends with it). ``batch`` is not for an edited call.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    call_id: str = Field(min_length=1)
    decision: Literal["allow", "allow_session", "allow_always", "deny"]
    args: dict[str, Any] | None = None
    scope: Literal["batch"] | None = None

    @model_validator(mode="after")
    def _edited_runs_once(self) -> Self:
        if self.args is not None and self.decision != "allow":
            raise ValueError("edited args go only with decision allow")
        if self.args is not None and self.scope is not None:
            raise ValueError("an edited call runs once, not for a batch")
        return self


class ApprovalRespondResult(BaseModel):
    """The run that goes on. Its events go to the attached connections."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    run_id: str = Field(min_length=1)


class HelpersRespondParams(BaseModel):
    """``helpers.respond``. Answer the question "start these helpers?" a lead waits on.

    The lead asks it when ``[agents] use_helpers`` is ``ask``: its pending list holds a
    ``batch`` item whose ``call_id`` is the ``delegate`` call. ``run`` true starts the helpers
    as usual. ``run`` false starts none, and the model gets a result that tells it to do the
    work in the chat. The question is also on the log as ``approval.needed`` with the source
    ``use_helpers`` and the tool ``delegate``, and the answer as ``approval.resolved``
    (``allow`` or ``deny``); an older client may answer it with ``approval.respond``, where a
    yes of any kind runs the helpers and writes no rule.

    ``cheaper`` true, with ``run`` true, starts the helpers on the item's ``cheaper_model``
    ("Use a cheaper model"). ``cheaper`` with ``run`` false is refused.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    call_id: str = Field(min_length=1)
    run: bool
    cheaper: bool = False

    @model_validator(mode="after")
    def _cheaper_needs_run(self) -> Self:
        if self.cheaper and not self.run:
            raise ValueError("cheaper needs run: true")
        return self


class HelpersRespondResult(BaseModel):
    """The run that goes on. Its events go to the attached connections."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    run_id: str = Field(min_length=1)


class RouteConsentAnswerParams(BaseModel):
    """``route.consent.answer``. Answer the paid step-up question a session's run waits on.

    ``session`` runs the turn on the paid model and allows paid models for the rest of the
    session (not with ``[routing] paid = "always_ask"``, then it is ``once``). ``once`` runs
    this turn on it. ``local`` runs the turn on a local model. The answer must be one the
    event offered in ``alternatives``.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str = Field(min_length=1)
    run_id: str = Field(min_length=1)
    answer: ConsentAnswer


class RouteConsentAnswerResult(BaseModel):
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


InstallMethod = Literal["homebrew", "script", "dev"]


class SetupInstall(BaseModel):
    """Where golem is installed. ``binary`` is the ``golem`` program, null if not on the PATH."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    method: InstallMethod
    version: str = Field(min_length=1)
    binary: str | None = Field(default=None, min_length=1)
    daemon_binary: str = Field(min_length=1)


class SetupPaths(BaseModel):
    """The files golem keeps, absolute."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    home: str = Field(min_length=1)
    config: str = Field(min_length=1)
    logs: str = Field(min_length=1)
    socket: str = Field(min_length=1)


class SetupJob(BaseModel):
    """A launchd job. ``pid`` is set only while it runs. ``plist`` is its file, present or not."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    label: str = Field(min_length=1)
    plist: str = Field(min_length=1)
    loaded: bool
    pid: int | None = None


class SetupStatusResult(BaseModel):
    """The rows in the order ``golem doctor`` prints them.

    ``install``, ``paths``, and ``jobs`` say where golem is installed and what
    runs it. A daemon that does not know them leaves them out.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    rows: list[SetupRow]
    install: SetupInstall | None = None
    paths: SetupPaths | None = None
    jobs: list[SetupJob] = Field(default_factory=list[SetupJob])


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


class NotifyTestParams(BaseModel):
    """``notify.test``. Post a sample notification, for Settings and ``golem doctor``."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class NotifyTestResult(BaseModel):
    """``posted`` is false when nothing was shown: no poster on this machine, or macOS refused.

    ``mechanism`` names the poster that tried, such as ``osascript`` or ``none``.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    posted: bool
    mechanism: str


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


class GitInfoParams(BaseModel):
    """``git.info``. What git says about a folder, read only.

    ``path`` is an absolute folder under the user's home folder, checked as
    ``fs.list_dirs`` checks it. A path that is not a folder is refused.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    path: str = Field(min_length=1)


class GitWorktree(BaseModel):
    """A checkout of a repo. ``agent`` is true under ``<repo>/.claude/worktrees/``."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    path: str = Field(min_length=1)
    branch: str | None = None
    main: bool
    agent: bool


class GitInfoResult(BaseModel):
    """The repo a folder belongs to. Not a repo: ``repository`` is false and the rest is empty.

    ``changed`` counts the lines of ``git status --porcelain``, tracked and
    untracked. ``branch`` is null on a detached HEAD, and ``detached`` is true.
    ``worktrees`` lists the main checkout first, then the others by path.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    repository: bool
    root: str | None = None
    branch: str | None = None
    detached: bool
    changed: int = Field(ge=0)
    worktrees: list[GitWorktree]


class GitBranchesParams(BaseModel):
    """``git.branches``. The local branches of the repo a folder belongs to, read only."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    path: str = Field(min_length=1)


class GitBranch(BaseModel):
    """A local branch. ``last_used`` is the time of its last commit, ISO 8601, or null."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)
    last_used: str | None = None


class GitBranchesResult(BaseModel):
    """Local branches, newest commit first, at most 200. Not a repo: empty."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    current: str | None = None
    branches: list[GitBranch]


class FsChooseFolderParams(BaseModel):
    """``fs.choose_folder``. Opens the macOS folder dialog on the daemon's Mac.

    ``start`` is the folder the dialog opens in. Null opens it in the home folder, and so
    does a path that is not a folder. The call waits up to 5 minutes for an answer. It is
    refused with ``not_local`` when the caller is not a page on this Mac, with
    ``unsupported`` when the platform is not macOS, and with ``busy`` while another dialog
    is open (see ``HelloResult.local_ui``).
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    start: str | None = Field(default=None, min_length=1)


class FsChooseFolderResult(BaseModel):
    """The folder chosen, as an absolute path with no trailing slash. Null means cancelled."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    path: str | None = None


class FsRevealParams(BaseModel):
    """``fs.reveal``. Opens a folder in Finder on the daemon's Mac.

    ``path`` is an absolute, existing folder under the user's home folder, checked as
    ``git.info`` checks it. It is refused with ``not_local`` when the caller is not a page on
    this Mac and with ``unsupported`` when the platform is not macOS (see
    ``HelloResult.local_ui``).
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    path: str = Field(min_length=1)


class FsRevealResult(BaseModel):
    """Empty. The call returns once ``open`` has exited."""

    model_config = ConfigDict(extra="forbid", frozen=True)


# --- evals.*: the measurement of the helper rules (step 15.14) ---------------------------------

EvalTier = Literal["local", "budget", "frontier"]
"""The kind of model an arm uses, as the model ladder names it."""

EvalMemoryVerdict = Literal["fits", "tight", "too_big", "no_room", "unknown"]
"""Whether a local arm's model fits in memory. ``fits``: plenty of room. ``tight``: it fits, but
takes most of the free memory, so it needs ``allow_tight`` or ``own_risk``. ``too_big``: it will
not fit on this machine. ``no_room``: it would fit if other apps let go of memory. ``unknown``:
the size or the memory could not be read. The last three run only with ``own_risk``. Memory a
model already holds in Ollama counts as taken, not as missing."""

EvalState = Literal["running", "stopped", "done"]
"""``running`` is being measured now. ``stopped`` ended early and may be resumed. ``done`` ran
every run."""

EvalMode = Literal["on", "off"]
"""Whether the lead could start helpers in a run."""

EvalRunEnd = Literal["completed", "failed", "cancelled", "timeout", "not_run", "running", "pending"]
"""How a run ended. ``not_run`` was skipped and is not counted. ``running`` is the one in
progress and ``pending`` waits its turn; both are only on a measurement that is running."""

EvalNumberKey = Literal["read_share", "fill_share", "job_share", "price_ratio"]
"""The four numbers of ``[agents.delegate]``."""

_EVAL_NUMBER_KEYS = ("fill_share", "job_share", "price_ratio", "read_share")


class EvalModelChoice(BaseModel):
    """A model an arm may use instead of its own. ``size_gb`` is its size in memory, if known."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    ref: str = Field(min_length=1)
    size_gb: float | None = Field(default=None, ge=0)


class EvalPlanArm(BaseModel):
    """One arm of a measurement as ``evals.plan`` sees it now.

    ``kind`` is ``local`` for a model on this machine and ``cloud`` for a paid one. ``model`` is
    the model it would use, and ``choices`` the others it could use. A local arm has the memory
    numbers and a ``verdict``; ``needed_gb`` is what the model needs at this window, ``ram_gb``
    the machine's memory and ``free_gb`` what is free now, each null when it could not be read.
    ``loaded_gb`` is what Ollama already holds in memory for that model (null when it is not
    loaded); it is not counted as missing. ``runnable`` is false when the arm cannot run at all,
    whatever the person says: a hosted model without a key, or a local model that Ollama does not
    have. A cloud arm has none of the memory numbers and may have ``cost_usd``, the estimate for
    all its runs. ``reason`` is one plain line on the verdict, or on the cost. ``asks`` is how
    many asks it plays (twice each: with helpers and without), and ``minutes`` a rough time for
    the arm.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)
    label: str = Field(min_length=1)
    kind: Literal["local", "cloud"]
    tier: EvalTier
    window: int = Field(ge=1)
    model: str = Field(min_length=1)
    choices: list[EvalModelChoice] = Field(default_factory=list[EvalModelChoice])
    needed_gb: float | None = Field(default=None, ge=0)
    ram_gb: float | None = Field(default=None, ge=0)
    free_gb: float | None = Field(default=None, ge=0)
    loaded_gb: float | None = Field(default=None, ge=0)
    verdict: EvalMemoryVerdict | None = None
    runnable: bool = True
    reason: str = ""
    cost_usd: float | None = Field(default=None, ge=0)
    asks: int = Field(ge=1)
    minutes: float | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def _memory_only_for_local(self) -> Self:
        if self.kind == "local":
            if self.verdict is None:
                raise ValueError("a local arm has a verdict")
            if self.cost_usd is not None:
                raise ValueError("a local arm costs nothing")
        elif (
            self.verdict is not None
            or self.needed_gb is not None
            or self.ram_gb is not None
            or self.free_gb is not None
            or self.loaded_gb is not None
        ):
            raise ValueError("a cloud arm takes no memory")
        return self


EvalAskReason = Literal["none", "window", "at_once", "model"]
"""Why an ask is in the set: ``none`` a plain ask, ``window`` the reading crowds the window,
``at_once`` independent jobs, ``model`` a stronger or cheaper model may fit."""


class EvalAsk(BaseModel):
    """One ask of the set, as a person can read it before and after a measurement.

    ``text`` is the message sent to the model. ``facts`` is what a good answer must mention, each
    as a readable string (``a or b`` holds when either is there). ``setup`` is one short line on
    what the ask is set up with, and ``why`` says in plain words why it is in the set (``reason``
    is the same as a code).
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)
    text: str = Field(min_length=1)
    facts: list[str] = Field(default_factory=list[str])
    setup: str = ""
    reason: EvalAskReason = "none"
    why: str = ""


class EvalArmParams(BaseModel):
    """What one arm ran with. ``window`` is in tokens. ``at_a_time`` is how many requests the
    model gets at once (1 for a local model, null for a hosted one). ``helper_model`` says in
    plain words which model the helpers use."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)
    model: str = Field(min_length=1)
    window: int = Field(ge=1)
    at_a_time: int | None = Field(default=None, ge=1)
    helper_model: str = ""


class EvalsPlanParams(BaseModel):
    """``evals.plan``. What a measurement would run and whether this machine has room for it.

    It reads the memory and calls no model. ``models`` maps an arm's name to the model to plan it
    with, instead of its own. With ``arms``, only those arms are planned; with none, every arm.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    arms: list[str] = Field(default_factory=list[str])
    models: dict[str, str] = Field(default_factory=dict[str, str])


class EvalsPlanResult(BaseModel):
    """The arms, and ``running``: the id of the measurement that runs now, else null. Only one
    runs at a time, so while it does ``evals.start`` is refused."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    arms: list[EvalPlanArm]
    running: str | None = Field(default=None, min_length=1)
    asks: list[EvalAsk] = Field(default_factory=list[EvalAsk])


class EvalsStartParams(BaseModel):
    """``evals.start``. Begin a measurement of ``arms``, with the helper rules of ``config.toml``.

    ``models`` maps an arm's name to the model to use instead of its own. ``allow_tight`` lets
    a local arm run when its verdict is ``tight``. ``own_risk`` also lets one run whose verdict is
    ``too_big``, ``no_room`` or ``unknown`` (and a ``tight`` one); it is the person's yes to a
    warning, and is recorded in the measurement. An arm that cannot run at all (``runnable`` is
    false in the plan) is refused either way. It answers at once; the progress arrives as
    ``eval.progress`` and the end as ``eval.ended``.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    arms: list[str] = Field(min_length=1)
    models: dict[str, str] = Field(default_factory=dict[str, str])
    allow_tight: bool = False
    own_risk: bool = False

    @model_validator(mode="after")
    def _arms_are_distinct(self) -> Self:
        if len(set(self.arms)) != len(self.arms):
            raise ValueError("an arm is named once")
        return self


class EvalsStartResult(BaseModel):
    """``id`` is the new measurement."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(min_length=1)


class EvalArmUsed(BaseModel):
    """An arm of a measurement and the model it ran with."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)
    model: str = Field(min_length=1)


class EvalRun(BaseModel):
    """One ask played once on one arm.

    ``quality`` is the answer's score from 0 to 1, ``seconds`` the time, ``window_left`` the
    share of the window that was still free at the fullest point (0 to 1), and
    ``helpers_started`` how many helpers the lead started. They are null for a run that has no
    result: ``pending``, ``running`` and ``not_run``. ``answer`` is the model's final answer, cut
    to 2,000 characters (empty when none was kept), and ``found`` and ``missing`` are the facts
    of the ask that it mentions and lacks.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    arm: str = Field(min_length=1)
    ask: str = Field(min_length=1)
    mode: EvalMode
    end: EvalRunEnd
    quality: float | None = Field(default=None, ge=0, le=1)
    seconds: float | None = Field(default=None, ge=0)
    window_left: float | None = Field(default=None, ge=0, le=1)
    helpers_started: int | None = Field(default=None, ge=0)
    answer: str = Field(default="", max_length=2000)
    found: list[str] = Field(default_factory=list[str])
    missing: list[str] = Field(default_factory=list[str])

    @model_validator(mode="after")
    def _no_numbers_without_a_result(self) -> Self:
        if self.end in ("pending", "running", "not_run") and (
            self.quality is not None
            or self.seconds is not None
            or self.window_left is not None
            or self.helpers_started is not None
            or self.answer
            or self.found
            or self.missing
        ):
            raise ValueError(f"a run that is {self.end} has no numbers")
        return self


class EvalNumber(BaseModel):
    """One of the four numbers of ``[agents.delegate]``.

    ``current`` is the value in force, ``proposed`` the measured one. ``measured`` is false when
    the arms that ran could not tell, and ``proposed`` is then null. ``note`` says in one plain
    line what it was measured from, or why it was not.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    key: EvalNumberKey
    current: float
    proposed: float | None = None
    measured: bool
    note: str = ""

    @model_validator(mode="after")
    def _measured_has_a_value(self) -> Self:
        if self.measured != (self.proposed is not None):
            raise ValueError("a number is measured exactly when it has a proposed value")
        return self


class EvalProposal(BaseModel):
    """What a measurement proposes: all four numbers, once each. ``pairs`` is how many asks ran
    both with and without helpers, and ``wins`` in how many of them helpers did better."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    numbers: list[EvalNumber]
    pairs: int = Field(ge=0)
    wins: int = Field(ge=0)

    @model_validator(mode="after")
    def _the_four_numbers(self) -> Self:
        if tuple(sorted(number.key for number in self.numbers)) != _EVAL_NUMBER_KEYS:
            raise ValueError("a proposal has the four numbers, once each")
        if self.wins > self.pairs:
            raise ValueError("wins cannot be more than pairs")
        return self


class EvalMeasurement(BaseModel):
    """A whole measurement, as ``evals.get`` returns it.

    ``runs`` holds every planned run in order, with the ones not yet played as ``pending`` and
    the ones that will not be played as ``not_run``. ``asks`` are the asks of the set as they
    were when it started, ``arm_params`` what each arm ran with, ``rules`` the four numbers of
    ``[agents.delegate]`` in force when it started and ``golem_version`` the version that ran it
    (each empty or null for a measurement kept before they were recorded). ``own_risk`` is true
    when it was started, or resumed, at the person's own risk. ``stop_reason`` is plain text and
    is set only when the state is ``stopped``. ``proposal`` is null while it runs and when too
    little ran to propose anything. ``in_use`` is true when its numbers were applied and still are
    the ones in ``config.toml``. ``cost_usd`` is what the paid arms cost.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(min_length=1)
    started_at: str = Field(min_length=1)
    ended_at: str | None = Field(default=None, min_length=1)
    state: EvalState
    stop_reason: str | None = Field(default=None, min_length=1)
    arms: list[EvalArmUsed]
    runs: list[EvalRun]
    proposal: EvalProposal | None = None
    in_use: bool = False
    cost_usd: float | None = Field(default=None, ge=0)
    asks: list[EvalAsk] = Field(default_factory=list[EvalAsk])
    arm_params: list[EvalArmParams] = Field(default_factory=list[EvalArmParams])
    rules: dict[str, float] = Field(default_factory=dict[str, float])
    golem_version: str | None = Field(default=None, min_length=1)
    own_risk: bool = False

    @model_validator(mode="after")
    def _state_fits_the_rest(self) -> Self:
        if self.state == "running" and self.ended_at is not None:
            raise ValueError("a running measurement has not ended")
        if self.state != "running" and self.ended_at is None:
            raise ValueError("a measurement that is not running has ended")
        if self.stop_reason is not None and self.state != "stopped":
            raise ValueError("only a stopped measurement has a stop reason")
        if self.in_use and self.proposal is None:
            raise ValueError("a measurement without a proposal cannot be in use")
        return self


class EvalSummary(BaseModel):
    """One line of ``evals.list``. ``runs_played`` of ``runs_total`` are done, and ``proposes``
    is how many of the four numbers it measured."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(min_length=1)
    started_at: str = Field(min_length=1)
    ended_at: str | None = Field(default=None, min_length=1)
    state: EvalState
    stop_reason: str | None = Field(default=None, min_length=1)
    arms: list[EvalArmUsed]
    runs_played: int = Field(ge=0)
    runs_total: int = Field(ge=0)
    proposes: int = Field(default=0, ge=0, le=4)
    in_use: bool = False
    cost_usd: float | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def _played_within_total(self) -> Self:
        if self.runs_played > self.runs_total:
            raise ValueError("runs_played is at most runs_total")
        if self.stop_reason is not None and self.state != "stopped":
            raise ValueError("only a stopped measurement has a stop reason")
        return self


class EvalsStopParams(BaseModel):
    """``evals.stop``. Stop a running measurement and keep the runs done so far."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(min_length=1)


class EvalsStopResult(BaseModel):
    """``stopped`` is false when that measurement was not running."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    stopped: bool


class EvalsResumeParams(BaseModel):
    """``evals.resume``. Play the runs a stopped measurement did not play. The same checks as
    ``evals.start`` apply, and ``allow_tight`` or ``own_risk`` is asked for again."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(min_length=1)
    allow_tight: bool = False
    own_risk: bool = False


class EvalsResumeResult(BaseModel):
    """The measurement goes on under the same ``id``."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(min_length=1)


class EvalsListParams(BaseModel):
    """``evals.list``. The measurements kept on this machine, the newest first."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class EvalsListResult(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    measurements: list[EvalSummary] = Field(default_factory=list[EvalSummary])


class EvalsGetParams(BaseModel):
    """``evals.get``. One measurement with its runs and its proposal."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(min_length=1)


class EvalsGetResult(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    measurement: EvalMeasurement


class EvalsApplyParams(BaseModel):
    """``evals.apply``. Write the measured numbers of a measurement to ``[agents.delegate]`` in
    ``config.toml``. A number that was not measured stays as it is."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(min_length=1)


class EvalsApplyResult(BaseModel):
    """``ok`` is false when nothing could be written, with the reasons in ``errors``. ``values``
    is what is in force now, set when ``ok``."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    ok: bool
    errors: list[ConfigError] = Field(default_factory=list[ConfigError])
    values: AgentsKeepValues | None = None


class EvalsDeleteParams(BaseModel):
    """``evals.delete``. Delete a measurement that is not running. The numbers in
    ``config.toml`` stay."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(min_length=1)


class EvalsDeleteResult(BaseModel):
    """``deleted`` is false when there was no such measurement."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    deleted: bool


class EvalStarted(BaseModel):
    """``eval.started``. A measurement began, or went on after ``evals.resume``. ``total`` is
    the runs it will play."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(min_length=1)
    started_at: str = Field(min_length=1)
    arms: list[EvalArmUsed]
    total: int = Field(ge=1)


class EvalProgress(BaseModel):
    """``eval.progress``. A run began, or its state changed. ``index`` counts from 1 of
    ``total``. ``state`` is ``running`` while it plays and then how it ended. ``elapsed`` is
    the seconds since the measurement began. ``memory_used_gb`` and ``memory_total_gb`` are the
    machine's memory now, each null when it could not be read."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(min_length=1)
    index: int = Field(ge=1)
    total: int = Field(ge=1)
    arm: str = Field(min_length=1)
    mode: EvalMode
    ask: str = Field(min_length=1)
    state: Literal["running", "completed", "failed", "cancelled", "timeout"]
    elapsed: float = Field(ge=0)
    memory_used_gb: float | None = Field(default=None, ge=0)
    memory_total_gb: float | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def _index_within_total(self) -> Self:
        if self.index > self.total:
            raise ValueError("index is at most total")
        return self


class EvalEnded(BaseModel):
    """``eval.ended``. A measurement is no longer running. ``state`` is ``done`` or ``stopped``,
    and ``stop_reason`` says why in plain text when it stopped."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(min_length=1)
    state: Literal["stopped", "done"]
    stop_reason: str | None = Field(default=None, min_length=1)

    @model_validator(mode="after")
    def _reason_only_when_stopped(self) -> Self:
        if self.stop_reason is not None and self.state != "stopped":
            raise ValueError("only a stopped measurement has a stop reason")
        return self


WorkflowState = Literal["ok", "broken", "untrusted"]
"""``broken`` did not load (see ``error``). ``untrusted`` sits in a folder that is not trusted."""
WorkflowRunStatus = Literal["pending", "running", "waiting", "done", "failed", "cancelled"]
WorkflowStepStatus = Literal[
    "pending", "running", "waiting", "done", "failed", "skipped", "in_doubt"
]
WorkflowStepKind = Literal["step", "agent", "review", "notify", "llm", "tool", "skill"]
WorkflowTriggerKind = Literal["manual", "schedule", "on_file"]
WorkflowRunTrigger = str
"""What started a run, as ``workflow_runs.trigger`` stores it: ``manual``, ``schedule``, ``file``,
``chat``, ``try``, or ``routine:<name>`` for a run a routine started."""
WorkflowStartTrigger = Literal["manual", "try", "chat"]
"""What a client may start a run with. The daemon starts ``schedule`` and ``file`` runs itself."""


class WorkflowTriggerInfo(BaseModel):
    """What starts a workflow. ``expr`` is for ``schedule``, ``path`` for ``on_file``."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    kind: WorkflowTriggerKind
    expr: str | None = None
    path: str | None = None


class WorkflowInputInfo(BaseModel):
    """One declared input: its name, its type name and the default as written, if any."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)
    type: str | None = None
    default: str | None = None


class WorkflowEntryInfo(BaseModel):
    """One workflow the daemon found (ADR-062).

    ``id`` is ``<path>::<name>``, or the path for a file with no workflow. ``project`` is the
    project folder, null for the user's folder. ``error`` is the traceback tail of a ``broken``
    file. ``trigger`` is null for a workflow with none.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(min_length=1)
    name: str
    path: str = Field(min_length=1)
    project: str | None = None
    state: WorkflowState
    error: str | None = None
    trigger: WorkflowTriggerInfo | None = None
    inputs: list[WorkflowInputInfo] = Field(default_factory=list[WorkflowInputInfo])
    description: str = ""
    title: str | None = None
    """The name from ``@workflow(title=)``; null when the file gives none."""


class WorkflowStepArg(BaseModel):
    """One argument of a ``run.*`` call, with its exact place in the source.

    ``line`` and ``end_line`` count from 1; ``col`` and ``end_col`` are character offsets from 0,
    ``end_col`` just after the last character. ``literal`` is true for a plain string, number or
    bool, or an f-string with no expressions; ``value`` is then its text. A value the code
    computes has ``literal`` false: it is shown, and set in the code.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)
    source: str
    literal: bool
    value: str | None = None
    line: int = Field(ge=1)
    col: int = Field(ge=0)
    end_line: int = Field(ge=1)
    end_col: int = Field(ge=0)


class WorkflowOutlineStep(BaseModel):
    """One step read from the source, without running it.

    ``lines`` is the first and last line in the file (from 1). ``key`` and ``group`` are the
    step's key and the group it belongs to, when the source says them. ``for_each`` and
    ``condition`` are the source text of the loop and the guard. ``after`` lists the ids of the
    steps this one follows.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(min_length=1)
    kind: str = Field(min_length=1)
    title: str
    agent: str | None = None
    lines: tuple[int, int]
    group: str | None = None
    for_each: str | None = None
    condition: str | None = None
    key: str | None = None
    gets: str | None = None
    budget: str | None = None
    brief_line: int | None = Field(default=None, ge=1)
    budget_line: int | None = Field(default=None, ge=1)
    after: list[str] = Field(default_factory=list[str])
    args: list[WorkflowStepArg] = Field(default_factory=list[WorkflowStepArg])
    """The arguments of the step's ``run.*`` call, in source order. A code step has none."""
    item: str | None = None
    """The source text of the ``item=`` expression of a ``run.step``."""
    group_title: str | None = None
    """The ``title=`` of the ``run.parallel`` the step is in, when it is a string literal."""
    does: str | None = None
    """The first sentence of the docstring of the function a ``run.step`` calls, when that
    function is in the same file."""


class WorkflowListParams(BaseModel):
    """``workflow.list``. The workflows of the user's folder and of ``folders``.

    A project folder that is not trusted lists its files as ``untrusted`` and never imports them.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    folders: list[str] = Field(default_factory=list[str])


class WorkflowListResult(BaseModel):
    """The workflows, user ones first, each group in file order."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    workflows: list[WorkflowEntryInfo]


class WorkflowGetParams(BaseModel):
    """``workflow.get``. One workflow by its ``id``."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(min_length=1)


class WorkflowGetResult(BaseModel):
    """The workflow and its outline steps (empty for a ``broken`` or ``untrusted`` file).

    ``code`` is the text of the file, for the Code tab. It is set only for a workflow the registry
    lists as ``ok`` (a trusted one), and null when the file cannot be read.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    workflow: WorkflowEntryInfo
    steps: list[WorkflowOutlineStep] = Field(default_factory=list[WorkflowOutlineStep])
    code: str | None = None
    code_hash: str | None = None
    """sha256 of the file's bytes, the ``base_hash`` of a ``workflow.save``."""


class WorkflowProblem(BaseModel):
    """One finding of ``workflow.check``, with the line it is on and the outline step it belongs
    to (null for the header or the whole file). ``fix`` is a short replacement text or the name
    of an action."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    severity: Literal["error", "warning"]
    line: int = Field(ge=1)
    step_id: str | None = None
    message: str = Field(min_length=1)
    fix: str | None = None


class WorkflowCheckParams(BaseModel):
    """``workflow.check``. Check the workflow ``id``. Without ``code`` it checks the saved file;
    with ``code`` it checks that text and returns its outline (no file is read or written, and
    no model is asked)."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(min_length=1)
    code: str | None = None


class WorkflowCheckResult(BaseModel):
    """The problems, in line order, and the outline steps of the checked text."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    problems: list[WorkflowProblem] = Field(default_factory=list[WorkflowProblem])
    steps: list[WorkflowOutlineStep] = Field(default_factory=list[WorkflowOutlineStep])


class WorkflowProposeParams(BaseModel):
    """``workflow.propose``. Ask golem for a change to the workflow ``id``: ``code`` is the text
    in the editor and ``ask`` the sentence. ``previous_code`` and ``previous_note`` are the last
    proposal and its note, for a refine (one more sentence on top of it). Nothing is written."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(min_length=1)
    code: str
    ask: str = Field(min_length=1)
    previous_code: str | None = None
    previous_note: str | None = None


class WorkflowProposeResult(BaseModel):
    """The proposed file, one or two sentences on what changed and why, its outline steps, the
    problems the check found in it and the model that wrote it. The proposal is never saved."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    code: str
    note: str
    steps: list[WorkflowOutlineStep] = Field(default_factory=list[WorkflowOutlineStep])
    problems: list[WorkflowProblem] = Field(default_factory=list[WorkflowProblem])
    model: str


class WorkflowEditStepParams(BaseModel):
    """``workflow.edit_step``. Set one argument of one step in ``code`` (the text the editor holds).

    ``name`` is the argument (``type``, ``brief``, ``model``, ``budget``, ``key``, ...) and
    ``value`` its new literal. Only that argument's source span is replaced, or ``name=value`` is
    added when the call lacks it. Refused for a code step, an argument the code computes and a
    value that is not valid for it.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(min_length=1)
    code: str
    step_id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    value: str | float | bool


class WorkflowEditStepResult(BaseModel):
    """The new text, its outline and its problems. Nothing is written; the editor holds the
    text as an unsaved edit."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    code: str
    steps: list[WorkflowOutlineStep] = Field(default_factory=list[WorkflowOutlineStep])
    problems: list[WorkflowProblem] = Field(default_factory=list[WorkflowProblem])


class WorkflowSaveParams(BaseModel):
    """``workflow.save``. Write ``code`` as the file of the workflow ``id``.

    ``base_hash`` is the ``code_hash`` the editor started from. The call is refused when the file
    changed on disk since, when ``code`` has an ``error`` problem, and for an untrusted folder.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(min_length=1)
    code: str
    base_hash: str = Field(min_length=1)


class WorkflowSaveResult(BaseModel):
    """The workflow as the registry reloaded it, its steps, the warnings and the new hash."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    workflow: WorkflowEntryInfo
    steps: list[WorkflowOutlineStep] = Field(default_factory=list[WorkflowOutlineStep])
    problems: list[WorkflowProblem] = Field(default_factory=list[WorkflowProblem])
    code_hash: str = Field(min_length=1)


class WorkflowStarterInfo(BaseModel):
    """One starter workflow golem ships. ``needs_folder`` says it reads a project, so it goes
    in that project's ``workflows`` folder; the others go in the user's."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(min_length=1)
    title: str
    line: str
    needs_folder: bool
    schedule: str | None = None
    """When it runs by itself, as a line to show before it is added. Null for never."""


class WorkflowStartersParams(BaseModel):
    """``workflow.starters``. The starter workflows."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class WorkflowStartersResult(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    starters: list[WorkflowStarterInfo]


class WorkflowAddStarterParams(BaseModel):
    """``workflow.add_starter``. Write the starter ``id`` as a workflow file.

    A ``needs_folder`` starter needs ``folder`` (a trusted project folder); the others go in the
    user's folder. Refused for an unknown id, an untrusted folder and a file that exists.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(min_length=1)
    folder: str | None = None


class WorkflowAddStarterResult(BaseModel):
    """The new workflow: ``id`` is the one ``workflow.get`` takes."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    path: str = Field(min_length=1)


class WorkflowStartParams(BaseModel):
    """``workflow.start``. Start a run of the workflow ``id`` with ``inputs``.

    ``trigger`` says what asked for it. A person pressing Run is ``manual``.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(min_length=1)
    inputs: dict[str, Any] = Field(default_factory=dict[str, Any])
    trigger: WorkflowStartTrigger = "manual"


class WorkflowStartResult(BaseModel):
    """The run ``workflow.start`` made."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    workflow_run_id: str = Field(min_length=1)


class WorkflowRunInfo(BaseModel):
    """One run of a workflow, from its ``workflow_runs`` row.

    The times are ISO 8601 with an offset. ``session_id`` is the run's headless session, null
    until a step needs one. ``error`` says why a ``failed`` run failed.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    workflow_run_id: str = Field(min_length=1)
    workflow_id: str = Field(min_length=1)
    name: str
    status: WorkflowRunStatus
    trigger: WorkflowRunTrigger
    inputs: dict[str, Any] = Field(default_factory=dict[str, Any])
    session_id: str | None = Field(default=None, min_length=1)
    started_at: str | None = None
    finished_at: str | None = None
    error: str | None = None


class WorkflowStepInfo(BaseModel):
    """One step of a run, from its ``workflow_steps`` row.

    ``key`` is the step key the engine journals by, ``group`` the key of the group it runs in.
    ``attempts`` counts starts. ``child_session_id`` is the helper session of an ``agent`` step.
    ``in_doubt`` is a step that may have had its effect before the daemon stopped.
    ``result`` is the step's saved JSON, parsed, or null while it has none.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    key: str = Field(min_length=1)
    kind: WorkflowStepKind
    title: str
    status: WorkflowStepStatus
    group: str | None = None
    group_title: str | None = None
    """The title of the ``run.parallel`` group, when the workflow gave one."""
    item: str | None = None
    """The part that changes in a loop (``item=`` of a ``run.step``)."""
    attempts: int = Field(default=0, ge=0)
    error: str | None = None
    child_session_id: str | None = Field(default=None, min_length=1)
    model: str | None = None
    """The model that answered an ``llm`` step, as ``provider/name``."""
    cost_usd: float | None = Field(default=None, ge=0)
    """What the call of an ``llm`` step cost, or None when it was not priced."""
    started_at: str | None = None
    finished_at: str | None = None
    result: Any = None


class WorkflowStatusParams(BaseModel):
    """``workflow.status``. A run and its steps."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    workflow_run_id: str = Field(min_length=1)


class WorkflowReviewInfo(BaseModel):
    """A review a run waits on, with its whole draft (the pending item's ``preview`` is cut).

    ``draft`` is the JSON ``run.review`` was given. ``key`` is the step key that
    ``workflow.review.answer`` names. ``answered`` is false for every review
    ``WorkflowStatusResult.reviews`` lists.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    key: str = Field(min_length=1)
    ask: str
    draft: Any = None
    created_at: str
    answered: bool = False


class WorkflowStatusResult(BaseModel):
    """The run and its steps, in the order they started.

    ``reviews`` are the run's open reviews (those without an answer), oldest first, with their
    full drafts. An older daemon leaves it out.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    run: WorkflowRunInfo
    steps: list[WorkflowStepInfo] = Field(default_factory=list[WorkflowStepInfo])
    reviews: list[WorkflowReviewInfo] = Field(default_factory=list[WorkflowReviewInfo])


class WorkflowCancelParams(BaseModel):
    """``workflow.cancel``. Stop a run. A run that already ended is left as it is."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    workflow_run_id: str = Field(min_length=1)


class WorkflowCancelResult(BaseModel):
    """``cancelled`` is false when the run had already ended."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    cancelled: bool


class WorkflowResumeParams(BaseModel):
    """``workflow.resume``. Continue a run that stopped: ``running`` (left by a restart),
    ``waiting`` (``on_restart="ask"``) or ``failed``. Finished steps are not run again."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    workflow_run_id: str = Field(min_length=1)


class WorkflowResumeResult(BaseModel):
    """The run as it was when it was continued; its steps arrive as ``workflow.step.*``."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    run: WorkflowRunInfo


WorkflowReviewVerdict = Literal["approve", "edit", "reject"]


class WorkflowReviewAnswerParams(BaseModel):
    """``workflow.review.answer``. Answer the review ``key`` of a waiting run.

    ``verdict`` is ``approve`` (the draft as it is), ``edit`` (``text`` replaces it, so it is
    required) or ``reject``. ``text`` is the answer's text; for ``approve`` it defaults to the
    draft. The answer is saved, then the run continues once none of its reviews waits. A
    ``reject`` goes back to the workflow code, which decides what it means.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    workflow_run_id: str = Field(min_length=1)
    key: str = Field(min_length=1)
    verdict: WorkflowReviewVerdict
    text: str | None = None


class WorkflowReviewAnswerResult(BaseModel):
    """The run as it was when the answer was saved; its steps arrive as ``workflow.step.*``."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    run: WorkflowRunInfo


class WorkflowRunEvent(BaseModel):
    """The params of ``workflow.run.started|waiting|resumed|done|failed|cancelled``.

    The method names the change, ``status`` is the run's state after it. ``error`` is set for
    ``workflow.run.failed``. The name is ``workflow.run.*``, never ``run.*`` (ADR-050).
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    workflow_run_id: str = Field(min_length=1)
    workflow_id: str = Field(min_length=1)
    name: str
    status: WorkflowRunStatus
    trigger: WorkflowRunTrigger | None = None
    session_id: str | None = Field(default=None, min_length=1)
    started_at: str | None = None
    finished_at: str | None = None
    error: str | None = None


class WorkflowStepEvent(BaseModel):
    """The params of ``workflow.step.started|done|failed|waiting|in_doubt``.

    The method names the change, ``status`` is the step's state after it. ``key`` is the step
    key, ``group`` the key of its group, ``attempts`` the number of starts so far.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    workflow_run_id: str = Field(min_length=1)
    key: str = Field(min_length=1)
    kind: WorkflowStepKind
    title: str
    status: WorkflowStepStatus
    group: str | None = None
    group_title: str | None = None
    """The title of the ``run.parallel`` group, when the workflow gave one."""
    item: str | None = None
    """The part that changes in a loop (``item=`` of a ``run.step``)."""
    attempts: int = Field(default=0, ge=0)
    error: str | None = None
    child_session_id: str | None = Field(default=None, min_length=1)
    model: str | None = None
    """The model that answered an ``llm`` step, as ``provider/name``."""
    cost_usd: float | None = Field(default=None, ge=0)
    """What the call of an ``llm`` step cost, or None when it was not priced."""
    started_at: str | None = None
    finished_at: str | None = None
    result: Any = None
    """The step's saved JSON, parsed."""


DataPrivacy = Literal["open", "local", "schema"]
"""What may leave the machine: ``open`` anything, ``local`` local models, ``schema`` names."""

DataSourceKind = Literal["builtin", "files", "sqlite", "duckdb", "postgres", "mysql", "url"]
DataScope = Literal["builtin", "user", "project"]
DataExtension = Literal["excel", "sqlite", "postgres", "mysql"]
DataSourceStatus = Literal["ready", "reading", "untrusted", "error"]
DataValue = str | int | float | bool | None
"""One cell on the wire. Dates and times are ISO strings, decimals are numbers."""


class DataColumn(BaseModel):
    """One column. The stats are null when unknown or hidden."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)
    type: str
    min: str | None = None
    max: str | None = None
    distinct: int | None = Field(default=None, ge=0)
    distinct_estimate: bool = False
    """True when ``distinct`` is an estimate, not an exact count."""
    null_fraction: float | None = Field(default=None, ge=0, le=1)


class DataTable(BaseModel):
    """One table. ``rows`` is null when unknown or hidden."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)
    rows: int | None = Field(default=None, ge=0)
    columns: list[DataColumn] = Field(default_factory=list[DataColumn])


class DataSource(BaseModel):
    """One data source. ``location`` is for display and never holds a password."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)
    kind: DataSourceKind
    scope: DataScope
    project: str | None = None
    location: str
    privacy: DataPrivacy
    privacy_reason: str | None = None
    status: DataSourceStatus
    error: str | None = None
    tables: int | None = Field(default=None, ge=0)
    rows: int | None = Field(default=None, ge=0)
    watch: bool = False
    notes_path: str | None = None
    needs_extension: DataExtension | None = None
    """The extension to download once before this source can be read."""
    in_keychain: bool = False
    """True when the password is in the Keychain as ``data/<name>``. It is never sent."""
    timeout_s: float | None = None
    """For a database: seconds a query may run on the server."""
    warning: str | None = None
    """For a database: a sentence when its login can change data."""


class DataSavedQuery(BaseModel):
    """A query saved with a source."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)
    sql: str
    description: str | None = None
    last_run_at: str | None = None


class DataResult(BaseModel):
    """Rows of a query, or one page of them. ``total_rows`` is null while unknown."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    result_id: str = Field(min_length=1)
    source: str
    columns: list[DataColumn]
    rows: list[list[DataValue]]
    total_rows: int | None = Field(default=None, ge=0)
    truncated: bool = False
    elapsed_ms: int = Field(ge=0)


class DataListParams(BaseModel):
    """``data.list``. Every source the user can see."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    session_id: str | None = Field(default=None, min_length=1)


class DataListResult(BaseModel):
    """The sources."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    sources: list[DataSource]


class DataInspectParams(BaseModel):
    """``data.inspect``. Look at a location before it is added.

    A file or a folder is a ``location``. A database is ``kind`` (``postgres`` or ``mysql``) with
    ``host``, ``port``, ``database``, ``user`` and ``ssl_mode``, and its ``password`` for this
    one look: it is used to connect and is not stored.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    location: str | None = Field(default=None, min_length=1)
    kind: Literal["postgres", "mysql"] | None = None
    host: str | None = Field(default=None, min_length=1)
    port: int | None = Field(default=None, ge=1, le=65535)
    database: str | None = Field(default=None, min_length=1)
    user: str | None = Field(default=None, min_length=1)
    ssl_mode: str | None = Field(default=None, min_length=1)
    password: SecretStr | None = None
    session_id: str | None = Field(default=None, min_length=1)


class DataInspectResult(BaseModel):
    """What a location holds. ``notes`` are plain-language guesses. ``sample``: 20 rows a table."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    kind: DataSourceKind
    files: int | None = Field(default=None, ge=0)
    tables: list[DataTable]
    sample: dict[str, list[list[DataValue]]]
    suggested_name: str
    suggested_privacy: DataPrivacy
    privacy_reason: str | None = None
    notes: list[str] = Field(default_factory=list[str])
    needs_extension: DataExtension | None = None
    """Set when the location cannot be read until that extension is downloaded. ``notes`` then
    holds the sentence that asks, and ``tables`` is empty."""
    url: str | None = None
    """For a database: its address with no password, which ``data.add`` takes as ``location``."""
    server_version: str | None = None
    """For a database: such as ``PostgreSQL 17.2``."""
    warning: str | None = None
    """For a database: a sentence when its login can change data, with a way to make a safer one."""


class DataAddParams(BaseModel):
    """``data.add``. ``password`` goes to the Keychain and is never written to a file."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)
    location: str = Field(min_length=1)
    kind: DataSourceKind | None = None
    privacy: DataPrivacy
    scope: Literal["user", "project"]
    watch: bool = False
    password: SecretStr | None = None
    session_id: str | None = Field(default=None, min_length=1)


class DataAddResult(BaseModel):
    """The new source."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    source: DataSource


class DataUpdateParams(BaseModel):
    """``data.update``. Only the fields that are set change."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)
    privacy: DataPrivacy | None = None
    watch: bool | None = None
    password: SecretStr | None = None
    """A new password for a database source. It goes to the Keychain and is never returned."""
    timeout_s: float | None = Field(default=None, gt=0, le=3600)
    include: list[str] | None = None
    exclude: list[str] | None = None
    session_id: str | None = Field(default=None, min_length=1)


class DataUpdateResult(BaseModel):
    """The source after the change."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    source: DataSource


class DataExtensionInstallParams(BaseModel):
    """``data.extension.install``. Download a DuckDB extension once, into golem's folder."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: DataExtension


class DataExtensionInstallResult(BaseModel):
    """Empty."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class DataRemoveParams(BaseModel):
    """``data.remove``."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)
    session_id: str | None = Field(default=None, min_length=1)


class DataRemoveResult(BaseModel):
    """Empty."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class DataDescribeParams(BaseModel):
    """``data.describe``. A source, or one table of it."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    source: str = Field(min_length=1)
    table: str | None = Field(default=None, min_length=1)
    session_id: str | None = Field(default=None, min_length=1)


class DataDescribeResult(BaseModel):
    """The source with its tables, a sample, its notes and saved queries."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    source: DataSource
    tables: list[DataTable]
    sample: dict[str, list[list[DataValue]]]
    notes: str | None = None
    queries: list[DataSavedQuery] = Field(default_factory=list[DataSavedQuery])


class DataQueryParams(BaseModel):
    """``data.query``. Run SQL on one source."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    source: str = Field(min_length=1)
    sql: str = Field(min_length=1)
    limit: int | None = Field(default=None, ge=1)
    result_id: str | None = Field(default=None, min_length=1)
    """An id the client picks, so it can ``data.cancel`` the query by it. None: the daemon picks."""
    session_id: str | None = Field(default=None, min_length=1)


class DataResultPageParams(BaseModel):
    """``data.result.page``. One page of a kept result, sorted if asked."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    result_id: str = Field(min_length=1)
    offset: int = Field(default=0, ge=0)
    limit: int = Field(default=200, ge=1, le=1000)
    sort_column: str | None = None
    sort_desc: bool = False


class DataProfileParams(BaseModel):
    """``data.profile``. The shape of each column of one table."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    source: str = Field(min_length=1)
    table: str = Field(min_length=1)
    session_id: str | None = Field(default=None, min_length=1)


class DataTopValue(BaseModel):
    """A value and how many rows have it."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    value: DataValue
    count: int = Field(ge=0)


class DataColumnProfile(BaseModel):
    """What one column looks like. For a person's screen: it never goes to a model."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)
    type: str
    shape: Literal["key", "number", "date", "category", "text"]
    empty: float = Field(ge=0, le=1)
    """The fraction of rows with no value."""
    distinct: int = Field(ge=0)
    distinct_estimate: bool = False
    """True when ``distinct`` is an estimate, not an exact count."""
    min: DataValue = None
    max: DataValue = None
    mean: float | None = None
    bins: list[int] | None = None
    """A number or a date: the rows in each of 24 equal-width bins from ``min`` to ``max``."""
    top: list[DataTopValue] = Field(default_factory=list[DataTopValue])
    """A category: its most frequent values, most frequent first."""
    more_values: int = Field(default=0, ge=0)
    """A category: how many more values there are than ``top`` lists."""
    more_rows: int = Field(default=0, ge=0)
    """A category: how many rows have those values."""
    unique_ratio: float | None = Field(default=None, ge=0, le=1)
    avg_length: float | None = None
    most_common: DataTopValue | None = None
    """Text: the value that repeats most, when one repeats."""


class DataProfileResult(BaseModel):
    """The columns of a table, one entry each, in their order."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    source: str
    table: str
    rows: int = Field(ge=0)
    distinct_estimate: bool = False
    """True when the table is big enough that its distinct counts are estimates."""
    columns: list[DataColumnProfile]


class DataBrowseSort(BaseModel):
    """A column to sort a view by."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    column: str = Field(min_length=1)
    desc: bool = False


class DataBrowseFilter(BaseModel):
    """One test on a column. ``=`` needs a ``value``; ``is null`` takes none."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    column: str = Field(min_length=1)
    op: Literal["=", "is null"]
    value: DataValue = None


class DataBrowseParams(BaseModel):
    """``data.browse``. A page of a table, sorted and filtered across all of its rows.

    It carries no SQL: the daemon builds it from names it checks against the table.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    source: str = Field(min_length=1)
    table: str = Field(min_length=1)
    offset: int = Field(default=0, ge=0)
    limit: int = Field(default=200, ge=1, le=500)
    sort: DataBrowseSort | None = None
    filters: list[DataBrowseFilter] = Field(default_factory=list[DataBrowseFilter])
    """At most 20: the data engine refuses more."""
    search: str | None = Field(default=None, max_length=200)
    """Rows with this text in any text column, in any case."""
    session_id: str | None = Field(default=None, min_length=1)


class DataBrowseResult(BaseModel):
    """The page, and how many rows the view has."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    columns: list[DataColumn]
    rows: list[list[DataValue]]
    total_rows: int | None = Field(default=None, ge=0)
    elapsed_ms: int = Field(ge=0)


class DataExportParams(BaseModel):
    """``data.export``. Write a kept result to a new file. It never overwrites one."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    result_id: str = Field(min_length=1)
    path: str = Field(min_length=1)
    format: Literal["csv", "parquet", "json", "xlsx"] | None = None
    """None: from the end of ``path``."""
    session_id: str | None = Field(default=None, min_length=1)
    """The session whose folder a relative ``path`` is relative to, and whose sources count."""


class DataExportResult(BaseModel):
    """The file written. With ``needs_extension`` nothing was written: that add-on is not here."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    path: str
    rows: int = Field(ge=0)
    needs_extension: DataExtension | None = None


class DataCancelParams(BaseModel):
    """``data.cancel``. Stop a query that is still running."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    result_id: str = Field(min_length=1)


class DataCancelResult(BaseModel):
    """Empty."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class DataNotesGetParams(BaseModel):
    """``data.notes.get``."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    source: str = Field(min_length=1)
    session_id: str | None = Field(default=None, min_length=1)


class DataNotesGetResult(BaseModel):
    """The notes, null when there are none."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    text: str | None = None
    path: str | None = None


class DataNotesSetParams(BaseModel):
    """``data.notes.set``."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    source: str = Field(min_length=1)
    text: str
    session_id: str | None = Field(default=None, min_length=1)


class DataNotesSetResult(BaseModel):
    """Where the notes were saved."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    path: str


class DataNotesDraftParams(BaseModel):
    """``data.notes.draft``. Ask for a proposal."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    source: str = Field(min_length=1)
    session_id: str | None = Field(default=None, min_length=1)


class DataNotesDraftResult(BaseModel):
    """A proposal. It is not saved."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    text: str


class DataQueriesSaveParams(BaseModel):
    """``data.queries.save``."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    source: str = Field(min_length=1)
    name: str = Field(min_length=1)
    sql: str = Field(min_length=1)
    description: str | None = None
    session_id: str | None = Field(default=None, min_length=1)


class DataQueriesSaveResult(BaseModel):
    """The saved query."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    query: DataSavedQuery


class DataQueriesRemoveParams(BaseModel):
    """``data.queries.remove``."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    source: str = Field(min_length=1)
    name: str = Field(min_length=1)
    session_id: str | None = Field(default=None, min_length=1)


class DataQueriesRemoveResult(BaseModel):
    """Empty."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class DataChanged(BaseModel):
    """A source or the list changed. List again. ``source`` is null when the list itself changed."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    source: str | None = None
    reason: Literal["added", "updated", "removed", "files", "notes", "queries"]


__all__ = [
    "AgentInfo",
    "AgentLimitKey",
    "AgentLimits",
    "AgentOrigin",
    "AgentRegistryChanged",
    "AgentsDelegateNumber",
    "AgentsDelegateValues",
    "AgentsGetParams",
    "AgentsGetResult",
    "AgentsKeepParams",
    "AgentsKeepResult",
    "AgentsKeepValues",
    "AgentsListParams",
    "AgentsListResult",
    "AgentsSetDefaultLimitsParams",
    "AgentsSetLimitsParams",
    "AgentsSetLimitsResult",
    "AgentsSetWishParams",
    "AgentsSetWishResult",
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
    "B64Key32",
    "B64Key65",
    "B64Message",
    "B64Sig64",
    "ChangedFile",
    "ChangesCommitInfoParams",
    "ChangesCommitInfoResult",
    "ChangesCommitParams",
    "ChangesCommitResult",
    "ChangesDiffParams",
    "ChangesDiffResult",
    "ChangesListParams",
    "ChangesListResult",
    "ChangesSuggestMessageParams",
    "ChangesSuggestMessageResult",
    "ChatDraftParams",
    "ChatDraftResult",
    "ChatGetParams",
    "ChatPromptParams",
    "ChatPromptPart",
    "ChatPromptResult",
    "ChatSetParams",
    "ChatSetResult",
    "ChatSuggestion",
    "ChatSuggestionDismissParams",
    "ChatSuggestionDismissResult",
    "ChatSuggestionsParams",
    "ChatSuggestionsResult",
    "ChatValues",
    "ConfigAllowance",
    "ConfigError",
    "ConfigGetParams",
    "ConfigGetResult",
    "ConfigLadder",
    "ConfigRawGetParams",
    "ConfigRawGetResult",
    "ConfigRawResult",
    "ConfigRawSetParams",
    "ConfigRouting",
    "ConfigRule",
    "ConnectionIdentifyParams",
    "ConnectionIdentifyResult",
    "CostDayRow",
    "CostGetParams",
    "CostGetResult",
    "CostModelRow",
    "CostRoleRow",
    "CostTotals",
    "DaemonStatus",
    "DataAddParams",
    "DataAddResult",
    "DataBrowseFilter",
    "DataBrowseParams",
    "DataBrowseResult",
    "DataBrowseSort",
    "DataCancelParams",
    "DataCancelResult",
    "DataChanged",
    "DataColumn",
    "DataColumnProfile",
    "DataDescribeParams",
    "DataDescribeResult",
    "DataExportParams",
    "DataExportResult",
    "DataExtension",
    "DataExtensionInstallParams",
    "DataExtensionInstallResult",
    "DataInspectParams",
    "DataInspectResult",
    "DataListParams",
    "DataListResult",
    "DataNotesDraftParams",
    "DataNotesDraftResult",
    "DataNotesGetParams",
    "DataNotesGetResult",
    "DataNotesSetParams",
    "DataNotesSetResult",
    "DataPrivacy",
    "DataProfileParams",
    "DataProfileResult",
    "DataQueriesRemoveParams",
    "DataQueriesRemoveResult",
    "DataQueriesSaveParams",
    "DataQueriesSaveResult",
    "DataQueryParams",
    "DataRemoveParams",
    "DataRemoveResult",
    "DataResult",
    "DataResultPageParams",
    "DataSavedQuery",
    "DataScope",
    "DataSource",
    "DataSourceKind",
    "DataSourceStatus",
    "DataTable",
    "DataTopValue",
    "DataUpdateParams",
    "DataUpdateResult",
    "DataValue",
    "DeviceChanged",
    "DeviceId",
    "DeviceInfo",
    "DeviceListParams",
    "DeviceListResult",
    "DevicePairBeginParams",
    "DevicePairBeginResult",
    "DevicePairChanged",
    "DevicePairConfirmParams",
    "DevicePairConfirmResult",
    "DevicePairRequestParams",
    "DevicePairRequestResult",
    "DeviceRenameParams",
    "DeviceRenameResult",
    "DeviceRevokeParams",
    "DeviceRevokeResult",
    "DeviceRule",
    "DeviceSyncParams",
    "DeviceSyncResult",
    "DirEntry",
    "EvalArmParams",
    "EvalArmUsed",
    "EvalAsk",
    "EvalAskReason",
    "EvalEnded",
    "EvalHelperRow",
    "EvalMeasurement",
    "EvalMemoryVerdict",
    "EvalMode",
    "EvalModelChoice",
    "EvalNumber",
    "EvalNumberKey",
    "EvalPlanArm",
    "EvalProgress",
    "EvalProposal",
    "EvalRoutingParams",
    "EvalRoutingResult",
    "EvalRun",
    "EvalRunEnd",
    "EvalScenarioRow",
    "EvalStarted",
    "EvalState",
    "EvalSummary",
    "EvalTier",
    "EvalTopSession",
    "EvalsApplyParams",
    "EvalsApplyResult",
    "EvalsDeleteParams",
    "EvalsDeleteResult",
    "EvalsGetParams",
    "EvalsGetResult",
    "EvalsListParams",
    "EvalsListResult",
    "EvalsPlanParams",
    "EvalsPlanResult",
    "EvalsResumeParams",
    "EvalsResumeResult",
    "EvalsStartParams",
    "EvalsStartResult",
    "EvalsStopParams",
    "EvalsStopResult",
    "FileListParams",
    "FileListResult",
    "FileReadParams",
    "FileReadResult",
    "FsChooseFolderParams",
    "FsChooseFolderResult",
    "FsListDirsParams",
    "FsListDirsResult",
    "FsRevealParams",
    "FsRevealResult",
    "GitBranch",
    "GitBranchesParams",
    "GitBranchesResult",
    "GitInfoParams",
    "GitInfoResult",
    "GitWorktree",
    "HelloParams",
    "HelloResult",
    "HelperApplyParams",
    "HelperApplyResult",
    "HelperDiscardParams",
    "HelperDiscardResult",
    "HelperRetryParams",
    "HelperRetryResult",
    "HelperStopParams",
    "HelperStopResult",
    "InspectMessage",
    "InstallMethod",
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
    "McpLoginDone",
    "McpLoginResult",
    "McpLogsParams",
    "McpLogsResult",
    "McpOAuthConfig",
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
    "MemoryAuthor",
    "MemoryChanged",
    "MemoryCounts",
    "MemoryDeleteParams",
    "MemoryDeleteResult",
    "MemoryExportParams",
    "MemoryExportResult",
    "MemoryGetParams",
    "MemoryGetResult",
    "MemoryItem",
    "MemoryKeptBy",
    "MemoryListParams",
    "MemoryListResult",
    "MemoryPrivacy",
    "MemoryScope",
    "MemorySettings",
    "MemorySettingsParams",
    "MemorySettingsResult",
    "MemorySource",
    "MemoryState",
    "MemoryUpdateParams",
    "MemoryUpdateResult",
    "MemoryWriteParams",
    "MemoryWriteResult",
    "MessageSendParams",
    "MessageSendResult",
    "ModelBenchDone",
    "ModelBenchParams",
    "ModelBenchProgress",
    "ModelBenchResult",
    "ModelBenchRow",
    "ModelCheckCase",
    "ModelCheckDone",
    "ModelCheckParams",
    "ModelCheckProgress",
    "ModelCheckResult",
    "ModelDeleteParams",
    "ModelDeleteResult",
    "ModelListParams",
    "ModelListResult",
    "ModelOption",
    "ModelOptionsGetParams",
    "ModelOptionsGetResult",
    "ModelOptionsSaved",
    "ModelOptionsSetParams",
    "ModelOptionsSetResult",
    "ModelPriceInfo",
    "ModelProbeParams",
    "ModelProbeResult",
    "ModelPullCancelParams",
    "ModelPullCancelResult",
    "ModelPullCleanupParams",
    "ModelPullCleanupResult",
    "ModelPullDone",
    "ModelPullParams",
    "ModelPullProgress",
    "ModelPullResult",
    "ModelScoreInfo",
    "ModelScoreResetParams",
    "ModelScoreResetResult",
    "ModelSetDefaultParams",
    "ModelSetDefaultResult",
    "ModelSpeedInfo",
    "ModelStarParams",
    "ModelStarResult",
    "NotificationsGetParams",
    "NotificationsSetParams",
    "NotificationsSetResult",
    "NotificationsValues",
    "NotifyTestParams",
    "NotifyTestResult",
    "OllamaInstallCancelParams",
    "OllamaInstallCancelResult",
    "OllamaInstallDone",
    "OllamaInstallOutput",
    "OllamaInstallParams",
    "OllamaInstallResult",
    "OllamaSettingsGetParams",
    "OllamaSettingsSetParams",
    "OllamaSettingsSetResult",
    "OllamaSettingsValues",
    "OllamaStartParams",
    "OllamaStartResult",
    "PairState",
    "PairingDevice",
    "PendingItem",
    "PermissionsSetModeParams",
    "PermissionsSetModeResult",
    "PingParams",
    "PolicyEditResult",
    "PolicyRemoveParams",
    "PolicyUpdateParams",
    "RelayDevice",
    "RelayDhParams",
    "RelayDhResult",
    "RelayPair",
    "RelaySignParams",
    "RelaySignResult",
    "RouteConsentAnswerParams",
    "RouteConsentAnswerResult",
    "RoutineChanged",
    "RoutineConfig",
    "RoutineFinished",
    "RoutineFired",
    "RoutineGetParams",
    "RoutineGetResult",
    "RoutineInfo",
    "RoutineIssue",
    "RoutineListParams",
    "RoutineListResult",
    "RoutinePreviewParams",
    "RoutinePreviewResult",
    "RoutineRemoveParams",
    "RoutineRemoveResult",
    "RoutineRunParams",
    "RoutineRunResult",
    "RoutineRunSummary",
    "RoutineUpdateParams",
    "RoutineUpdateResult",
    "RoutineWatchConfig",
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
    "SessionCompactParams",
    "SessionCompactResult",
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
    "SessionSetChecksParams",
    "SessionSetChecksResult",
    "SessionSetModeParams",
    "SessionSetModeResult",
    "SessionSetModelParams",
    "SessionSetModelResult",
    "SessionSetOptionsParams",
    "SessionSetOptionsResult",
    "SessionSetPlanParams",
    "SessionSetPlanResult",
    "SessionSetRouteParams",
    "SessionSetRouteResult",
    "SessionSetSkillsParams",
    "SessionSetSkillsResult",
    "SessionSummary",
    "SetupAction",
    "SetupInstall",
    "SetupJob",
    "SetupPart",
    "SetupPaths",
    "SetupRow",
    "SetupState",
    "SetupStatusParams",
    "SetupStatusResult",
    "SkillCreateParams",
    "SkillCreateResult",
    "SkillIssue",
    "SkillListParams",
    "SkillListResult",
    "SkillReadParams",
    "SkillReadResult",
    "SkillRegistryChanged",
    "SkillSetDisabledParams",
    "SkillSetDisabledResult",
    "SkillSource",
    "SkillWriteParams",
    "SkillWriteResult",
    "TraceContext",
    "TraceContextCleared",
    "TraceContextItem",
    "TraceContextPart",
    "TraceGetParams",
    "TraceGetResult",
    "TraceMessage",
    "TraceModelSpan",
    "TraceRoute",
    "TraceRunSpan",
    "TraceSpan",
    "TraceSpanParams",
    "TraceSpanResult",
    "TraceTokens",
    "TraceToolSpan",
    "WishResolution",
    "WorkflowAddStarterParams",
    "WorkflowAddStarterResult",
    "WorkflowCancelParams",
    "WorkflowCancelResult",
    "WorkflowEditStepParams",
    "WorkflowEditStepResult",
    "WorkflowEntryInfo",
    "WorkflowGetParams",
    "WorkflowGetResult",
    "WorkflowInputInfo",
    "WorkflowListParams",
    "WorkflowListResult",
    "WorkflowOutlineStep",
    "WorkflowProposeParams",
    "WorkflowProposeResult",
    "WorkflowResumeParams",
    "WorkflowResumeResult",
    "WorkflowReviewAnswerParams",
    "WorkflowReviewAnswerResult",
    "WorkflowReviewInfo",
    "WorkflowReviewVerdict",
    "WorkflowRunEvent",
    "WorkflowRunInfo",
    "WorkflowRunStatus",
    "WorkflowRunTrigger",
    "WorkflowStartParams",
    "WorkflowStartResult",
    "WorkflowStartTrigger",
    "WorkflowStarterInfo",
    "WorkflowStartersParams",
    "WorkflowStartersResult",
    "WorkflowState",
    "WorkflowStatusParams",
    "WorkflowStatusResult",
    "WorkflowStepArg",
    "WorkflowStepEvent",
    "WorkflowStepInfo",
    "WorkflowStepKind",
    "WorkflowStepStatus",
    "WorkflowTriggerInfo",
    "WorkflowTriggerKind",
]
