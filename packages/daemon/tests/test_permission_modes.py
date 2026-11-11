"""Permission modes: what the built-in rules allow, and the session's override of the mode."""

from __future__ import annotations

from pathlib import Path
from typing import cast, get_args

import pytest
from test_server import HELLO, RpcClient, error_code, rpc_result, start_daemon, stop_daemon

from golem.config import PERMISSION_MODES, GolemSettings, PermissionMode
from golem.models.router import ModelRouter
from golem.permissions.policy import Policy
from golem.server.dispatcher import INVALID_PARAMS, SESSION_NOT_FOUND
from golem.tools import default_registry
from golem_protocol import events

READ_ONLY = {
    "read_file",
    "list_dir",
    "glob",
    "grep",
    "git_status",
    "git_diff",
    "git_log",
    "read_artifact",
    "todo_write",
}
BALANCED = READ_ONLY | {"web_search", "web_fetch"}
AUTOPILOT = BALANCED | {"shell", "write_file", "edit_file"}
ALLOWED: dict[PermissionMode, set[str]] = {
    "careful": READ_ONLY,
    "balanced": BALANCED,
    "autopilot": AUTOPILOT,
}
NEVER = ["shell_unsandboxed", "mcp__fake__echo", "some_unknown_tool"]


def _policy(tmp_path: Path, text: str = "") -> Policy:
    config = tmp_path / "config.toml"
    config.write_text(text, encoding="utf-8")
    return Policy(config, home=tmp_path)


def _allowed(policy: Policy, mode: PermissionMode | None = None) -> set[str]:
    registry = default_registry()
    names = [*registry.names, *NEVER]
    return {
        name for name in names if policy.check(registry, name, {}, None, mode).action == "allow"
    }


def test_the_protocol_and_the_config_name_the_same_modes() -> None:
    assert set(PERMISSION_MODES) == set(get_args(PermissionMode))
    assert set(PERMISSION_MODES) == set(get_args(events.PermissionMode))


def test_the_default_mode_is_balanced(tmp_path: Path) -> None:
    assert GolemSettings().permissions.mode == "balanced"
    assert Policy(None, home=tmp_path).default_mode() == "balanced"


@pytest.mark.parametrize("mode", PERMISSION_MODES)
def test_each_mode_allows_its_tools_and_asks_for_the_rest(
    tmp_path: Path, mode: PermissionMode
) -> None:
    policy = _policy(tmp_path)
    assert _allowed(policy, mode) == ALLOWED[mode]
    source = policy.check(default_registry(), "shell_unsandboxed", {}, None, mode).source
    assert source == f"built-in default ({mode})"


def test_the_config_mode_applies_without_a_session_mode(tmp_path: Path) -> None:
    policy = _policy(tmp_path, '[permissions]\nmode = "autopilot"\n')
    assert policy.default_mode() == "autopilot"
    assert _allowed(policy) == AUTOPILOT


def test_a_session_mode_beats_the_config_mode(tmp_path: Path) -> None:
    policy = _policy(tmp_path, '[permissions]\nmode = "autopilot"\n')
    assert _allowed(policy, "careful") == READ_ONLY


def test_shell_asks_in_balanced_when_the_network_is_on(tmp_path: Path) -> None:
    policy = _policy(tmp_path, "[shell]\nnetwork = true\n")
    assert _allowed(policy, "balanced") == BALANCED
    assert _allowed(policy, "autopilot") == AUTOPILOT - {"shell"}


def test_a_user_ask_rule_still_asks_in_balanced(tmp_path: Path) -> None:
    policy = _policy(tmp_path, '[[rule]]\ntool = "web_search"\naction = "ask"\n')
    registry = default_registry()
    assert policy.check(registry, "web_search", {}, None, "balanced").action == "ask"
    assert policy.check(registry, "web_fetch", {}, None, "balanced").action == "allow"


