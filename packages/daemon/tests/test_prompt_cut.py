"""Whether Ollama cut a prompt: the four rules, the dropped messages, and the ratio."""

from __future__ import annotations

from typing import Any

from pydantic import TypeAdapter

from golem.sessions.cut import DEFAULT_TOKENS_PER_CHAR, CallFacts, judge, tokens_per_char
from golem.sessions.trace import build_trace
from golem_protocol.commands import TraceModelSpan
from golem_protocol.events import ChatEvent, ModelCallStartedData

_EVENT: TypeAdapter[ChatEvent] = TypeAdapter(ChatEvent)


class _Log:
    def __init__(self) -> None:
        self.events: list[ChatEvent] = []

    def add(self, kind: str, data: dict[str, Any], run: str) -> None:
        seq = len(self.events) + 1
        self.events.append(
            _EVENT.validate_python(
                {
                    "seq": seq,
                    "session_id": "s_1",
                    "run_id": run,
                    "ts": f"2026-11-10T10:{seq // 60:02d}:{seq % 60:02d}.000+00:00",
                    "type": kind,
                    "data": data,
                }
            )
        )

    def call(
        self,
        message_id: str,
        *,
        run: str = "r1",
        provider: str = "ollama",
        window: int | None = 1000,
        used: int | None = 100,
        ids: list[str] | None = None,
        chars: list[int] | None = None,
        system: int = 100,
        tools: int = 200,
        sized: bool = True,
        system_sha: str | None = "s",
        tools_sha: str | None = "t",
        estimated: bool = False,
    ) -> None:
        ids = ids if ids is not None else ["a"]
        chars = chars if chars is not None else [10] * len(ids)
        data: dict[str, Any] = {
            "message_id": message_id,
            "index": 1,
            "profile": "p",
            "provider": provider,
            "model": "m",
            "message_ids": ids,
            "context_window": window,
            "window_estimated": estimated,
            "system_prompt_sha": system_sha,
            "tools_sha": tools_sha,
        }
        if sized:
            data.update(
                system_chars=system,
                system_bytes=system,
                tools_chars=tools,
                tools_bytes=tools,
                message_chars=chars,
                message_bytes=chars,
            )
        self.add("model.call.started", data, run)
        self.add(
            "model.call.completed",
            {
                "message_id": message_id,
                "latency_ms": 5,
                "usage": None if used is None else {"input": used, "output": 2},
            },
            run,
        )

    def spans(self) -> list[TraceModelSpan]:
        return [m for r in build_trace(self.events) for m in r.children]


def test_bytes_under_the_window_prove_no_cut() -> None:
    log = _Log()
    log.call("m1", window=1000, system=100, tools=200, ids=["a"], chars=[10])
    (span,) = log.spans()
    assert span.prompt_cut == "no"
    assert span.prompt_cut_kind is None
    assert span.dropped_message_ids == []


def test_the_bound_counts_16_bytes_for_each_message() -> None:
    log = _Log()
    # 100 + 200 + 10 + 16 = 326, so a window of 326 is not proven.
    log.call("m1", window=326, ids=["a"], chars=[10], used=300)
    (span,) = log.spans()
    assert span.prompt_cut is None


def test_a_grown_prompt_with_fewer_tokens_is_a_proven_cut() -> None:
    log = _Log()
    log.call("m1", window=400, used=390, ids=["a", "b"], chars=[300, 300])
    log.call("m2", window=400, used=300, ids=["a", "b", "c", "d"], chars=[300, 300, 300, 300])
    first, second = log.spans()
    assert first.prompt_cut is None
    assert (second.prompt_cut, second.prompt_cut_kind) == ("yes", "older_messages")


def test_a_cut_is_proven_from_an_earlier_run() -> None:
    log = _Log()
    log.call("m1", run="r1", window=400, used=390, ids=["a", "b"], chars=[300, 300])
    log.call("m2", run="r2", window=400, used=300, ids=["a", "b", "c"], chars=[300] * 3)
    assert log.spans()[1].prompt_cut == "yes"


def test_a_changed_tools_sha_does_not_prove_a_cut() -> None:
    log = _Log()
    log.call("m1", window=400, used=390, ids=["a", "b"], chars=[300, 300])
    log.call("m2", window=400, used=300, ids=["a", "b", "c"], chars=[300] * 3, tools_sha="other")
    assert log.spans()[1].prompt_cut != "yes"


def test_a_changed_system_sha_a_changed_window_or_a_non_prefix_does_not_prove_a_cut() -> None:
    for change in (
        {"system_sha": "other"},
        {"window": 401},
        {"ids": ["x", "b", "c"]},
        {"ids": ["a", "b"]},
    ):
        log = _Log()
        log.call("m1", window=400, used=390, ids=["a", "b"], chars=[300, 300])
        args: dict[str, Any] = {"window": 400, "used": 300, "ids": ["a", "b", "c"], **change}
        args["chars"] = [300] * len(args["ids"])
        log.call("m2", **args)
        assert log.spans()[1].prompt_cut != "yes", change


