"""What would the recorded sessions have cost on another route? A calculation, not a replay.

A session's events say, for every model call, how big the system text, the tools and each
message were, how many tokens came back and what it cost. :func:`replay` goes through those
calls again and runs the *decisions* of a scenario on them: the pick of a model, clearing old
tool results, summarising old turns, the fit check, and the step-up. It calls no model.

The limits are the method's own:

- A stronger model would have made different calls: other tools, fewer retries, a shorter
  road to the answer. The recorded calls stay as they were. The report is an estimate of
  cost and of cut prompts, not of quality.
- Tokens are estimated from characters with one ratio per session, learned from its recorded
  calls. Another model has another tokenizer, so the estimate is rough.
- A summary has the length of the summaries recorded in the session, or a fixed size.
- A call without sizes (an event from before they were stored), a call that failed, and a
  call without its end event cannot be sized. They are counted as ``skipped`` and left out.
- A struggle is read from the events: an unread text call, a reply cut at the length limit,
  an empty reply, invalid tool calls in a row, and the same call three times. The text of a
  reply is not stored apart from its length, so nothing else is guessed.

The report holds counts and money, never message text.
"""

from __future__ import annotations

import json
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, ToolMessage

from golem.config import ContextSettings, LadderSettings, RouteMode, RoutingSettings
from golem.graphs.context_view import (
    SUMMARY_ID,
    ContextView,
    freed_by,
    plan_clear,
    plan_stub_newest,
    plan_summary,
    sent_chars,
    view,
)
from golem.graphs.estimate import CUT_AT, TokenRatios
from golem.graphs.fit import KEEP_RESULTS, prompt_estimate
from golem.graphs.struggle import CUT_REASONS, INVALID_IN_A_ROW, REPEATS
from golem.models.cost import cost_usd
from golem.models.facts import ModelFacts
from golem.models.pick import Traits, ladder, pick, tier_picks
from golem.models.pick_helper import pick_helper
from golem.models.tiers import TIERS, Tier
from golem_protocol.commands import (
    EvalHelperRow,
    EvalRoutingResult,
    EvalScenarioRow,
    EvalTopSession,
)
from golem_protocol.events import (
    ChatEvent,
    ContextChangedEvent,
    HelperStartedEvent,
    MessageCompletedEvent,
    ModelCallCompletedEvent,
    ModelCallStartedEvent,
    RunFailedEvent,
    SessionCreatedEvent,
    ToolCompletedEvent,
    ToolFailedEvent,
    ToolRequestedEvent,
)

KEY = "session"
"""The name the session's one token ratio is kept under."""
SUMMARY_CHARS = 2000
"""The length of a summary when the session recorded none."""
TOP = 5
ACTUAL = "as it really ran"


@dataclass(frozen=True, slots=True)
class Scenario:
    name: str  # "pinned frontier" | "pinned local" | "auto"
    route: RouteMode
    session_model: str
    ladder: LadderSettings
    context: ContextSettings
    summarise: str = "session"
    """``[routing.roles] summarise``: the model that writes a summary."""


@dataclass(slots=True)
class SessionReport:
    """One scenario over one session."""

    scenario: str
    session_id: str
    calls: int = 0
    skipped: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0
    cuts: int = 0
    step_ups: int | None = None
    clears: int = 0
    summaries: int = 0
    peak_share: float | None = None


@dataclass(frozen=True, slots=True)
class _Msg:
    id: str
    kind: str  # "user" | "assistant" | "tool"
    chars: int
    name: str | None = None
    call_id: str | None = None
    error: bool = False


