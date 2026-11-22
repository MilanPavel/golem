"""``agents.keep``: read and write ``[agents] keep_days`` and ``keep_problem_days`` (#1567)."""

from __future__ import annotations

import tomllib
from pathlib import Path
from typing import Any

from test_server import HELLO, RpcClient, rpc_result, start_daemon, stop_daemon


def _result(response: dict[str, Any]) -> dict[str, Any]:
    return rpc_result(response)


def _kept(result: dict[str, Any]) -> dict[str, Any]:
    """The keep values, without the limits of ``[agents]`` that travel beside them."""
    return {k: v for k, v in result["values"].items() if k.startswith("keep_")}


async def test_agents_keep_reads_the_defaults_and_writes_the_file(short_home: Path) -> None:
    config = short_home / "config.toml"
    config.write_text("# mine\n[agents.explorer]\nmodel = 'local'\n", "utf-8")
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        got = _result(await client.call("agents.keep", {}))
        assert _kept(got) == {"keep_days": 7, "keep_problem_days": 30}
        assert config.read_text("utf-8").startswith("# mine")

        saved = _result(await client.call("agents.keep", {"keep_days": 14}))
        assert saved["ok"] is True
        assert _kept(saved) == {"keep_days": 14, "keep_problem_days": 30}
        forever = _result(await client.call("agents.keep", {"keep_problem_days": 0}))
        assert _kept(forever) == {"keep_days": 14, "keep_problem_days": 0}
        text = config.read_text("utf-8")
        assert "# mine" in text
        table = tomllib.loads(text)["agents"]
        assert (table["keep_days"], table["keep_problem_days"]) == (14, 0)
        assert table["explorer"] == {"model": "local"}
        again = _result(await client.call("agents.keep", {}))
        assert _kept(again) == {"keep_days": 14, "keep_problem_days": 0}
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_agents_keep_names_the_field_of_a_wrong_value(short_home: Path) -> None:
    config = short_home / "config.toml"
    config.write_text("[agents]\nkeep_days = 3\n", "utf-8")
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        bad = _result(await client.call("agents.keep", {"keep_days": -1}))
        assert bad["ok"] is False
        assert bad["values"] is None
        assert [error["path"] for error in bad["errors"]] == ["agents.keep_days"]
        assert config.read_text("utf-8") == "[agents]\nkeep_days = 3\n"
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_agents_keep_reads_and_writes_use_helpers(short_home: Path) -> None:
    config = short_home / "config.toml"
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        got = _result(await client.call("agents.keep", {}))
        assert got["values"]["use_helpers"] == "when_needed"
        saved = _result(await client.call("agents.keep", {"use_helpers": "ask"}))
        assert saved["ok"] is True
        assert saved["values"]["use_helpers"] == "ask"
        assert tomllib.loads(config.read_text("utf-8"))["agents"]["use_helpers"] == "ask"
        again = _result(await client.call("agents.keep", {}))
        assert again["values"]["use_helpers"] == "ask"
    finally:
        await client.close()
        await stop_daemon(app, task)
