"""``[notifications]`` and the routine overrides: the settings, the notifier, and the RPCs."""

from __future__ import annotations

import tomllib
from pathlib import Path
from typing import Any

import pytest
from test_notifier import _completed, _failed, _Poster  # pyright: ignore[reportPrivateUsage]
from test_server import HELLO, RpcClient, rpc_result, start_daemon, stop_daemon

from golem.config import GolemSettings, NotificationSettings, load_settings
from golem.config_raw import check_text
from golem.notify import Notifier, SessionFacts
from golem.server.app import _notifier_kinds  # pyright: ignore[reportPrivateUsage]
from golem.sessions.bus import EventBus

ROUTINES = """
[[routine]]
name = "brief"
schedule = "daily 08:30"
prompt = "summarise"
notify_finished = true

[[routine]]
name = "noisy"
schedule = "every 15m"
prompt = "poll"
notify_failed = false
"""


def test_the_defaults() -> None:
    settings = GolemSettings().notifications
    assert (settings.needs_you, settings.failed, settings.finished) == (True, True, False)
    assert (settings.open_in, settings.terminal_app) == ("web", "Terminal")


def test_the_file_overrides_the_defaults(tmp_path: Path) -> None:
    text = 'failed = false\nfinished = true\nopen_in = "terminal"\nterminal_app = "Ghostty"\n'
    config = tmp_path / "config.toml"
    config.write_text("[notifications]\n" + text, "utf-8")
    settings = load_settings(home=tmp_path, project_dir=tmp_path).notifications
    assert (settings.failed, settings.finished) == (False, True)
    assert (settings.open_in, settings.terminal_app) == ("terminal", "Ghostty")


def test_an_unknown_terminal_app_is_an_error_with_its_line() -> None:
    text = '[notifications]\nfinished = true\nterminal_app = "Hyper"\n'
    [issue] = check_text(text, "").issues
    assert (issue.path, issue.line) == ("notifications.terminal_app", 3)


def test_needs_you_cannot_be_turned_off_and_the_error_has_its_line() -> None:
    with pytest.raises(ValueError, match="cannot be turned off"):
        NotificationSettings(needs_you=False)
    [issue] = check_text("[notifications]\n\nneeds_you = false\n", "").issues
    assert (issue.path, issue.line) == ("notifications.needs_you", 3)
    assert "cannot be turned off" in issue.message
    assert check_text("[notifications]\nneeds_you = true\n", "").issues == []


def _notifier(home: Path, origin: str) -> tuple[Notifier, EventBus, _Poster]:
    poster = _Poster()

    async def lookup(_session_id: str) -> SessionFacts | None:
        return SessionFacts(None, origin)

    bus = EventBus()
    notifier = Notifier(poster, lookup, bus.attached, _notifier_kinds(home))
    bus.observe(notifier.on_event)
    return notifier, bus, poster


async def _kinds_posted(home: Path, origin: str) -> list[str]:
    notifier, bus, poster = _notifier(home, origin)
    bus.publish(_completed())
    bus.publish(_failed())
    await notifier.drain()
    return [notice.kind for notice in poster.notices]


async def test_a_routine_can_turn_finished_on_when_the_global_is_off(tmp_path: Path) -> None:
    (tmp_path / "config.toml").write_text(ROUTINES, "utf-8")
    assert await _kinds_posted(tmp_path, "routine:brief") == ["finished", "failed"]
    # Another routine, and a chat of the CLI, follow the global setting.
    assert await _kinds_posted(tmp_path, "routine:noisy") == []
    assert await _kinds_posted(tmp_path, "cli") == ["failed"]


async def test_a_routine_can_turn_failed_off_when_the_global_is_on(tmp_path: Path) -> None:
    (tmp_path / "config.toml").write_text("[notifications]\nfinished = true\n" + ROUTINES, "utf-8")
    assert await _kinds_posted(tmp_path, "routine:noisy") == ["finished"]
    assert await _kinds_posted(tmp_path, "routine:brief") == ["finished", "failed"]


async def test_a_routine_with_notify_finished_false_stays_quiet_when_the_global_is_on(
    tmp_path: Path,
) -> None:
    text = "[notifications]\nfinished = true\n" + ROUTINES.replace(
        "notify_finished = true", "notify_finished = false"
    )
    (tmp_path / "config.toml").write_text(text, "utf-8")
    assert await _kinds_posted(tmp_path, "routine:brief") == ["failed"]


async def test_a_config_that_does_not_load_falls_back_to_the_defaults(tmp_path: Path) -> None:
    (tmp_path / "config.toml").write_text("[notifications]\nterminal_app = 'Hyper'\n", "utf-8")
    assert await _kinds_posted(tmp_path, "cli") == ["failed"]


def _result(response: dict[str, Any]) -> dict[str, Any]:
    return rpc_result(response)


async def test_notifications_get_and_set_write_the_file(short_home: Path) -> None:
    config = short_home / "config.toml"
    config.write_text("# mine\n" + ROUTINES, "utf-8")
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        got = _result(await client.call("notifications.get", {}))
        assert got["needs_you"] is True
        assert (got["failed"], got["finished"], got["open_in"]) == (True, False, "web")
        assert got["terminal_apps"] == ["Terminal", "iTerm", "Ghostty"]
        assert got["finished_routines"] == ["brief"]

        saved = _result(
            await client.call(
                "notifications.set",
                {"finished": True, "open_in": "terminal", "terminal_app": "iTerm"},
            )
        )
        assert saved["ok"] is True
        assert saved["values"]["finished"] is True
        text = config.read_text("utf-8")
        assert "# mine" in text
        assert tomllib.loads(text)["notifications"] == {
            "finished": True,
            "open_in": "terminal",
            "terminal_app": "iTerm",
        }

        bad = _result(await client.call("notifications.set", {"terminal_app": "Hyper"}))
        assert bad["ok"] is False
        assert bad["values"] is None
        assert [error["path"] for error in bad["errors"]] == ["notifications.terminal_app"]
        assert config.read_text("utf-8") == text
    finally:
        await client.close()
        await stop_daemon(app, task)