@dataclass(slots=True)
class _Call:
    run_id: str
    parent: str | None
    message_id: str
    tier: str | None
    system_chars: int | None
    tools_chars: int | None
    message_ids: list[str]
    message_chars: list[int] | None
    cleared: set[str]
    summary_chars: int | None
    window: int | None
    history: tuple[_Msg, ...] = ()
    done: bool = False
    failed: bool = False
    tokens_in: int | None = None
    tokens_out: int | None = None
    cost: float | None = None
    stop_reason: str | None = None
    unread: bool = False
    tools: int = 0
    invalid: bool = False
    repeated: bool = False
    empty: bool = False

    @property
    def sized(self) -> bool:
        return (
            self.done
            and not self.failed
            and self.system_chars is not None
            and self.tools_chars is not None
            and self.message_chars is not None
            and len(self.message_chars) == len(self.message_ids)
        )

    @property
    def struggles(self) -> bool:
        cut = self.stop_reason in CUT_REASONS and self.tools == 0
        return (
            self.unread or cut or (self.empty and self.tools == 0) or self.invalid or self.repeated
        )


@dataclass(slots=True)
class _Parsed:
    session_id: str = ""
    profile: str | None = None
    calls: list[_Call] = field(default_factory=list[_Call])
    context_cleared: int = 0
    context_summarised: int = 0
    context_failed: int = 0


def _parse(events: Sequence[ChatEvent]) -> _Parsed:
    out = _Parsed()
    users: set[str] = set()
    tool_names: dict[str, str] = {}
    requested: dict[str, str] = {}  # call id -> the reply that asked
    failed_calls: set[str] = set()
    by_message: dict[str, _Call] = {}
    empty_replies: set[str] = set()
    runs: dict[str, Counter[str]] = {}
    in_a_row: dict[str, int] = {}
    streams: dict[str | None, set[str]] = {}
    full: dict[tuple[str | None, str], int] = {}
    stubbed: dict[tuple[str | None, str], int] = {}
    order: dict[str | None, list[str]] = {}
    for event in sorted(events, key=lambda e: e.seq):
        out.session_id = event.session_id
        if isinstance(event, SessionCreatedEvent):
            out.profile = event.data.model_profile
        elif isinstance(event, MessageCompletedEvent):
            if event.data.role == "user":
                users.add(event.data.message_id)
            elif event.data.text.strip() == "":
                empty_replies.add(event.data.message_id)
        elif isinstance(event, ModelCallStartedEvent):
            data = event.data
            if out.profile is None:
                out.profile = data.profile
            call = _Call(
                event.run_id,
                data.parent_call_id,
                data.message_id,
                data.tier,
                data.system_chars,
                data.tools_chars,
                list(data.message_ids),
                None if data.message_chars is None else list(data.message_chars),
                set(data.cleared_ids),
                data.summary_chars,
                data.context_window,
            )
            out.calls.append(call)
            by_message[data.message_id] = call
        elif isinstance(event, ModelCallCompletedEvent):
            found = by_message.get(event.data.message_id)
            if found is None:
                continue
            found.done = True
            found.failed = event.data.failed
            usage = event.data.usage
            found.tokens_in = None if usage is None else usage.input
            found.tokens_out = None if usage is None else usage.output
            found.cost = event.data.cost_usd
            found.stop_reason = event.data.stop_reason
            found.unread = event.data.text_tool_calls == "unread"
            if event.data.context_window is not None:
                found.window = event.data.context_window
        elif isinstance(event, ToolRequestedEvent):
            data = event.data
            tool_names[data.call_id] = data.name
            requested[data.call_id] = data.message_id
            asked = by_message.get(data.message_id)
            if asked is not None:
                asked.tools += 1
                key = json.dumps([data.name, data.args], sort_keys=True, default=str)
                seen = runs.setdefault(asked.run_id, Counter[str]())
                seen[key] += 1
                if seen[key] >= REPEATS:
                    asked.repeated = True
        elif isinstance(event, ToolFailedEvent | ToolCompletedEvent):
            call_id = event.data.call_id
            asked = by_message.get(requested.get(call_id, ""))
            bad = isinstance(event, ToolFailedEvent) and event.data.message.lstrip().removeprefix(
                "error:"
            ).lstrip().startswith(("invalid arguments for", "unknown tool"))
            if isinstance(event, ToolFailedEvent):
                failed_calls.add(call_id)
            run = event.run_id
            in_a_row[run] = in_a_row.get(run, 0) + 1 if bad else 0
            if asked is not None and in_a_row[run] >= INVALID_IN_A_ROW:
                asked.invalid = True
        elif isinstance(event, ContextChangedEvent):
            if event.data.action == "cleared":
                out.context_cleared += 1
            elif event.data.action == "summarised":
                out.context_summarised += 1
        elif isinstance(event, RunFailedEvent) and event.data.code == "context_full":
            out.context_failed += 1
    for call in out.calls:
        call.empty = call.message_id in empty_replies
        seen_ids = streams.setdefault(call.parent, set())
        keys = order.setdefault(call.parent, [])
        sizes = call.message_chars or []
        for index, message_id in enumerate(call.message_ids):
            if message_id == SUMMARY_ID or index >= len(sizes):
                continue
            slot = (call.parent, message_id)
            if message_id in call.cleared:
                stubbed.setdefault(slot, sizes[index])
            else:
                full[slot] = max(full.get(slot, 0), sizes[index])
            if message_id not in seen_ids:
                keys.append(message_id)
                seen_ids.add(message_id)
        history: list[_Msg] = []
        for message_id in keys:
            slot = (call.parent, message_id)
            chars = full.get(slot, stubbed.get(slot, 0))
            history.append(_kind(message_id, chars, users, by_message, tool_names, failed_calls))
        call.history = tuple(history)
    return out


