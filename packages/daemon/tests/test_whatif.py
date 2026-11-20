"""``golem.evals.whatif``: recorded sessions run through a route, over hand-built events."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from fakes import ToolCallingChatModel
from langgraph.checkpoint.memory import InMemorySaver

from golem.config import ContextSettings, LadderSettings, ModelPrice, RoutingSettings
from golem.evals.whatif import Scenario, build_report, helper_rows, recorded, replay, scenarios_for
from golem.graphs.chat import open_chat
from golem.models.facts import ModelFacts
from golem.models.pick import Traits, ladder
from golem.models.pick_helper import pick_helper
from golem.models.router import ModelRouter
from golem.models.tiers import Tier, blended
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.manager import SessionManager
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem_protocol.events import CHAT_EVENT, ChatEvent

LADDER = LadderSettings()
CONTEXT = ContextSettings()


def facts(ref: str, tier: Tier, window: int, price: float | None = None) -> ModelFacts:
    model_price = None if price is None else ModelPrice(input=price, output=price * 2)
    return ModelFacts(
        ref=ref,
        profile=ref,
        tier=tier,
        ready=True,
        why_not_ready=None,
        window=window,
        window_exact=True,
        tools=True,
        vision=False,
        price=model_price,
        blended=None if model_price is None else blended(model_price),
        prompt_tps=None,
        reply_tps=None,
        tool_score=None,
    )


LOCAL = facts("ollama/small", "local", 8192, 0.0)
CHEAP = facts("deepseek/cheap", "budget", 64000, 0.5)
BIG = facts("anthropic/big", "frontier", 200000, 5.0)
ALL = [LOCAL, CHEAP, BIG]


class Log:
    """Builds the events of one session the way the daemon stores them."""

    def __init__(self, session_id: str = "s1", profile: str = "ollama/small") -> None:
        self.session_id = session_id
        self.events: list[ChatEvent] = []
        self._seq = 0
        self._calls = 0
        self.add(None, "session.created", {"model_profile": profile})

    def add(self, run: str | None, kind: str, data: Mapping[str, Any]) -> None:
        self._seq += 1
        self.events.append(
            CHAT_EVENT.validate_python(
                {
                    "seq": self._seq,
                    "session_id": self.session_id,
                    "run_id": run,
                    "ts": "2026-03-01T10:00:00Z",
                    "type": kind,
                    "data": dict(data),
                }
            )
        )

    def user(self, message_id: str, run: str = "r1") -> None:
        data = {"message_id": message_id, "role": "user", "text": "hi"}
        self.add(run, "message.completed", data)

    def call(
        self,
        history: Sequence[tuple[str, int]],
        *,
        run: str = "r1",
        tier: str | None = "local",
        window: int | None = 8192,
        tokens: int | None = None,
        out: int = 100,
        sized: bool = True,
        extra: Mapping[str, Any] | None = None,
        done: Mapping[str, Any] | None = None,
        tools: Sequence[tuple[str, str, dict[str, Any]]] = (),
    ) -> str:
        """One model call. ``history`` is the ``(id, chars)`` of each message sent."""
        self._calls += 1
        message_id = f"a{self._calls}"
        chars = 1000 + sum(size for _, size in history)
        started: dict[str, Any] = {
            "message_id": message_id,
            "index": self._calls,
            "profile": "p",
            "tier": tier,
            "message_ids": [i for i, _ in history],
            "context_window": window,
        }
        if sized:
            started |= {
                "system_chars": 600,
                "tools_chars": 400,
                "message_chars": [size for _, size in history],
            }
        started |= dict(extra or {})
        self.add(run, "model.call.started", started)
        used = round(chars * 0.25) if tokens is None else tokens
        completed: dict[str, Any] = {
            "message_id": message_id,
            "latency_ms": 5,
            "usage": {"input": used, "output": out},
            "cost_usd": 0.0,
        }
        completed |= dict(done or {})
        self.add(run, "model.call.completed", completed)
        self.add(run, "message.completed", {"message_id": message_id, "role": "assistant",
                                            "text": "ok"})  # fmt: skip
        for call_id, name, args in tools:
            data = {"call_id": call_id, "message_id": message_id, "name": name, "args": args}
            self.add(run, "tool.requested", data)
        return message_id

    def helper(self, index: int, agent: str, wish: str, picked: ModelFacts, why: str) -> None:
        """A ``helper.started`` on the lead's log, as the daemon stores it."""
        data = {
            "call_id": "c1",
            "index": index,
            "helper_id": f"{self.session_id}_h{index}",
            "agent": agent,
            "label": agent,
            "model": picked.profile,
            "wish": wish,
            "pick_reason": why,
        }
        self.add("r1", "helper.started", data)

    def tool_ok(self, call_id: str, run: str = "r1") -> None:
        self.add(run, "tool.completed", {"call_id": call_id, "summary": "", "preview": ""})

    def tool_failed(self, call_id: str, message: str, run: str = "r1") -> None:
        self.add(run, "tool.failed", {"call_id": call_id, "message": message})


