"""The trace builder, on hand-written event lists."""

from __future__ import annotations

from typing import Any

from pydantic import TypeAdapter

from golem.sessions.trace import build_trace
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
        self, message_id: str, *, recorded: bool = True, text: str = "ok", run: str = "r1"
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
                    "usage": {"input": 5, "output": 2},
                    "stop_reason": "end_turn",
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