def _kind(
    message_id: str,
    chars: int,
    users: set[str],
    replies: Mapping[str, _Call],
    tool_names: Mapping[str, str],
    failed: set[str],
) -> _Msg:
    if message_id in users:
        return _Msg(message_id, "user", chars)
    if message_id in replies:
        return _Msg(message_id, "assistant", chars)
    call_id = message_id.removeprefix("t_")
    if message_id.startswith("t_") and call_id in tool_names:
        return _Msg(message_id, "tool", chars, tool_names[call_id], call_id, call_id in failed)
    return _Msg(message_id, "user", chars)


def session_model(events: Sequence[ChatEvent]) -> str | None:
    """The model profile the session was made with, else the one of its first call."""
    return _parse(events).profile


def _build(msg: _Msg) -> BaseMessage:
    text = "x" * msg.chars
    if msg.kind == "assistant":
        return AIMessage(content=text, id=msg.id)
    if msg.kind == "tool":
        return ToolMessage(
            content=text,
            tool_call_id=msg.call_id or msg.id,
            name=msg.name,
            id=msg.id,
            status="error" if msg.error else "success",
        )
    return HumanMessage(content=text, id=msg.id)


def _unknown(ref: str) -> ModelFacts:
    return ModelFacts(
        ref, ref, "frontier", True, None, None, False, None, False, None, None, None, None, None
    )


def _find(facts: Sequence[ModelFacts], name: str) -> ModelFacts | None:
    return next((f for f in facts if name in (f.ref, f.profile)), None)


def _ratios(parsed: _Parsed) -> TokenRatios:
    ratios = TokenRatios()
    for call in parsed.calls:
        if call.sized and call.tokens_in:
            chars = (call.system_chars or 0) + (call.tools_chars or 0)
            chars += sum(call.message_chars or [])
            ratios.note(KEY, chars=chars, tokens=call.tokens_in, window=call.window)
    return ratios


@dataclass(slots=True)
class _Run:
    model: ModelFacts
    stepped: bool = False