def scenario(name: str, route: str, model: str, context: ContextSettings = CONTEXT) -> Scenario:
    return Scenario(name, route, model, LADDER, context)  # type: ignore[arg-type]


def small_session() -> Log:
    """Three calls that fit any window."""
    log = Log()
    log.user("u1")
    first = log.call([("u1", 200)], tools=[("c1", "read_file", {"path": "a"})])
    log.tool_ok("c1")
    second = log.call([("u1", 200), (first, 100), ("t_c1", 300)])
    log.call([("u1", 200), (first, 100), ("t_c1", 300), (second, 150)], out=50)
    return log


def test_a_session_that_fits_everywhere_costs_auto_nothing() -> None:
    log = small_session()
    auto = replay(log.events, scenario("auto", "auto", "ollama/small"), ALL)
    local = replay(log.events, scenario("pinned local", "pinned", "ollama/small"), ALL)
    assert (auto.calls, auto.cuts, auto.step_ups, auto.cost_usd) == (3, 0, 0, 0.0)
    assert (local.calls, local.cuts, local.step_ups) == (3, 0, None)
    assert auto.output_tokens == 250
    assert 0 < (auto.peak_share or 0) < 1


def test_the_frontier_scenario_prices_every_call() -> None:
    log = small_session()
    report = replay(log.events, scenario("pinned frontier", "pinned", "anthropic/big"), ALL)
    expected = (report.input_tokens * 5.0 + report.output_tokens * 10.0) / 1_000_000
    assert report.calls == 3
    assert report.cost_usd == pytest.approx(expected, abs=1e-5)
    assert report.cost_usd > 0


def grown() -> Log:
    """One run that starts small and meets a long error result that cannot be cleared."""
    log = Log()
    log.user("u1")
    first = log.call([("u1", 200)], tools=[("c1", "shell", {"cmd": "x"})])
    log.tool_failed("c1", "boom")
    log.call([("u1", 200), (first, 100), ("t_c1", 40000)])
    return log


def test_a_session_that_outgrows_the_local_window_is_cut_there_and_steps_up_on_auto() -> None:
    log = grown()
    local = replay(log.events, scenario("pinned local", "pinned", "ollama/small"), ALL)
    auto = replay(log.events, scenario("auto", "auto", "ollama/small"), ALL)
    assert local.cuts == 1
    assert local.peak_share == 1.0
    assert auto.cuts == 0
    assert auto.step_ups == 1
    assert auto.cost_usd > 0


def test_a_prompt_too_big_at_the_start_of_a_run_goes_to_a_bigger_model_without_a_step_up() -> None:
    log = Log()
    log.user("u1")
    log.call([("u1", 40000)])
    local = replay(log.events, scenario("pinned local", "pinned", "ollama/small"), ALL)
    auto = replay(log.events, scenario("auto", "auto", "ollama/small"), ALL)
    assert local.cuts == 1
    assert (auto.cuts, auto.step_ups) == (0, 0)
    assert auto.cost_usd > 0


def test_a_recorded_struggle_of_the_local_model_steps_up_the_rest_of_the_run() -> None:
    log = Log()
    log.user("u1")
    first = log.call([("u1", 200)], done={"text_tool_calls": "unread"})
    log.call([("u1", 200), (first, 100)])
    log.call([("u1", 200), (first, 100), ("a2", 100)])
    auto = replay(log.events, scenario("auto", "auto", "ollama/small"), ALL)
    assert auto.step_ups == 1
    assert auto.cuts == 0
    assert auto.cost_usd > 0  # the two later calls ran on the budget model


def test_a_struggle_of_a_hosted_model_does_not_step_up() -> None:
    log = Log()
    log.user("u1")
    log.call([("u1", 200)], tier="frontier", done={"text_tool_calls": "unread"})
    auto = replay(log.events, scenario("auto", "auto", "ollama/small"), ALL)
    assert auto.step_ups == 0


