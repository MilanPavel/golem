"""The memory.* methods over the daemon's socket (ADR-061)."""

from __future__ import annotations

import json
import sqlite3
import tomllib
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from dataclasses import replace
from pathlib import Path
from typing import Any, cast

from test_server import HELLO, RpcClient, error_code, rpc_result, start_daemon, stop_daemon

from golem.models.discovery import ModelDiscovery
from golem.server.app import DaemonApp
from golem.server.dispatcher import INVALID_PARAMS
from golem_protocol.commands import ListedModel


@asynccontextmanager
async def _daemon(home: Path) -> AsyncGenerator[tuple[DaemonApp, RpcClient]]:
    app, task = await start_daemon(home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        yield app, client
    finally:
        await client.close()
        await stop_daemon(app, task)


async def _write(client: RpcClient, text: str, **extra: object) -> dict[str, Any]:
    params: dict[str, object] = {"scope": "you", "text": text, **extra}
    return cast(dict[str, Any], rpc_result(await client.call("memory.write", params))["item"])


async def _ids(client: RpcClient, **params: object) -> list[object]:
    result = rpc_result(await client.call("memory.list", dict(params)))
    return [item["id"] for item in cast(list[dict[str, object]], result["items"])]


async def test_a_write_by_the_browser_is_kept_and_by_you(short_home: Path) -> None:
    async with _daemon(short_home) as (_, client):
        item = await _write(client, "Use pnpm.\nNot npm.")
        assert (item["author"], item["state"], item["kept_by"]) == ("you", "kept", "you")
        assert item["title"] == "Use pnpm."
        assert item["usable"] is None
        got = rpc_result(await client.call("memory.get", {"id": item["id"]}))
        assert got["item"] == item


async def test_errors_are_invalid_params_with_a_reason(short_home: Path) -> None:
    async with _daemon(short_home) as (_, client):
        missing = await client.call("memory.get", {"id": "m_nope"})
        assert error_code(missing) == INVALID_PARAMS
        assert "m_nope" in str(missing["error"])
        blank = await client.call("memory.write", {"scope": "you", "text": "   "})
        assert error_code(blank) == INVALID_PARAMS
        assert "some text" in str(blank["error"])
        edit = await client.call("memory.update", {"id": "m_nope", "text": "x"})
        assert error_code(edit) == INVALID_PARAMS
        nothing = await client.call("memory.update", {"id": "m_nope"})
        assert error_code(nothing) == INVALID_PARAMS
        gone = await client.call("memory.write", {"scope": "you", "text": "a", "sources": ["/no"]})
        assert error_code(gone) == INVALID_PARAMS
        assert "cannot read the source" in str(gone["error"])
        device = await client.call(
            "memory.write", {"scope": "you", "text": "a", "sources": ["/dev/null"]}
        )
        assert error_code(device) == INVALID_PARAMS
        assert "is not a file" in str(device["error"])


async def test_list_filters_pages_and_counts(short_home: Path) -> None:
    async with _daemon(short_home) as (_, client):
        first = await _write(client, "one retry rule")
        second = await _write(client, "two")
        third = await _write(client, "three", scope="project", folder=str(short_home))
        every = await _ids(client)
        assert set(every) == {first["id"], second["id"], third["id"]}
        page = rpc_result(await client.call("memory.list", {"limit": 2}))
        assert len(cast(list[object], page["items"])) == 2 and page["total"] == 3
        assert page["counts"] == {
            "you": 2,
            "project": 1,
            "history": 0,
            "proposed": 0,
            "kept": 3,
            "stale": 0,
        }
        assert await _ids(client, limit=2, after=every[1]) == every[2:]
        assert await _ids(client, scope="project") == [third["id"]]
        assert await _ids(client, folder=str(short_home)) == [third["id"]]
        assert await _ids(client, query="retries") == [first["id"]]
        assert await _ids(client, query="retries", state="stale") == []
        found = await _ids(client, query="one two three")
        assert set(found) == set(every)
        assert await _ids(client, query="one two three", limit=1, after=found[0]) == found[1:2]


async def test_update_edits_and_always_is_yours(short_home: Path) -> None:
    async with _daemon(short_home) as (app, client):
        item = await _write(client, "old text")
        result = rpc_result(
            await client.call(
                "memory.update",
                {"id": item["id"], "text": "new text", "privacy": "local", "always": True},
            )
        )
        edited = cast(dict[str, Any], result["item"])
        assert (edited["text"], edited["privacy"], edited["always"]) == ("new text", "local", True)
        assert edited["title"] == "new text"
        # A proposal by the lead cannot be always until you keep it.
        assert app.state.memory is not None
        proposed = await app.state.memory.remember("a fact", "you", "no such quote", "hello")
        assert proposed is not None and proposed.state == "proposed"
        refused = await client.call("memory.update", {"id": proposed.id, "always": True})
        assert error_code(refused) == INVALID_PARAMS
        assert "you wrote or kept" in str(refused["error"])


async def test_a_stale_note_is_accepted_with_its_sources_hashed_again(short_home: Path) -> None:
    folder = short_home / "app"
    folder.mkdir()
    (folder / "client.py").write_text("one\n", "utf-8")
    async with _daemon(short_home) as (app, client):
        item = await _write(
            client, "client is thin", scope="project", folder=str(folder), sources=["client.py"]
        )
        [source] = cast(list[dict[str, Any]], item["sources"])
        assert source["path"] == "client.py" and source["size"] == 4
        assert app.state.memory is not None
        store = app.state.memory.store
        row = await store.get(item["id"])
        assert row is not None
        await store.update(replace(row, state="stale"))
        (folder / "client.py").write_text("two lines\nhere\n", "utf-8")
        accepted = rpc_result(
            await client.call("memory.update", {"id": item["id"], "accept_sources": True})
        )
        new = cast(dict[str, Any], accepted["item"])
        assert new["state"] == "kept"
        [again] = new["sources"]
        assert again["size"] == 15 and again["sha256"] != source["sha256"]


async def test_delete_removes_the_row_its_sources_and_its_search_entry(short_home: Path) -> None:
    folder = short_home / "app"
    folder.mkdir()
    (folder / "a.py").write_text("x", "utf-8")
    async with _daemon(short_home) as (app, client):
        gone = await _write(
            client, "zebra stripes", scope="project", folder=str(folder), sources=["a.py"]
        )
        kept = await _write(client, "zebra herd")
        done = rpc_result(await client.call("memory.delete", {"ids": [gone["id"], "m_none"]}))
        assert done == {"deleted": [gone["id"]], "missing": ["m_none"]}
        assert await _ids(client) == [kept["id"]]
        assert error_code(await client.call("memory.get", {"id": gone["id"]})) == INVALID_PARAMS
        assert await _ids(client, query="stripes") == []
        assert app.state.memory is not None
        db = sqlite3.connect(app.paths.memory_file)
        try:
            marks = (gone["id"],)
            assert db.execute("SELECT 1 FROM memories WHERE id = ?", marks).fetchall() == []
            sources = db.execute("SELECT 1 FROM memory_sources WHERE memory_id = ?", marks)
            assert sources.fetchall() == []
            if app.state.memory.store.search_kind == "fts":
                fts = db.execute("SELECT 1 FROM memory_fts WHERE memory_fts MATCH 'stripes'")
                assert fts.fetchall() == []
        finally:
            db.close()


async def test_every_connection_hears_memory_changed(short_home: Path) -> None:
    async with _daemon(short_home) as (app, client):
        other = await RpcClient.connect(app.paths.socket_path)
        try:
            await other.call("hello", HELLO)
            item = await _write(client, "a note")
            await client.call("memory.update", {"id": item["id"], "text": "a better note"})
            await client.call("memory.delete", {"ids": [item["id"]]})
            for each in (client, other):
                await each.take_events()
                heard = [n["params"] for n in each.notices if n.get("method") == "memory.changed"]
                assert heard == [
                    {"id": item["id"], "change": change, "scope": "you", "folder": None}
                    for change in ("created", "updated", "deleted")
                ]
        finally:
            await other.close()


async def test_export_markdown_and_json(short_home: Path) -> None:
    folder = short_home / "app"
    folder.mkdir()
    (folder / "a.py").write_text("x", "utf-8")
    async with _daemon(short_home) as (_, client):
        mine = await _write(client, "I like tea")
        project = await _write(
            client, "app note", scope="project", folder=str(folder), sources=["a.py"]
        )
        markdown = rpc_result(await client.call("memory.export", {"format": "markdown"}))
        assert markdown["count"] == 2
        text = str(markdown["text"])
        assert "## app note" in text and "- sources: a.py" in text and "- author: you" in text
        scoped = rpc_result(
            await client.call("memory.export", {"format": "json", "scope": "project"})
        )
        assert scoped["count"] == 1
        [row] = json.loads(str(scoped["text"]))
        assert row["id"] == project["id"] and row["sources"][0]["path"] == "a.py"
        assert mine["id"] not in str(scoped["text"])
        by_folder = rpc_result(
            await client.call("memory.export", {"format": "json", "folder": str(folder)})
        )
        assert by_folder["count"] == 1


async def test_settings_set_the_privacy_of_a_scope_in_the_file(short_home: Path) -> None:
    config = short_home / "config.toml"
    config.write_text('# mine\n[memory]\nauto_keep = ["/work"]  # keep\n', "utf-8")
    async with _daemon(short_home) as (_, client):
        read = rpc_result(await client.call("memory.settings", {}))
        assert cast(dict[str, object], read["settings"])["you"] == "chat"
        result = rpc_result(
            await client.call("memory.settings", {"scope": "project", "privacy": "local"})
        )
        settings = cast(dict[str, object], result["settings"])
        assert (settings["projects"], settings["auto_keep"]) == ("local", ["/work"])
        text = config.read_text("utf-8")
        assert "# mine" in text and "# keep" in text
        assert tomllib.loads(text)["memory"]["projects"] == "local"
        listed = rpc_result(await client.call("memory.list", {}))
        assert cast(dict[str, object], listed["settings"])["projects"] == "local"


async def test_settings_cannot_set_auto_keep(short_home: Path) -> None:
    config = short_home / "config.toml"
    config.write_text('[memory]\nyou = "chat"\n', "utf-8")
    before = config.read_text("utf-8")
    async with _daemon(short_home) as (_, client):
        for params in (
            {"auto_keep": ["/work"]},
            {"scope": "you", "privacy": "local", "auto_keep": ["/work"]},
        ):
            assert error_code(await client.call("memory.settings", params)) == INVALID_PARAMS
        assert config.read_text("utf-8") == before
        result = rpc_result(await client.call("memory.settings", {}))
        assert cast(dict[str, object], result["settings"])["auto_keep"] == []


def _model(ref: str, tier: str, status: str = "ready") -> ListedModel:
    fields: dict[str, Any] = {
        "ref": ref,
        "label": ref,
        "provider": ref.split("/")[0],
        "source": "installed",
        "status": status,
        "tier": tier,
    }
    return ListedModel(**fields)


class _Models:
    """The model list a handler reads."""

    def __init__(self, models: list[ListedModel]) -> None:
        self._models = models

    def cached(self) -> list[ListedModel]:
        return self._models


async def _usable(home: Path, models: list[ListedModel]) -> list[object]:
    async with _daemon(home) as (app, client):
        real = app.state.models
        app.state.models = cast(ModelDiscovery, _Models(models))
        try:
            await _write(client, "stays on this Mac", privacy="local")
            await _write(client, "goes anywhere")
            listed = rpc_result(await client.call("memory.list", {}))
        finally:
            app.state.models = real
        by_text = {i["text"]: i["usable"] for i in cast(list[dict[str, Any]], listed["items"])}
        assert by_text["goes anywhere"] is None
        return [by_text["stays on this Mac"]]


async def test_a_local_memory_is_not_usable_with_cloud_models_only(short_home: Path) -> None:
    cloud = [_model("anthropic/claude", "frontier"), _model("openai/gpt", "budget")]
    assert await _usable(short_home, cloud) == [False]


async def test_a_local_memory_is_usable_with_a_local_model(short_home: Path) -> None:
    assert await _usable(short_home, [_model("ollama/qwen", "local")]) == [True]


async def test_a_local_model_that_is_not_installed_does_not_make_it_usable(
    short_home: Path,
) -> None:
    models = [_model("ollama/qwen", "local", "not_installed")]
    assert await _usable(short_home, models) == [False]


async def test_with_memory_off_the_methods_say_so_but_settings_still_read(
    short_home: Path,
) -> None:
    (short_home / "config.toml").write_text("[memory]\nenabled = false\n", "utf-8")
    async with _daemon(short_home) as (_, client):
        for method, params in (
            ("memory.list", {}),
            ("memory.get", {"id": "m_x"}),
            ("memory.write", {"scope": "you", "text": "a"}),
            ("memory.export", {"format": "json"}),
        ):
            reply = await client.call(method, params)
            assert error_code(reply) == INVALID_PARAMS
            assert "memory is off" in str(reply["error"])
        assert "settings" in rpc_result(await client.call("memory.settings", {}))