class _Replay:
    def __init__(
        self,
        parsed: _Parsed,
        scenario: Scenario,
        facts: Sequence[ModelFacts],
    ) -> None:
        self.parsed = parsed
        self.scenario = scenario
        self.facts = facts
        self.settings = scenario.context
        self.ratios = _ratios(parsed)
        self.candidates = ladder(scenario.ladder, scenario.session_model, facts)
        self.own = _find(facts, scenario.session_model) or _unknown(scenario.session_model)
        self.picks = tier_picks(scenario.ladder, scenario.session_model, facts)
        sums = [c.summary_chars for c in parsed.calls if c.summary_chars]
        self.summary_chars = round(sum(sums) / len(sums)) if sums else SUMMARY_CHARS
        auto = scenario.route == "auto"
        self.report = SessionReport(scenario.name, parsed.session_id, step_ups=0 if auto else None)
        self.contexts: dict[str | None, ContextView | None] = {}
        self.runs: dict[str, _Run] = {}
        self.cache: dict[tuple[str, int, bool], BaseMessage] = {}

    def run(self) -> SessionReport:
        for call in self.parsed.calls:
            if not call.sized:
                self.report.skipped += 1
                continue
            self._call(call)
        return self.report

    # one call

    def _messages(self, call: _Call) -> list[BaseMessage]:
        found: list[BaseMessage] = []
        for msg in call.history:
            key = (msg.id, msg.chars, msg.error)
            if key not in self.cache:
                self.cache[key] = _build(msg)
            found.append(self.cache[key])
        return found

    def _need(self, plain: Sequence[BaseMessage], ctx: ContextView | None, fixed: int) -> int:
        return prompt_estimate(self.ratios, KEY, view(plain, ctx), fixed)

    def _call(self, call: _Call) -> None:
        plain = self._messages(call)
        fixed = (call.system_chars or 0) + (call.tools_chars or 0)
        ctx = self.contexts.get(call.parent)
        run = self.runs.get(call.run_id)
        if run is None:
            run = self.runs[call.run_id] = _Run(self._first(self._need(plain, ctx, fixed)))
        fits, used = True, 0
        for _ in range(len(TIERS) + 1):
            used, fits = self._settle(call.parent, plain, run.model, fixed)
            if fits or self.scenario.route != "auto":
                break
            more = self._pick(run.model, used, None)
            if more is None:
                break
            run.model = more
            self.report.step_ups = (self.report.step_ups or 0) + 1
        model = run.model
        window = model.window
        if not fits:
            self.report.cuts += 1
        tokens = used if window is None else min(used, window)
        out = call.tokens_out or 0
        self.report.calls += 1
        self.report.input_tokens += tokens
        self.report.output_tokens += out
        self.report.cost_usd += self._cost(model, tokens, out)
        if window is not None:
            share = min(1.0, used / window)
            self.report.peak_share = max(self.report.peak_share or 0.0, share)
        self._struggle(call, run, used)

    def _first(self, used: int) -> ModelFacts:
        if self.scenario.route != "auto":
            return self.own
        traits = Traits(
            prompt_tokens=used,
            reply_reserve=self.settings.reply_reserve,
            paid_allowed=True,
        )
        return pick("auto", self.own, self.candidates, traits).model or self.own

    def _pick(self, model: ModelFacts, used: int, floor: Tier | None) -> ModelFacts | None:
        """Another model for the rest of the run, or None to stay on ``model``."""
        traits = Traits(
            prompt_tokens=used,
            reply_reserve=self.settings.reply_reserve,
            paid_allowed=True,
            min_tier=floor,
        )
        found = pick("auto", model, self.candidates, traits).model
        return None if found is None or found.ref == model.ref else found

    def _struggle(self, call: _Call, run: _Run, used: int) -> None:
        if self.scenario.route != "auto" or run.stepped or call.tier != "local":
            return
        if not call.struggles or run.model.tier == TIERS[-1]:
            return
        floor = TIERS[TIERS.index(run.model.tier) + 1]
        more = self._pick(run.model, used, floor)
        if more is not None:
            run.model, run.stepped = more, True
            self.report.step_ups = (self.report.step_ups or 0) + 1

    def _cost(self, model: ModelFacts, tokens_in: int, tokens_out: int) -> float:
        found = cost_usd({"input": tokens_in, "output": tokens_out}, model.price)
        return found or 0.0

    # clearing, summarising, fit

    def _settle(
        self, stream: str | None, plain: Sequence[BaseMessage], model: ModelFacts, fixed: int
    ) -> tuple[int, bool]:
        """Clear, summarise and fit the history for ``model``. Gives the tokens and whether
        the prompt, with the reply reserve, fits the window."""
        settings = self.settings
        ctx = self.contexts.get(stream)
        used = self._need(plain, ctx, fixed)
        window = model.window
        if window is None:
            return used, True
        ratio = self.ratios.ratio(KEY)
        room = window - settings.reply_reserve
        if room > 0:
            planned = plan_clear(
                plain,
                ctx,
                used=used,
                ratio=ratio,
                room=room,
                clear_at=settings.clear_at,
                clear_to=settings.clear_to,
                keep_results=settings.keep_results,
            )
            ctx = self._cleared(plain, ctx, planned, ratio)
            used = self._need(plain, ctx, fixed)
            if used >= settings.compact_at * room:
                summed = self._summarised(plain, ctx, settings.keep_turns, model)
                if summed is not None:
                    ctx = summed
                else:
                    harder = plan_clear(
                        plain,
                        ctx,
                        used=used,
                        ratio=ratio,
                        room=room,
                        clear_at=0.0,
                        clear_to=0.0,
                        keep_results=2,
                    )
                    ctx = self._cleared(plain, ctx, harder, ratio)
                used = self._need(plain, ctx, fixed)
        for action in ("clear", "summarise", "stub"):
            if used + settings.reply_reserve <= window:
                break
            if action == "clear":
                planned = plan_clear(
                    plain,
                    ctx,
                    used=10**9,
                    ratio=1.0,
                    room=1,
                    clear_at=0.0,
                    clear_to=0.0,
                    keep_results=KEEP_RESULTS,
                )
                ctx = self._cleared(plain, ctx, planned, ratio)
            elif action == "summarise":
                ctx = self._summarised(plain, ctx, 1, model) or ctx
            else:
                ctx = self._cleared(plain, ctx, plan_stub_newest(plain, ctx), ratio)
            used = self._need(plain, ctx, fixed)
        self.contexts[stream] = ctx
        return used, used + settings.reply_reserve <= window

    def _cleared(
        self,
        plain: Sequence[BaseMessage],
        ctx: ContextView | None,
        planned: ContextView | None,
        ratio: float,
    ) -> ContextView | None:
        if planned is None:
            return ctx
        _, count = freed_by(plain, ctx, planned, ratio)
        if count == 0:
            return ctx
        self.report.clears += 1
        return planned

    def _summarised(
        self,
        plain: Sequence[BaseMessage],
        ctx: ContextView | None,
        keep_turns: int,
        model: ModelFacts,
    ) -> ContextView | None:
        found = plan_summary(plain, ctx, keep_turns=keep_turns)
        if found is None:
            return None
        start, end = found
        earlier = (ctx or {}).get("summary") if start > 0 else None
        chars = sum(sent_chars(m) for m in plain[start:end]) + len(earlier or "")
        tokens_in = self.ratios.estimate(KEY, chars, end - start)
        tokens_out = round(self.summary_chars * self.ratios.ratio(KEY))
        writer = self._writer(model)
        self.report.cost_usd += self._cost(writer, tokens_in, tokens_out)
        self.report.input_tokens += tokens_in
        self.report.output_tokens += tokens_out
        self.report.summaries += 1
        return {
            **(ctx or {}),
            "summary": "s" * self.summary_chars,
            "summarised_before": str(plain[end].id),
        }

    def _writer(self, model: ModelFacts) -> ModelFacts:
        """The model of the summarise role: the session's own, or a budget one when hosted."""
        role = self.scenario.summarise
        if role != "session":
            return _find(self.facts, role) or model
        if model.tier == "local":
            return model
        return self.picks["budget"] or model