def test_an_earlier_call_with_fewer_tokens_does_not_prove_a_cut() -> None:
    log = _Log()
    log.call("m1", window=400, used=200, ids=["a", "b"], chars=[300, 300])
    log.call("m2", window=400, used=300, ids=["a", "b", "c"], chars=[300] * 3)
    assert log.spans()[1].prompt_cut != "yes"


def test_half_the_window_arriving_for_a_big_prompt_is_a_likely_cut_in_the_middle() -> None:
    log = _Log()
    # About 4000 chars is about 1000 tokens, the window. 500 arrived.
    log.call("m1", window=1000, used=500, ids=["a"], chars=[4000])
    (span,) = log.spans()
    assert (span.prompt_cut, span.prompt_cut_kind) == ("likely", "middle")
    assert span.dropped_message_ids == []


def test_nearly_the_window_arriving_for_a_big_prompt_is_likely_older_messages() -> None:
    log = _Log()
    log.call("m1", window=1000, used=950, ids=["a", "b", "c"], chars=[2000, 2000, 2000])
    (span,) = log.spans()
    assert (span.prompt_cut, span.prompt_cut_kind) == ("likely", "older_messages")
    assert span.dropped_message_ids[:1] == ["a"]
    assert "c" not in span.dropped_message_ids


def test_a_big_prompt_whose_estimate_is_under_the_window_says_nothing() -> None:
    log = _Log()
    # Bytes are over the window (so not proven uncut), but 1800 chars is only 450 tokens.
    log.call("m1", window=600, used=400, ids=["a"], chars=[1500], system=100, tools=200)
    (span,) = log.spans()
    assert span.prompt_cut is None


def test_a_hosted_model_says_nothing() -> None:
    log = _Log()
    log.call("m1", provider="anthropic", window=1000, used=900, ids=["a"], chars=[10])
    log.call("m2", provider="anthropic", window=100, used=50, ids=["a"], chars=[4000])
    assert [s.prompt_cut for s in log.spans()] == [None, None]


def test_old_events_without_sizes_say_nothing() -> None:
    log = _Log()
    log.call("m1", window=1000, used=500, ids=["a"], sized=False)
    assert log.spans()[0].prompt_cut is None


def test_an_estimated_or_unknown_window_says_nothing() -> None:
    log = _Log()
    log.call("m1", window=1000, estimated=True, used=500, ids=["a"], chars=[4000])
    log.call("m2", window=None, used=500, ids=["a"], chars=[4000])
    assert [s.prompt_cut for s in log.spans()] == [None, None]


def _facts(
    ids: list[str],
    chars: list[int],
    *,
    used: int,
    window: int = 1000,
    system: int = 0,
    tools: int = 0,
) -> CallFacts:
    data = ModelCallStartedData(
        message_id="m",
        index=1,
        profile="p",
        provider="ollama",
        model="m",
        message_ids=ids,
        system_chars=system,
        system_bytes=system,
        tools_chars=tools,
        tools_bytes=tools,
        message_chars=chars,
        message_bytes=chars,
    )
    return CallFacts(data, "ollama/m", window, used)


def test_ten_messages_with_room_for_the_last_six_mark_the_oldest_four() -> None:
    ids = [f"m{i}" for i in range(10)]
    # 400 chars each, 1/4 token a char: 100 tokens each. System 100 chars, tools 300: 100 tokens.
    here = _facts(ids, [400] * 10, used=700, system=100, tools=300)
    found = judge(here, [])
    assert found.cut == "likely"
    assert found.dropped_message_ids == ("m0", "m1", "m2", "m3")
    assert found.dropped_tokens == 400


def test_the_last_message_and_the_system_prompt_are_never_marked() -> None:
    ids = ["a", "b", "c"]
    here = _facts(ids, [4000, 4000, 4000], used=900, system=4000)
    found = judge(here, [])
    assert found.dropped_message_ids == ("a", "b")


def test_the_ratio_comes_from_the_latest_earlier_call_proven_uncut() -> None:
    uncut = _facts(["a"], [1000], used=500, window=100000)
    assert tokens_per_char([uncut], "ollama/m") == 0.5
    assert tokens_per_char([uncut], "ollama/other") == DEFAULT_TOKENS_PER_CHAR


def test_with_no_proven_uncut_call_the_ratio_is_one_quarter() -> None:
    cut = _facts(["a"], [100000], used=500, window=1000)
    assert tokens_per_char([], "ollama/m") == 0.25
    assert tokens_per_char([cut], "ollama/m") == 0.25
