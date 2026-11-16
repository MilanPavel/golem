"""The trace builder, on hand-written event lists."""

from __future__ import annotations

from typing import Any

from pydantic import TypeAdapter

from golem.sessions.trace import build_trace, helper_of, spans, with_windows
from golem_protocol.events import ChatEvent

_EVENT: TypeAdapter[ChatEvent] = TypeAdapter(ChatEvent)


class _Log:
    """Numbers events and stamps each one a second after the last."""

    def __init__(self) -> None:
        self.events: list[ChatEvent] = []

    def add(self, kind: str, data: dict[str, Any], run: str | None = "r1", gap: float = 1) -> None:
        self._at = getattr(self, "_at", 0.0) + gap
        seconds = int(self._at)
        millis = round((self._at - seconds) * 1000)
        minute, second = divmod(seconds, 60)
        self.events.append(
            _EVENT.validate_python(
                {
                    "seq": len(self.events) + 1,
                    "session_id": "s_1",
                    "run_id": run,
                    "ts": f"2026-11-07T10:{minute:02d}:{second:02d}.{millis:03d}+00:00",
                    "type": kind,
                    "data": data,
                }
            )
        )

    def user(self, text: str, run: str = "r1") -> None:
        self.add("message.completed", {"message_id": f"u_{run}", "role": "user", "text": text}, run)
        self.add("run.started", {}, run)

    def model(
        self,
        message_id: str,
        *,
        recorded: bool = True,
        text: str = "ok",
        run: str = "r1",
        window: dict[str, int | bool] | None = None,
        done: dict[str, float | bool] | None = None,
        used: int = 5,
    ) -> None:
        self.add("message.started", {"message_id": message_id, "role": "assistant"}, run)
        if recorded:
            self.add(
                "model.call.started",
                {
                    "message_id": message_id,
                    "index": 1,
                    "profile": "p",
                    "provider": "x",
                    "model": "y",
                    **(window or {}),
                },
                run,
            )
        self.add(
            "message.completed", {"message_id": message_id, "role": "assistant", "text": text}, run
        )
        if recorded:
            self.add(
                "model.call.completed",
                {
                    "message_id": message_id,
                    "latency_ms": 700,
                    "first_token_ms": 100,
                    "usage": {"input": used, "output": 2},
                    "stop_reason": "end_turn",
                    **(done or {}),
                },
                run,
            )

    def tool(
        self,
        call_id: str,
        message_id: str,
        *,
        end: str | None = "completed",
        run: str = "r1",
        name: str = "read_file",
    ) -> None:
        self.add(
            "tool.requested",
            {"call_id": call_id, "message_id": message_id, "name": name, "args": {"a": 1}},
            run,
        )
        self.add("tool.started", {"call_id": call_id}, run)
        if end == "completed":
            self.add(
                "tool.completed",
                {"call_id": call_id, "summary": "3 lines", "preview": "abc", "duration_ms": 40},
                run,
            )
        elif end == "failed-result":
            self.add(
                "tool.completed",
                {"call_id": call_id, "summary": "exit 1", "preview": "boom", "failed": True},
                run,
            )
        elif end == "raised":
            self.add("tool.failed", {"call_id": call_id, "message": "no such file"}, run)


def _ids(spans: list[Any]) -> list[str]:
    return [s.id for s in spans]


def test_a_new_session_has_two_model_calls_and_two_tools() -> None:
    log = _Log()
    log.user("what is in notes?")
    log.model("m_1", text="let me look")
    log.tool("c_1", "m_1")
    log.tool("c_2", "m_1", name="list_dir")
    log.model("m_2", text="It says 42.")
    log.add("run.completed", {})

    (run,) = build_trace(log.events)
    assert (run.id, run.kind, run.name, run.status) == ("r1", "run", "what is in notes?", "ok")
    assert run.end is not None and run.duration_ms is not None
    first, second = run.children
    assert (first.id, first.name, first.status, first.recorded) == ("m_1", "model 1", "ok", True)
    assert (second.id, second.name) == ("m_2", "model 2")
    assert (first.model, first.duration_ms, first.first_token_ms) == ("x/y", 700, 100)
    assert first.tokens is not None and (first.tokens.input, first.tokens.output) == (5, 2)
    assert first.preview == "let me look"
    assert _ids(first.children) == ["c_1", "c_2"]
    assert second.children == []
    tool = first.children[0]
    assert (tool.name, tool.status, tool.duration_ms, tool.preview) == (
        "read_file",
        "ok",
        40,
        "3 lines",
    )
    assert first.children[1].name == "list_dir"


