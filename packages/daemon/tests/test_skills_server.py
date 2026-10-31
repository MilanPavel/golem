"""skill.list over the daemon's socket: a folder's project skills, the user's, and broken ones."""

from __future__ import annotations

from pathlib import Path
from typing import cast

from fakes import ScriptedChatModel
from test_server import HELLO, RpcClient, error_code, rpc_result, start_daemon, stop_daemon

from golem.models.router import ModelRouter
from golem.server.dispatcher import INVALID_PARAMS, SKILL_NOT_FOUND

REPO = Path(__file__).resolve().parents[3]


def _skill(parent: Path, name: str, frontmatter: str) -> None:
    folder = parent / name
    folder.mkdir(parents=True)
    (folder / "SKILL.md").write_text(f"---\n{frontmatter}---\nBody\n", encoding="utf-8")


async def _listed(client: RpcClient, params: dict[str, object]) -> list[dict[str, object]]:
    result = rpc_result(await client.call("skill.list", params))
    return cast(list[dict[str, object]], result["skills"])


async def test_skill_list_shows_a_folders_skills_and_the_users(short_home: Path) -> None:
    _skill(short_home / "skills", "notes", "description: Write notes.\nargument-hint: [topic]\n")
    _skill(short_home / "skills", "ship", "description: My own ship.\n")
    _skill(short_home / ".claude" / "skills", "broken", "description: [unclosed\n")
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)

        listed = await _listed(client, {"cwd": str(REPO)})
        rows = [(s["name"], s["source"], s["usable"]) for s in listed]
        assert rows == [
            ("setup", "project", True),
            ("ship", "project", True),
            ("notes", "user", True),
            ("ship", "user", False),
            ("broken", "user", False),
        ]
        mine = listed[3]
        assert mine["shadowed_by"] == str(REPO / ".agents" / "skills" / "ship")
        assert listed[2]["argument_hint"] == "[topic]"
        assert listed[4]["errors"] != []

        users = await _listed(client, {})
        assert [(s["name"], s["usable"]) for s in users] == [
            ("notes", True),
            ("ship", True),
            ("broken", False),
        ]
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_skill_list_refuses_a_relative_folder(short_home: Path) -> None:
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)

        assert error_code(await client.call("skill.list", {"cwd": "relative"})) == INVALID_PARAMS
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_message_send_runs_a_skill_and_refuses_an_unknown_one(short_home: Path) -> None:
    _skill(short_home / "skills", "notes", "description: Write notes.\n")
    model = ScriptedChatModel(replies=["Noted."])
    app, task = await start_daemon(short_home, router=ModelRouter(model=model))
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        created = rpc_result(await client.call("session.create", {}))
        send = {"session_id": created["session_id"], "text": "/notes on skills"}

        unknown = await client.call("message.send", {**send, "skill": {"name": "nope"}})
        sent = await client.call(
            "message.send", {**send, "skill": {"name": "notes", "args": "on skills"}}
        )

        assert error_code(unknown) == SKILL_NOT_FOUND
        assert "run_id" in rpc_result(sent)
    finally:
        await client.close()
        await stop_daemon(app, task)
