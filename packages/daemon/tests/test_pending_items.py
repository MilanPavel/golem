"""A lead lists its helpers' pending questions, the same one once with a count (ADR-059, 8; #1326).

Scripted models, no real one. A helper's approval or paid question is an item of its own
session; the lead's ``pending_items`` carries its own item and the helpers', oldest first.
"""

# pyright: reportPrivateUsage=false
from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pytest
from fakes import FixedFacts, make_checkout
from test_helper_consent import _agent, _helper, _lead  # pyright: ignore
from test_helper_model import (  # pyright: ignore
    BIG,
    CHEAP,
    LOCAL,
    _cloud_setup,
    _local_setup,
    _mixed_setup,
    _settings,
)
from test_helper_sessions import _LIVE, WORKER, _Chat  # pyright: ignore

from golem.config import GolemSettings, RoutingSettings
from golem.sessions.summaries import summarize
from golem.store.database import Database
from golem_protocol.commands import PendingItem, SessionSummary

LOCK = ("shell", {"command": "uv lock"})
HWRITE = ("shell", {"command": "printf x > new.txt"})
WRITE = ("write_file", {"path": "new.txt", "content": "x"})


@pytest.fixture(autouse=True)
async def _settled(database: Database) -> AsyncIterator[None]:
    yield
    for chat in _LIVE:
        await chat.manager.cancel_all()
    _LIVE.clear()


