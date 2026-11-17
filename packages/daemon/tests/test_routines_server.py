"""The routine.* methods over the daemon's socket."""

from __future__ import annotations

import asyncio
from datetime import datetime
from pathlib import Path
from typing import cast
from zoneinfo import ZoneInfo

from fakes import ToolCallingChatModel
from test_server import HELLO, RpcClient, error_code, rpc_result, start_daemon, stop_daemon

from golem.models.router import ModelRouter
from golem.server.dispatcher import INVALID_PARAMS

NOW = datetime(2026, 2, 6, 9, 0, tzinfo=ZoneInfo("Europe/Prague"))  # a Friday
BRIEF = (
    '[[routine]]\nname = "morning-brief"\nschedule = "weekdays 08:30"\nprompt = "/brief"\n'
    'folder = "~/work"\n'
)
PROJECT = '[[routine]]\nname = "nightly"\nschedule = "daily 02:00"\nprompt = "Run the checks."\n'

Rows = list[dict[str, object]]


def _routines(result: dict[str, object]) -> Rows:
    return cast(Rows, result["routines"])


async def test_list_returns_the_morning_brief_with_its_next_time(short_home: Path) -> None:
    (short_home / "config.toml").write_text(BRIEF, encoding="utf-8")
    app, task = await start_daemon(short_home)
    app.state.clock = lambda: NOW
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        (row,) = _routines(rpc_result(await client.call("routine.list", {})))
        assert row["source"] == "user" and row["folder"] is None
        assert row["next_at"] == "2026-02-09T08:30:00+01:00"  # Monday
        assert (row["last"], row["paused"], row["blocked"]) == (None, False, False)
        config = cast(dict[str, object], row["config"])
        assert (config["name"], config["schedule"], config["missed"]) == (
            "morning-brief",
            "weekdays 08:30",
            "skip",
        )
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_project_routine_is_listed_blocked_until_the_folder_is_trusted(
    short_home: Path, tmp_path: Path
) -> None:
    project = (tmp_path / "proj").resolve()
    (project / ".golem").mkdir(parents=True)
    (project / ".golem" / "config.toml").write_text(PROJECT, encoding="utf-8")
    app, task = await start_daemon(short_home)
    app.state.clock = lambda: NOW
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        params = {"folders": [str(project)]}
        (row,) = _routines(rpc_result(await client.call("routine.list", params)))
        assert (row["source"], row["folder"], row["blocked"]) == ("project", str(project), True)
        assert row["next_at"] is None

        # Without the folder, nothing of it is looked at.
        assert _routines(rpc_result(await client.call("routine.list", {}))) == []

        (short_home / "config.toml").write_text(
            f'trusted_projects = ["{project}"]\n', encoding="utf-8"
        )
        (row,) = _routines(rpc_result(await client.call("routine.list", params)))
        assert row["blocked"] is False
        assert row["next_at"] == "2026-02-07T02:00:00+01:00"

        got = rpc_result(
            await client.call("routine.get", {"name": "nightly", "folder": str(project)})
        )
        assert got["runs"] == []
        assert error_code(await client.call("routine.get", {"name": "nightly"})) == INVALID_PARAMS
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_update_and_remove_edit_the_users_file_and_tell_watchers(short_home: Path) -> None:
    path = short_home / "config.toml"
    path.write_text("# mine\n" + BRIEF, encoding="utf-8")
    app, task = await start_daemon(short_home)
    app.state.clock = lambda: NOW
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        result = rpc_result(
            await client.call(
                "routine.update",
                {
                    "name": "morning-brief",
                    "fields": {"schedule": "daily 07:00", "missed": "run_once"},
                },
            )
        )
        assert cast(dict[str, object], result["routine"])["next_at"] == "2026-02-07T07:00:00+01:00"
        assert "# mine" in path.read_text(encoding="utf-8")

        await client.call(
            "routine.update",
            {"name": "morning-brief", "fields": {"enabled": False}},
        )
        assert "enabled = false" in path.read_text(encoding="utf-8")
        listed = _routines(rpc_result(await client.call("routine.list", {})))
        assert listed[0]["next_at"] is None

        await client.call(
            "routine.update",
            {
                "name": "weekly",
                "create": True,
                "fields": {"schedule": "weekly mon 06:00", "prompt": "Report."},
            },
        )
        assert len(_routines(rpc_result(await client.call("routine.list", {})))) == 2
        await client.call("routine.remove", {"name": "weekly"})
        assert len(_routines(rpc_result(await client.call("routine.list", {})))) == 1

        await client.take_events()
        changes = [
            cast(dict[str, object], n["params"])
            for n in client.notices
            if n.get("method") == "routine.changed"
        ]
        assert [(c["name"], c["change"]) for c in changes] == [
            ("morning-brief", "updated"),
            ("morning-brief", "updated"),
            ("weekly", "added"),
            ("weekly", "removed"),
        ]
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_update_refuses_what_is_wrong_and_a_project_routine(short_home: Path) -> None:
    (short_home / "config.toml").write_text(BRIEF, encoding="utf-8")
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        bad: list[tuple[str, dict[str, object]]] = [
            ("routine.update", {"name": "morning-brief", "fields": {"on": {"watch": "~"}}}),
            ("routine.update", {"name": "morning-brief", "fields": {"schedule": "every 7m"}}),
            ("routine.update", {"name": "morning-brief", "fields": {"token": "x"}}),
            ("routine.update", {"name": "nope", "fields": {"enabled": False}}),
            ("routine.update", {"name": "morning-brief", "fields": {}, "folder": "/p"}),
            (
                "routine.update",
                {
                    "name": "morning-brief",
                    "create": True,
                    "fields": {"prompt": "p", "schedule": "daily 08:30"},
                },
            ),
            ("routine.remove", {"name": "morning-brief", "folder": "/p"}),
            ("routine.remove", {"name": "nope"}),
        ]
        for method, params in bad:
            assert error_code(await client.call(method, params)) == INVALID_PARAMS, (method, params)
        assert "weekdays 08:30" in (short_home / "config.toml").read_text(encoding="utf-8")
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_preview_gives_the_next_three_times_or_the_reason_a_schedule_is_wrong(
    short_home: Path,
) -> None:
    app, task = await start_daemon(short_home)
    app.state.clock = lambda: NOW
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        got = rpc_result(await client.call("routine.preview", {"schedule": "weekdays 08:30"}))
        assert got["next"] == [
            "2026-02-09T08:30:00+01:00",
            "2026-02-10T08:30:00+01:00",
            "2026-02-11T08:30:00+01:00",
        ]
        cron = rpc_result(await client.call("routine.preview", {"schedule": "0 17 * * 5"}))
        assert cron["next"] == [
            "2026-02-06T17:00:00+01:00",
            "2026-02-13T17:00:00+01:00",
            "2026-02-20T17:00:00+01:00",
        ]
        for bad in ("every 7m", "61 * * * *", "", "soon"):
            reply = await client.call("routine.preview", {"schedule": bad})
            assert error_code(reply) == INVALID_PARAMS, bad
        error = cast(dict[str, object], reply["error"])
        assert "not a schedule" in str(error["message"])
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_run_fires_a_headless_session_and_get_lists_the_firing(short_home: Path) -> None:
    (short_home / "config.toml").write_text(
        BRIEF.replace('folder = "~/work"\n', "").replace("/brief", "Brief me."), "utf-8"
    )
    router = ModelRouter(model=ToolCallingChatModel(replies=["Three PRs need you."]))
    app, task = await start_daemon(short_home, router=router)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        run = rpc_result(await client.call("routine.run", {"name": "morning-brief"}))
        session_id = run["session_id"]

        sessions = rpc_result(await client.call("session.list", {}))["sessions"]
        (summary,) = [s for s in cast(Rows, sessions) if s["session_id"] == session_id]
        assert summary["origin"] == "routine:morning-brief"

        async with asyncio.timeout(5):
            while True:
                got = rpc_result(await client.call("routine.get", {"name": "morning-brief"}))
                (row,) = cast(Rows, got["runs"])
                if row["status"] != "running":
                    break
                await asyncio.sleep(0.02)
        assert (row["routine_run_id"], row["trigger"], row["status"]) == (
            run["routine_run_id"],
            "manual",
            "succeeded",
        )
        assert row["summary"] == "Three PRs need you."
        last = cast(dict[str, object], cast(dict[str, object], got["routine"])["last"])
        assert last["routine_run_id"] == run["routine_run_id"]

        await client.take_events()
        methods = [n.get("method") for n in client.notices]
        assert "routine.fired" in methods and "routine.finished" in methods

        assert error_code(await client.call("routine.run", {"name": "nope"})) == INVALID_PARAMS
    finally:
        await client.close()
        await stop_daemon(app, task)