def test_the_run_name_is_cut_at_80_characters() -> None:
    log = _Log()
    log.user("x" * 200)
    log.add("run.completed", {})
    (run,) = build_trace(log.events)
    assert run.name == "x" * 80


def test_without_model_call_events_the_spans_are_rebuilt_from_messages() -> None:
    log = _Log()
    log.user("hi")
    log.model("m_1", recorded=False, text="looking")
    log.tool("c_1", "m_1")
    log.model("m_2", recorded=False, text="done")
    log.add("run.completed", {})

    (run,) = build_trace(log.events)
    first, second = run.children
    assert [(s.id, s.name, s.recorded, s.status) for s in run.children] == [
        ("m_1", "model 1", False, "ok"),
        ("m_2", "model 2", False, "ok"),
    ]
    assert first.model is None and first.tokens is None and first.first_token_ms is None
    assert first.duration_ms == 1000  # message.started to message.completed
    assert first.preview == "looking"
    assert _ids(first.children) == ["c_1"]
    assert second.children == []


def test_a_failed_tool_is_failed_whether_it_ran_or_raised() -> None:
    log = _Log()
    log.user("go")
    log.model("m_1")
    log.tool("c_1", "m_1", end="failed-result")
    log.tool("c_2", "m_1", end="raised")
    log.add("run.completed", {})

    (run,) = build_trace(log.events)
    ran, raised = run.children[0].children
    assert (ran.status, ran.preview) == ("failed", "exit 1")
    assert (raised.status, raised.preview) == ("failed", "no such file")
    assert raised.duration_ms == 2000  # not measured, so end minus start


def test_a_denied_tool_is_denied() -> None:
    log = _Log()
    log.user("go")
    log.model("m_1")
    log.tool("c_1", "m_1", end=None)
    log.add(
        "approval.needed",
        {"call_id": "c_1", "name": "shell", "args": {}, "source": "default"},
    )
    log.add("approval.resolved", {"call_id": "c_1", "name": "shell", "decision": "deny"})
    log.add("tool.failed", {"call_id": "c_1", "message": "denied"})
    log.add("run.completed", {})

    (tool,) = build_trace(log.events)[0].children[0].children
    assert tool.status == "denied"


def test_an_approval_wait_is_counted_apart() -> None:
    log = _Log()
    log.user("go")
    log.model("m_1")
    log.add("tool.requested", {"call_id": "c_1", "message_id": "m_1", "name": "shell", "args": {}})
    log.add("approval.needed", {"call_id": "c_1", "name": "shell", "args": {}, "source": "d"})
    log.add("approval.resolved", {"call_id": "c_1", "name": "shell", "decision": "allow"}, gap=12.5)
    log.add("tool.started", {"call_id": "c_1"})
    log.add("tool.completed", {"call_id": "c_1", "summary": "ok", "preview": "", "duration_ms": 30})
    log.add("run.completed", {})

    (tool,) = build_trace(log.events)[0].children[0].children
    assert tool.status == "ok"
    assert tool.approval_wait_ms == 12500
    assert tool.duration_ms == 30


def test_a_cancelled_run_cancels_its_open_tool() -> None:
    log = _Log()
    log.user("go")
    log.add("message.started", {"message_id": "m_1", "role": "assistant"})
    log.add("model.call.started", {"message_id": "m_1", "index": 1, "profile": "p"})
    log.add("tool.requested", {"call_id": "c_1", "message_id": "m_1", "name": "shell", "args": {}})
    log.add("tool.started", {"call_id": "c_1"})
    log.add("run.cancelled", {"reason": "user"})

    (run,) = build_trace(log.events)
    (model,) = run.children
    assert run.status == "cancelled"
    assert (model.status, model.end) == ("cancelled", None)
    assert model.model == "p"  # the profile, when the provider did not resolve
    (tool,) = model.children
    assert (tool.status, tool.end) == ("cancelled", None)


def test_an_open_run_is_running() -> None:
    log = _Log()
    log.user("go")
    log.add("message.started", {"message_id": "m_1", "role": "assistant"})
    log.add("model.call.started", {"message_id": "m_1", "index": 1, "profile": "p"})
    log.add("tool.requested", {"call_id": "c_1", "message_id": "m_1", "name": "shell", "args": {}})

    (run,) = build_trace(log.events)
    assert (run.status, run.end, run.duration_ms) == ("running", None, None)
    assert run.children[0].status == "running"
    assert run.children[0].children[0].status == "running"


def test_a_run_with_25_model_calls_keeps_all_of_them() -> None:
    log = _Log()
    log.user("loop")
    for number in range(25):
        log.model(f"m_{number}")
        log.tool(f"c_{number}", f"m_{number}")
    log.add("run.completed", {})

    (run,) = build_trace(log.events)
    assert len(run.children) == 25
    assert [m.name for m in run.children][-1] == "model 25"
    assert all(len(m.children) == 1 for m in run.children)


