"""``ollama.settings.get`` and ``ollama.settings.set``: the ``[ollama]`` settings over the wire."""

from __future__ import annotations

import tomllib
from pathlib import Path
from typing import Any

from test_server import HELLO, RpcClient, rpc_result, start_daemon, stop_daemon

CONFIG = """# mine
[ollama]
start = true

[ollama.models."qwen3:8b"]
num_ctx = 4096
"""


def _result(response: dict[str, Any]) -> dict[str, Any]:
    return rpc_result(response)


async def test_each_field_round_trips_and_models_stay(short_home: Path) -> None:
    config = short_home / "config.toml"
    config.write_text(CONFIG, "utf-8")
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        got = _result(await client.call("ollama.settings.get", {}))
        assert got == {
            "start": True,
            "idle_stop_minutes": 30,
            "parallel": 1,
            "started_by_golem": False,
            "running": False,
        }
        before = tomllib.loads(config.read_text("utf-8"))["ollama"]["models"]

        for patch in (
            {"start": False},
            {"idle_stop_minutes": 5},
            {"parallel": 4},
            {"parallel": "auto"},
        ):
            saved = _result(await client.call("ollama.settings.set", patch))
            assert saved["ok"] is True
            key = next(iter(patch))
            assert saved["values"][key] == patch[key]
            again = _result(await client.call("ollama.settings.get", {}))
            assert again[key] == patch[key]

        text = config.read_text("utf-8")
        assert "# mine" in text
        table = tomllib.loads(text)["ollama"]
        assert table["models"] == before
        assert (table["start"], table["idle_stop_minutes"], table["parallel"]) == (
            False,
            5,
            "auto",
        )
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_wrong_values_are_refused_and_nothing_is_written(short_home: Path) -> None:
    config = short_home / "config.toml"
    config.write_text(CONFIG, "utf-8")
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        for patch, path in (
            ({"parallel": 9}, "ollama.parallel"),
            ({"idle_stop_minutes": -1}, "ollama.idle_stop_minutes"),
        ):
            bad = _result(await client.call("ollama.settings.set", patch))
            assert bad["ok"] is False
            assert bad["values"] is None
            assert next(error["path"] for error in bad["errors"]).startswith(path)
        assert config.read_text("utf-8") == CONFIG
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_changed_idle_stop_reaches_the_server_manager(short_home: Path) -> None:
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        local = app.state.local_servers
        assert local is not None
        assert local.settings.idle_stop_minutes == 30
        saved = _result(await client.call("ollama.settings.set", {"idle_stop_minutes": 7}))
        assert saved["ok"] is True
        assert local.settings.idle_stop_minutes == 7
    finally:
        await client.close()
        await stop_daemon(app, task)
