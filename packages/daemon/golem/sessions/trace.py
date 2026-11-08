"""A session's events as a tree of spans, and what one span took in and gave out.

Pure: these functions read lists the caller loaded, and do no I/O. The tree
is run, then model call, then tool call.

A session recorded before ``model.call.*`` events existed has none. Its model
spans are rebuilt from each assistant message's ``message.started`` and
``message.completed``, with ``recorded`` false.

A model span carries the context window of its call. A window the event did
not record is filled from today's config, and marked estimated.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from golem_protocol.commands import (
    TraceMessage,
    TraceModelSpan,
    TraceRunSpan,
    TraceSpan,
    TraceSpanResult,
    TraceTokens,
    TraceToolSpan,
)
from golem_protocol.events import (
    ApprovalNeededEvent,
    ApprovalResolvedEvent,
    ChatEvent,
    MessageCompletedEvent,
    MessageStartedEvent,
    ModelCallCompletedEvent,
    ModelCallStartedEvent,
    RunCancelledEvent,
    RunCompletedEvent,
    RunFailedEvent,
    ToolCompletedEvent,
    ToolFailedEvent,
    ToolRequestedEvent,
)

Status = Literal["ok", "failed", "cancelled", "denied", "running"]

_NAME_CHARS = 80
_PREVIEW_CHARS = 200


def build_trace(events: Sequence[ChatEvent]) -> list[TraceRunSpan]:
    """The runs found in ``events``, oldest first, each with its model and tool spans."""
    order: list[str] = []
    by_run: dict[str, list[ChatEvent]] = {}
    for event in events:
        if event.run_id is None:
            continue
        if event.run_id not in by_run:
            order.append(event.run_id)
            by_run[event.run_id] = []
        by_run[event.run_id].append(event)
    runs: list[TraceRunSpan] = []
    for run_id in order:
        run = _run(run_id, by_run[run_id])
        if run is not None:
            runs.append(run)
    return runs


def _run(run_id: str, events: list[ChatEvent]) -> TraceRunSpan | None:
    start: str | None = None
    end: str | None = None
    status: Status = "running"
    name = ""
    for event in events:
        if isinstance(event, MessageCompletedEvent) and event.data.role == "user" and not name:
            name = event.data.text[:_NAME_CHARS]
        elif event.type == "run.started":
            start = event.ts
        elif isinstance(event, RunCompletedEvent):
            end, status = event.ts, "ok"
        elif isinstance(event, RunFailedEvent):
            end, status = event.ts, "failed"
        elif isinstance(event, RunCancelledEvent):
            end, status = event.ts, "cancelled"
    if start is None:
        start = events[0].ts
    models = _models(events, ended=end is not None, cancelled=status == "cancelled")
    return TraceRunSpan(
        id=run_id,
        kind="run",
        name=name,
        start=start,
        end=end,
        duration_ms=None if end is None else _between(start, end),
        status=status,
        children=models,
    )


def _models(events: list[ChatEvent], *, ended: bool, cancelled: bool) -> list[TraceModelSpan]:
    started = [e for e in events if isinstance(e, ModelCallStartedEvent)]
    models = (
        _recorded_models(events, started, cancelled)
        if started
        else _rebuilt_models(events, cancelled)
    )
    if not models:
        return []
    by_message = {m.id: i for i, m in enumerate(models)}
    tools: list[list[TraceToolSpan]] = [[] for _ in models]
    for event in events:
        if isinstance(event, ToolRequestedEvent):
            tool = _tool(event, events, ended=ended)
            tools[by_message.get(event.data.message_id, _last_before(models, event.ts))].append(
                tool
            )
    return [m.model_copy(update={"children": t}) for m, t in zip(models, tools, strict=True)]


def _last_before(models: list[TraceModelSpan], ts: str) -> int:
    """Index of the newest model span that started by ``ts``, for a tool with no known parent."""
    found = 0
    for i, model in enumerate(models):
        if model.start <= ts:
            found = i
    return found


def _recorded_models(
    events: list[ChatEvent], started: list[ModelCallStartedEvent], cancelled: bool
) -> list[TraceModelSpan]:
    completed = {e.data.message_id: e for e in events if isinstance(e, ModelCallCompletedEvent)}
    replies = _replies(events)
    spans: list[TraceModelSpan] = []
    for number, event in enumerate(started, start=1):
        data = event.data
        done = completed.get(data.message_id)
        status: Status
        if done is None:
            status = "cancelled" if cancelled else "running"
            end, duration, tokens, first = None, None, None, None
        else:
            status = ("cancelled" if cancelled else "failed") if done.data.failed else "ok"
            end, duration, first = done.ts, done.data.latency_ms, done.data.first_token_ms
            tokens = None
            if done.data.usage is not None:
                tokens = TraceTokens(**done.data.usage.model_dump())
        model = f"{data.provider}/{data.model}" if data.provider and data.model else data.profile
        spans.append(
            TraceModelSpan(
                id=data.message_id,
                kind="model",
                name=f"model {number}",
                start=event.ts,
                end=end,
                duration_ms=duration,
                status=status,
                model=model,
                tokens=tokens,
                first_token_ms=first,
                context_window=data.context_window,
                num_ctx=data.num_ctx,
                preview=replies.get(data.message_id, "")[:_PREVIEW_CHARS],
            )
        )
    return spans


def _rebuilt_models(events: list[ChatEvent], cancelled: bool) -> list[TraceModelSpan]:
    opened: dict[str, str] = {}
    spans: list[TraceModelSpan] = []
    for event in events:
        if isinstance(event, MessageStartedEvent):
            opened[event.data.message_id] = event.ts
        elif isinstance(event, MessageCompletedEvent) and event.data.role == "assistant":
            start = opened.pop(event.data.message_id, event.ts)
            spans.append(_rebuilt(event.data.message_id, start, event))
    for message_id, start in opened.items():
        spans.append(
            TraceModelSpan(
                id=message_id,
                kind="model",
                name="",
                start=start,
                status="cancelled" if cancelled else "running",
                recorded=False,
            )
        )
    spans.sort(key=lambda s: s.start)
    return [s.model_copy(update={"name": f"model {i}"}) for i, s in enumerate(spans, start=1)]


def _rebuilt(message_id: str, start: str, done: MessageCompletedEvent) -> TraceModelSpan:
    return TraceModelSpan(
        id=message_id,
        kind="model",
        name="",
        start=start,
        end=done.ts,
        duration_ms=_between(start, done.ts),
        status="cancelled" if done.data.interrupted else "ok",
        preview=done.data.text[:_PREVIEW_CHARS],
        recorded=False,
    )


def _replies(events: list[ChatEvent]) -> dict[str, str]:
    return {
        e.data.message_id: e.data.text
        for e in events
        if isinstance(e, MessageCompletedEvent) and e.data.role == "assistant"
    }


def _tool(event: ToolRequestedEvent, events: list[ChatEvent], *, ended: bool) -> TraceToolSpan:
    call_id = event.data.call_id
    end: str | None = None
    status: Status = "cancelled" if ended else "running"
    duration: int | None = None
    preview = ""
    needed: str | None = None
    wait: int | None = None
    denied = False
    for later in events:
        if later.seq <= event.seq:
            continue
        if isinstance(later, ToolCompletedEvent) and later.data.call_id == call_id:
            end, status = later.ts, "failed" if later.data.failed else "ok"
            duration = later.data.duration_ms
            preview = later.data.summary or later.data.preview
        elif isinstance(later, ToolFailedEvent) and later.data.call_id == call_id:
            end, status = later.ts, "failed"
            duration = later.data.duration_ms
            preview = later.data.message
        elif isinstance(later, ApprovalNeededEvent) and later.data.call_id == call_id:
            if needed is None:
                needed = later.ts
        elif isinstance(later, ApprovalResolvedEvent) and later.data.call_id == call_id:
            if needed is not None and wait is None:
                wait = _between(needed, later.ts)
            denied = later.data.decision == "deny"
    if denied:
        status = "denied"
    if duration is None and end is not None:
        duration = _between(event.ts, end)
    return TraceToolSpan(
        id=call_id,
        kind="tool",
        name=event.data.name,
        start=event.ts,
        end=end,
        duration_ms=duration,
        status=status,
        approval_wait_ms=wait,
        preview=preview[:_PREVIEW_CHARS],
    )


def _between(start: str, end: str) -> int:
    seconds = (datetime.fromisoformat(end) - datetime.fromisoformat(start)).total_seconds()
    return max(0, round(seconds * 1000))


def spans(runs: Sequence[TraceRunSpan]) -> list[TraceSpan]:
    """Every span of ``runs`` in time order, each without its children."""
    flat: list[TraceSpan] = []
    for run in runs:
        flat.append(_bare(run))
        for model in run.children:
            flat.append(_bare(model))
            flat.extend(_bare(tool) for tool in model.children)
    return flat


def _bare(span: TraceSpan) -> TraceSpan:
    return TraceSpan(**{name: getattr(span, name) for name in TraceSpan.model_fields})


def window_name(span: TraceSpan, profile: str) -> str | None:
    """The name to look a missing window up by: the span's model, else the session's profile."""
    if span.recorded:
        return span.model or None
    return profile or None


def filled_window(
    span: TraceSpan, window: int | None, profile: str, window_of: Callable[[str], int | None]
) -> tuple[int | None, bool]:
    """``(window, estimated)``: ``window`` when it is set, else today's window for the span."""
    if window is not None:
        return window, False
    name = window_name(span, profile)
    if name is None:
        return None, False
    found = window_of(name)
    return found, found is not None


