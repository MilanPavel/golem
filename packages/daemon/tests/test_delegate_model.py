"""``delegate`` takes an optional ``model`` for one helper (ADR-059, section 5; #1487).

The named model is the wish of that one helper, so the pick, the paid question, privacy and the
caps hold with no new path. Scripted models, the fixed facts of ``test_helper_model``.
"""

# pyright: reportPrivateUsage=false
from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from pydantic import ValidationError
from test_helper_consent import (  # pyright: ignore
    _activity,
    _asked,
    _chat,
    _kinds,
    _lead,
    _paid_ok,
)
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

from golem.config import GolemSettings, ModelPrice, ModelSettings
from golem.graphs.tools_node import _specs
from golem.store.database import Database
from golem.tools.delegate import MODELS_SHOWN, DelegateArgs, describe
from golem.tools.registry import InvalidArguments


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


async def _helper(
    chat: _Chat,
    lead: str,
    project: Path,
    model: str | None,
    *,
    wish: str = "same",
    index: int = 0,
    lead_model: str = LOCAL,
    agent: str = "explorer",
) -> str:
    ref = await chat.manager.start_helper(
        lead,
        "call-1",
        index,
        _agent(wish, agent),
        "look",
        lead_model,
        str(project),
        label=f"look {index}",
        asked_model=model,
    )
    return ref.session_id


# --- a local lead and a cloud model ------------------------------------------------------------


