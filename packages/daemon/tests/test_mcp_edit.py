"""``mcp.get``, ``mcp.update``, the full ``mcp.add``, ``mcp.remove``, and ``config.raw.*``."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import cast

from fakes import ToolCallingChatModel
from test_server import HELLO, RpcClient, error_code, rpc_result, start_daemon, stop_daemon

from golem.models.router import ModelRouter
from golem.secrets import MemorySecrets
from golem.server.dispatcher import INVALID_PARAMS
from golem_protocol.methods import METHOD_ACCESS

SERVER = str(Path(__file__).with_name("fake_mcp_server.py"))
URL = "http://127.0.0.1:9/mcp"


def _hosted(name: str = "github", extra: str = "", token: bool = True) -> str:
    header = f'headers = {{ Authorization = "Bearer keychain:mcp/{name}" }}\n' if token else ""
    return f'[mcp.{name}]\nurl = "{URL}"\nenabled = false\n{header}{extra}'


async def _start(home: Path, secrets: MemorySecrets | None = None):
    app, task = await start_daemon(
        home, router=ModelRouter(model=ToolCallingChatModel(replies=[])), secrets=secrets
    )
    client = await RpcClient.connect(app.paths.socket_path)
    await client.call("hello", HELLO)
    return app, task, client


def _config(**fields: object) -> dict[str, object]:
    return {"url": URL, "enabled": False, **fields}


async def test_get_returns_the_config_and_which_secrets_are_stored(short_home: Path) -> None:
    secrets = MemorySecrets()
    secrets.secrets["mcp/github"] = "ghp-secret"
    (short_home / "config.toml").write_text(
        _hosted(extra='approval = "allow"\ntools = { exclude = ["delete_*"] }\n'), encoding="utf-8"
    )
    app, task, client = await _start(short_home, secrets)
    try:
        detail = rpc_result(await client.call("mcp.get", {"name": "github"}))
        assert detail["scope"] == "user"
        assert detail["path"] == str(short_home / "config.toml")
        config = cast(dict[str, object], detail["config"])
        assert config["url"] == URL and config["approval"] == "allow"
        assert config["tools"] == {"include": [], "exclude": ["delete_*"]}
        assert detail["secrets"] == [{"ref": "mcp/github", "stored": True}]
        assert "ghp-secret" not in json.dumps(detail)
        assert error_code(await client.call("mcp.get", {"name": "nope"})) == INVALID_PARAMS
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_update_changes_every_field_and_keeps_a_secret_left_out(short_home: Path) -> None:
    secrets = MemorySecrets()
    secrets.secrets["mcp/github"] = "kept"
    (short_home / "config.toml").write_text(
        "# top\n" + _hosted(extra="timeout_seconds = 30\n"), encoding="utf-8"
    )
    app, task, client = await _start(short_home, secrets)
    try:
        config = _config(
            headers={"Authorization": "Bearer keychain:mcp/github"},
            timeout_seconds=60,
            approval="allow",
            tools={"include": ["list_*"], "exclude": ["list_secrets"]},
        )
        updated = rpc_result(await client.call("mcp.update", {"name": "github", "config": config}))
        assert updated["approval"] == "allow"
        text = (short_home / "config.toml").read_text(encoding="utf-8")
        assert text.startswith("# top\n")
        assert "timeout_seconds = 60" in text and 'approval = "allow"' in text
        assert '"list_secrets"' in text
        assert secrets.secrets == {"mcp/github": "kept"}
        detail = rpc_result(await client.call("mcp.get", {"name": "github"}))
        assert cast(dict[str, object], detail["config"])["timeout_seconds"] == 60
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_update_stores_a_sent_secret_and_renames_with_its_secrets(short_home: Path) -> None:
    secrets = MemorySecrets()
    secrets.secrets["mcp/github"] = "old-token"
    (short_home / "config.toml").write_text(_hosted(), encoding="utf-8")
    app, task, client = await _start(short_home, secrets)
    try:
        renamed = _config(headers={"Authorization": "Bearer keychain:mcp/work"})
        result = rpc_result(
            await client.call(
                "mcp.update", {"name": "github", "new_name": "work", "config": renamed}
            )
        )
        assert result["name"] == "work"
        assert secrets.secrets == {"mcp/work": "old-token"}
        text = (short_home / "config.toml").read_text(encoding="utf-8")
        assert "[mcp.work]" in text and "[mcp.github]" not in text

        again = _config(headers={"Authorization": "Bearer keychain:mcp/work"})
        sent = {"name": "work", "config": again, "secrets": {"mcp/work": "new-token"}}
        rpc_result(await client.call("mcp.update", sent))
        assert secrets.secrets == {"mcp/work": "new-token"}
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_update_refuses_to_redirect_a_stored_secret(short_home: Path) -> None:
    secrets = MemorySecrets()
    secrets.secrets["mcp/github"] = "ghp-secret"
    original = _hosted()
    (short_home / "config.toml").write_text(original, encoding="utf-8")
    app, task, client = await _start(short_home, secrets)
    try:
        headers = {"Authorization": "Bearer keychain:mcp/github"}
        moved = {"name": "github", "config": _config(url="http://evil.test/mcp", headers=headers)}
        failed = await client.call("mcp.update", moved)
        assert error_code(failed) == INVALID_PARAMS
        assert "send the secret again" in json.dumps(failed)
        assert (short_home / "config.toml").read_text(encoding="utf-8") == original
        # A rename with a new address copies the old secret nowhere either.
        renamed = {
            **moved,
            "new_name": "evil",
            "config": _config(
                url="http://evil.test/mcp", headers={"Authorization": "Bearer keychain:mcp/evil"}
            ),
        }
        assert error_code(await client.call("mcp.update", renamed)) == INVALID_PARAMS
        assert secrets.secrets == {"mcp/github": "ghp-secret"}
        # Sending the secret again is how the page says it means it.
        moved["secrets"] = {"mcp/github": "ghp-again"}
        rpc_result(await client.call("mcp.update", moved))
        assert secrets.secrets == {"mcp/github": "ghp-again"}
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_server_may_not_name_another_servers_secret(short_home: Path) -> None:
    secrets = MemorySecrets()
    secrets.secrets["mcp/github"] = "ghp-secret"
    (short_home / "config.toml").write_text(_hosted(), encoding="utf-8")
    app, task, client = await _start(short_home, secrets)
    try:
        steal = _config(url="http://evil.test/mcp")
        steal["headers"] = {"Authorization": "Bearer keychain:mcp/github"}
        added = await client.call("mcp.add", {"name": "evil", "config": steal})
        assert error_code(added) == INVALID_PARAMS and "only its own secrets" in json.dumps(added)
        mine = _config(headers={"Authorization": "Bearer keychain:mcp/other"})
        assert (
            error_code(await client.call("mcp.update", {"name": "github", "config": mine}))
            == INVALID_PARAMS
        )
        # A secret sent for a name the config does not use is refused.
        sent = {"name": "ok", "config": _config(), "secrets": {"mcp/ok": "t"}}
        assert error_code(await client.call("mcp.add", sent)) == INVALID_PARAMS
        assert "[mcp.evil]" not in (short_home / "config.toml").read_text(encoding="utf-8")
        assert secrets.secrets == {"mcp/github": "ghp-secret"}
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_the_full_add_stores_its_secrets_before_the_file_and_never_echoes_them(
    short_home: Path,
) -> None:
    secrets = MemorySecrets()
    app, task, client = await _start(short_home, secrets)
    try:
        config = _config(headers={"Authorization": "Bearer keychain:mcp/github"}, approval="allow")
        params = {"name": "github", "config": config, "secrets": {"mcp/github": "ghp-secret"}}
        response = await client.call("mcp.add", params)
        assert rpc_result(response)["approval"] == "allow"
        assert secrets.secrets == {"mcp/github": "ghp-secret"}
        assert "ghp-secret" not in (short_home / "config.toml").read_text(encoding="utf-8")
        assert "ghp-secret" not in json.dumps(response)
        both = {"name": "x", "config": _config(), "url": URL}
        assert error_code(await client.call("mcp.add", both)) == INVALID_PARAMS
        removed = rpc_result(await client.call("mcp.remove", {"name": "github"}))
        assert removed == {"name": "github", "secret": True}
        assert secrets.secrets == {}
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_project_server_needs_a_trusted_project(short_home: Path, tmp_path: Path) -> None:
    project = tmp_path / "proj"
    project.mkdir()
    app, task, client = await _start(short_home)
    try:
        created = rpc_result(await client.call("session.create", {"cwd": str(project)}))
        session_id = str(created["session_id"])
        params = {"name": "mine", "config": _config(), "scope": "project", "session_id": session_id}
        assert error_code(await client.call("mcp.add", params)) == INVALID_PARAMS
        no_session = {"name": "mine", "config": _config(), "scope": "project"}
        assert error_code(await client.call("mcp.add", no_session)) == INVALID_PARAMS
        assert not (project / ".golem").exists()
    finally:
        await client.close()
        await stop_daemon(app, task)

    trusted = f'trusted_projects = ["{project.resolve()}"]\n'
    (short_home / "config.toml").write_text(trusted, encoding="utf-8")
    app, task, client = await _start(short_home)
    try:
        created = rpc_result(await client.call("session.create", {"cwd": str(project)}))
        session_id = str(created["session_id"])
        params = {"name": "mine", "config": _config(), "scope": "project", "session_id": session_id}
        rpc_result(await client.call("mcp.add", params))
        written = (project / ".golem" / "config.toml").read_text(encoding="utf-8")
        assert "[mcp.mine]" in written
        assert "mcp" not in (short_home / "config.toml").read_text(encoding="utf-8")
        detail = rpc_result(
            await client.call("mcp.get", {"name": "mine", "session_id": session_id})
        )
        assert detail["scope"] == "project"
        updated = {"name": "mine", "session_id": session_id, "config": _config(approval="allow")}
        assert rpc_result(await client.call("mcp.update", updated))["approval"] == "allow"
        removed = rpc_result(
            await client.call("mcp.remove", {"name": "mine", "session_id": session_id})
        )
        assert removed["name"] == "mine"
        assert "[mcp.mine]" not in (project / ".golem" / "config.toml").read_text(encoding="utf-8")
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_remove_keeps_a_secret_another_server_names(short_home: Path) -> None:
    secrets = MemorySecrets()
    secrets.secrets["mcp/shared"] = "token"
    shared = 'headers = { Authorization = "Bearer keychain:mcp/shared" }\n'
    (short_home / "config.toml").write_text(
        f'[mcp.shared]\nurl = "{URL}"\nenabled = false\n{shared}'
        f'[mcp.other]\nurl = "{URL}"\nenabled = false\n'
        f'headers = {{ Authorization = "Bearer keychain:mcp/shared" }}\n',
        encoding="utf-8",
    )
    app, task, client = await _start(short_home, secrets)
    try:
        removed = rpc_result(await client.call("mcp.remove", {"name": "other"}))
        assert removed["secret"] is False
        assert secrets.secrets == {"mcp/shared": "token"}
        removed = rpc_result(await client.call("mcp.remove", {"name": "shared"}))
        assert removed["secret"] is True and secrets.secrets == {}
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_raw_get_and_set_round_trip_with_a_conflict_check(short_home: Path) -> None:
    path = short_home / "config.toml"
    app, task, client = await _start(short_home)
    try:
        absent = rpc_result(await client.call("config.raw.get", {}))
        assert (absent["text"], absent["mtime_ns"], absent["exists"]) == ("", None, False)

        text = f'# mine\nlog_level = "DEBUG"\n[mcp.fake]\ncommand = {json.dumps(sys.executable)}\n'
        text += f"args = [{json.dumps(SERVER)}]\n"
        saved = rpc_result(
            await client.call("config.raw.set", {"text": text, "base_mtime_ns": None})
        )
        assert saved["ok"] is True and saved["restart_needed"] == ["log_level"]
        assert path.read_text(encoding="utf-8") == text
        got = rpc_result(await client.call("config.raw.get", {}))
        assert (
            got["text"] == text and got["exists"] is True and got["mtime_ns"] == saved["mtime_ns"]
        )

        stale = rpc_result(
            await client.call("config.raw.set", {"text": "x = 1\n", "base_mtime_ns": 1})
        )
        assert stale["ok"] is False
        assert cast(list[dict[str, object]], stale["errors"])[0]["message"] == (
            "config.toml changed on disk; reload"
        )
        assert path.read_text(encoding="utf-8") == text
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_raw_set_reports_errors_with_lines_and_leaves_the_file_alone(
    short_home: Path,
) -> None:
    path = short_home / "config.toml"
    original = '# keep\nlog_level = "INFO"\n'
    path.write_text(original, encoding="utf-8")
    app, task, client = await _start(short_home)
    try:
        base = rpc_result(await client.call("config.raw.get", {}))["mtime_ns"]

        async def attempt(text: str, **extra: object) -> dict[str, object]:
            params = {"text": text, "base_mtime_ns": base, **extra}
            return rpc_result(await client.call("config.raw.set", params))

        syntax = await attempt('log_level = "INFO"\nbroken = = 1\n')
        [error] = cast(list[dict[str, object]], syntax["errors"])
        assert (syntax["ok"], error["line"], error["column"]) == (False, 2, 10)

        invalid = await attempt("[mcp.x]\ncommand = 'uvx'\nurl = 'http://x.test'\n")
        [error] = cast(list[dict[str, object]], invalid["errors"])
        assert error["path"] == "mcp.x" and error["line"] == 1

        literal = await attempt(
            "[mcp.x]\nurl = 'http://x.test'\nheaders = { Authorization = 'Bearer abc' }\n"
        )
        assert literal["ok"] is False
        assert "looks like a secret" in json.dumps(literal["errors"])

        protected = await attempt('trusted_projects = ["/evil"]\n')
        assert protected["ok"] is False
        assert "trusted_projects" in json.dumps(protected["errors"])

        dry = await attempt('log_level = "DEBUG"\n', dry_run=True)
        assert dry["ok"] is True and dry["restart_needed"] == ["log_level"]
        assert path.read_text(encoding="utf-8") == original
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_the_protected_write_is_for_local_clients_only(short_home: Path) -> None:
    assert METHOD_ACCESS["config.raw.set"] == "browser"
    assert METHOD_ACCESS["config.raw.set_protected"] == "local"
    assert METHOD_ACCESS["auth.set"] == "local"
    path = short_home / "config.toml"
    app, task, client = await _start(short_home)
    try:
        text = 'trusted_projects = ["/work"]\n'
        browser = rpc_result(
            await client.call("config.raw.set", {"text": text, "base_mtime_ns": None})
        )
        assert browser["ok"] is False and not path.exists()
        local = rpc_result(
            await client.call("config.raw.set_protected", {"text": text, "base_mtime_ns": None})
        )
        assert local["ok"] is True
        assert path.read_text(encoding="utf-8") == text
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_raw_edit_cannot_redirect_a_server_with_a_stored_secret(short_home: Path) -> None:
    secrets = MemorySecrets()
    secrets.secrets["mcp/github"] = "ghp-secret"
    path = short_home / "config.toml"
    original = _hosted()
    path.write_text(original, encoding="utf-8")
    app, task, client = await _start(short_home, secrets)
    try:
        base = rpc_result(await client.call("config.raw.get", {}))["mtime_ns"]
        moved = original.replace("127.0.0.1:9", "evil.test")
        result = rpc_result(
            await client.call("config.raw.set", {"text": moved, "base_mtime_ns": base})
        )
        assert result["ok"] is False and "send the secret again" in json.dumps(result["errors"])
        assert path.read_text(encoding="utf-8") == original
        quiet = original.replace("enabled = false", "enabled = false\ntimeout_seconds = 5")
        ok = rpc_result(await client.call("config.raw.set", {"text": quiet, "base_mtime_ns": base}))
        assert ok["ok"] is True
    finally:
        await client.close()
        await stop_daemon(app, task)
