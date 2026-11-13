"""The MCP catalog: every entry validates, ``mcp.catalog``, and the catalog form of ``mcp.add``."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, cast

import pytest
from fakes import ToolCallingChatModel
from test_server import HELLO, RpcClient, error_code, rpc_result, start_daemon, stop_daemon

from golem.config import McpServerSettings
from golem.mcp.catalog import (
    CatalogEntry,
    CatalogError,
    build,
    find_entry,
    load_catalog,
    secret_ref,
)
from golem.mcp.catalog_check import package_of, validate
from golem.models.router import ModelRouter
from golem.secrets import MemorySecrets
from golem.server.dispatcher import INVALID_PARAMS


def _entry(**changes: object) -> CatalogEntry:
    base: dict[str, object] = {
        "id": "x",
        "name": "x",
        "title": "X",
        "description": "an x",
        "category": "other",
        "homepage": "https://example.test",
        "runtime": "npx",
        "auth": "none",
        "template": {"command": "npx", "args": ["-y", "pkg", "{input.folder}"]},
        "inputs": [{"id": "folder", "kind": "path", "label": "Folder", "default": "{folder}"}],
    }
    return CatalogEntry.model_validate({**base, **changes})


def test_every_entry_validates_with_sample_inputs() -> None:
    entries = load_catalog()
    assert validate(entries) == []
    assert len({entry.id for entry in entries}) == len(entries) >= 10
    starters = [entry.id for entry in entries if entry.starter]
    assert starters == ["fetch", "playwright", "context7"]
    assert all(entry.defaults.enabled == "on_demand" for entry in entries)


def test_the_check_fails_on_a_bad_template() -> None:
    bad = [
        _entry(template={"command": "npx", "args": ["{input.nope}"]}),
        _entry(id="y", name="y", template={"command": "uvx"}),
        _entry(id="z", name="z", template={"command": "npx", "args": ["{folder}", "{bogus}"]}),
        _entry(id="t", name="t", auth="token"),
    ]
    problems = validate(bad)
    assert "does not take" in problems[0]
    assert "runtime npx but the command is different" in problems[1]
    assert "{bogus}, which is not a placeholder" in problems[2]
    assert "auth token does not match" in problems[3]
    assert len(problems) == 5


def test_packages_are_found_in_the_templates() -> None:
    by_id = {entry.id: entry for entry in load_catalog()}
    assert package_of(by_id["filesystem"]) == "@modelcontextprotocol/server-filesystem"
    assert package_of(by_id["fetch"]) == "mcp-server-fetch"
    assert package_of(by_id["playwright"]) == "@playwright/mcp"
    assert package_of(by_id["github"]) is None


def test_substitution_fills_folder_name_inputs_and_secrets() -> None:
    entry = _entry(
        template={
            "command": "npx",
            "args": ["-y", "pkg", "{input.folder}", "--as", "{name}"],
            "env": {"API_KEY": "{secret.token}"},
        },
        inputs=[
            {"id": "folder", "kind": "path", "label": "Folder", "default": "{folder}"},
            {"id": "token", "kind": "secret", "label": "Key"},
        ],
        auth="token",
    )
    table, store = build(entry, {}, {"token": "abc"}, folder="/work")
    assert table == {
        "command": "npx",
        "args": ["-y", "pkg", "/work", "--as", "x"],
        "env": {"API_KEY": "keychain:mcp/x"},
        "enabled": "on_demand",
    }
    assert store == {"mcp/x": "abc"}
    table, _ = build(entry, {"folder": "/typed"}, {"token": "abc"}, name="second", folder="/work")
    assert table["args"][2] == "/typed" and table["args"][4] == "second"
    assert table["env"] == {"API_KEY": "keychain:mcp/second"}
    assert secret_ref("x", "token") == "mcp/x" and secret_ref("x", "pat") == "mcp/x-pat"


def test_substitution_refuses_what_is_missing_or_wrong() -> None:
    entry = _entry(
        inputs=[
            {"id": "folder", "kind": "path", "label": "Folder"},
            {
                "id": "mode",
                "kind": "choice",
                "label": "Mode",
                "choices": ["a", "b"],
                "required": False,
            },
            {"id": "token", "kind": "secret", "label": "Key"},
        ],
        template={"command": "npx", "args": ["{input.folder}", "{input.mode}"]},
    )
    with pytest.raises(CatalogError, match="Folder is required"):
        build(entry, {}, {"token": "t"})
    with pytest.raises(CatalogError, match="Key is required"):
        build(entry, {"folder": "/a"}, {})
    with pytest.raises(CatalogError, match="must be one of a, b"):
        build(entry, {"folder": "/a", "mode": "c"}, {"token": "t"})
    with pytest.raises(CatalogError, match="has no input nope"):
        build(entry, {"folder": "/a", "nope": "1"}, {"token": "t"})
    with pytest.raises(CatalogError, match="is a secret"):
        build(entry, {"folder": "/a", "token": "t"}, {})
    with pytest.raises(CatalogError, match="not a secret"):
        build(entry, {"folder": "/a"}, {"token": "t", "folder": "/b"})
    folderless = _entry()
    with pytest.raises(CatalogError, match="needs a folder"):
        build(folderless, {}, {})


async def _daemon(home: Path, secrets: MemorySecrets | None = None):
    app, task = await start_daemon(
        home, router=ModelRouter(model=ToolCallingChatModel(replies=[])), secrets=secrets
    )
    client = await RpcClient.connect(app.paths.socket_path)
    await client.call("hello", HELLO)
    return app, task, client


async def test_the_catalog_says_what_is_missing_and_what_is_added(
    short_home: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def has_command(_self: object, program: str) -> bool:
        return program == "uvx"

    monkeypatch.setattr("golem.mcp.supervisor.McpSupervisor.has_command", has_command)
    (short_home / "config.toml").write_text(
        '[mcp.fetch]\ncommand = "uvx"\nargs = ["mcp-server-fetch"]\nenabled = false\n',
        encoding="utf-8",
    )
    app, task, client = await _daemon(short_home)
    try:
        listed = rpc_result(await client.call("mcp.catalog", {}))
        entries = {e["id"]: e for e in cast(list[dict[str, object]], listed["entries"])}
        assert list(entries)[:3] == ["filesystem", "fetch", "git"]
        assert entries["filesystem"]["missing"] == "node"
        assert entries["fetch"]["missing"] is None and entries["fetch"]["added"] is True
        assert entries["github"]["missing"] is None and entries["github"]["added"] is False
        assert all(entry["available"] is True for entry in entries.values())
        assert entries["github"]["inputs"] == [
            {
                "id": "token",
                "kind": "secret",
                "label": "GitHub token",
                "hint": entries["github"]["inputs"][0]["hint"],  # type: ignore[index]
                "default": None,
                "choices": [],
                "required": True,
            }
        ]
        assert "template" not in entries["fetch"]
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_add_from_the_catalog_fills_the_template_and_stores_the_secret(
    short_home: Path, tmp_path: Path
) -> None:
    secrets = MemorySecrets()
    folder = tmp_path / "proj"
    folder.mkdir()
    app, task, client = await _daemon(short_home, secrets)
    try:
        created = rpc_result(await client.call("session.create", {"cwd": str(folder)}))
        session_id = str(created["session_id"])
        added = rpc_result(
            await client.call(
                "mcp.add",
                {"name": "filesystem", "catalog_id": "filesystem", "session_id": session_id},
            )
        )
        assert (added["name"], added["state"]) == ("filesystem", "idle")
        assert added["on_demand"] is True
        text = (short_home / "config.toml").read_text(encoding="utf-8")
        assert f'"{folder.resolve()}"' in text or f'"{folder}"' in text
        assert 'enabled = "on_demand"' in text

        github = {
            "name": "github",
            "catalog_id": "github",
            "secrets": {"token": "ghp-secret"},
        }
        response = await client.call("mcp.add", github)
        rpc_result(response)
        assert secrets.secrets == {"mcp/github": "ghp-secret"}
        text = (short_home / "config.toml").read_text(encoding="utf-8")
        assert "Bearer keychain:mcp/github" in text and "ghp-secret" not in text
        assert "ghp-secret" not in json.dumps(response)

        listed = rpc_result(await client.call("mcp.catalog", {}))
        entries = {e["id"]: e for e in cast(list[dict[str, object]], listed["entries"])}
        assert entries["github"]["added"] is True and entries["filesystem"]["added"] is True
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_add_from_the_catalog_refuses_what_does_not_fit(short_home: Path) -> None:
    secrets = MemorySecrets()
    app, task, client = await _daemon(short_home, secrets)
    try:

        async def code(params: dict[str, Any]) -> int | None:
            return error_code(await client.call("mcp.add", params))

        assert await code({"name": "x", "catalog_id": "nope"}) == INVALID_PARAMS
        assert await code({"name": "github", "catalog_id": "github"}) == INVALID_PARAMS
        assert await code({"name": "filesystem", "catalog_id": "filesystem"}) == INVALID_PARAMS
        mixed = {"name": "x", "catalog_id": "fetch", "url": "http://x.test"}
        assert await code(mixed) == INVALID_PARAMS
        assert await code({"name": "x", "inputs": {"a": "b"}}) == INVALID_PARAMS
        assert (
            await code({"name": "x", "catalog_id": "fetch", "inputs": {"a": "b"}}) == INVALID_PARAMS
        )
        assert not (short_home / "config.toml").exists() and secrets.secrets == {}
        rpc_result(await client.call("mcp.add", {"name": "fetch", "catalog_id": "fetch"}))
        assert await code({"name": "fetch", "catalog_id": "fetch"}) == INVALID_PARAMS
        assert find_entry("fetch") is not None
    finally:
        await client.close()
        await stop_daemon(app, task)


def test_the_entries_that_sign_in_are_offered_and_need_no_secret() -> None:
    signs_in = [entry for entry in load_catalog() if entry.auth == "oauth"]
    assert {entry.id for entry in signs_in} >= {"linear", "sentry", "notion"}
    for entry in signs_in:
        table, stored = build(entry, {}, {})
        assert table["oauth"] == {} and str(table["url"]).startswith("https://")
        assert stored == {}
        settings = McpServerSettings.model_validate(table)
        assert settings.oauth is not None and settings.oauth.client_id is None