def with_windows(
    runs: Sequence[TraceRunSpan], window_of: Callable[[str], int | None], profile: str
) -> list[TraceRunSpan]:
    """``runs`` with a window on each model span that had none, marked estimated.

    ``window_of`` is called at most once for each name.
    """
    known: dict[str, int | None] = {}

    def lookup(name: str) -> int | None:
        if name not in known:
            known[name] = window_of(name)
        return known[name]

    filled: list[TraceRunSpan] = []
    for run in runs:
        models: list[TraceModelSpan] = []
        for model in run.children:
            if model.context_window is None:
                window, estimated = filled_window(model, None, profile, lookup)
                if window is not None:
                    model = model.model_copy(
                        update={"context_window": window, "context_window_estimated": estimated}
                    )
            models.append(model)
        filled.append(run.model_copy(update={"children": models}))
    return filled


@dataclass(frozen=True, slots=True)
class SpanRead:
    """A span's input and output. The system prompt and tools are named by hash, not loaded."""

    result: TraceSpanResult
    system_prompt_sha: str | None = None
    tools_sha: str | None = None
    context_window: int | None = None
    num_ctx: int | None = None


def read_span(
    runs: Sequence[TraceRunSpan],
    events: Sequence[ChatEvent],
    messages: Sequence[TraceMessage],
    span_id: str,
) -> SpanRead | None:
    """What span ``span_id`` took in and gave out, or None when no span has that id.

    ``messages`` are the session's checkpoint messages, in order. A run's id
    is a span too, but it has no input or output of its own: it comes back as
    the span alone.
    """
    flat = spans(runs)
    span = next((s for s in flat if s.id == span_id), None)
    if span is None:
        return None
    if span.kind == "tool":
        return SpanRead(_tool_read(span, events, messages))
    if span.kind == "model":
        return _model_read(span, [s for s in flat if s.kind == "model"], events, messages)
    return SpanRead(TraceSpanResult(span=span))