def replay(
    events: Sequence[ChatEvent], scenario: Scenario, facts: Sequence[ModelFacts]
) -> SessionReport:
    """The recorded model calls of one session, run through ``scenario``.

    For each call that can be sized, in order: the history is rebuilt from the recorded sizes,
    clearing and summarising are planned on it with the scenario's ``[context]`` settings, the
    tokens are estimated, and the model is picked (per run, and again on a step-up). The report
    has the model's cost for those input tokens and the recorded output tokens, whether the
    prompt would not fit the window (a cut), and the step-ups: a prompt that did not fit, and,
    from the recorded struggles of a local model, a stronger tier. A summary adds the cost of
    its own call on the summarise role's model. See the module docstring for what this cannot say.
    """
    return _Replay(_parse(events), scenario, facts).run()


def recorded(events: Sequence[ChatEvent]) -> SessionReport:
    """The session as it really ran: recorded tokens and cost, and the prompts the server cut.

    A prompt is counted as cut when its input reached ``CUT_AT`` of the window, and a run that
    failed with ``context_full`` counts as one too.
    """
    parsed = _parse(events)
    report = SessionReport(ACTUAL, parsed.session_id)
    for call in parsed.calls:
        if not call.done or call.failed or call.tokens_in is None:
            report.skipped += 1
            continue
        report.calls += 1
        report.input_tokens += call.tokens_in
        report.output_tokens += call.tokens_out or 0
        report.cost_usd += call.cost or 0.0
        if call.window is not None:
            report.peak_share = max(
                report.peak_share or 0.0, min(1.0, call.tokens_in / call.window)
            )
            if call.tokens_in >= CUT_AT * call.window:
                report.cuts += 1
    report.cuts += parsed.context_failed
    report.clears = parsed.context_cleared
    report.summaries = parsed.context_summarised
    return report


