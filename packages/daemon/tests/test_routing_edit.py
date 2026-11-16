"""``routing.get`` and ``routing.set``: the five routing tables, written with comments kept."""

from __future__ import annotations

import tomllib
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any, cast

import pytest
from test_server import HELLO, RpcClient, rpc_result, start_daemon, stop_daemon

from golem.config import LadderSettings, ModelPrice
from golem.config_edit import RawConflictError, set_keys
from golem.models.facts import ModelFacts
from golem.models.pick import tier_picks
from golem.models.tiers import Tier, blended

FILE = """# mine
default_model = "local"  # keep

[routing]
# how golem picks
mode = "auto"  # now
paid = "ask"

[routing.ladder]
local = "ollama/small"  # the fast one

[budget]
daily_usd = 2.0  # a day

[shell]
network = false
"""


def test_set_keys_changes_the_named_keys_and_keeps_comments(tmp_path: Path) -> None:
    config = tmp_path / "config.toml"
    config.write_text(FILE, "utf-8")
    set_keys(
        config,
        {
            "routing": {"mode": "local", "budget_max_price": 2.5},
            "budget": {"daily_usd": 5.0},
            "context": {"window": 32768},
        },
    )
    text = config.read_text("utf-8")
    for kept in ("# mine", "# keep", "# how golem picks", "# now", "# the fast one", "# a day"):
        assert kept in text
    parsed = tomllib.loads(text)
    assert parsed["routing"]["mode"] == "local"
    assert parsed["routing"]["paid"] == "ask"
    assert parsed["routing"]["budget_max_price"] == 2.5
    assert parsed["routing"]["ladder"] == {"local": "ollama/small"}
    assert parsed["budget"] == {"daily_usd": 5.0}
    assert parsed["context"] == {"window": 32768}
    assert parsed["shell"] == {"network": False}


def test_set_keys_removes_a_key_and_the_table_it_empties(tmp_path: Path) -> None:
    config = tmp_path / "config.toml"
    config.write_text(FILE, "utf-8")
    set_keys(config, {"routing.ladder": {"local": None}, "budget": {"daily_usd": None}})
    parsed = tomllib.loads(config.read_text("utf-8"))
    assert "ladder" not in parsed["routing"]
    assert "budget" not in parsed
    assert "# how golem picks" in config.read_text("utf-8")


def test_set_keys_creates_nested_tables_and_the_file(tmp_path: Path) -> None:
    config = tmp_path / "home" / "config.toml"
    set_keys(config, {"routing.roles": {"titles": "ollama/tiny"}})
    assert tomllib.loads(config.read_text("utf-8")) == {
        "routing": {"roles": {"titles": "ollama/tiny"}}
    }


def test_set_keys_refuses_a_path_that_is_not_a_table(tmp_path: Path) -> None:
    config = tmp_path / "config.toml"
    config.write_text("budget = 3\n", "utf-8")
    with pytest.raises(ValueError, match="not a table"):
        set_keys(config, {"budget": {"over": "ask"}})
    assert config.read_text("utf-8") == "budget = 3\n"


def test_set_keys_refuses_a_file_that_changed_while_writing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import golem.config_edit as config_edit

    config = tmp_path / "config.toml"
    config.write_text(FILE, "utf-8")
    real = config_edit.write_raw

    def stale(path: Path, text: str, base: int | None) -> int:
        return real(path, text, None if base is None else base - 1)

    monkeypatch.setattr(config_edit, "write_raw", stale)
    with pytest.raises(RawConflictError):
        set_keys(config, {"routing": {"mode": "local"}})
    assert tomllib.loads(config.read_text("utf-8"))["routing"]["mode"] == "auto"


def _facts(ref: str, tier: Tier, window: int, price: float | None = None) -> ModelFacts:
    model_price = None if price is None else ModelPrice(input=price, output=price)
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


def test_tier_picks_choose_the_largest_local_and_the_cheapest_budget_model() -> None:
    everything = [
        _facts("ollama/small", "local", 8192),
        _facts("ollama/big", "local", 32768),
        _facts("deepseek/a", "budget", 64000, 1.0),
        _facts("deepseek/b", "budget", 64000, 0.5),
        _facts("anthropic/x", "frontier", 200000, 15.0),
    ]
    picks = tier_picks(LadderSettings(), "", everything)
    assert {tier: None if m is None else m.ref for tier, m in picks.items()} == {
        "local": "ollama/big",
        "budget": "deepseek/b",
        "frontier": None,
    }
    named = tier_picks(LadderSettings(local="ollama/small", frontier="anthropic/x"), "", everything)
    assert named["local"] is not None and named["local"].ref == "ollama/small"
    assert named["frontier"] is not None and named["frontier"].ref == "anthropic/x"