def _tool_read(
    span: TraceSpan, events: Sequence[ChatEvent], messages: Sequence[TraceMessage]
) -> TraceSpanResult:
    args: dict[str, object] | None = None
    artifact_id: str | None = None
    approval: dict[str, object] | None = None
    for event in events:
        if isinstance(event, ToolRequestedEvent) and event.data.call_id == span.id:
            args = dict(event.data.args)
        elif isinstance(event, ApprovalResolvedEvent) and event.data.call_id == span.id:
            approval = event.data.model_dump(mode="json")
            if event.data.args is not None:
                args = dict(event.data.args)
        elif isinstance(event, ToolCompletedEvent) and event.data.call_id == span.id:
            artifact_id = event.data.artifact_id
    result = next((m.text for m in messages if m.role == "tool" and m.call_id == span.id), None)
    return TraceSpanResult(
        span=span, args=args, result=result, artifact_id=artifact_id, approval=approval
    )


def _model_read(
    span: TraceSpan,
    models: list[TraceSpan],
    events: Sequence[ChatEvent],
    messages: Sequence[TraceMessage],
) -> SpanRead:
    starts = {e.data.message_id: e.data for e in events if isinstance(e, ModelCallStartedEvent)}
    done = next(
        (
            e.data
            for e in events
            if isinstance(e, ModelCallCompletedEvent) and e.data.message_id == span.id
        ),
        None,
    )
    here = starts.get(span.id)
    index = next(i for i, m in enumerate(models) if m.id == span.id)
    context = _context(span.id, here.message_ids if here else None, messages)
    new_from = 0
    if index > 0:
        before = models[index - 1].id
        previous = starts.get(before)
        seen = {
            m.id for m in _context(before, previous.message_ids if previous else None, messages)
        }
        new_from = next((i for i, m in enumerate(context) if m.id not in seen), len(context))
    return SpanRead(
        TraceSpanResult(
            span=span,
            messages=context,
            new_from=new_from,
            reply=next((m for m in messages if m.id == span.id), None),
            stop_reason=None if done is None else done.stop_reason,
            provider=None if here is None else here.provider,
            system_sections=None if here is None else here.system_sections,
        ),
        system_prompt_sha=None if here is None else here.system_prompt_sha,
        tools_sha=None if here is None else here.tools_sha,
        context_window=None if here is None else here.context_window,
        num_ctx=None if here is None else here.num_ctx,
    )


def _context(
    reply_id: str, message_ids: list[str] | None, messages: Sequence[TraceMessage]
) -> list[TraceMessage]:
    """The messages a model call was sent: the recorded ids, else all before its reply."""
    if message_ids:
        by_id = {m.id: m for m in messages if m.id is not None}
        return [by_id[i] for i in message_ids if i in by_id]
    for i, message in enumerate(messages):
        if message.id == reply_id:
            return list(messages[:i])
    return list(messages)