def test_two_runs_come_out_oldest_first() -> None:
    log = _Log()
    log.user("first", run="r1")
    log.model("m_1", run="r1")
    log.add("run.completed", {}, run="r1")
    log.add("session.updated", {"title": "t"}, run=None)
    log.user("second", run="r2")
    log.model("m_2", run="r2")
    log.add("run.failed", {"message": "bad"}, run="r2")

    first, second = build_trace(log.events)
    assert [(r.id, r.name, r.status) for r in (first, second)] == [
        ("r1", "first", "ok"),
        ("r2", "second", "failed"),
    ]
    assert _ids(first.children) == ["m_1"]
    assert _ids(second.children) == ["m_2"]


def test_a_recorded_span_takes_its_window_and_num_ctx_from_the_event() -> None:
    log = _Log()
    log.user("hi")
    log.model("m1", window={"context_window": 8192, "num_ctx": 4096})
    log.model("m2")
    (run,) = build_trace(log.events)
    first, second = run.children
    assert (first.context_window, first.num_ctx) == (8192, 4096)
    assert (second.context_window, second.num_ctx) == (None, None)
    assert first.context_window_estimated is False


def test_a_recorded_estimated_window_is_estimated_on_the_span() -> None:
    log = _Log()
    log.user("hi")
    log.model("m1", window={"context_window": 4096, "window_estimated": True})
    (run,) = build_trace(log.events)
    assert run.children[0].context_window_estimated is True


def test_with_windows_fills_only_spans_without_one() -> None:
    log = _Log()
    log.user("hi")
    log.model("m1", window={"context_window": 8192})
    log.model("m2")
    log.model("m3")
    log.user("again", "r2")
    log.model("m4", recorded=False, run="r2")
    asked: list[str] = []

    def window_of(name: str) -> int | None:
        asked.append(name)
        return 1000 if name == "x/y" else 2000

    runs = with_windows(build_trace(log.events), window_of, "prof")
    got = [(m.context_window, m.context_window_estimated) for r in runs for m in r.children]
    assert got == [(8192, False), (1000, True), (1000, True), (2000, True)]
    assert sorted(asked) == ["prof", "x/y"]


def test_with_windows_leaves_a_span_whose_window_is_unknown() -> None:
    log = _Log()
    log.user("hi")
    log.model("m1")
    (run,) = with_windows(build_trace(log.events), lambda _: None, "prof")
    assert (run.children[0].context_window, run.children[0].context_window_estimated) == (
        None,
        False,
    )


def test_with_windows_gives_an_old_ollama_call_todays_estimated_window() -> None:
    from golem.config import GolemSettings, ModelSettings
    from golem.models.router import ModelRouter
    from golem.models.window import resolve_window

    class Listed:
        def known_ctx(self, ref: str) -> int | None:
            return 131072

        def modelfile_num_ctx(self, ref: str) -> int | None:
            return 4096

        def default_ctx(self, ref: str) -> int | None:
            return None

    router = ModelRouter(GolemSettings(models={"local": ModelSettings(model="ollama/llama3.2:3b")}))
    log = _Log()
    log.user("hi")
    log.model("m1", recorded=False)
    (run,) = with_windows(
        build_trace(log.events),
        lambda name: resolve_window(router, name, Listed()).window,
        "local",
    )
    assert (run.children[0].context_window, run.children[0].context_window_estimated) == (
        4096,
        True,
    )


def test_a_window_read_after_the_call_wins_and_is_exact() -> None:
    log = _Log()
    log.user("hi")
    log.model(
        "m1",
        window={"context_window": 4096, "window_estimated": True},
        done={"context_window": 32768},
        used=23600,
    )
    (run,) = build_trace(log.events)
    span = run.children[0]
    assert (span.context_window, span.context_window_estimated) == (32768, False)


def test_an_estimated_window_below_the_input_is_dropped_and_not_filled_again() -> None:
    log = _Log()
    log.user("hi")
    log.model("m1", window={"context_window": 4096, "window_estimated": True}, used=23600)
    (run,) = build_trace(log.events)
    assert (run.children[0].context_window, run.children[0].context_window_estimated) == (
        None,
        False,
    )
    (again,) = with_windows(build_trace(log.events), lambda _: 4096, "prof")
    assert again.children[0].context_window is None


def test_an_exact_window_below_the_input_is_kept() -> None:
    log = _Log()
    log.user("hi")
    log.model("m1", window={"context_window": 4096}, used=23600)
    (run,) = build_trace(log.events)
    assert run.children[0].context_window == 4096


