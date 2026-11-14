"""``permissions.set_mode``: ``[permissions] mode`` written with the comments kept."""

from __future__ import annotations

import os
import tomllib
from pathlib import Path

import pytest
from test_server import HELLO, RpcClient, rpc_result, start_daemon, stop_daemon

import golem.config_edit as config_edit
from golem.config_edit import RawConflictError, set_permission_mode
from golem.server import handlers

FILE = """# mine
default_model = "local"  # keep

[permissions]
# how careful
mode = "careful"  # now

[shell]
network = false
"""


def test_set_permission_mode_keeps_comments_and_the_rest(tmp_path: Path) -> None:
    config = tmp_path / "config.toml"
    config.write_text(FILE, "utf-8")
    set_permission_mode(config, "autopilot")
    text = config.read_text("utf-8")
    assert "# mine" in text and "# keep" in text and "# how careful" in text
    parsed = tomllib.loads(text)
    assert parsed["permissions"]["mode"] == "autopilot"
    assert parsed["default_model"] == "local"
    assert parsed["shell"] == {"network": False}


def test_set_permission_mode_creates_the_table_and_the_file(tmp_path: Path) -> None:
    config = tmp_path / "home" / "config.toml"
    set_permission_mode(config, "careful")
    assert tomllib.loads(config.read_text("utf-8")) == {"permissions": {"mode": "careful"}}
    config.write_text('default_model = "x"\n', "utf-8")
    set_permission_mode(config, "balanced")
    assert tomllib.loads(config.read_text("utf-8")) == {
        "default_model": "x",
        "permissions": {"mode": "balanced"},
    }


def test_set_permission_mode_refuses_a_file_that_changed_while_writing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config = tmp_path / "config.toml"
    config.write_text(FILE, "utf-8")
    real_read = config_edit.read_raw

    def read_then_edit(path: Path) -> tuple[str, int | None]:
        result = real_read(path)
        stat = path.stat()
        os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns + 1_000_000))
        return result

    monkeypatch.setattr(config_edit, "read_raw", read_then_edit)
    with pytest.raises(RawConflictError):
        set_permission_mode(config, "autopilot")
    assert tomllib.loads(config.read_text("utf-8"))["permissions"]["mode"] == "careful"


async def test_permissions_set_mode_writes_and_the_policy_follows(
    short_home: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    config = short_home / "config.toml"
    config.write_text(FILE, "utf-8")
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        stored = rpc_result(await client.call("permissions.set_mode", {"mode": "autopilot"}))
        assert stored == {"mode": "autopilot", "path": str(config)}
        assert "# how careful" in config.read_text("utf-8")
        got = rpc_result(await client.call("config.get", {}))
        assert got["default_permission_mode"] == "autopilot"
        bad = await client.call("permissions.set_mode", {"mode": "reckless"})
        assert "error" in bad

        def conflict(_file: Path, _mode: str) -> int:
            raise RawConflictError("config.toml changed on disk; reload")

        monkeypatch.setattr(handlers, "set_permission_mode", conflict)
        failed = await client.call("permissions.set_mode", {"mode": "careful"})
        assert "changed on disk" in str(failed)
        assert tomllib.loads(config.read_text("utf-8"))["permissions"]["mode"] == "autopilot"
    finally:
        await client.close()
        await stop_daemon(app, task)