def scenarios_for(
    profile: str,
    routing: RoutingSettings,
    context: ContextSettings,
    facts: Sequence[ModelFacts],
) -> list[Scenario]:
    """The three scenarios of a session made with ``profile``.

    The frontier model is the one ``[routing.ladder]`` names, else the session's own when it
    is frontier, else the cheapest priced frontier model that is ready. The local model is the
    ladder's, else the session's own when local, else the ready local model with the largest
    window. A scenario with no such model is left out.
    """
    picks = tier_picks(routing.ladder, profile, facts)
    frontier = picks["frontier"]
    if frontier is None:
        priced = [f for f in facts if f.tier == "frontier" and f.ready and f.blended is not None]
        frontier = min(priced, key=lambda f: (f.blended or 0.0, f.ref), default=None)
    found: list[Scenario] = []
    role, tiers = routing.roles.summarise, routing.ladder
    if frontier is not None:
        found.append(Scenario("pinned frontier", "pinned", frontier.ref, tiers, context, role))
    local = picks["local"]
    if local is not None:
        found.append(Scenario("pinned local", "pinned", local.ref, tiers, context, role))
    found.append(Scenario("auto", "auto", profile, tiers, context, role))
    return found


def helper_rows(
    events: Sequence[ChatEvent],
    *,
    routing: RoutingSettings,
    context: ContextSettings,
    facts: Sequence[ModelFacts],
) -> list[EvalHelperRow]:
    """The helpers of one session, as recorded and as ``pick_helper`` would pick them now.

    The lead's model is the session's own. The candidates and traits are the ones the daemon
    builds for a helper (``SessionManager._helper_model``), on the models that are ready:
    ``paid = "never"`` keeps them local, and a lead on a hosted model has agreed to paid
    models already. A folder that stays local is not in the events, so it is not applied.
    Calls no model.
    """
    helpers = [e for e in sorted(events, key=lambda e: e.seq) if isinstance(e, HelperStartedEvent)]
    profile = session_model(events)
    if not helpers or profile is None:
        return []
    own = _find(facts, profile) or _unknown(profile)
    candidates = ladder(routing.ladder, profile, facts)
    if routing.paid == "never":
        candidates = [m for m in candidates if m.tier == "local"]
    traits = Traits(
        reply_reserve=context.reply_reserve,
        needs_tools=True,
        paid_allowed=own.tier != "local",
    )
    rows: list[EvalHelperRow] = []
    for event in helpers:
        data = event.data
        pool = list(candidates)
        named = _find(facts, data.wish)
        if named is not None and routing.paid != "never" and all(named.ref != m.ref for m in pool):
            pool.append(named)
        choice = pick_helper(data.wish, own, pool, traits)
        rows.append(
            EvalHelperRow(
                session_id=event.session_id,
                agent=data.agent,
                wish=data.wish,
                ran=data.model,
                ran_why=data.pick_reason,
                would=choice.model.profile,
                would_tier=choice.model.tier,
                would_why=choice.detail,
                would_asks=choice.needs_consent,
            )
        )
    return rows


