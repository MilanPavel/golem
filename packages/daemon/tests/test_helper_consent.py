"""The paid question comes before a helper's first paid call (ADR-059, sections 5 and 8; #1303).

Scripted models, a fixed list of model facts (the harness of ``test_helper_model``). A helper
whose wish lands on a paid model, in a chat that has not agreed, parks on its own
``route.consent.needed``; the answer decides what runs.
"""

# pyright: reportPrivateUsage=false
from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from fakes import FixedFacts
from test_helper_model import (  # pyright: ignore
    BIG,
    CHEAP,
    LOCAL,
    _agent,
    _cloud_setup,
    _local_setup,
    _mixed_setup,
    _routed,
    _settings,
    _started,
)
from test_helper_sessions import _LIVE, _Chat  # pyright: ignore

from golem.config import GolemSettings, RoutingSettings
from golem.store.database import Database
from golem_protocol.commands import PendingItem
from golem_protocol.events import ChatEvent, HelperModelEvent, RouteConsentNeededEvent


@pytest.fixture(autouse=True)
async def _settled(database: Database) -> AsyncIterator[None]:
    yield
    for chat in _LIVE:
        await chat.manager.cancel_all()
    _LIVE.clear()


@pytest.fixture
def project(tmp_path: Path) -> Path:
    root = tmp_path / "project"
    root.mkdir()
    (root / "a.py").write_text("def a():\n    return 1\n", encoding="utf-8")
    return root


def _chat(
    database: Database,
    tmp_path: Path,
    facts: FixedFacts,
    *,
    default: str = LOCAL,
    paid: str = "ask",
    local_only: Path | None = None,
) -> _Chat:
    base = _settings(default, local_only=local_only)
    routing: RoutingSettings = base.routing.model_copy(update={"paid": paid})
    settings: GolemSettings = base.model_copy(update={"routing": routing})
    chat = _Chat(database, ["done", "done", "done"], settings=settings, home=tmp_path)
    chat.manager.facts = facts
    return chat


async def _lead(chat: _Chat, project: Path, model: str = LOCAL, origin: str | None = None) -> str:
    return await chat.manager.create(model, cwd=str(project), origin=origin)


async def _helper(
    chat: _Chat,
    lead: str,
    project: Path,
    wish: str = "frontier",
    *,
    call: str = "call-1",
    index: int = 0,
    model: str = LOCAL,
) -> str:
    ref = await chat.manager.start_helper(
        lead, call, index, _agent(wish), "look", model, str(project), label=f"look {index}"
    )
    return ref.session_id


async def _asked(chat: _Chat, helper: str) -> RouteConsentNeededEvent:
    events = await chat.until(helper, "route.consent.needed")
    return next(e for e in events if isinstance(e, RouteConsentNeededEvent))


def _kinds(events: list[ChatEvent]) -> set[str]:
    return {e.type for e in events}


def _moved(events: list[ChatEvent]) -> list[HelperModelEvent]:
    return [e for e in events if isinstance(e, HelperModelEvent)]


async def _pending(chat: _Chat, session: str) -> PendingItem | None:
    activity = await chat.records.activity(session)
    assert activity is not None
    return await chat.manager._events.pending(activity)


async def _paid_ok(chat: _Chat, session: str) -> bool:
    record = await chat.records.get(session)
    assert record is not None
    return record.paid_ok


# --- asked once per chat ----------------------------------------------------------------------


