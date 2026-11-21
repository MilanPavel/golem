"""Continuing a helper as a chat: ``session.fork`` of a helper (ADR-059, section 9; #1568)."""

# pyright: reportPrivateUsage=false
from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from test_helper_consent import (  # pyright: ignore
    _asked,
    _chat,
    _helper,
    _lead,
    _settled,  # pyright: ignore
)
from test_helper_model import BIG, LOCAL, _mixed_setup  # pyright: ignore
from test_helper_sessions import EXPLORER, SETTINGS, _Chat  # pyright: ignore

from golem.config import AgentSettings, GolemSettings, RoutingSettings
from golem.sessions.manager import HelperTrimmedError, MessageNotFoundError
from golem.sessions.summaries import summarize
from golem.sessions.trim import HelperTrimmer
from golem.store.database import Database

__all__ = ["_settled"]

NOW = datetime(2026, 12, 20, 12, 0, tzinfo=UTC)


@pytest.fixture
def project(tmp_path: Path) -> Path:
    root = tmp_path / "project"
    root.mkdir()
    (root / "a.py").write_text("def a():\n    return 1\n", encoding="utf-8")
    return root


async def _finished(chat: _Chat, project: Path) -> tuple[str, str]:
    lead = await chat.manager.create(None, cwd=str(project))
    helper = await chat.helper(lead, project, EXPLORER, brief="where is a")
    await chat.until(helper, "session.completed")
    return lead, helper


async def _texts(chat: _Chat, session: str) -> list[tuple[str, str]]:
    events = await chat.stored(session)
    return [(e.data.role, e.data.text) for e in events if e.type == "message.completed"]


async def test_a_finished_explorer_continues_as_an_ordinary_chat(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _Chat(database, ["found it", "next answer"], home=tmp_path)
    lead, helper = await _finished(chat, project)
    helper_events = len(await chat.stored(helper))
    helper_row = await chat.records.get(helper)

    new = await chat.manager.fork(helper)

    record = await chat.records.get(new)
    assert record is not None and helper_row is not None
    assert record.origin == "user" and record.agent is None
    assert record.parent_session_id is None and record.parent_call_id is None
    assert record.helper_index is None
    assert record.forked_from == helper
    assert (record.model_profile, record.cwd) == (helper_row.model_profile, helper_row.cwd)
    assert record.permission_mode is None and record.trimmed_at is None
    assert await _texts(chat, new) == [("user", "where is a"), ("assistant", "found it")]
    assert new in [a.session.session_id for a in await chat.manager.recent(50)]

    await chat.manager.send(new, "and b?")
    await chat.until(new, "run.completed")
    assert "write_file" in chat.model.bound and "shell" in chat.model.bound
    system = [m for m in chat.model.seen[-1] if m.type == "system"]
    assert not any("explorer" in str(m.content) for m in system)
    assert (await _texts(chat, new))[-2:] == [("user", "and b?"), ("assistant", "next answer")]

    assert len(await chat.stored(helper)) == helper_events
    after = await chat.records.get(helper)
    assert after is not None and after.parent_session_id == lead
    assert after.permission_mode == helper_row.permission_mode


async def test_the_lead_still_shows_its_helper_and_the_chat_is_not_a_helper(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _Chat(database, ["found it"], home=tmp_path)
    lead, helper = await _finished(chat, project)
    new = await chat.manager.fork(helper)

    assert await chat.records.open_helpers(lead) == [helper]
    activity = await chat.records.activity(new)
    assert activity is not None
    summary = summarize(activity)
    assert summary.parent_session_id is None and summary.forked_from == helper


async def test_a_message_id_in_the_helper_forks_up_to_it(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _Chat(database, ["found it"], home=tmp_path)
    _, helper = await _finished(chat, project)
    first = next(e for e in await chat.stored(helper) if e.type == "message.completed")

    new = await chat.manager.fork(helper, first.data.message_id)  # type: ignore[union-attr]

    assert await _texts(chat, new) == [("user", "where is a")]
    with pytest.raises(MessageNotFoundError):
        await chat.manager.fork(helper, "m_nope")


async def test_a_trimmed_helper_cannot_be_continued(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _Chat(database, ["found it"], home=tmp_path)
    _, helper = await _finished(chat, project)
    trimmer = HelperTrimmer(
        chat.records,
        chat.manager._events,
        lambda: AgentSettings(),
        lambda: NOW + timedelta(days=30),
    )
    assert await trimmer.run_once() == 1

    with pytest.raises(HelperTrimmedError, match="steps were removed"):
        await chat.manager.fork(helper)


async def test_a_local_lead_continues_as_a_local_chat(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _Chat(database, ["found it"], home=tmp_path)
    lead = await chat.manager.create(None, cwd=str(project))
    await chat.manager.set_route(lead, "local")
    helper = await chat.helper(lead, project)
    await chat.until(helper, "session.completed")

    new = await chat.manager.fork(helper)

    record = await chat.records.get(new)
    assert record is not None and record.route == "local"
    assert chat.manager._sessions[new].route == "local"


async def test_a_local_only_folder_covers_the_continued_chat(
    database: Database, project: Path, tmp_path: Path
) -> None:
    settings = GolemSettings(
        default_model=SETTINGS.default_model,
        routing=RoutingSettings(local_only=[str(project)]),
    )
    chat = _Chat(database, ["found it", "more"], settings=settings, home=tmp_path)
    lead, helper = await _finished(chat, project)
    new = await chat.manager.fork(helper)
    # The rule is by folder, and the fork keeps the folder; send refuses a hosted model there.
    assert chat.manager.local_only(str(project))

    record = await chat.records.get(new)
    assert record is not None and record.cwd == str(project)
    del lead


async def test_a_helper_that_ran_on_a_paid_model_does_not_carry_the_paid_answer(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _chat(database, tmp_path, _mixed_setup())
    lead = await _lead(chat, project)
    helper = await _helper(chat, lead, project)
    await _asked(chat, helper)
    run = await chat.runs.latest(helper)
    assert run is not None
    await chat.manager.answer_consent(helper, run.run_id, "session")
    await chat.until(helper, "session.completed")
    assert chat.manager._sessions[lead].paid_ok

    new = await chat.manager.fork(helper)

    record = await chat.records.get(new)
    assert record is not None and record.model_profile == BIG
    assert not record.paid_ok and not chat.manager._sessions[new].paid_ok
    assert chat.manager._sessions[new].helper_ask is None
    assert (await chat.records.get(lead)).paid_ok  # type: ignore[union-attr]
    assert LOCAL != BIG


async def test_the_trim_skips_a_continued_chat(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _Chat(database, ["found it"], home=tmp_path)
    _, helper = await _finished(chat, project)
    new = await chat.manager.fork(helper)
    trimmer = HelperTrimmer(
        chat.records,
        chat.manager._events,
        lambda: AgentSettings(),
        lambda: NOW + timedelta(days=400),
    )
    ids = [h.session_id for h in await chat.records.finished_helpers()]
    assert new not in ids

    await trimmer.run_once()

    record = await chat.records.get(new)
    assert record is not None and record.trimmed_at is None
    assert len(await _texts(chat, new)) == 2
