"""A helper starts on the model ``pick_helper`` chose from its wish (ADR-059, section 5; #1301).

Scripted models, a fixed list of model facts. The pick itself is tested in ``test_pick_helper``;
here: the wish of an agent reaches it, the helper is pinned to the answer, and the logs say so.
"""

# pyright: reportPrivateUsage=false
from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from fakes import FixedFacts, model_facts
from test_helper_sessions import (  # pyright: ignore
    _LIVE,
    EXPLORER,
    _Chat,
)

from golem.config import GolemSettings, LadderSettings, RoleSettings, RoutingSettings
from golem.store.database import Database
from golem_protocol.events import (
    AgentSnapshot,
    ChatEvent,
    HelperStartedEvent,
    ModelOptionsChangedEvent,
    ModelRoutedEvent,
)

LOCAL = "ollama/qwen3:8b"
OTHER_LOCAL = "ollama/gemma3:12b"
CHEAP = "deepseek/chat"
BIG = "anthropic/big"
MID = "openai/mid"


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


def _settings(
    default: str, *, local_only: Path | None = None, explore: str = "session"
) -> GolemSettings:
    """The setup's settings. The ladder names the frontier model, as a user who has one does."""
    return GolemSettings(
        default_model=default,
        routing=RoutingSettings(
            ladder=LadderSettings(frontier=BIG),
            local_only=[] if local_only is None else [str(local_only)],
            roles=RoleSettings(explore=explore),
        ),
    )


def _agent(wish: str, name: str = "explorer") -> AgentSnapshot:
    return EXPLORER.model_copy(update={"name": name, "wish": wish})


async def _start(
    chat: _Chat, lead_model: str, project: Path, agent: AgentSnapshot
) -> tuple[str, str, list[ChatEvent]]:
    """The helper's id, the lead's id, and the lead's events once the helper started."""
    lead = await chat.manager.create(lead_model, cwd=str(project))
    ref = await chat.manager.start_helper(
        lead, "call-1", 0, agent, "look", lead_model, str(project)
    )
    await chat.until(ref.session_id, "session.completed")
    return ref.session_id, lead, await chat.stored(lead)


def _started(events: list[ChatEvent]) -> HelperStartedEvent:
    return next(e for e in events if isinstance(e, HelperStartedEvent))


def _routed(events: list[ChatEvent]) -> list[ModelRoutedEvent]:
    return [e for e in events if isinstance(e, ModelRoutedEvent)]


def _local_setup() -> FixedFacts:
    return FixedFacts(model_facts(LOCAL, "local"), model_facts(OTHER_LOCAL, "local", 64000))


def _cloud_setup() -> FixedFacts:
    return FixedFacts(
        model_facts(CHEAP, "budget", price=0.5),
        model_facts(BIG, "frontier", price=5.0),
    )


def _mixed_setup() -> FixedFacts:
    return FixedFacts(
        model_facts(LOCAL, "local"),
        model_facts(CHEAP, "budget", price=0.5),
        model_facts(BIG, "frontier", price=5.0),
    )


async def test_local_models_only_every_wish_is_local_and_stronger_is_a_fresh_window(
    database: Database, project: Path, tmp_path: Path
) -> None:
    for wish in ("cheapest", "same", "stronger", "local", "budget", "frontier", OTHER_LOCAL):
        chat = _Chat(database, ["done"], settings=_settings(LOCAL), home=tmp_path)
        chat.manager.facts = _local_setup()
        helper, _lead, events = await _start(chat, LOCAL, project, _agent(wish))

        record = await chat.records.get(helper)
        assert record is not None
        assert record.model_profile in (LOCAL, OTHER_LOCAL), wish
        assert _started(events).data.wish == wish
        # No paid question, in the helper's log or the lead's.
        kinds = {e.type for e in await chat.stored(helper)} | {e.type for e in events}
        assert "route.consent.needed" not in kinds

    chat = _Chat(database, ["done"], settings=_settings(LOCAL), home=tmp_path)
    chat.manager.facts = _local_setup()
    helper, _, events = await _start(chat, LOCAL, project, _agent("stronger"))
    assert _started(events).data.model == LOCAL
    assert "fresh window" in _started(events).data.pick_reason


