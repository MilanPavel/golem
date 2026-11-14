"""skill.read, skill.write, skill.create and skill.set_disabled over the daemon's socket."""

from __future__ import annotations

from pathlib import Path
from typing import cast

from test_server import HELLO, RpcClient, error_code, rpc_result, start_daemon, stop_daemon

from golem.server.dispatcher import INVALID_PARAMS, SKILL_NOT_FOUND
from golem_protocol.methods import BROWSER_METHODS


def _skill(parent: Path, name: str, description: str = "Write notes.") -> Path:
    folder = parent / name
    folder.mkdir(parents=True)
    file = folder / "SKILL.md"
    file.write_text(f"---\ndescription: {description}\n---\nBody\n", encoding="utf-8")
    return file


async def _listed(
    client: RpcClient, params: dict[str, object] | None = None
) -> list[dict[str, object]]:
    result = rpc_result(await client.call("skill.list", params or {}))
    return cast(list[dict[str, object]], result["skills"])


async def _changed(client: RpcClient) -> int:
    await client.take_events()
    return sum(1 for notice in client.notices if notice.get("method") == "skill.registry.changed")


async def test_read_then_write_lists_the_new_description_and_announces_once(
    short_home: Path,
) -> None:
    file = _skill(short_home / "skills", "notes")
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        read = rpc_result(await client.call("skill.read", {"name": "notes"}))
        assert read["path"] == str(file)
        assert read["source"] == "user"
        assert "Write notes." in str(read["text"])

        text = str(read["text"]).replace("Write notes.", "Take better notes.")
        written = rpc_result(
            await client.call(
                "skill.write", {"path": str(file), "text": text, "base_mtime_ns": read["mtime_ns"]}
            )
        )
        assert written["ok"] is True and written["written"] is True
        assert written["errors"] == []
        assert [s["description"] for s in await _listed(client)] == ["Take better notes."]
        assert await _changed(client) == 1
        again = rpc_result(await client.call("skill.read", {"name": "notes"}))
        assert again["mtime_ns"] == written["mtime_ns"]
        assert error_code(await client.call("skill.read", {"name": "nope"})) == SKILL_NOT_FOUND
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_stale_mtime_is_refused_and_the_file_is_unchanged(short_home: Path) -> None:
    file = _skill(short_home / "skills", "notes")
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        read = rpc_result(await client.call("skill.read", {"name": "notes"}))
        before = file.read_text(encoding="utf-8")
        stale = cast(int, read["mtime_ns"]) - 1

        result = rpc_result(
            await client.call(
                "skill.write", {"path": str(file), "text": "x", "base_mtime_ns": stale}
            )
        )

        assert result["ok"] is False and result["written"] is False
        assert file.read_text(encoding="utf-8") == before
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_broken_frontmatter_reports_the_line_and_is_written_when_asked(
    short_home: Path,
) -> None:
    file = _skill(short_home / "skills", "notes")
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        read = rpc_result(await client.call("skill.read", {"name": "notes"}))
        broken = "---\nname: notes\ndescription: [unclosed\n---\nBody\n"
        params = {"path": str(file), "text": broken, "base_mtime_ns": read["mtime_ns"]}

        dry = rpc_result(await client.call("skill.write", {**params, "dry_run": True}))
        errors = cast(list[dict[str, object]], dry["errors"])
        assert dry["written"] is False
        assert errors and errors[0]["line"] is not None
        assert file.read_text(encoding="utf-8") != broken

        saved = rpc_result(await client.call("skill.write", params))
        assert saved["written"] is True and saved["errors"] != []
        row = (await _listed(client))[0]
        assert row["usable"] is False and row["errors"] != []
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_bad_field_reports_its_line(short_home: Path) -> None:
    file = _skill(short_home / "skills", "notes")
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        read = rpc_result(await client.call("skill.read", {"name": "notes"}))
        text = "---\ndescription: Notes.\nuser-invocable: maybe\n---\n"
        result = rpc_result(
            await client.call(
                "skill.write",
                {
                    "path": str(file),
                    "text": text,
                    "base_mtime_ns": read["mtime_ns"],
                    "dry_run": True,
                },
            )
        )
        assert result["errors"] == [
            {"line": 3, "message": "`user-invocable` must be true or false"}
        ]
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_writes_outside_the_listed_folders_are_refused(short_home: Path) -> None:
    _skill(short_home / "skills", "notes")
    outside = _skill(short_home / "elsewhere", "stray")
    real = _skill(short_home / "real", "linked")
    (short_home / "skills" / "linked").symlink_to(real.parent)
    link_file = _skill(short_home / "skills", "filelink")
    link_file.unlink()
    link_file.symlink_to(outside)
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)

        async def write(path: Path) -> dict[str, object]:
            return await client.call(
                "skill.write", {"path": str(path), "text": "x", "base_mtime_ns": 1}
            )

        linked = short_home / "skills" / "linked" / "SKILL.md"
        assert error_code(await write(outside)) == INVALID_PARAMS
        assert error_code(await write(linked)) == INVALID_PARAMS
        assert error_code(await write(link_file)) == INVALID_PARAMS
        assert error_code(await write(linked.with_name("other.md"))) == INVALID_PARAMS
        assert "Body" in outside.read_text(encoding="utf-8")
        assert "Body" in real.read_text(encoding="utf-8")
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_bundled_skill_is_read_only(short_home: Path) -> None:
    bundled = _skill(short_home / "bundled-src", "builtin")
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        registry = app.state.skills
        assert registry is not None
        registry._bundled = bundled.parent.parent  # pyright: ignore[reportPrivateUsage]
        result = await client.call(
            "skill.write", {"path": str(bundled), "text": "x", "base_mtime_ns": 1}
        )
        assert error_code(result) == INVALID_PARAMS
        assert "bundled" in str(result["error"])
        assert "Body" in bundled.read_text(encoding="utf-8")
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_create_in_both_scopes_and_refuse_a_taken_or_bad_name(short_home: Path) -> None:
    project = short_home / "project"
    project.mkdir()
    (short_home / "config.toml").write_text(
        f'trusted_projects = ["{project.resolve()}"]\n', encoding="utf-8"
    )
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        user = rpc_result(
            await client.call(
                "skill.create",
                {
                    "name": "mine",
                    "scope": "user",
                    "description": "Does: a thing",
                    "model_invocable": False,
                },
            )
        )
        assert user["path"] == str(short_home / "skills" / "mine" / "SKILL.md")
        mine = (await _listed(client))[0]
        assert mine["usable"] is True and mine["model_invocable"] is False
        assert mine["description"] == "Does: a thing"

        made = rpc_result(
            await client.call(
                "skill.create",
                {"name": "ours", "scope": "project", "cwd": str(project), "description": "Ours."},
            )
        )
        assert made["path"] == str(project / ".agents" / "skills" / "ours" / "SKILL.md")
        listed = await _listed(client, {"cwd": str(project)})
        assert [(s["name"], s["source"]) for s in listed] == [("ours", "project"), ("mine", "user")]

        again = {"name": "mine", "scope": "user", "description": "x"}
        assert error_code(await client.call("skill.create", again)) == INVALID_PARAMS
        for bad in ("Bad Name", "-x", "a--b", "x" * 65):
            params = {"name": bad, "scope": "user", "description": "x"}
            assert error_code(await client.call("skill.create", params)) == INVALID_PARAMS
        no_cwd = {"name": "p", "scope": "project", "description": "x"}
        assert error_code(await client.call("skill.create", no_cwd)) == INVALID_PARAMS
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_an_untrusted_project_is_written_only_by_the_protected_methods(
    short_home: Path,
) -> None:
    project = short_home / "project"
    file = _skill(project / ".agents" / "skills", "ours")
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        read = rpc_result(await client.call("skill.read", {"name": "ours", "cwd": str(project)}))
        assert read["source"] == "project"
        write = {
            "path": str(file),
            "text": "---\ndescription: New.\n---\n",
            "base_mtime_ns": read["mtime_ns"],
            "cwd": str(project),
        }
        create = {"name": "more", "scope": "project", "cwd": str(project), "description": "More."}

        assert error_code(await client.call("skill.write", write)) == INVALID_PARAMS
        assert error_code(await client.call("skill.create", create)) == INVALID_PARAMS
        assert "Write notes." in file.read_text(encoding="utf-8")

        assert rpc_result(await client.call("skill.write_protected", write))["written"] is True
        rpc_result(await client.call("skill.create_protected", create))
        assert (project / ".agents" / "skills" / "more" / "SKILL.md").is_file()
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_disable_and_enable_keep_a_comment_in_config_toml(short_home: Path) -> None:
    _skill(short_home / "skills", "notes")
    config = short_home / "config.toml"
    config.write_text('# my settings\nlog_level = "info"\n', encoding="utf-8")
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        rpc_result(await client.call("skill.set_disabled", {"name": "notes", "disabled": True}))
        assert "# my settings" in config.read_text(encoding="utf-8")
        assert 'disabled = ["notes"]' in config.read_text(encoding="utf-8")
        row = (await _listed(client))[0]
        assert row["disabled"] is True and row["usable"] is False
        assert await _changed(client) == 1

        rpc_result(await client.call("skill.set_disabled", {"name": "notes", "disabled": False}))
        text = config.read_text(encoding="utf-8")
        assert "# my settings" in text and "skills" not in text
        assert (await _listed(client))[0]["disabled"] is False
    finally:
        await client.close()
        await stop_daemon(app, task)


def test_the_browser_may_call_the_skill_methods_but_not_the_protected_ones() -> None:
    for method in ("skill.read", "skill.write", "skill.create", "skill.set_disabled"):
        assert method in BROWSER_METHODS
    for method in ("skill.write_protected", "skill.create_protected"):
        assert method not in BROWSER_METHODS