class _Facts:
    def __init__(self, *models: ModelFacts) -> None:
        self.models = list(models)

    async def facts(
        self, refs: Sequence[str], *, overrides: Mapping[str, float | str] | None = None
    ) -> list[ModelFacts]:
        del refs, overrides
        return list(self.models)


def _result(response: dict[str, object]) -> dict[str, Any]:
    return cast(dict[str, Any], rpc_result(response))


async def test_routing_get_and_set_round_trip(short_home: Path) -> None:
    config = short_home / "config.toml"
    config.write_text(FILE, "utf-8")
    facts = _Facts(
        _facts("ollama/small", "local", 8192),
        _facts("ollama/big", "local", 32768),
        _facts("deepseek/cheap", "budget", 64000, 0.5),
    )
    app, task = await start_daemon(short_home, facts=facts)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        got = _result(await client.call("routing.get", {}))
        assert got["routing"]["mode"] == "auto"
        assert got["routing"]["paid"] == "ask"
        assert got["routing"]["budget_max_price"] == 1.5
        assert got["ladder"] == {"local": "ollama/small", "budget": None, "frontier": None}
        assert got["roles"] == {"titles": "session", "summarise": "session", "explore": "session"}
        assert got["budget"] == {"daily_usd": 2.0, "session_usd": None, "over": "local"}
        assert got["context"]["window"] == "auto"
        assert got["picked"]["local"] == "ollama/big"
        assert got["picked"]["budget"] == "deepseek/cheap"

        saved = _result(
            await client.call(
                "routing.set",
                {
                    "routing": {"mode": "local", "local_only": ["/Users/me/private"]},
                    "ladder": {"local": None},
                    "roles": {"titles": "ollama/small"},
                    "budget": {"session_usd": 0.5, "over": "ask"},
                    "context": {"window": 16384, "clear_at": 0.6},
                },
            )
        )
        assert saved["ok"] is True
        assert saved["values"]["routing"]["mode"] == "local"
        assert saved["values"]["routing"]["local_only"] == ["/Users/me/private"]
        assert saved["values"]["ladder"]["local"] is None
        assert saved["values"]["budget"] == {"daily_usd": 2.0, "session_usd": 0.5, "over": "ask"}
        assert saved["values"]["context"]["window"] == 16384
        text = config.read_text("utf-8")
        for kept in ("# mine", "# how golem picks", "# a day"):
            assert kept in text
        parsed = tomllib.loads(text)
        assert parsed["routing"]["roles"] == {"titles": "ollama/small"}
        assert "ladder" not in parsed["routing"]
        assert parsed["context"] == {"window": 16384, "clear_at": 0.6}

        again = _result(await client.call("routing.get", {}))
        assert again["routing"]["mode"] == "local"
        assert again["context"]["clear_at"] == 0.6

        cleared = _result(
            await client.call(
                "routing.set", {"routing": {"local_only": []}, "budget": {"over": None}}
            )
        )
        assert cleared["ok"] is True
        parsed = tomllib.loads(config.read_text("utf-8"))
        assert "local_only" not in parsed["routing"]
        assert parsed["budget"] == {"daily_usd": 2.0, "session_usd": 0.5}
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_routing_set_with_a_bad_value_returns_field_errors_and_writes_nothing(
    short_home: Path,
) -> None:
    config = short_home / "config.toml"
    config.write_text(FILE, "utf-8")
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        bad = _result(
            await client.call(
                "routing.set",
                {
                    "routing": {"mode": "auto", "budget_max_price": 0, "local_only": ["relative"]},
                    "budget": {"daily_usd": -1},
                    "context": {"window": 100},
                },
            )
        )
        assert bad["ok"] is False
        assert bad["values"] is None
        paths = {error["path"]: error["message"] for error in bad["errors"]}
        assert {"routing.budget_max_price", "budget.daily_usd", "context.window"} <= set(paths)
        assert config.read_text("utf-8") == FILE

        unordered = _result(await client.call("routing.set", {"context": {"clear_to": 0.9}}))
        assert [error["path"] for error in unordered["errors"]] == ["context.clear_to"]
        assert "clear_to" in unordered["errors"][0]["message"]
        assert config.read_text("utf-8") == FILE

        wrong = _result(
            await client.call(
                "routing.set",
                {
                    "routing": {"local_only": ["relative"]},
                    "ladder": {"local": "anthropic/some-model", "budget": "nope/none"},
                    "roles": {"explore": "nope/none"},
                },
            )
        )
        paths = {error["path"]: error["message"] for error in wrong["errors"]}
        assert "routing.local_only" in paths
        assert "not a local one" in paths["routing.ladder.local"]
        assert "routing.ladder.budget" in paths
        assert "routing.roles.explore" in paths
        assert config.read_text("utf-8") == FILE

        worse = await client.call("routing.set", {"routing": {"mode": "reckless"}})
        assert "error" in worse
        assert config.read_text("utf-8") == FILE
    finally:
        await client.close()
        await stop_daemon(app, task)
