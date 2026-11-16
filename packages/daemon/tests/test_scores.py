# pyright: reportPrivateUsage=false
"""The scoreboard of each model: the projection fills it, ``Scores`` reads it."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

from test_discovery import Network, _discovery, _ollama_routes

from golem.config import GolemSettings
from golem.models.facts import ListedFacts
from golem.models.keys import MemoryKeyStore
from golem.models.router import ModelRouter
from golem.models.scores import MIN_TOOL_CALLS, WINDOW, Scores, is_model_fault, tool_score_of
from golem.models.window import ContextWindow
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.usage import backfill
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import SessionRecords
from golem_protocol.events import (
    EmptyEventData,
    ModelCallCompletedData,
    ModelCallStartedData,
    ModelRoutedData,
    SessionCreatedData,
    ToolFailedData,
    ToolRequestedData,
)

INVALID = "invalid arguments for read_file: path is required"
UNKNOWN = "unknown tool 'frob'"
REF = "ollama/qwen3:8b"


def _log(database: Database) -> SessionLog:
    return SessionLog(EventLog(database), EventBus(), SessionRecords(database))


async def _session(log: SessionLog) -> None:
    await log.emit("s_1", None, "session.created", SessionCreatedData(model_profile="x"))
    await log.emit("s_1", "r_1", "run.started", EmptyEventData())


async def _call(
    log: SessionLog,
    message_id: str,
    *,
    run: str = "r_1",
    good: int = 0,
    bad: tuple[str, ...] = (),
    text: str | None = None,
) -> None:
    """One model call that asked for ``good`` working tool calls and one per ``bad`` message."""
    started = {
        "message_id": message_id,
        "index": 1,
        "profile": "p",
        "provider": "ollama",
        "model": "qwen3:8b",
        "tier": "local",
    }
    await log.emit("s_1", run, "model.call.started", ModelCallStartedData.model_validate(started))
    done = {"message_id": message_id, "latency_ms": 5, "text_tool_calls": text}
    await log.emit("s_1", run, "model.call.completed", ModelCallCompletedData.model_validate(done))
    for index in range(good):
        await _tool(log, message_id, f"{message_id}_g{index}", run, None)
    for index, message in enumerate(bad):
        await _tool(log, message_id, f"{message_id}_b{index}", run, message)


async def _tool(
    log: SessionLog, message_id: str, call_id: str, run: str, failure: str | None
) -> None:
    requested = ToolRequestedData(call_id=call_id, message_id=message_id, name="t", args={})
    await log.emit("s_1", run, "tool.requested", requested)
    if failure is not None:
        await log.emit("s_1", run, "tool.failed", ToolFailedData(call_id=call_id, message=failure))


async def _step_up(log: SessionLog, run: str = "r_1", reason: str = "escalated") -> None:
    routed = ModelRoutedData.model_validate(
        {"model_profile": "deepseek", "tier": "budget", "reason": reason, "detail": "x"}
    )
    await log.emit("s_1", run, "model.routed", routed)


async def _counts(database: Database, call_id: str) -> tuple[int | None, int | None, int | None]:
    row = await database.fetch_one(
        "SELECT tool_calls, bad_tool_calls, recovered_text_calls FROM model_calls"
        " WHERE call_id = ?",
        (call_id,),
    )
    assert row is not None
    return row[0], row[1], row[2]


def test_only_a_wrong_call_is_the_models_fault() -> None:
    assert is_model_fault(INVALID)
    assert is_model_fault(UNKNOWN)
    assert is_model_fault("mcp__x__y is not available in this session: the MCP server x")
    assert not is_model_fault("OSError: disk full")
    assert not is_model_fault("the user denied this tool call")
    assert not is_model_fault("cancelled: the run stopped before this tool call finished")


def test_the_tool_score_waits_for_enough_calls() -> None:
    assert tool_score_of(MIN_TOOL_CALLS - 1, 0) is None
    assert tool_score_of(MIN_TOOL_CALLS, 5) == 0.75


async def test_a_run_with_good_and_bad_tool_calls_fills_the_counts(database: Database) -> None:
    log = _log(database)
    await _session(log)
    await _call(log, "m_1", good=3, bad=(INVALID, UNKNOWN, "OSError: disk full"))
    assert await _counts(database, "m_1") == (6, 2, None)


async def test_a_recovered_text_call_is_recovered_not_bad(database: Database) -> None:
    log = _log(database)
    await _session(log)
    await _call(log, "m_1", good=1, text="recovered")
    assert await _counts(database, "m_1") == (1, None, 1)


async def test_an_unread_text_call_is_bad(database: Database) -> None:
    log = _log(database)
    await _session(log)
    await _call(log, "m_1", text="unread")
    assert await _counts(database, "m_1") == (1, 1, None)


async def test_a_step_up_counts_against_the_model_that_was_answering(
    database: Database,
) -> None:
    log = _log(database)
    await _session(log)
    await _call(log, "m_1", good=1)
    await _step_up(log)
    await _step_up(log, reason="fallback")
    rows = await database.fetch_all("SELECT provider, model, outcome FROM model_outcomes")
    assert [tuple(r) for r in rows] == [("ollama", "qwen3:8b", "stepped_up")]


async def test_backfill_fills_the_counts_and_outcomes_again(database: Database) -> None:
    log = _log(database)
    await _session(log)
    await _call(log, "m_1", good=2, bad=(INVALID,))
    await _step_up(log)
    await database.fetch_all("DELETE FROM model_calls")
    await database.fetch_all("DELETE FROM model_outcomes")
    await backfill(database)
    assert await _counts(database, "m_1") == (3, 1, None)
    row = await database.fetch_one("SELECT COUNT(*) FROM model_outcomes")
    assert row is not None and row[0] == 1


async def test_scores_read_the_last_200_tool_calls(database: Database) -> None:
    log = _log(database)
    await _session(log)
    # 100 old bad calls, then 200 good ones: the bad ones fall out of the window.
    for index in range(10):
        await _call(log, f"old_{index}", bad=(INVALID,) * 10)
    for index in range(20):
        await _call(log, f"new_{index}", good=10)
    score = await Scores(database).of(REF)
    assert score is not None
    assert (score.tool_calls, score.bad_tool_calls, score.tool_score) == (WINDOW, 0, 1.0)
    assert (score.calls, score.runs) == (30, 1)


async def test_under_twenty_tool_calls_the_score_is_unknown(database: Database) -> None:
    log = _log(database)
    await _session(log)
    await _call(log, "m_1", good=10, bad=(INVALID,) * 9)
    scores = Scores(database)
    score = await scores.of(REF)
    assert score is not None
    assert (score.tool_calls, score.bad_tool_calls, score.tool_score) == (19, 9, None)
    assert await scores.of("ollama/other") is None


async def test_scores_count_step_ups_and_runs(database: Database) -> None:
    log = _log(database)
    await _session(log)
    await _call(log, "m_1", good=1)
    await _step_up(log)
    await log.emit("s_1", "r_2", "run.started", EmptyEventData())
    await _call(log, "m_2", run="r_2", good=1)
    score = await Scores(database).of(REF)
    assert score is not None
    assert (score.runs, score.stepped_up, score.retried) == (2, 1, 0)


async def test_a_reset_starts_the_score_again_and_keeps_the_rows(database: Database) -> None:
    log = _log(database)
    await _session(log)
    await _call(log, "m_1", good=5, bad=(INVALID,) * 25)
    later = datetime.now(UTC) + timedelta(seconds=5)
    scores = Scores(database, now=lambda: later)
    before = await scores.of(REF)
    assert before is not None and before.tool_score is not None and before.tool_score < 0.5
    await scores.reset(REF)
    assert await scores.of(REF) is None
    rows = await database.fetch_one("SELECT COUNT(*) FROM model_calls")
    assert rows is not None and rows[0] == 1


async def test_the_scores_are_kept_for_a_minute(database: Database) -> None:
    log = _log(database)
    await _session(log)
    ticks = [0.0]
    scores = Scores(database, clock=lambda: ticks[0])
    assert await scores.of(REF) is None
    await _call(log, "m_1", good=1)
    assert await scores.of(REF) is None
    ticks[0] = 61.0
    assert await scores.of(REF) is not None


async def test_the_listing_and_the_facts_carry_the_score(
    database: Database, tmp_path: Path
) -> None:
    log = _log(database)
    await _session(log)
    await _call(log, "m_1", good=15, bad=(INVALID,) * 15)
    scores = Scores(database)
    router = ModelRouter(GolemSettings(), keys=MemoryKeyStore())
    discovery = _discovery(router, Network(_ollama_routes()), tmp_path)
    discovery.scores = scores
    listing = await discovery.list()
    by_ref = {model.ref: model for model in listing.models}
    score = by_ref[REF].score
    assert score is not None and score.tool_score == 0.5
    assert by_ref["ollama/small:1b"].score is None
    source = ListedFacts(
        discovery, router, lambda profile, overrides: ContextWindow(16384, 16384), scores=scores
    )
    (found,) = await source.facts([REF])
    assert found.tool_score == 0.5
    await discovery.aclose()
