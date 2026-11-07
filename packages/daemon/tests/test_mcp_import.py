"""Importing servers from other apps: mapping, names, secrets, scans, and the two methods."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, cast

from fakes import ToolCallingChatModel
from test_server import HELLO, RpcClient, error_code, rpc_result, start_daemon, stop_daemon

from golem.mcp.importer import (
    OLD_SSE,
    ConvertError,
    Raw,
    ScanStore,
    convert,
    discover,
    find_servers,
    fit_name,
    from_text,
    loads,
)
from golem.models.router import ModelRouter
from golem.secrets import MemorySecrets
from golem.server.dispatcher import INVALID_PARAMS
from golem_protocol.methods import METHOD_ACCESS

FIXTURES = Path(__file__).with_name("fixtures") / "mcp-import"


def _ok(response: dict[str, object]) -> dict[str, Any]:
    """A result with its nested values typed loosely, as a test reads them."""
    return cast(dict[str, Any], rpc_result(response))


def _fixture(name: str) -> dict[str, Any]:
    return cast(dict[str, Any], loads((FIXTURES / name).read_text(encoding="utf-8")))


def _server(file: str, name: str, key: str = "mcpServers") -> dict[str, Any]:
    return cast(dict[str, Any], _fixture(file)[key][name])


def _switched_off(text: str) -> str:
    """The same file with every server ``disabled``, so an import never starts a real one."""

    def walk(node: object) -> None:
        if isinstance(node, dict):
            table = cast(dict[str, Any], node)
            for key in ("mcpServers", "servers"):
                if isinstance(table.get(key), dict):
                    for server in cast(dict[str, Any], table[key]).values():
                        server["disabled"] = True
            for value in table.values():
                walk(value)

    doc = loads(text)
    walk(doc)
    return json.dumps(doc)


def _laid_out(tmp: Path, project: Path) -> Path:
    """A home folder with a copy of each app's file, and the project's own files."""
    home = tmp / "home"
    desktop = home / "Library" / "Application Support" / "Claude"
    desktop.mkdir(parents=True)
    (desktop / "claude_desktop_config.json").write_text(
        _switched_off((FIXTURES / "claude_desktop_config.json").read_text(encoding="utf-8")),
        encoding="utf-8",
    )
    code = (FIXTURES / "claude_code.json").read_text(encoding="utf-8")
    (home / ".claude.json").write_text(
        _switched_off(code.replace("{project}", str(project))), encoding="utf-8"
    )
    (home / ".cursor").mkdir()
    (home / ".cursor" / "mcp.json").write_text(
        (FIXTURES / "cursor.json").read_text(encoding="utf-8"), encoding="utf-8"
    )
    vscode = home / "Library" / "Application Support" / "Code" / "User"
    vscode.mkdir(parents=True)
    (vscode / "mcp.json").write_text(
        (FIXTURES / "vscode.json").read_text(encoding="utf-8"), encoding="utf-8"
    )
    (home / ".codeium" / "windsurf").mkdir(parents=True)
    (home / ".codeium" / "windsurf" / "mcp_config.json").write_text(
        (FIXTURES / "windsurf.json").read_text(encoding="utf-8"), encoding="utf-8"
    )
    project.mkdir(parents=True, exist_ok=True)
    (project / ".mcp.json").write_text(
        _switched_off((FIXTURES / "claude_code_project.mcp.json").read_text(encoding="utf-8")),
        encoding="utf-8",
    )
    return home


def test_a_token_in_env_moves_to_a_reference_and_the_table_keeps_no_value() -> None:
    body = _server("claude_desktop_config.json", "github")
    got = convert("github", body, {})
    assert got.table["command"] == "npx"
    assert got.table["env"] == {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "keychain:mcp/github",
        "GITHUB_API_URL": "https://api.github.com",
    }
    assert got.secrets == {"mcp/github": "ghp_fixture_token_1"}
    assert got.needed == []
    assert "ghp_fixture_token_1" not in json.dumps(got.table)
    assert got.settings.secrets == ["mcp/github"]


def test_a_bearer_header_is_split_and_a_second_secret_gets_a_suffixed_reference() -> None:
    docs = convert("remote-docs", _server("claude_desktop_config.json", "remote_docs"), {})
    assert docs.table == {
        "url": "https://docs.example.test/mcp",
        "headers": {"Authorization": "Bearer keychain:mcp/remote-docs"},
    }
    assert docs.secrets == {"mcp/remote-docs": "docs_fixture_token_2"}

    two = convert(
        "x",
        {"command": "npx", "env": {"API_TOKEN": "a", "OTHER_SECRET": "b", "REGION": "eu"}},
        {},
    )
    assert two.secrets == {"mcp/x": "a", "mcp/x-other_secret": "b"}
    assert two.table["env"]["REGION"] == "eu"


def test_a_header_name_with_dashes_counts_as_a_secret() -> None:
    got = convert("context7", _server("cursor.json", "context7"), {})
    assert got.table["headers"] == {"X-API-Key": "keychain:mcp/context7"}
    assert got.secrets == {"mcp/context7": "ctx_fixture_key_3"}


def test_a_vscode_input_becomes_a_needed_secret_with_a_warning() -> None:
    doc = _fixture("vscode.json")
    found = from_text((FIXTURES / "vscode.json").read_text(encoding="utf-8"))
    assert found.error is None
    assert [raw.name for raw in found.raws] == ["github", "legacy"]
    inputs = found.raws[0].inputs
    assert inputs["gh-token"]["password"] is True
    got = convert("github", doc["servers"]["github"], inputs)
    assert got.secrets == {}
    assert got.needed == ["mcp/github"]
    assert got.table["env"] == {"GITHUB_PERSONAL_ACCESS_TOKEN": "keychain:mcp/github"}
    assert any("${input:gh-token}" in warning for warning in got.warnings)


def test_a_placeholder_in_a_secret_slot_is_needed_and_in_a_plain_one_a_warning() -> None:
    secret = convert("x", _server("claude_code_project.mcp.json", "shared-tool"), {})
    assert secret.needed == ["mcp/x"]
    assert secret.secrets == {}

    plain = convert(
        "y", {"command": "npx", "env": {"REGION": "${AWS_REGION}"}, "args": ["${HOME}"]}, {}
    )
    assert plain.table["env"] == {"REGION": "${AWS_REGION}"}
    assert len(plain.warnings) == 2


def test_the_old_sse_transport_is_imported_with_a_warning() -> None:
    got = convert("legacy", _server("vscode.json", "legacy", "servers"), {})
    assert got.table == {"url": "https://legacy.example.test/sse"}
    assert got.warnings == [OLD_SSE]


def test_serverurl_disabled_and_a_server_with_nothing_to_run() -> None:
    figma = convert("figma", _server("windsurf.json", "figma"), {})
    assert figma.table["url"] == "https://figma.example.test/mcp"
    assert figma.secrets == {"mcp/figma": "figma_fixture_token_4"}

    off = convert("db", {"command": "uvx", "args": ["x"], "disabled": True}, {})
    assert off.table["enabled"] is False

    try:
        convert("broken", _server("windsurf.json", "broken"), {})
    except ConvertError as exc:
        assert "neither a command nor a url" in str(exc)
    else:
        raise AssertionError("expected a ConvertError")


def test_a_secret_named_variable_in_a_table_the_file_cannot_hold_is_refused() -> None:
    try:
        convert("x", {"command": "npx", "env": {"A": "keychain:provider/openai"}}, {})
    except ConvertError as exc:
        assert "outside mcp/" in str(exc)
    else:
        raise AssertionError("expected a ConvertError")


def test_names_are_made_to_fit_and_a_clash_gets_a_number() -> None:
    assert fit_name("my files", set()) == ("my-files", False)
    assert fit_name("remote_docs.v2", set()) == ("remote-docs-v2", False)
    assert fit_name("@scope/server", set()) == ("scope-server", False)
    assert fit_name("???", set()) == ("server", False)
    long = fit_name("a" * 40, set())[0]
    assert long == "a" * 32
    assert fit_name("github", {"github"}) == ("github-2", True)
    assert fit_name("github", {"github", "github-2"}) == ("github-3", True)
    squeezed, clash = fit_name("b" * 40, {"b" * 32})
    assert clash and len(squeezed) == 32 and squeezed.endswith("-2")


def test_json_with_comments_and_trailing_commas_loads() -> None:
    text = '{\n // a comment\n "a": "x // not a comment", /* more */ "b": [1, 2,],\n}'
    assert loads(text) == {"a": "x // not a comment", "b": [1, 2]}


def test_every_shape_of_pasted_text_is_found() -> None:
    server = {"command": "npx", "args": ["x"]}
    assert find_servers({"mcpServers": {"a": server}}) == {"a": server}
    assert find_servers({"servers": {"a": server}}) == {"a": server}
    assert find_servers({"mcp": {"servers": {"a": server}}}) == {"a": server}
    assert find_servers({"a": server, "b": {"url": "https://x.test/mcp"}}) is not None
    assert find_servers(server) == {"server": server}
    assert find_servers({"theme": "dark"}) is None
    assert find_servers([1]) is None
    bare = from_text((FIXTURES / "paste_bare.json").read_text(encoding="utf-8"))
    assert [(raw.name, raw.scope) for raw in bare.raws] == [("server", "user")]
    assert from_text("{nope").error == "that is not JSON"
    assert from_text('{"theme": 1}').error == "no MCP servers in that text"


def test_discovery_reads_each_apps_files_and_only_this_projects(tmp_path: Path) -> None:
    project = tmp_path / "work"
    home = _laid_out(tmp_path, project)
    found = discover(home, project)
    seen = {(item.source, raw.scope, raw.name) for item in found for raw in item.raws}
    assert seen == {
        ("claude-desktop", "user", "github"),
        ("claude-desktop", "user", "my files"),
        ("claude-desktop", "user", "remote_docs"),
        ("claude-code", "user", "memory"),
        ("claude-code", "project", "local-db"),
        ("claude-code", "project", "shared-tool"),
        ("cursor", "user", "context7"),
        ("vscode", "user", "github"),
        ("vscode", "user", "legacy"),
        ("windsurf", "user", "figma"),
        ("windsurf", "user", "broken"),
    }
    without_project = discover(home, None)
    names = {raw.name for item in without_project for raw in item.raws}
    assert "local-db" not in names and "shared-tool" not in names
    assert discover(tmp_path / "empty", None) == []


def test_a_file_that_is_not_json_is_reported_and_never_changed(tmp_path: Path) -> None:
    home = tmp_path / "home"
    (home / ".cursor").mkdir(parents=True)
    path = home / ".cursor" / "mcp.json"
    path.write_text("{ nope", encoding="utf-8")
    [item] = discover(home, None)
    assert item.error is not None and item.raws == []
    assert path.read_text(encoding="utf-8") == "{ nope"


def test_a_scan_is_kept_for_ten_minutes_and_used_once() -> None:
    now = [0.0]
    store = ScanStore(clock=lambda: now[0])
    raw = Raw("paste", "Pasted text", "user", "x", {"command": "npx"})
    first = store.put({"k": raw})
    now[0] = 599.0
    assert store.take(first) == {"k": raw}
    assert store.take(first) is None
    second = store.put({"k": raw})
    now[0] = 599.0 + 600.0
    assert store.take(second) is None


# -- the two methods ------------------------------------------------------------------------


async def _start(home: Path, user_home: Path | None, secrets: MemorySecrets | None = None):
    app, task = await start_daemon(
        home,
        router=ModelRouter(model=ToolCallingChatModel(replies=[])),
        secrets=secrets,
        user_home=user_home,
    )
    client = await RpcClient.connect(app.paths.socket_path)
    await client.call("hello", HELLO)
    return app, task, client


def _candidates(scan: dict[str, Any], source: str) -> list[dict[str, Any]]:
    return [
        candidate
        for item in scan["sources"]
        if item["id"] == source
        for candidate in item["candidates"]
    ]


def test_the_import_methods_may_be_called_from_a_browser() -> None:
    assert METHOD_ACCESS["mcp.import.scan"] == "browser"
    assert METHOD_ACCESS["mcp.import.apply"] == "browser"


async def test_a_claude_desktop_config_with_three_servers_imports_in_one_call(
    short_home: Path, tmp_path: Path
) -> None:
    home = _laid_out(tmp_path, tmp_path / "work")
    secrets = MemorySecrets()
    app, task, client = await _start(short_home, home, secrets)
    try:
        scan = _ok(await client.call("mcp.import.scan", {}))
        wire = json.dumps(scan)
        assert "ghp_fixture_token_1" not in wire and "docs_fixture_token_2" not in wire
        desktop = _candidates(scan, "claude-desktop")
        assert [c["name"] for c in desktop] == ["github", "my-files", "remote-docs"]
        assert desktop[0]["config"]["env"]["GITHUB_PERSONAL_ACCESS_TOKEN"] == "keychain:mcp/github"
        assert desktop[0]["secret_refs"] == ["mcp/github"]

        picks = [{"key": c["key"], "name": c["name"]} for c in desktop]
        applied = _ok(
            await client.call("mcp.import.apply", {"scan_id": scan["scan_id"], "picks": picks})
        )
        assert applied["failed"] == []
        assert [s["name"] for s in applied["added"]] == ["github", "my-files", "remote-docs"]
        assert "ghp_fixture_token_1" not in json.dumps(applied)
        assert secrets.secrets == {
            "mcp/github": "ghp_fixture_token_1",
            "mcp/remote-docs": "docs_fixture_token_2",
        }
        text = (short_home / "config.toml").read_text(encoding="utf-8")
        assert "ghp_fixture_token_1" not in text and "docs_fixture_token_2" not in text
        assert "[mcp.my-files]" in text and "keychain:mcp/github" in text

        detail = _ok(await client.call("mcp.get", {"name": "github"}))
        assert detail["secrets"] == [{"ref": "mcp/github", "stored": True}]

        again = _ok(await client.call("mcp.import.scan", {}))
        same = _candidates(again, "claude-desktop")
        assert [c["already_same"] for c in same] == [True, True, True]
        assert [c["name"] for c in same] == ["github-2", "my-files-2", "remote-docs-2"]
        assert all(c["clash"] for c in same)

        used = await client.call(
            "mcp.import.apply", {"scan_id": scan["scan_id"], "picks": picks[:1]}
        )
        assert error_code(used) == INVALID_PARAMS
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_pick_that_clashes_fails_alone_and_the_others_are_added(
    short_home: Path, tmp_path: Path
) -> None:
    (short_home / "config.toml").write_text(
        '[mcp.github]\ncommand = "npx"\nargs = ["old"]\nenabled = false\n', encoding="utf-8"
    )
    home = _laid_out(tmp_path, tmp_path / "work")
    secrets = MemorySecrets()
    app, task, client = await _start(short_home, home, secrets)
    try:
        scan = _ok(await client.call("mcp.import.scan", {}))
        desktop = _candidates(scan, "claude-desktop")
        assert desktop[0]["name"] == "github-2" and desktop[0]["clash"] is True
        picks = [
            {"key": desktop[0]["key"], "name": "github"},
            {"key": desktop[1]["key"], "name": desktop[1]["name"]},
            {"key": "nope.0:x", "name": "x"},
        ]
        applied = _ok(
            await client.call("mcp.import.apply", {"scan_id": scan["scan_id"], "picks": picks})
        )
        assert [s["name"] for s in applied["added"]] == ["my-files"]
        assert [f["key"] for f in applied["failed"]] == [desktop[0]["key"], "nope.0:x"]
        assert "already" in applied["failed"][0]["error"]
        assert secrets.secrets == {}
        assert 'args = ["old"]' in (short_home / "config.toml").read_text(encoding="utf-8")
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_pasted_text_asks_for_a_missing_secret_and_stores_what_it_is_given(
    short_home: Path, tmp_path: Path
) -> None:
    secrets = MemorySecrets()
    app, task, client = await _start(short_home, tmp_path / "nothing", secrets)
    try:
        text = _switched_off((FIXTURES / "vscode.json").read_text(encoding="utf-8"))
        scan = _ok(await client.call("mcp.import.scan", {"text": text}))
        assert [item["id"] for item in scan["sources"]] == ["paste"]
        [github, legacy] = scan["sources"][0]["candidates"]
        assert github["missing_refs"] == ["mcp/github"]
        assert OLD_SSE in legacy["warnings"]
        picks = [{"key": github["key"], "name": "github"}]
        params = {
            "scan_id": scan["scan_id"],
            "picks": picks,
            "secrets": {"mcp/github": "ghp_typed_by_hand"},
        }
        applied = _ok(await client.call("mcp.import.apply", params))
        assert applied["failed"] == []
        assert secrets.secrets == {"mcp/github": "ghp_typed_by_hand"}
        assert "ghp_typed_by_hand" not in json.dumps(applied)
        assert "ghp_typed_by_hand" not in (short_home / "config.toml").read_text(encoding="utf-8")

        bad = _ok(await client.call("mcp.import.scan", {"text": "{ nope"}))
        assert bad["sources"][0]["error"] == "that is not JSON"
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_project_pick_needs_a_trusted_project_and_writes_its_file(
    short_home: Path, tmp_path: Path
) -> None:
    project = (tmp_path / "work").resolve()
    home = _laid_out(tmp_path, project)
    app, task, client = await _start(short_home, home)
    try:
        created = _ok(await client.call("session.create", {"cwd": str(project)}))
        session_id = str(created["session_id"])
        scan = _ok(await client.call("mcp.import.scan", {"session_id": session_id}))
        shared = [c for c in _candidates(scan, "claude-code") if c["scope"] == "project"]
        assert [c["name"] for c in shared] == ["local-db", "shared-tool"]
        picks = [{"key": c["key"], "name": c["name"], "scope": "project"} for c in shared]
        params = {"scan_id": scan["scan_id"], "picks": picks, "session_id": session_id}
        refused = _ok(await client.call("mcp.import.apply", params))
        assert refused["added"] == []
        assert all("trusted_projects" in f["error"] for f in refused["failed"])
    finally:
        await client.close()
        await stop_daemon(app, task)

    (short_home / "config.toml").write_text(f'trusted_projects = ["{project}"]\n', encoding="utf-8")
    app, task, client = await _start(short_home, home)
    try:
        created = _ok(await client.call("session.create", {"cwd": str(project)}))
        session_id = str(created["session_id"])
        scan = _ok(await client.call("mcp.import.scan", {"session_id": session_id}))
        shared = [c for c in _candidates(scan, "claude-code") if c["scope"] == "project"]
        picks = [{"key": c["key"], "name": c["name"], "scope": "project"} for c in shared]
        params = {"scan_id": scan["scan_id"], "picks": picks, "session_id": session_id}
        applied = _ok(await client.call("mcp.import.apply", params))
        assert applied["failed"] == []
        written = (project / ".golem" / "config.toml").read_text(encoding="utf-8")
        assert "[mcp.local-db]" in written and "[mcp.shared-tool]" in written
        assert "mcp" not in (short_home / "config.toml").read_text(encoding="utf-8").replace(
            "trusted_projects", ""
        )
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_an_expired_scan_is_refused(short_home: Path, tmp_path: Path) -> None:
    app, task, client = await _start(short_home, tmp_path / "nothing")
    try:
        now = [0.0]
        app.state.mcp_imports.clock = lambda: now[0]
        scan = _ok(
            await client.call("mcp.import.scan", {"text": '{"command": "npx", "args": ["x"]}'})
        )
        key = scan["sources"][0]["candidates"][0]["key"]
        now[0] = 601.0
        late = await client.call(
            "mcp.import.apply",
            {"scan_id": scan["scan_id"], "picks": [{"key": key, "name": "x"}]},
        )
        assert error_code(late) == INVALID_PARAMS
        assert "expired" in json.dumps(late)
    finally:
        await client.close()
        await stop_daemon(app, task)