def test_a_model_span_has_the_cost_its_call_recorded() -> None:
    log = _Log()
    log.user("go")
    log.model("m1", done={"cost_usd": 0.012})
    log.model("m2")
    log.add("run.completed", {})
    (run,) = build_trace(log.events)
    assert [m.cost_usd for m in run.children] == [0.012, None]


def _helper_log(*, finish: bool = True) -> _Log:
    """A run whose first reply delegates; the helper reads one file in two model calls."""
    log = _Log()
    log.user("look around")
    log.model("m_1", text="I will ask a helper")
    log.tool("d1", "m_1", name="delegate", end=None)
    helper = {"parent_call_id": "d1"}
    for message_id, call_id in (("k_1", "kc_1"), ("k_2", None)):
        log.add(
            "model.call.started",
            {
                "message_id": message_id,
                "index": 1,
                "profile": "p",
                "provider": "x",
                "model": "helper-model",
                "context_window": 8000,
                **helper,
            },
        )
        log.add(
            "model.call.completed",
            {
                "message_id": message_id,
                "latency_ms": 300,
                "usage": {"input": 4000, "output": 10},
                "cost_usd": 0.25,
                **helper,
            },
        )
        if call_id is not None:
            log.add(
                "tool.requested",
                {
                    "call_id": call_id,
                    "message_id": message_id,
                    "name": "read_file",
                    "args": {},
                    **helper,
                },
            )
            log.add("tool.started", {"call_id": call_id, **helper})
            log.add(
                "tool.completed",
                {"call_id": call_id, "summary": "3 lines", "preview": "x", **helper},
            )
    if finish:
        log.add("tool.completed", {"call_id": "d1", "summary": "explorer", "preview": "found"})
    log.model("m_2", text="done", used=900)
    log.add("run.completed", {})
    return log


def test_a_helpers_calls_nest_under_its_delegate_tool_span() -> None:
    (run,) = build_trace(_helper_log().events)
    assert _ids(run.children) == ["m_1", "m_2"]
    delegate = run.children[0].children[0]
    assert (delegate.id, delegate.name, delegate.status) == ("d1", "delegate", "ok")
    assert _ids(delegate.children) == ["k_1", "k_2"]
    first, second = delegate.children
    assert (first.model, first.context_window, first.status) == ("x/helper-model", 8000, "ok")
    assert first.tokens is not None and first.tokens.input == 4000
    assert _ids(first.children) == ["kc_1"]
    assert first.children[0].status == "ok"
    assert second.children == []
    # The run's own second call has no helper under it.
    assert run.children[1].children == []


def test_a_helper_does_not_change_the_parents_cut_or_input_series() -> None:
    (with_helper,) = build_trace(_helper_log().events)
    bare = _Log()
    bare.user("look around")
    bare.model("m_1", text="I will ask a helper")
    bare.tool("d1", "m_1", name="delegate")
    bare.model("m_2", text="done", used=900)
    bare.add("run.completed", {})
    (without,) = build_trace(bare.events)
    series = [m.tokens.input for m in with_helper.children if m.tokens is not None]
    assert series == [m.tokens.input for m in without.children if m.tokens is not None]
    assert [m.prompt_cut for m in with_helper.children] == [m.prompt_cut for m in without.children]
    assert all(m.prompt_cut is None for m in with_helper.children[0].children[0].children)


def test_a_helper_still_running_or_cut_off_shows_open_spans() -> None:
    log = _helper_log(finish=False)
    open_events = [e for e in log.events if e.type != "run.completed"]
    (run,) = build_trace(open_events)
    assert run.children[0].children[0].status == "running"
    (ended,) = build_trace(log.events)
    assert ended.children[0].children[0].status == "cancelled"


def test_spans_lists_the_helpers_calls_after_the_delegate_span() -> None:
    runs = build_trace(_helper_log().events)
    assert _ids(spans(runs)) == ["r1", "m_1", "d1", "k_1", "kc_1", "k_2", "m_2"]
    assert helper_of(runs, "kc_1") == "d1"
    assert helper_of(runs, "k_2") == "d1"
    assert helper_of(runs, "d1") is None
    assert helper_of(runs, "m_2") is None


def test_with_windows_fills_a_helpers_model_span_too() -> None:
    log = _helper_log()
    for event in log.events:
        if event.type == "model.call.started" and getattr(event.data, "parent_call_id", None):
            object.__setattr__(event.data, "context_window", None)
    runs = with_windows(build_trace(log.events), lambda name: 32000, "p")
    helper = runs[0].children[0].children[0].children[0]
    assert (helper.context_window, helper.context_window_estimated) == (32000, True)
