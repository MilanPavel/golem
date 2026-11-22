"""``[agents]`` and ``[agents.<type>]``: the keys, the old explorer names, and which limit wins."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from golem.agents.bundled import bundled_agents_dir
from golem.agents.limits import DEFAULT_MAX_CALLS, resolve_limits
from golem.agents.model import Agent, AgentLimits
from golem.agents.parse import parse_agent
from golem.config import AgentSettings, load_settings
from golem.config_edit import set_keys
from golem.graphs.child import ChildLimits
from golem.sessions.helpers import snapshot_of

TOOLS = frozenset({"read_file"})


def _settings(**table: Any) -> AgentSettings:
    return AgentSettings.model_validate(table)


def _agent(tmp_path: Path, name: str = "explorer", front: str = "") -> Agent:
    path = tmp_path / f"{name}.md"
    path.write_text(
        f"---\nname: {name}\ndescription: D.\ntools: read_file\n{front}---\nGo.\n",
        encoding="utf-8",
    )
    agent = parse_agent(path, known_tools=TOOLS)
    assert agent.valid
    return agent


def _load(tmp_path: Path, text: str) -> AgentSettings:
    (tmp_path / "config.toml").write_text(text, encoding="utf-8")
    return load_settings(home=tmp_path, project_dir=tmp_path).agents


def test_every_limit_is_optional_and_the_job_keys_have_defaults() -> None:
    plain = AgentSettings()

    assert (plain.max_calls, plain.working_seconds, plain.max_cost, plain.max_tokens) == (
        None,
        None,
        None,
        None,
    )
    assert plain.at_once == 3
    assert plain.batch_limit == 3
    assert (plain.per_message_cost, plain.estimate_over) == (1.0, 0.25)
    for name in ("explorer", "worker", "reviewer", "advisor"):
        table = plain.table_for(name)
        assert table is not None
        assert table.max_cost is None


@pytest.mark.parametrize(
    "table",
    [
        {"max_calls": 0},
        {"working_seconds": 0},
        {"max_cost": -0.01},
        {"max_tokens": 0},
        {"at_once": 0},
        {"at_once": 17},
        {"max_per_batch": 0},
        {"max_per_batch": 21},
        {"per_message_cost": -1},
        {"estimate_over": -1},
        {"nope": 1},
        {"worker": {"nope": 1}},
        {"worker": {"at_once": 2}},
        {"worker": {"max_per_batch": 2}},
        {"worker": {"max_calls": 0}},
        {"reviewer": {"max_cost": -1}},
        {"advisor": {"max_tokens": 0}},
        {"explorer": {"working_seconds": 0}},
        {"helper": {"max_calls": 3}},
    ],
)
def test_a_wrong_key_or_value_is_refused(table: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        AgentSettings.model_validate(table)


def test_zero_cost_is_allowed_and_the_bounds_are_inclusive() -> None:
    settings = _settings(max_cost=0, max_calls=1, working_seconds=1, max_tokens=1, at_once=16)

    assert settings.max_cost == 0
    assert _settings(max_per_batch=20).batch_limit == 20


def test_the_old_explorer_names_still_load() -> None:
    explorer = _settings(
        explorer={"timeout_seconds": 90, "max_calls": 4, "answer_chars": 100, "max_per_turn": 2}
    ).explorer

    assert explorer.working_seconds == explorer.timeout_seconds == 90
    assert (explorer.max_calls, explorer.answer_chars, explorer.max_per_turn) == (4, 100, 2)


def test_the_new_name_alone_sets_the_old_one_too() -> None:
    assert _settings(explorer={"working_seconds": 45}).explorer.timeout_seconds == 45


def test_an_old_name_and_its_new_name_may_agree_but_not_differ() -> None:
    same = _settings(explorer={"timeout_seconds": 60, "working_seconds": 60}).explorer
    assert same.working_seconds == 60

    with pytest.raises(ValidationError, match="old name of working_seconds"):
        _settings(explorer={"timeout_seconds": 60, "working_seconds": 90})
    with pytest.raises(ValidationError, match=r"old name of \[agents\] max_per_batch"):
        _settings(max_per_batch=5, explorer={"max_per_turn": 2})
    _settings(max_per_batch=2, explorer={"max_per_turn": 2})


def test_max_per_turn_is_the_explorers_name_for_max_per_batch() -> None:
    assert _settings(explorer={"max_per_turn": 5}).batch_limit == 5
    assert _settings(max_per_batch=7).batch_limit == 7
    assert AgentSettings().batch_limit == 3


def test_an_old_config_file_loads_and_the_explorer_runs_as_before(tmp_path: Path) -> None:
    settings = _load(tmp_path, "[agents]\nkeep_days = 3\n\n[agents.explorer]\nmodel = 'same'\n")
    explorer = parse_agent(bundled_agents_dir() / "explorer.md")

    limits = resolve_limits(explorer, settings)

    today = ChildLimits()
    assert (limits.max_calls, limits.max_seconds, limits.answer_chars) == (15, 300, 6_000)
    assert (limits.max_cost_usd, limits.max_tokens) == (None, None)
    assert (today.max_calls, today.timeout_s, today.answer_chars, today.max_per_turn) == (
        15,
        300.0,
        6_000,
        3,
    )
    assert settings.batch_limit == 3


def test_an_old_explorer_table_with_its_keys_sets_the_explorers_limits(tmp_path: Path) -> None:
    settings = _load(
        tmp_path,
        "[agents.explorer]\nmax_calls = 5\ntimeout_seconds = 60\nanswer_chars = 500\n"
        "max_per_turn = 2\n",
    )
    explorer = parse_agent(bundled_agents_dir() / "explorer.md")

    limits = resolve_limits(explorer, settings)

    assert (limits.max_calls, limits.max_seconds, limits.answer_chars) == (5, 60, 500)
    assert settings.batch_limit == 2


def test_the_new_keys_load_from_toml(tmp_path: Path) -> None:
    settings = _load(
        tmp_path,
        "[agents]\nmax_cost = 0.5\nat_once = 2\nmax_per_batch = 4\nper_message_cost = 2.5\n"
        "estimate_over = 0.1\n\n[agents.worker]\nmax_tokens = 9000\nworking_seconds = 120\n",
    )

    assert (settings.max_cost, settings.at_once, settings.batch_limit) == (0.5, 2, 4)
    assert (settings.per_message_cost, settings.estimate_over) == (2.5, 0.1)
    assert settings.worker.max_tokens == 9000
    assert settings.worker.working_seconds == 120


def test_the_keys_can_be_written_like_the_other_agents_keys(tmp_path: Path) -> None:
    config = tmp_path / "config.toml"
    config.write_text("# mine\n[agents]\nkeep_days = 3\n", encoding="utf-8")

    set_keys(config, {"agents": {"max_cost": 0.25}, "agents.worker": {"max_calls": 8}})
    settings = load_settings(home=tmp_path, project_dir=tmp_path).agents

    assert config.read_text(encoding="utf-8").startswith("# mine")
    assert (settings.keep_days, settings.max_cost, settings.worker.max_calls) == (3, 0.25, 8)


def test_nothing_set_gives_the_built_in_calls_and_no_other_limit(tmp_path: Path) -> None:
    agent = _agent(tmp_path, "worker")

    assert resolve_limits(agent, AgentSettings()) == AgentLimits(max_calls=DEFAULT_MAX_CALLS)
    assert ChildLimits().max_calls == DEFAULT_MAX_CALLS


def test_the_agents_table_applies_to_every_type_when_the_file_is_silent(tmp_path: Path) -> None:
    settings = _settings(max_calls=9, working_seconds=80, max_cost=0.4, max_tokens=7000)

    for name in ("explorer", "worker", "other"):
        limits = resolve_limits(_agent(tmp_path, name), settings)
        assert (limits.max_calls, limits.max_seconds) == (9, 80)
        assert (limits.max_cost_usd, limits.max_tokens) == (0.4, 7000)


def test_the_agent_file_wins_over_the_agents_table(tmp_path: Path) -> None:
    agent = _agent(
        tmp_path,
        "worker",
        "max-calls: 6\nmax-seconds: 30\nmax-cost-usd: 0.1\nmax-tokens: 500\n",
    )
    settings = _settings(max_calls=9, working_seconds=80, max_cost=0.4, max_tokens=7000)

    limits = resolve_limits(agent, settings)

    assert (limits.max_calls, limits.max_seconds) == (6, 30)
    assert (limits.max_cost_usd, limits.max_tokens) == (0.1, 500)


def test_the_type_table_wins_over_the_file_and_the_agents_table(tmp_path: Path) -> None:
    agent = _agent(tmp_path, "worker", "max-calls: 6\nmax-seconds: 30\n")
    settings = _settings(
        max_calls=9,
        max_cost=0.4,
        worker={"max_calls": 2, "working_seconds": 11, "max_cost": 0, "max_tokens": 5},
    )

    limits = resolve_limits(agent, settings)

    assert (limits.max_calls, limits.max_seconds) == (2, 11)
    assert (limits.max_cost_usd, limits.max_tokens) == (0, 5)


def test_a_type_table_does_not_reach_another_type(tmp_path: Path) -> None:
    settings = _settings(worker={"max_calls": 2}, reviewer={"max_calls": 3})

    assert resolve_limits(_agent(tmp_path, "advisor"), settings).max_calls == DEFAULT_MAX_CALLS
    assert resolve_limits(_agent(tmp_path, "reviewer"), settings).max_calls == 3


def test_a_file_that_is_not_a_bundled_type_only_sees_the_agents_table(tmp_path: Path) -> None:
    agent = _agent(tmp_path, "worker-copy")
    settings = _settings(max_calls=9, worker={"max_calls": 2})

    assert resolve_limits(agent, settings).max_calls == 9


def test_explorer_keys_win_over_the_file_and_the_explorer_defaults_do_not(tmp_path: Path) -> None:
    own = _agent(tmp_path, "explorer", "max-calls: 40\nmax-seconds: 700\nmax-answer-chars: 50\n")

    plain = resolve_limits(own, AgentSettings())
    given = resolve_limits(
        own, _settings(explorer={"max_calls": 5, "timeout_seconds": 60, "answer_chars": 9})
    )

    assert (plain.max_calls, plain.max_seconds, plain.answer_chars) == (40, 700, 50)
    assert (given.max_calls, given.max_seconds, given.answer_chars) == (5, 60, 9)


def test_the_snapshot_carries_the_resolved_limits(tmp_path: Path) -> None:
    agent = _agent(tmp_path, "reviewer", "max-calls: 6\n")
    settings = _settings(max_tokens=1234, reviewer={"max_cost": 0.3})

    snapshot = snapshot_of(agent, "bundled", ["read_file"], settings)

    assert snapshot.limits.max_calls == 6
    assert snapshot.limits.max_tokens == 1234
    assert snapshot.limits.max_cost_usd == 0.3
    assert snapshot.name == "reviewer"
    assert snapshot.tools == ["read_file"]


def test_max_tokens_may_be_set_in_the_agent_file(tmp_path: Path) -> None:
    assert _agent(tmp_path, "worker", "max-tokens: 800\n").limits.max_tokens == 800