def test_invalid_tool_calls_in_a_row_are_a_struggle() -> None:
    log = Log()
    log.user("u1")
    first = log.call(
        [("u1", 200)],
        tools=[("c1", "read_file", {}), ("c2", "read_file", {"x": 1})],
    )
    log.tool_failed("c1", "invalid arguments for read_file: path is required")
    log.tool_failed("c2", "invalid arguments for read_file: path is required")
    log.call([("u1", 200), (first, 100), ("t_c1", 80), ("t_c2", 80)])
    auto = replay(log.events, scenario("auto", "auto", "ollama/small"), ALL)
    assert auto.step_ups == 1


def many_results() -> Log:
    log = Log()
    log.user("u1")
    history: list[tuple[str, int]] = [("u1", 200)]
    for n in range(1, 9):
        reply = log.call(list(history), tools=[(f"c{n}", "read_file", {"path": str(n)})])
        log.tool_ok(f"c{n}")
        history += [(reply, 80), (f"t_c{n}", 3000)]
    log.call(list(history))
    return log


def test_clearing_lowers_the_estimated_tokens() -> None:
    log = many_results()
    never = ContextSettings(clear_at=0.98, clear_to=0.97, compact_at=0.99)
    plain = replay(log.events, scenario("pinned local", "pinned", "ollama/small", never), ALL)
    cleared = replay(log.events, scenario("pinned local", "pinned", "ollama/small"), ALL)
    assert cleared.clears > 0
    assert cleared.input_tokens < plain.input_tokens
    assert cleared.cuts <= plain.cuts


def test_a_long_session_is_summarised_and_the_summary_has_a_cost() -> None:
    log = Log()
    history: list[tuple[str, int]] = []
    for turn in range(1, 9):
        run = f"r{turn}"
        log.user(f"u{turn}", run)
        history.append((f"u{turn}", 3000))
        reply = log.call(list(history), run=run, tier="frontier", window=200000)
        history.append((reply, 3000))
    big = ContextSettings(clear_at=0.5, clear_to=0.3, compact_at=0.6)
    auto = replay(log.events, scenario("auto", "auto", "anthropic/big", big), ALL)
    many = replay(log.events, scenario("pinned frontier", "pinned", "anthropic/big"), ALL)
    assert many.summaries == 0
    # on a local window of 8K the same history is summarised, on the local model: free
    local = replay(log.events, scenario("pinned local", "pinned", "ollama/small", big), ALL)
    assert local.summaries > 0
    assert local.cost_usd == 0
    assert auto.calls == 8


def test_a_call_without_sizes_is_skipped_and_counted() -> None:
    log = Log()
    log.user("u1")
    log.call([("u1", 200)], sized=False)
    log.call([("u1", 200)])
    report = replay(log.events, scenario("auto", "auto", "ollama/small"), ALL)
    assert (report.calls, report.skipped) == (1, 1)


def test_a_failed_call_is_skipped() -> None:
    log = Log()
    log.user("u1")
    log.call([("u1", 200)], done={"failed": True})
    report = replay(log.events, scenario("auto", "auto", "ollama/small"), ALL)
    assert (report.calls, report.skipped) == (0, 1)


def test_the_recorded_run_counts_prompts_the_server_cut() -> None:
    log = Log()
    log.user("u1")
    log.call([("u1", 200)], tokens=500, done={"cost_usd": 0.25})
    log.call([("u1", 200)], tokens=8100, done={"cost_usd": 0.5})
    log.add("r1", "run.failed", {"message": "no", "code": "context_full"})
    report = recorded(log.events)
    assert (report.calls, report.cuts) == (2, 2)
    assert report.cost_usd == pytest.approx(0.75)
    assert report.input_tokens == 8600


def test_scenarios_pick_the_models_the_ladder_names_or_golem_chooses() -> None:
    found = scenarios_for("ollama/small", RoutingSettings(), CONTEXT, ALL)
    assert [(s.name, s.session_model) for s in found] == [
        ("pinned frontier", "anthropic/big"),
        ("pinned local", "ollama/small"),
        ("auto", "ollama/small"),
    ]
    only_local = scenarios_for("ollama/small", RoutingSettings(), CONTEXT, [LOCAL])
    assert [s.name for s in only_local] == ["pinned local", "auto"]