async def test_a_named_cloud_model_asks_the_paid_question_and_runs_after_a_yes(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _chat(database, tmp_path, _mixed_setup())
    lead = await _lead(chat, project)
    helper = await _helper(chat, lead, project, BIG)

    asked = (await _asked(chat, helper)).data
    assert (asked.model_profile, asked.tier) == (BIG, "frontier")
    started = _started(await chat.stored(lead)).data
    assert started.wish == BIG
    assert BIG in started.pick_reason and "lead asked" in started.pick_reason
    run = await chat.runs.latest(helper)
    assert run is not None
    await chat.manager.answer_consent(helper, run.run_id, "once")
    await chat.until(helper, "session.completed")
    (routed,) = _routed(await chat.stored(helper))
    assert routed.data.model_profile == BIG
    record = await chat.records.get(helper)
    assert record is not None and record.model_profile == BIG


async def test_a_no_runs_the_asked_model_on_the_local_one(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _chat(database, tmp_path, _mixed_setup())
    lead = await _lead(chat, project)
    helper = await _helper(chat, lead, project, BIG)
    await _asked(chat, helper)
    run = await chat.runs.latest(helper)
    assert run is not None
    await chat.manager.answer_consent(helper, run.run_id, "local")
    await chat.until(helper, "session.completed")
    (routed,) = _routed(await chat.stored(helper))
    assert routed.data.model_profile == LOCAL


async def test_two_explorers_of_a_batch_with_the_model_are_answered_by_one_yes(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _chat(database, tmp_path, _mixed_setup())
    lead = await _lead(chat, project)
    one = await _helper(chat, lead, project, BIG, index=0)
    two = await _helper(chat, lead, project, BIG, index=1)
    await _asked(chat, one)
    await _asked(chat, two)
    run = await chat.runs.latest(one)
    assert run is not None
    await chat.manager.answer_consent(one, run.run_id, "session")
    for helper in (one, two):
        await chat.until(helper, "session.completed")
        (routed,) = _routed(await chat.stored(helper))
        assert routed.data.model_profile == BIG
    assert await _paid_ok(chat, lead)
    # The lead did not wait on a question of its own: only the helpers asked.
    assert "route.consent.needed" not in _kinds(await chat.stored(lead))
    assert await chat.manager.helpers(await _activity(chat, lead)) in (None, (0, 0))


async def test_a_chat_that_agreed_already_runs_the_named_model_without_a_question(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _chat(database, tmp_path, _mixed_setup())
    lead = await _lead(chat, project)
    chat.manager._sessions[lead].paid_ok = True
    helper = await _helper(chat, lead, project, BIG)
    await chat.until(helper, "session.completed")
    assert "route.consent.needed" not in _kinds(await chat.stored(helper))
    assert _started(await chat.stored(lead)).data.model == BIG


# --- the two setups ----------------------------------------------------------------------------


async def test_local_models_only_a_named_cloud_model_falls_back_and_says_so(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _chat(database, tmp_path, _local_setup())
    lead = await _lead(chat, project)
    helper = await _helper(chat, lead, project, BIG, wish="cheapest")
    await chat.until(helper, "session.completed")
    started = _started(await chat.stored(lead)).data
    assert started.model == LOCAL
    assert started.wish == BIG
    assert f"{BIG} is not set up, so the lead's model" in started.pick_reason
    assert "route.consent.needed" not in _kinds(await chat.stored(helper))


async def test_cloud_models_only_the_named_model_is_used_and_no_question_appears(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _chat(database, tmp_path, _cloud_setup(), default=CHEAP)
    lead = await _lead(chat, project, CHEAP)
    helper = await _helper(chat, lead, project, BIG, wish="cheapest", lead_model=CHEAP)
    await chat.until(helper, "session.completed")
    assert "route.consent.needed" not in _kinds(await chat.stored(helper))
    assert _started(await chat.stored(lead)).data.model == BIG
    assert not await _paid_ok(chat, lead)


async def test_a_local_only_folder_refuses_the_named_cloud_model_and_stays_local(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _chat(database, tmp_path, _mixed_setup(), local_only=project)
    lead = await _lead(chat, project)
    helper = await _helper(chat, lead, project, BIG)
    await chat.until(helper, "session.completed")
    assert "route.consent.needed" not in _kinds(await chat.stored(helper))
    started = _started(await chat.stored(lead)).data
    assert started.model == LOCAL
    assert f"{BIG} cannot be used now (this chat stays on this Mac)" in started.pick_reason


async def test_paid_never_refuses_the_named_cloud_model_with_its_reason(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _chat(database, tmp_path, _mixed_setup(), paid="never")
    lead = await _lead(chat, project)
    helper = await _helper(chat, lead, project, BIG)
    await chat.until(helper, "session.completed")
    started = _started(await chat.stored(lead)).data
    assert started.model == LOCAL
    assert f"{BIG} cannot be used now (paid models are off in your settings)" in started.pick_reason


# --- what the call names -----------------------------------------------------------------------


async def test_a_tier_is_a_model_too(database: Database, project: Path, tmp_path: Path) -> None:
    chat = _chat(database, tmp_path, _mixed_setup())
    lead = await _lead(chat, project)
    helper = await _helper(chat, lead, project, "budget", wish="local")
    await _asked(chat, helper)
    started = _started(await chat.stored(lead)).data
    assert (started.model, started.wish) == (CHEAP, "budget")


async def test_without_a_model_the_wish_of_the_agent_decides_as_before(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _chat(database, tmp_path, _mixed_setup())
    lead = await _lead(chat, project)
    helper = await _helper(chat, lead, project, None, wish="cheapest")
    await chat.until(helper, "session.completed")
    started = _started(await chat.stored(lead)).data
    assert (started.model, started.wish) == (LOCAL, "cheapest")
    assert "lead asked" not in started.pick_reason


async def test_the_named_model_wins_over_the_explore_role(
    database: Database, project: Path, tmp_path: Path
) -> None:
    base = _settings(CHEAP, explore=BIG)
    chat = _Chat(database, ["done"], settings=base, home=tmp_path)
    chat.manager.facts = _cloud_setup()
    lead = await chat.manager.create(CHEAP, cwd=str(project))
    ref = await chat.manager.start_helper(
        lead, "c", 0, _agent("cheapest"), "look", CHEAP, str(project), asked_model=LOCAL
    )
    await chat.until(ref.session_id, "session.completed")
    started = _started(await chat.stored(lead)).data
    # LOCAL is not set up here: the lead's model, not the role's BIG.
    assert (started.model, started.wish) == (CHEAP, LOCAL)

    chat = _Chat(database, ["done"], settings=base, home=tmp_path)
    chat.manager.facts = _cloud_setup()
    lead = await chat.manager.create(CHEAP, cwd=str(project))
    ref = await chat.manager.start_helper(
        lead, "c", 0, _agent("cheapest"), "look", CHEAP, str(project), asked_model="cheapest"
    )
    await chat.until(ref.session_id, "session.completed")
    assert (_started(await chat.stored(lead)).data.model) == CHEAP


async def test_an_unknown_name_does_not_fail_the_call(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _chat(database, tmp_path, _mixed_setup())
    lead = await _lead(chat, project)
    helper = await _helper(chat, lead, project, "gpt6-luna")
    await chat.until(helper, "session.completed")
    started = _started(await chat.stored(lead)).data
    assert started.model == LOCAL
    assert "gpt6-luna is not set up, so the lead's model" in started.pick_reason


# --- the argument and the description ----------------------------------------------------------


def test_the_argument_is_optional_and_a_name() -> None:
    assert DelegateArgs(brief="x").model is None
    assert DelegateArgs(brief="x", model="ollama/qwen3:8b").model == "ollama/qwen3:8b"


@pytest.mark.parametrize("bad", ["", "  ", "two words", " lead", "x" * 101])
def test_a_bad_model_is_a_readable_tool_error(bad: str) -> None:
    with pytest.raises(ValidationError):
        DelegateArgs(brief="x", model=bad)
    call = {
        "name": "delegate",
        "args": {"brief": "x", "model": bad},
        "id": "d",
        "type": "tool_call",
    }
    with pytest.raises(InvalidArguments, match="model"):
        _specs(call)  # pyright: ignore[reportArgumentType]


def test_specs_carry_the_model() -> None:
    call = {"name": "delegate", "args": {"brief": "x", "model": "local"}, "id": "d"}
    (spec,) = _specs({**call, "type": "tool_call"})  # pyright: ignore[reportArgumentType]
    assert spec.model == "local"


def test_the_description_lists_the_models_and_caps_them() -> None:
    text = describe([("explorer", "reads")], ["local", "budget", "fast", "big"])
    assert "one of local, budget, fast, big" in text
    many = [f"m{n}" for n in range(20)]
    shown = describe([], many)
    assert f"m{MODELS_SHOWN - 1}" in shown and f"m{MODELS_SHOWN}" not in shown
    assert describe([], []) == describe([], ())
    assert "model argument" not in describe([("explorer", "reads")])


async def test_the_session_description_lists_tiers_and_ready_profiles_cheapest_first(
    database: Database, project: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("DEEPSEEK_API_KEY", "k")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    settings: GolemSettings = _settings(LOCAL).model_copy(
        update={
            "models": {
                "dear": ModelSettings(model="deepseek/big", price=ModelPrice(input=5, output=5)),
                "cheap": ModelSettings(model="deepseek/chat", price=ModelPrice(input=1, output=1)),
                "qwen": ModelSettings(model="ollama/qwen3:8b"),
                "nokey": ModelSettings(model="anthropic/opus"),
            }
        }
    )
    chat = _Chat(database, ["done"], settings=settings, home=tmp_path)
    first = chat.manager._delegate_text(project)
    # Tiers, local profiles, then hosted ones with a key by price; a hosted one without a key
    # is left out. The text is the same on every call, so it does not bust the prompt cache.
    assert "one of local, budget, frontier, qwen, cheap, dear." in first
    assert "nokey" not in first
    assert chat.manager._delegate_text(project) == first
