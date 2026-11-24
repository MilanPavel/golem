"""A helper that waits says why: ``team`` when ``[agents] at_once`` holds it back, ``budget``
when a spent cap in ``[budget]`` does (ADR-059, ADR-060).

Local models only: only ``team`` can happen, since nothing costs. Cloud models only: both.
"""

# pyright: reportPrivateUsage=false
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import pytest
from test_helper_policy_setting import (  # pyright: ignore
    LOCAL,
    SETUPS,
    _Chat,
    _helper_ids,
    _settled,  # pyright: ignore  # noqa: F401  (autouse fixture)
    _Setup,
    _state,
    _types,
)

from golem.config import AgentSettings, BudgetSettings, GolemSettings
from golem.models.budget import Budget, Room
from golem.store.database import Database
from golem_protocol.events import ChatEvent, HelperStateData


@pytest.fixture
def project(tmp_path: Path) -> Path:
    root = tmp_path / "project"
    root.mkdir()
    (root / "a.py").write_text("def a():\n    return 1\n", encoding="utf-8")
    return root


HANG = ("delegate", {"agent": "explorer", "brief": "hang"})
QUICK = ("delegate", {"agent": "explorer", "brief": "quick"})


def _waits(events: list[ChatEvent], call_id: str) -> list[HelperStateData]:
    return [e.data for e in events if e.type == "helper.state" and e.data.call_id == call_id]


@pytest.mark.parametrize("setup", SETUPS)
async def test_team_holds_a_helper_back_until_a_turn_frees(
    database: Database, project: Path, tmp_path: Path, setup: _Setup
) -> None:
    chat = _Chat(
        database,
        [[HANG, HANG, QUICK], "first", "second", "third", "done"],
        project,
        tmp_path,
        at_once=2,
        setup=setup,
    )
    lead, run_id = await chat.start()
    await chat.until(lead, "helper.state")
    *_running, third = _helper_ids(await chat.stored(lead))

    # Two helpers hold the two turns: the third has no run, and says why with no sentence.
    assert await chat.runs.latest(third) is None
    stored = await chat.stored(lead)
    assert _state(stored, "call_1") == [] and _state(stored, "call_2") == []
    assert _state(stored, "call_3") == [("queued", "team")]
    held = _waits(stored, "call_3")[0]
    assert (held.spent_usd, held.cap_usd) == (None, None)

    chat.model.release()
    events = await chat.finished(run_id)
    stored = await chat.stored(lead)
    assert _state(stored, "call_3") == [("queued", "team"), ("running", None)]
    assert [e.data.call_id for e in stored if e.type == "helper.ended"].count("call_3") == 1
    assert "run.completed" in _types(events)


async def test_a_limit_above_the_number_of_helpers_holds_none_back(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _Chat(database, [[HANG, QUICK], "a", "b", "done"], project, tmp_path, at_once=2)
    lead, run_id = await chat.start()
    chat.model.release()
    await chat.finished(run_id)
    assert "helper.state" not in _types(await chat.stored(lead))


@dataclass(frozen=True)
class _CappedSetup(_Setup):
    """Cloud models only, with a session cap of $0.50."""

    def settings(self, project: Path, agents: AgentSettings) -> GolemSettings:
        base = super().settings(project, agents)
        return base.model_copy(update={"budget": BudgetSettings(session_usd=0.5)})


class _Spent(Budget):
    """The cap is spent for the helpers, never for the lead (its own turn is not under test)."""

    def __init__(self, lead: list[str]) -> None:
        super().__init__(None, BudgetSettings)  # type: ignore[arg-type]
        self._lead = lead
        self.open = False

    async def room(self, session_id: str) -> Room:
        if self.open or session_id in self._lead:
            return Room(None, None, 0.0, 0.0)
        return Room(0.0, "session", 0.62, 0.62)


async def test_budget_holds_a_paid_helper_with_what_is_spent_and_the_cap(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _Chat(database, [[QUICK], "first", "done"], project, tmp_path, setup=_CappedSetup(True))
    lead_ids: list[str] = []
    spent = _Spent(lead_ids)
    chat.manager.budget = spent
    lead = await chat.manager.create(chat.setup.profile, cwd=str(project))
    lead_ids.append(lead)
    run_id = await chat.manager.send(lead, "go")

    stored = await chat.until(lead, "helper.state")
    (helper,) = _helper_ids(stored)
    held = _waits(stored, "call_1")
    assert [(w.state, w.reason, w.spent_usd, w.cap_usd) for w in held] == [
        ("waiting", "budget", 0.62, 0.5)
    ]
    assert await chat.runs.latest(helper) is None

    # The cap opens (a new day, a higher cap) and a turn ends: the helper starts.
    spent.open = True
    async with chat.manager._lock:
        await chat.manager._start_queued(lead)
    events = await chat.finished(run_id)
    assert _state(await chat.stored(lead), "call_1")[-1] == ("running", None)
    assert "run.completed" in _types(events)


async def test_budget_never_holds_a_local_helper(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _Chat(database, [[QUICK], "first", "done"], project, tmp_path, setup=LOCAL)
    lead_ids: list[str] = []
    chat.manager.budget = _Spent(lead_ids)
    lead = await chat.manager.create(chat.setup.profile, cwd=str(project))
    lead_ids.append(lead)
    run_id = await chat.manager.send(lead, "go")
    await chat.finished(run_id)
    assert "helper.state" not in _types(await chat.stored(lead))