def _row(name: str, reports: Sequence[SessionReport]) -> EvalScenarioRow:
    shares = [r.peak_share for r in reports if r.peak_share is not None]
    ups = [r.step_ups for r in reports if r.step_ups is not None]
    return EvalScenarioRow(
        name=name,
        calls=sum(r.calls for r in reports),
        input=sum(r.input_tokens for r in reports),
        output=sum(r.output_tokens for r in reports),
        cost_usd=round(sum(r.cost_usd for r in reports), 6),
        cuts=sum(r.cuts for r in reports),
        step_ups=sum(ups) if ups else None,
        clears=sum(r.clears for r in reports),
        summaries=sum(r.summaries for r in reports),
        peak_share=max(shares) if shares else None,
    )


def build_report(
    sessions: Mapping[str, Sequence[ChatEvent]],
    *,
    routing: RoutingSettings,
    context: ContextSettings,
    facts: Sequence[ModelFacts],
    days: int,
) -> EvalRoutingResult:
    """The three scenarios and the recorded run over every session in ``sessions``, and the
    helpers they started: what each ran on and what ``pick_helper`` gives now."""
    by_name: dict[str, list[SessionReport]] = {}
    actual: list[SessionReport] = []
    auto: list[SessionReport] = []
    helpers: list[EvalHelperRow] = []
    for events in sessions.values():
        helpers += helper_rows(events, routing=routing, context=context, facts=facts)
        real = recorded(events)
        profile = session_model(events)
        actual.append(real)
        if real.calls == 0 or profile is None:
            continue
        for scenario in scenarios_for(profile, routing, context, facts):
            report = replay(events, scenario, facts)
            by_name.setdefault(scenario.name, []).append(report)
            if scenario.name == "auto":
                auto.append(report)
    rows = [_row(name, by_name[name]) for name in ("pinned frontier", "pinned local", "auto")
            if name in by_name]  # fmt: skip
    dearest = sorted(auto, key=lambda r: (-r.cost_usd, r.session_id))
    top = [
        EvalTopSession(session_id=r.session_id, calls=r.calls, cost_usd=round(r.cost_usd, 6))
        for r in dearest[:TOP]
        if r.cost_usd > 0
    ]
    return EvalRoutingResult(
        days=days,
        sessions=sum(1 for r in actual if r.calls > 0),
        calls=sum(r.calls for r in actual),
        skipped=sum(r.skipped for r in actual),
        scenarios=rows,
        actual=_row(ACTUAL, actual),
        top=top,
        helpers=helpers,
    )


__all__ = [
    "ACTUAL",
    "Scenario",
    "SessionReport",
    "build_report",
    "helper_rows",
    "recorded",
    "replay",
    "scenarios_for",
    "session_model",
]