@pytest.fixture
def project(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("GOLEM_HOME", str(tmp_path / "golem-home"))
    root = tmp_path / "project"
    root.mkdir()
    (root / "a.py").write_text("def a():\n    return 1\n", encoding="utf-8")
    return make_checkout(root)


class _Watch:
    def __init__(self) -> None:
        self.summaries: list[SessionSummary] = []

    def deliver_summary(self, summary: SessionSummary) -> None:
        self.summaries.append(summary)

    def of(self, session_id: str) -> list[SessionSummary]:
        return [s for s in self.summaries if s.session_id == session_id]


def _chat(
    database: Database,
    tmp_path: Path,
    replies: list[Any],
    facts: FixedFacts,
    *,
    default: str = LOCAL,
    paid: str = "ask",
) -> tuple[_Chat, _Watch]:
    base = _settings(default)
    routing: RoutingSettings = base.routing.model_copy(update={"paid": paid})
    settings: GolemSettings = base.model_copy(update={"routing": routing})
    chat = _Chat(database, replies, settings=settings, home=tmp_path)
    chat.manager.facts = facts
    watch = _Watch()
    chat.manager._events._bus.watch(watch)
    return chat, watch


async def _summary(chat: _Chat, session_id: str) -> SessionSummary:
    """The summary ``session.list`` makes of the session."""
    activity = await chat.records.activity(session_id)
    assert activity is not None
    manager = chat.manager
    own = await manager.pending(activity)
    helpers = await manager.helpers(activity)
    return summarize(
        activity,
        False,
        own,
        await manager.wait(activity),
        helpers,
        manager.step(session_id),
        await manager.pending_items(activity, own, helpers),
    )


async def _until(check: object) -> None:
    async with asyncio.timeout(5):
        while not await check():  # type: ignore[operator]
            await asyncio.sleep(0.01)


async def _asking(chat: _Chat, helper: str, kind: str = "approval.needed") -> None:
    await chat.until(helper, kind)

    async def waiting() -> bool:
        run = await chat.runs.latest(helper)
        return run is not None and run.status == "waiting"

    await _until(waiting)


async def _workers(
    chat: _Chat, watch: _Watch, lead: str, project: Path, count: int, call: str = "c"
) -> list[str]:
    """Start ``count`` workers, and return once each asks and the lead's watchers were told."""
    found: list[str] = []
    for index in range(count):
        found.append(await chat.helper(lead, project, WORKER, call_id=call, index=index))
        await _asking(chat, found[-1])

    async def told() -> bool:
        last = watch.of(lead)[-1]
        return sum(i.count or 1 for i in last.pending_items if i.helper) == count

    await _until(told)
    return found


async def _careful(chat: _Chat, project: Path, model: str = LOCAL) -> str:
    lead = await chat.manager.create(model, cwd=str(project))
    await chat.manager.set_mode(lead, "careful")
    return lead


# --- the same question is one item ------------------------------------------------------------


async def test_five_helpers_asking_the_same_call_are_one_item_with_a_count(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat, watch = _chat(database, tmp_path, [[LOCK]] * 5, _local_setup())
    lead = await _careful(chat, project)
    helpers = await _workers(chat, watch, lead, project, 5)

    summary = await _summary(chat, lead)
    (item,) = summary.pending_items
    assert (item.kind, item.name, item.count) == ("approval", "shell", 5)
    assert item.helper is not None
    # The first helper that asked stands for the group, with its own place in the call.
    assert (item.helper.session_id, item.helper.agent, item.helper.index) == (
        helpers[0],
        "worker",
        0,
    )
    assert item.helper.label is not None and item.helper.label != ""
    assert summary.pending == item
    # The lead's status follows ADR-059, 7: nothing in its own run waits. No lead run here.
    assert summary.status == "idle"
    assert (summary.helpers_running, summary.helpers_waiting) == (0, 5)
    # A helper's own summary lists its own item, without a helper or a count.
    mine = await _summary(chat, helpers[2])
    assert [(i.name, i.helper, i.count) for i in mine.pending_items] == [("shell", None, None)]
    assert mine.pending == mine.pending_items[0]


async def test_the_same_tool_with_another_subject_is_another_item(
    database: Database, project: Path, tmp_path: Path
) -> None:
    other = ("shell", {"command": "uv sync"})
    chat, watch = _chat(database, tmp_path, [[LOCK], [LOCK], [other]], _local_setup())
    lead = await _careful(chat, project)
    helpers = await _workers(chat, watch, lead, project, 3)

    items = (await _summary(chat, lead)).pending_items
    assert [(i.name, i.count) for i in items] == [("shell", 2), ("shell", None)]
    assert [i.helper.session_id for i in items if i.helper] == [helpers[0], helpers[2]]


async def test_two_different_questions_are_two_items_oldest_first(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat, watch = _chat(database, tmp_path, [[HWRITE], [LOCK], [HWRITE]], _local_setup())
    lead = await _careful(chat, project)
    helpers = await _workers(chat, watch, lead, project, 3)

    summary = await _summary(chat, lead)
    kinds = [
        (i.name, i.count, i.helper.session_id if i.helper else None) for i in summary.pending_items
    ]
    assert kinds == [("shell", 2, helpers[0]), ("shell", None, helpers[1])]
    assert summary.pending_items[0].since <= summary.pending_items[1].since
    assert summary.pending == summary.pending_items[0]


async def test_a_lead_lists_its_own_item_and_a_helpers(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat, watch = _chat(database, tmp_path, [[WRITE], [LOCK]], _local_setup())
    lead = await _careful(chat, project)
    await chat.manager.send(lead, "write it")
    await chat.until(lead, "approval.needed")
    await _until(lambda: _waiting(chat, lead))
    (helper,) = await _workers(chat, watch, lead, project, 1)

    summary = await _summary(chat, lead)
    assert summary.status == "waiting"
    assert [(i.name, i.helper.session_id if i.helper else None) for i in summary.pending_items] == [
        ("write_file", None),
        ("shell", helper),
    ]
    assert summary.pending == summary.pending_items[0]


async def _waiting(chat: _Chat, session_id: str) -> bool:
    run = await chat.runs.latest(session_id)
    return run is not None and run.status == "waiting"


# --- answering clears it, and the lead's summary is sent again --------------------------------


async def test_answering_one_clears_it_from_the_lead_and_the_lead_is_told(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat, watch = _chat(database, tmp_path, [[HWRITE], [LOCK], "done"], _local_setup())
    lead = await _careful(chat, project)
    one, two = await _workers(chat, watch, lead, project, 2)
    # The lead's summary went out with each helper's question as it appeared.
    sent = [[i.name for i in s.pending_items] for s in watch.of(lead)]
    assert ["shell"] in sent and ["shell", "shell"] in sent

    call = next(e for e in await chat.stored(one) if e.type == "approval.needed").data.call_id  # type: ignore[union-attr]
    await chat.manager.respond(one, call, "deny")
    await _until(lambda: _told(watch, lead, ["shell"]))

    assert [i.name for i in (await _summary(chat, lead)).pending_items] == ["shell"]
    assert [i.name for i in watch.of(lead)[-1].pending_items] == ["shell"]
    # The other helper's item is still its own.
    assert [
        i.helper.session_id for i in (await _summary(chat, lead)).pending_items if i.helper
    ] == [two]


async def _told(watch: _Watch, lead: str, names: list[str]) -> bool:
    last = watch.of(lead)[-1]
    return [i.name for i in last.pending_items] == names


async def test_a_group_answered_by_one_helper_shrinks_and_hands_over_to_the_next(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat, watch = _chat(database, tmp_path, [[LOCK]] * 3 + ["done"], _local_setup())
    lead = await _careful(chat, project)
    helpers = await _workers(chat, watch, lead, project, 3)
    call = next(
        e for e in await chat.stored(helpers[0]) if e.type == "approval.needed"
    ).data.call_id  # type: ignore[union-attr]

    await chat.manager.respond(helpers[0], call, "deny")
    await _until(lambda: _told_count(watch, lead, 2))

    (item,) = (await _summary(chat, lead)).pending_items
    assert item.count == 2 and item.helper is not None
    assert item.helper.session_id == helpers[1]
    assert watch.of(lead)[-1].pending_items[0].count == 2


async def _told_count(watch: _Watch, lead: str, count: int) -> bool:
    items = watch.of(lead)[-1].pending_items
    return len(items) == 1 and items[0].count == count


# --- the paid question ------------------------------------------------------------------------


async def test_a_helpers_paid_question_is_an_item_with_what_is_sent(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat, _watch = _chat(database, tmp_path, ["done"] * 3, _mixed_setup())
    lead = await _lead(chat, project)
    first = await _helper(chat, lead, project, "frontier", index=0)
    second = await _helper(chat, lead, project, "frontier", index=1)
    await _asking(chat, first, "route.consent.needed")
    await _asking(chat, second, "route.consent.needed")

    summary = await _summary(chat, lead)
    (item,) = summary.pending_items
    assert (item.kind, item.count) == ("consent", 2)
    assert item.sent == [
        "the brief, 1 word",
        "the instructions of the explorer agent",
        "what it reads with its tools, as it works",
    ]
    assert item.not_sent == ["this chat", "your memory"]
    assert item.helper is not None and item.helper.session_id == first
    assert (item.helper.agent, item.helper.label) == ("explorer", "look 0")
    assert summary.pending == item
    run = await chat.runs.latest(first)
    assert run is not None
    await chat.manager.answer_consent(first, run.run_id, "session")
    await _until(lambda: _no_items(chat, lead))
    assert (await _summary(chat, lead)).pending_items == []


async def _no_items(chat: _Chat, lead: str) -> bool:
    return (await _summary(chat, lead)).pending_items == []


async def test_a_paid_question_for_another_model_is_another_item(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat, _watch = _chat(database, tmp_path, ["done"] * 3, _mixed_setup())
    lead = await _lead(chat, project)
    one = await _helper(chat, lead, project, "frontier", index=0)
    two = await _helper(chat, lead, project, "budget", index=1)
    await _asking(chat, one, "route.consent.needed")
    await _asking(chat, two, "route.consent.needed")

    items = (await _summary(chat, lead)).pending_items
    assert [i.count for i in items] == [None, None]
    assert [i.helper.session_id for i in items if i.helper] == [one, two]
    assert BIG != CHEAP


# --- local models only, cloud models only -----------------------------------------------------


async def test_local_models_only_five_scripted_helpers_ask_once(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat, watch = _chat(database, tmp_path, [[LOCK]] * 5, _local_setup(), default=LOCAL)
    lead = await _careful(chat, project, LOCAL)
    await _workers(chat, watch, lead, project, 5)

    (item,) = (await _summary(chat, lead)).pending_items
    assert (item.kind, item.count) == ("approval", 5)
    # No model is paid: no consent anywhere.
    assert all(e.type != "route.consent.needed" for e in await chat.stored(lead))


async def test_cloud_models_only_five_scripted_helpers_ask_once(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat, _watch = _chat(
        database, tmp_path, [[LOCK]] * 5, _cloud_setup(), default=CHEAP, paid="always"
    )
    lead = await _careful(chat, project, CHEAP)
    for index in range(5):
        found = await chat.manager.start_helper(
            lead,
            "c",
            index,
            _agent("cheapest", "worker").model_copy(update={"tools": ["shell"], "asks": True}),
            "look",
            CHEAP,
            str(project),
            label=f"look {index}",
        )
        await _asking(chat, found.session_id)

    (item,) = (await _summary(chat, lead)).pending_items
    assert (item.kind, item.count) == ("approval", 5)


# --- sessions without helpers are as before ---------------------------------------------------


async def test_a_session_without_helpers_lists_only_its_own_item(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat, _watch = _chat(database, tmp_path, [[WRITE]], _local_setup())
    lead = await _careful(chat, project)
    idle = await _summary(chat, lead)
    assert (idle.pending, idle.pending_items) == (None, [])

    await chat.manager.send(lead, "write it")
    await chat.until(lead, "approval.needed")
    await _until(lambda: _waiting(chat, lead))
    summary = await _summary(chat, lead)
    assert summary.status == "waiting"
    assert summary.pending is not None
    assert summary.pending_items == [summary.pending]
    assert isinstance(summary.pending, PendingItem)
    assert (summary.pending.helper, summary.pending.count) == (None, None)