async def test_a_local_lead_is_asked_once_and_then_not_again_in_the_chat(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _chat(database, tmp_path, _mixed_setup())
    lead = await _lead(chat, project)
    first = await _helper(chat, lead, project)

    asked = await _asked(chat, first)
    assert (asked.data.model_profile, asked.data.tier) == (BIG, "frontier")
    assert asked.data.alternatives == ["session", "once", "local"]
    assert asked.data.estimated_usd is not None
    # The helper is parked: no model call yet, and the lead sees it waiting for you.
    run = await chat.runs.latest(first)
    assert run is not None and run.status == "waiting"
    assert "model.call.started" not in _kinds(await chat.stored(first))
    assert await chat.manager.helpers(await _activity(chat, lead)) == (0, 1)

    await chat.manager.answer_consent(first, run.run_id, "session")
    await chat.until(first, "session.completed")
    (routed,) = _routed(await chat.stored(first))
    assert routed.data.model_profile == BIG

    second = await _helper(chat, lead, project, call="call-2")
    await chat.until(second, "session.completed")
    assert "route.consent.needed" not in _kinds(await chat.stored(second))
    (again,) = _routed(await chat.stored(second))
    assert again.data.model_profile == BIG


async def _activity(chat: _Chat, session: str):
    activity = await chat.records.activity(session)
    assert activity is not None
    return activity


async def test_the_question_names_the_helper_and_what_is_sent(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _chat(database, tmp_path, _mixed_setup())
    lead = await _lead(chat, project)
    helper = await _helper(chat, lead, project)

    asked = (await _asked(chat, helper)).data
    assert asked.helper_id == helper
    assert asked.agent == "explorer"
    assert asked.label == "look 0"
    assert asked.sent == ["the brief"]
    assert asked.not_sent == ["this chat"]
    assert "explorer" in asked.why
    # The question is the helper's own: nothing on the lead's log asks.
    assert "route.consent.needed" not in _kinds(await chat.stored(lead))
    # The summary item carries the same fields.
    item = await _pending(chat, helper)
    assert item is not None and item.kind == "consent"
    assert (item.helper_id, item.agent, item.label) == (helper, "explorer", "look 0")
    assert (item.sent, item.not_sent) == (["the brief"], ["this chat"])


# --- the answers ------------------------------------------------------------------------------


async def test_yes_for_the_session_sets_paid_ok_on_the_lead_and_not_on_the_helper(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _chat(database, tmp_path, _mixed_setup())
    lead = await _lead(chat, project)
    helper = await _helper(chat, lead, project)
    await _asked(chat, helper)
    run = await chat.runs.latest(helper)
    assert run is not None

    assert not await _paid_ok(chat, lead)
    await chat.manager.answer_consent(helper, run.run_id, "session")
    await chat.until(helper, "session.completed")

    assert await _paid_ok(chat, lead)
    assert chat.manager._sessions[lead].paid_ok
    assert not await _paid_ok(chat, helper)
    assert await _pending(chat, helper) is None


async def test_once_runs_the_helper_on_the_paid_model_and_the_next_one_asks_again(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _chat(database, tmp_path, _mixed_setup())
    lead = await _lead(chat, project)
    first = await _helper(chat, lead, project)
    await _asked(chat, first)
    run = await chat.runs.latest(first)
    assert run is not None
    await chat.manager.answer_consent(first, run.run_id, "once")
    await chat.until(first, "session.completed")

    (routed,) = _routed(await chat.stored(first))
    assert routed.data.model_profile == BIG
    assert not await _paid_ok(chat, lead)
    assert _moved(await chat.stored(lead)) == []

    second = await _helper(chat, lead, project, call="call-2")
    await _asked(chat, second)


async def test_no_runs_the_helper_on_the_local_model_with_a_fresh_window(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _chat(database, tmp_path, _mixed_setup())
    lead = await _lead(chat, project)
    helper = await _helper(chat, lead, project)
    await _asked(chat, helper)
    run = await chat.runs.latest(helper)
    assert run is not None
    await chat.manager.answer_consent(helper, run.run_id, "local")
    await chat.until(helper, "session.completed")

    record = await chat.records.get(helper)
    assert record is not None
    assert (record.model_profile, record.route) == (LOCAL, "pinned")
    own = await chat.stored(helper)
    (routed,) = _routed(own)
    assert routed.data.model_profile == LOCAL
    assert "fresh window" in routed.data.detail
    assert "stay local" in routed.data.detail
    assert [e.data.answer for e in own if e.type == "route.consent.answered"] == ["local"]
    assert not await _paid_ok(chat, lead)
    # The lead's log was written before the answer: its reason says what a no becomes.
    reason = _started(await chat.stored(lead)).data.pick_reason
    assert "waits for your yes" in reason
    assert f"on a no it runs on {LOCAL}" in reason
    assert _started(await chat.stored(lead)).data.model == BIG
    # The lead's log then says which model the helper ran on.
    (moved,) = _moved(await chat.stored(lead))
    assert (moved.data.call_id, moved.data.index, moved.data.helper_id) == ("call-1", 0, helper)
    assert moved.data.model == LOCAL
    assert "fresh window" in moved.data.pick_reason


async def test_the_always_ask_setting_asks_again_though_the_chat_said_yes(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _chat(database, tmp_path, _mixed_setup(), paid="always_ask")
    lead = await _lead(chat, project)
    chat.manager._sessions[lead].paid_ok = True
    helper = await _helper(chat, lead, project)
    asked = await _asked(chat, helper)
    assert asked.data.model_profile == BIG


# --- a batch ----------------------------------------------------------------------------------


async def test_two_helpers_of_one_batch_are_answered_by_one_yes(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _chat(database, tmp_path, _mixed_setup())
    lead = await _lead(chat, project)
    one = await _helper(chat, lead, project, index=0)
    two = await _helper(chat, lead, project, index=1)
    await _asked(chat, one)
    await _asked(chat, two)
    assert await chat.manager.helpers(await _activity(chat, lead)) == (0, 2)

    run = await chat.runs.latest(one)
    assert run is not None
    await chat.manager.answer_consent(one, run.run_id, "session")
    await chat.until(one, "session.completed")
    await chat.until(two, "session.completed")

    for helper in (one, two):
        events = await chat.stored(helper)
        assert [e.data.answer for e in events if e.type == "route.consent.answered"] == ["session"]
        (routed,) = _routed(events)
        assert routed.data.model_profile == BIG
    # The lead agreed once.
    updates = [
        e
        for e in await chat.stored(lead)
        if e.type == "session.updated" and e.data.paid_ok is not None
    ]
    assert len(updates) == 1


async def test_a_no_for_one_helper_of_a_batch_is_a_no_for_all(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _chat(database, tmp_path, _mixed_setup())
    lead = await _lead(chat, project)
    one = await _helper(chat, lead, project, index=0)
    two = await _helper(chat, lead, project, index=1)
    await _asked(chat, two)
    run = await chat.runs.latest(two)
    assert run is not None
    await chat.manager.answer_consent(two, run.run_id, "local")
    for helper in (one, two):
        await chat.until(helper, "session.completed")
        (routed,) = _routed(await chat.stored(helper))
        assert routed.data.model_profile == LOCAL


# --- never asked ------------------------------------------------------------------------------


async def test_local_models_only_never_ask_and_a_paid_wish_is_the_local_fresh_window(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _chat(database, tmp_path, _local_setup())
    lead = await _lead(chat, project)
    helper = await _helper(chat, lead, project, "stronger")
    await chat.until(helper, "session.completed")
    assert "route.consent.needed" not in _kinds(await chat.stored(helper))
    assert "fresh window" in _started(await chat.stored(lead)).data.pick_reason
    assert _moved(await chat.stored(lead)) == []


async def test_cloud_models_only_never_ask(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _chat(database, tmp_path, _cloud_setup(), default=CHEAP)
    lead = await _lead(chat, project, CHEAP)
    helper = await _helper(chat, lead, project, "stronger", model=CHEAP)
    await chat.until(helper, "session.completed")
    assert "route.consent.needed" not in _kinds(await chat.stored(helper))
    assert _started(await chat.stored(lead)).data.model == BIG
    assert not await _paid_ok(chat, lead)
    assert _moved(await chat.stored(lead)) == []


async def test_a_local_only_folder_never_asks_and_stays_local(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _chat(database, tmp_path, _mixed_setup(), local_only=project)
    lead = await _lead(chat, project)
    helper = await _helper(chat, lead, project)
    await chat.until(helper, "session.completed")
    assert "route.consent.needed" not in _kinds(await chat.stored(helper))
    (routed,) = _routed(await chat.stored(helper))
    assert routed.data.model_profile == LOCAL


async def test_paid_never_and_a_routine_lead_never_ask(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _chat(database, tmp_path, _mixed_setup(), paid="never")
    lead = await _lead(chat, project)
    helper = await _helper(chat, lead, project)
    await chat.until(helper, "session.completed")
    assert "route.consent.needed" not in _kinds(await chat.stored(helper))
    assert _started(await chat.stored(lead)).data.model == LOCAL

    chat = _chat(database, tmp_path, _mixed_setup())
    lead = await _lead(chat, project, origin="routine:nightly")
    helper = await _helper(chat, lead, project)
    await chat.until(helper, "session.completed")
    assert "route.consent.needed" not in _kinds(await chat.stored(helper))
    assert _started(await chat.stored(lead)).data.model == LOCAL


async def test_a_wish_that_is_not_paid_never_asks(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _chat(database, tmp_path, _mixed_setup())
    lead = await _lead(chat, project)
    helper = await _helper(chat, lead, project, "cheapest")
    await chat.until(helper, "session.completed")
    assert "route.consent.needed" not in _kinds(await chat.stored(helper))


# --- stopping while the question waits --------------------------------------------------------


async def test_stopping_the_helper_while_the_question_waits_leaves_no_pending_item(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _chat(database, tmp_path, _mixed_setup())
    lead = await _lead(chat, project)
    helper = await _helper(chat, lead, project)
    await _asked(chat, helper)
    assert await _pending(chat, helper) is not None

    assert await chat.manager.stop_helper(helper) is True

    run = await chat.runs.latest(helper)
    assert run is not None and run.status == "cancelled"
    assert await _pending(chat, helper) is None
    assert await chat.manager.helpers(await _activity(chat, lead)) is None
    assert "model.call.started" not in _kinds(await chat.stored(helper))
    ended = [e for e in await chat.stored(lead) if e.type == "helper.ended"]
    assert [e.data.stopped for e in ended] == ["cancelled"]


async def test_closing_the_lead_while_the_question_waits_leaves_no_pending_item(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _chat(database, tmp_path, _mixed_setup())
    lead = await _lead(chat, project)
    helper = await _helper(chat, lead, project)
    await _asked(chat, helper)

    await chat.manager.close(lead)

    run = await chat.runs.latest(helper)
    assert run is not None and run.status == "cancelled"
    assert await _pending(chat, helper) is None
    assert await chat.manager.helpers(await _activity(chat, lead)) is None