def test_the_report_sums_the_sessions_and_names_the_dearest() -> None:
    cheap, dear = small_session(), grown()
    dear.session_id = "s2"
    dear.events = [e.model_copy(update={"session_id": "s2"}) for e in dear.events]
    report = build_report(
        {"s1": cheap.events, "s2": dear.events},
        routing=RoutingSettings(),
        context=CONTEXT,
        facts=ALL,
        days=14,
    )
    names = [row.name for row in report.scenarios]
    assert names == ["pinned frontier", "pinned local", "auto"]
    assert (report.sessions, report.calls, report.skipped) == (2, 5, 0)
    by_name = {row.name: row for row in report.scenarios}
    assert by_name["pinned local"].cuts == 1
    assert by_name["auto"].cuts == 0
    assert by_name["auto"].step_ups == 1
    assert by_name["pinned frontier"].cost_usd > by_name["auto"].cost_usd > 0
    assert [t.session_id for t in report.top] == ["s2"]
    assert report.actual.name == "as it really ran"
    assert "hi" not in report.model_dump_json()


async def test_the_manager_reads_the_stored_sessions(database: Database, tmp_path: Path) -> None:
    class Source:
        async def facts(
            self, refs: Sequence[str], *, overrides: Mapping[str, float | str] | None = None
        ) -> list[ModelFacts]:
            return ALL

    events = EventLog(database)
    records = SessionRecords(database)
    runtime = open_chat(ModelRouter(model=ToolCallingChatModel(replies=["x"])), InMemorySaver())
    log = SessionLog(events, EventBus(), records)
    manager = SessionManager(runtime, log, records, RunRecords(database))
    manager.facts = Source()
    for event in grown().events:
        await log.emit(event.session_id, event.run_id, event.type, event.data)
    now = datetime.now(UTC)
    report = await manager.eval_routing(14, None, now)
    assert report.sessions == 1
    assert {row.name for row in report.scenarios} == {"pinned frontier", "pinned local", "auto"}
    assert report.top and report.top[0].session_id == "s1"
    old = await manager.eval_routing(14, None, datetime(2030, 1, 1, tzinfo=UTC))
    assert old.sessions == 0


LOCAL_ONLY = [LOCAL, facts("ollama/big", "local", 32768, 0.0)]
CLOUD_ONLY = [CHEAP, BIG]
WISHES = [("explorer", "cheapest"), ("reviewer", "stronger"), ("planner", "same")]


def lead_with_helpers(setup: Sequence[ModelFacts], profile: str) -> Log:
    """A lead with three helpers, recorded as the daemon would pick them in ``setup``."""
    log = Log("lead", profile)
    log.user("u1")
    log.call([("u1", 400)], tier=setup[0].tier, window=setup[0].window)
    lead = next(m for m in setup if m.profile == profile)
    traits = Traits(needs_tools=True, paid_allowed=lead.tier != "local")
    for index, (agent, wish) in enumerate(WISHES):
        choice = pick_helper(wish, lead, ladder(LadderSettings(), profile, setup), traits)
        log.helper(index, agent, wish, choice.model, choice.detail)
    return log


@pytest.mark.parametrize(
    ("setup", "profile", "tiers"),
    [
        (LOCAL_ONLY, "ollama/small", {"local"}),
        (CLOUD_ONLY, "deepseek/cheap", {"budget", "frontier"}),
    ],
)
def test_the_report_shows_the_helper_picks_in_a_local_only_and_a_cloud_only_setup(
    setup: list[ModelFacts], profile: str, tiers: set[str]
) -> None:
    log = lead_with_helpers(setup, profile)
    report = build_report(
        {"lead": log.events},
        routing=RoutingSettings(),
        context=CONTEXT,
        facts=setup,
        days=14,
    )
    assert [(h.agent, h.wish) for h in report.helpers] == WISHES
    assert {h.would_tier for h in report.helpers} <= tiers
    assert all(h.would_why and h.ran_why for h in report.helpers)
    # The setup is the one they were recorded in, so the pick gives what ran.
    assert [h.would for h in report.helpers] == [h.ran for h in report.helpers]
    assert all(h.session_id == "lead" for h in report.helpers)


def test_a_helper_recorded_in_one_setup_is_picked_again_in_the_other() -> None:
    log = lead_with_helpers(LOCAL_ONLY, "ollama/small")
    rows = helper_rows(log.events, routing=RoutingSettings(), context=CONTEXT, facts=ALL)
    stronger = next(r for r in rows if r.wish == "stronger")
    assert stronger.ran == "ollama/small"
    assert stronger.would == "deepseek/cheap"  # ALL has a budget model, the tier above local
    assert stronger.would_asks  # a paid model, and a local chat has not agreed
    cheapest = next(r for r in rows if r.wish == "cheapest")
    assert cheapest.would_tier == "local"
    assert not cheapest.would_asks


def test_a_session_without_helpers_has_no_helper_rows() -> None:
    assert helper_rows(small_session().events, routing=RoutingSettings(), context=CONTEXT,
                       facts=ALL) == []  # fmt: skip