async def test_cloud_models_only_cheapest_is_the_cheapest_hosted_and_stronger_the_next_tier(
    database: Database, project: Path, tmp_path: Path
) -> None:
    settings = _settings(BIG)
    chat = _Chat(database, ["done"], settings=settings, home=tmp_path)
    chat.manager.facts = _cloud_setup()
    helper, _lead, events = await _start(chat, BIG, project, _agent("cheapest"))
    started = _started(events)
    assert (started.data.model, started.data.wish) == (CHEAP, "cheapest")
    assert started.data.helper_id == helper

    chat = _Chat(database, ["done"], settings=settings, home=tmp_path)
    chat.manager.facts = _cloud_setup()
    _, lead, events = await _start(chat, CHEAP, project, _agent("stronger"))
    assert _started(events).data.model == BIG
    # The lead's chat is paid already: nothing is asked.
    assert "route.consent.needed" not in {e.type for e in events}
    assert "route.consent.needed" not in {e.type for e in await chat.stored(lead)}


async def test_cloud_models_only_stronger_from_the_top_tier_is_the_leads_model(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _Chat(database, ["done"], settings=_settings(BIG), home=tmp_path)
    chat.manager.facts = _cloud_setup()
    _, _, events = await _start(chat, BIG, project, _agent("stronger"))
    assert _started(events).data.model == BIG


async def test_a_named_model_and_a_tier_are_wishes_too(
    database: Database, project: Path, tmp_path: Path
) -> None:
    facts = FixedFacts(
        model_facts(CHEAP, "budget", price=0.5),
        model_facts(MID, "budget", price=1.0),
        model_facts(BIG, "frontier", price=5.0),
    )
    got: dict[str, str] = {}
    for wish in (MID, "frontier", "same"):
        chat = _Chat(database, ["done"], settings=_settings(CHEAP), home=tmp_path)
        chat.manager.facts = facts
        _, _, events = await _start(chat, CHEAP, project, _agent(wish))
        got[wish] = _started(events).data.model
    assert got == {MID: MID, "frontier": BIG, "same": CHEAP}


async def test_a_local_lead_with_no_yes_parks_the_helper_on_the_paid_pick(
    database: Database, project: Path, tmp_path: Path
) -> None:
    """The paid question is asked (``test_helper_consent``): the helper is pinned to the paid
    pick and waits; the lead's reason says what a no becomes."""
    for wish in ("stronger", "frontier", BIG):
        chat = _Chat(database, ["done"], settings=_settings(LOCAL), home=tmp_path)
        chat.manager.facts = _mixed_setup()
        lead = await chat.manager.create(LOCAL, cwd=str(project))
        ref = await chat.manager.start_helper(
            lead, "call-1", 0, _agent(wish), "look", LOCAL, str(project)
        )
        started = _started(await chat.stored(lead))
        assert started.data.model in (CHEAP, BIG), wish
        assert "waits for your yes" in started.data.pick_reason
        assert f"on a no it runs on {LOCAL}" in started.data.pick_reason
        assert ref.model == started.data.model
        assert "route.consent.needed" in {e.type for e in await chat.stored(ref.session_id)}

    # A wish that is not paid is left alone.
    chat = _Chat(database, ["done"], settings=_settings(LOCAL), home=tmp_path)
    chat.manager.facts = _mixed_setup()
    _, _, events = await _start(chat, LOCAL, project, _agent("cheapest"))
    assert _started(events).data.model == LOCAL
    assert "waits for your yes" not in _started(events).data.pick_reason


async def test_a_local_lead_that_agreed_to_paid_models_gets_the_wished_hosted_model(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _Chat(database, ["done"], settings=_settings(LOCAL), home=tmp_path)
    chat.manager.facts = _mixed_setup()
    lead = await chat.manager.create(LOCAL, cwd=str(project))
    chat.manager._sessions[lead].paid_ok = True
    ref = await chat.manager.start_helper(
        lead, "call-1", 0, _agent("frontier"), "look", LOCAL, str(project)
    )
    await chat.until(ref.session_id, "session.completed")
    assert ref.model == BIG


async def test_a_local_only_folder_keeps_every_helper_local(
    database: Database, project: Path, tmp_path: Path
) -> None:
    settings = _settings(LOCAL, local_only=project)
    for wish in ("cheapest", "stronger", "frontier", BIG):
        chat = _Chat(database, ["done"], settings=settings, home=tmp_path)
        chat.manager.facts = _mixed_setup()
        helper, _, events = await _start(chat, LOCAL, project, _agent(wish))
        assert _started(events).data.model == LOCAL, wish
        (routed,) = _routed(await chat.stored(helper))
        assert routed.data.model_profile == LOCAL


async def test_a_local_route_keeps_the_helper_local(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _Chat(database, ["done"], settings=_settings(LOCAL), home=tmp_path)
    chat.manager.facts = _mixed_setup()
    lead = await chat.manager.create(LOCAL, cwd=str(project))
    await chat.manager.set_route(lead, "local")
    chat.manager._sessions[lead].paid_ok = True
    ref = await chat.manager.start_helper(
        lead, "call-1", 0, _agent("frontier"), "look", LOCAL, str(project)
    )
    assert ref.model == LOCAL


async def test_the_explore_role_is_the_wish_of_the_explorer_and_only_of_it(
    database: Database, project: Path, tmp_path: Path
) -> None:
    settings = _settings(CHEAP, explore=BIG)
    chat = _Chat(database, ["done"], settings=settings, home=tmp_path)
    chat.manager.facts = _cloud_setup()
    _, _, events = await _start(chat, CHEAP, project, _agent("cheapest"))
    started = _started(events)
    assert (started.data.model, started.data.wish) == (BIG, BIG)

    chat = _Chat(database, ["done"], settings=settings, home=tmp_path)
    chat.manager.facts = _cloud_setup()
    _, _, events = await _start(chat, CHEAP, project, _agent("cheapest", name="worker"))
    assert (_started(events).data.model, _started(events).data.wish) == (CHEAP, "cheapest")


async def test_the_picked_model_pins_the_helper_and_its_log_has_model_routed(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _Chat(database, ["done"], settings=_settings(LOCAL), home=tmp_path)
    chat.manager.facts = _local_setup()
    helper, _, events = await _start(chat, LOCAL, project, _agent("stronger"))

    record = await chat.records.get(helper)
    assert record is not None
    assert (record.model_profile, record.route) == (LOCAL, "pinned")
    own = await chat.stored(helper)
    (routed,) = _routed(own)
    assert routed.data.model_profile == LOCAL
    assert routed.data.detail.startswith("stronger: ")
    assert "fresh window" in routed.data.detail
    kinds = [e.type for e in own]
    assert kinds.index("model.routed") < kinds.index("message.started")
    # The lead's log has the summary: model, wish and the reason, in words.
    started = _started(events)
    assert (started.data.model, started.data.wish) == (LOCAL, "stronger")
    assert started.data.pick_reason in routed.data.detail


async def test_model_routed_of_a_hosted_pick_names_the_rejected_models(
    database: Database, project: Path, tmp_path: Path
) -> None:
    settings = _settings(LOCAL, local_only=project)
    chat = _Chat(database, ["done"], settings=settings, home=tmp_path)
    chat.manager.facts = _mixed_setup()
    helper, _, _ = await _start(chat, LOCAL, project, _agent("cheapest"))
    (routed,) = _routed(await chat.stored(helper))
    assert {r.ref for r in routed.data.rejected} == {CHEAP, BIG}
    assert {r.why for r in routed.data.rejected} == {"this chat stays on this Mac"}

    chat = _Chat(database, ["done"], settings=_settings(BIG), home=tmp_path)
    chat.manager.facts = _cloud_setup()
    helper, _, _ = await _start(chat, BIG, project, _agent("cheapest"))
    (routed,) = _routed(await chat.stored(helper))
    assert (routed.data.model_profile, routed.data.reason, routed.data.tier) == (
        CHEAP,
        "cheapest",
        "budget",
    )


async def test_a_helper_on_the_leads_model_keeps_the_leads_options(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _Chat(database, ["done"], settings=_settings(LOCAL), home=tmp_path)
    chat.manager.facts = _local_setup()
    lead = await chat.manager.create(LOCAL, cwd=str(project))
    await chat.manager.set_options(lead, {"temperature": 0.2})
    same = await chat.manager.start_helper(
        lead, "call-1", 0, _agent("same"), "look", LOCAL, str(project)
    )
    other = await chat.manager.start_helper(
        lead, "call-1", 1, _agent(OTHER_LOCAL), "look", LOCAL, str(project)
    )
    assert other.model == OTHER_LOCAL

    def options(events: list[ChatEvent]) -> list[object]:
        return [e.data.options for e in events if isinstance(e, ModelOptionsChangedEvent)]

    assert options(await chat.stored(same.session_id)) == [{"temperature": 0.2}]
    assert options(await chat.stored(other.session_id)) == []


async def test_without_model_facts_the_helper_runs_on_the_leads_model(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _Chat(database, ["done"], settings=_settings(LOCAL), home=tmp_path)
    helper, _, events = await _start(chat, LOCAL, project, _agent("stronger"))
    assert _started(events).data.model == LOCAL
    assert _routed(await chat.stored(helper)) == []