def test_a_deny_rule_still_denies_in_autopilot(tmp_path: Path) -> None:
    text = '[[rule]]\ntool = "write_file"\npath = "secrets/**"\naction = "deny"\n'
    policy = _policy(tmp_path, text)
    registry = default_registry()
    root = tmp_path / "project"
    root.mkdir()
    denied = policy.check(registry, "write_file", {"path": "secrets/k"}, root, "autopilot")
    other = policy.check(registry, "write_file", {"path": "a.txt"}, root, "autopilot")
    assert (denied.action, other.action) == ("deny", "allow")


def test_a_wildcard_allow_rule_never_covers_shell_unsandboxed(tmp_path: Path) -> None:
    policy = _policy(tmp_path, '[[rule]]\ntool = "*"\naction = "allow"\n')
    registry = default_registry()
    assert policy.check(registry, "shell_unsandboxed", {}, None, "autopilot").action == "ask"


def test_a_tool_marks_the_first_mode_that_allows_it() -> None:
    registry = default_registry()

    def tool(name: str):
        found = registry.get(name)
        assert found is not None
        return found

    assert tool("write_file").allow_from == "autopilot"
    assert tool("web_fetch").allow_from == "balanced"
    assert tool("shell").allow_from == "autopilot"
    assert tool("shell").offline_only
    assert tool("shell_unsandboxed").allow_from is None


async def test_a_session_mode_is_set_announced_and_survives_a_restart(short_home: Path) -> None:
    (short_home / "config.toml").write_text('[permissions]\nmode = "careful"\n', encoding="utf-8")
    router = ModelRouter(GolemSettings())
    app, task = await start_daemon(short_home, router=router)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        created = rpc_result(await client.call("session.create", {}))
        session_id = cast(str, created["session_id"])
        rpc_result(await client.call("session.attach", {"session_id": session_id, "after_seq": 0}))
        config = rpc_result(await client.call("config.get", {"session_id": session_id}))
        assert (config["default_permission_mode"], config["permission_mode"]) == (
            "careful",
            "careful",
        )
        result = rpc_result(
            await client.call("session.set_mode", {"session_id": session_id, "mode": "autopilot"})
        )
        assert result == {"session_id": session_id, "mode": "autopilot", "override": True}
        event = await client.wait_for_event("session.mode.changed")
        params = cast(dict[str, object], event["params"])
        assert params["data"] == {"mode": "autopilot"}
        rpc_result(
            await client.call("session.set_mode", {"session_id": session_id, "mode": "autopilot"})
        )
        types = [cast(dict[str, object], e["params"])["type"] for e in client.events]
        assert types.count("session.mode.changed") == 1
        config = rpc_result(await client.call("config.get", {"session_id": session_id}))
        assert (config["default_permission_mode"], config["permission_mode"]) == (
            "careful",
            "autopilot",
        )
        rules = cast(list[dict[str, object]], config["rules"])
        assert any(
            r["tool"] == "write_file" and r["source"] == "built-in default (autopilot)"
            for r in rules
        )
    finally:
        await client.close()
        await stop_daemon(app, task)
    app, task = await start_daemon(short_home, router=router)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        rpc_result(await client.call("session.attach", {"session_id": session_id, "after_seq": 0}))
        config = rpc_result(await client.call("config.get", {"session_id": session_id}))
        assert config["permission_mode"] == "autopilot"
        cleared = rpc_result(
            await client.call("session.set_mode", {"session_id": session_id, "mode": None})
        )
        assert cleared == {"session_id": session_id, "mode": "careful", "override": False}
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_bad_mode_or_session_is_refused(short_home: Path) -> None:
    app, task = await start_daemon(short_home, router=ModelRouter(GolemSettings()))
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        created = rpc_result(await client.call("session.create", {}))
        bad = await client.call(
            "session.set_mode", {"session_id": created["session_id"], "mode": "reckless"}
        )
        assert error_code(bad) == INVALID_PARAMS
        missing = await client.call("session.set_mode", {"session_id": "s_nope", "mode": "careful"})
        assert error_code(missing) == SESSION_NOT_FOUND
    finally:
        await client.close()
        await stop_daemon(app, task)
