"""The supervisor: which session sees which server, restarts, health, reloads, and secrets."""

from __future__ import annotations

import asyncio
import json
import sys
from collections.abc import AsyncIterator, Callable
from pathlib import Path

import pytest

from golem.config import McpServerSettings
from golem.mcp import McpServerError, McpSupervisor, Timing
from golem.mcp.client import McpError
from golem.mcp.tools import result_text
from golem.tools.registry import ToolContext, ToolScope
from golem_protocol.commands import McpServer
from golem_protocol.rpc import McpServerStatusNotification

SERVER = str(Path(__file__).with_name("fake_mcp_server.py"))
FAST = Timing(
    backoff_first=0.05, backoff_max=0.2, health_seconds=60, reload_seconds=0.05, prepare_seconds=10
)
EVERYONE = ToolScope()


def _settings(*flags: str, **extra: object) -> McpServerSettings:
    return McpServerSettings.model_validate(
        {"command": sys.executable, "args": [SERVER, *flags], **extra}
    )


def _toml(name: str, *flags: str, extra: str = "") -> str:
    args = json.dumps([SERVER, *flags])
    return f"[mcp.{name}]\ncommand = {json.dumps(sys.executable)}\nargs = {args}\n{extra}"


async def _until(check: Callable[[], bool], timeout: float = 10) -> None:
    async with asyncio.timeout(timeout):
        while not check():
            await asyncio.sleep(0.02)


def _state(supervisor: McpSupervisor, name: str, scope: ToolScope | None = None) -> McpServer:
    return next(status for status in supervisor.statuses(scope) if status.name == name)


async def _call(supervisor: McpSupervisor, scope: ToolScope, called: str, **args: object) -> str:
    tool = next(tool for tool in supervisor.tools(scope) if tool.name == called)
    result = await tool.call(args, ToolContext(root=None))
    return result.summary


@pytest.fixture
async def running() -> AsyncIterator[list[McpSupervisor]]:
    """Supervisors a test makes, closed after it."""
    made: list[McpSupervisor] = []
    yield made
    for supervisor in made:
        await supervisor.aclose()


async def test_servers_start_fail_and_report_each_change(running: list[McpSupervisor]) -> None:
    sent: list[McpServerStatusNotification] = []
    supervisor = McpSupervisor(
        {
            "fake": _settings(),
            "broken": _settings("--exit-at-start"),
            "missing": McpServerSettings(command="no-such-mcp-server"),
            "off": _settings(enabled=False),
        },
        broadcast=lambda note: sent.append(note),  # pyright: ignore[reportArgumentType]
        timing=Timing(backoff_first=60),
    )
    running.append(supervisor)
    assert [status.state for status in supervisor.statuses()] == ["starting"] * 3 + ["disabled"]
    supervisor.start()
    await _until(lambda: all(status.state != "starting" for status in supervisor.statuses()))
    fake = _state(supervisor, "fake")
    assert fake.state == "running"
    assert "mcp__fake__echo" in fake.tools
    assert fake.schema_tokens is not None and fake.schema_tokens > 50
    broken = _state(supervisor, "broken")
    assert (broken.state, broken.error, broken.retry_seconds) == (
        "failed",
        "the server exited with code 2: cannot start: no config",
        60,
    )
    assert (_state(supervisor, "missing").error or "").startswith(
        "command not found: no-such-mcp-server"
    )
    assert _state(supervisor, "off").state == "disabled"
    assert {tool.name for tool in supervisor.tools(EVERYONE)} == set(fake.tools)
    assert {note.params.name for note in sent} >= {"fake", "broken", "missing"}

    await _call(supervisor, EVERYONE, "mcp__fake__grow")
    await _until(lambda: "mcp__fake__late" in {tool.name for tool in supervisor.tools(EVERYONE)})


async def test_an_on_demand_server_starts_for_the_sessions_that_turn_it_on(
    running: list[McpSupervisor],
) -> None:
    supervisor = McpSupervisor({"fake": _settings(enabled="on_demand")}, timing=FAST)
    running.append(supervisor)
    supervisor.start()
    assert _state(supervisor, "fake").state == "idle"
    assert _state(supervisor, "fake", EVERYONE).enabled is False
    await supervisor.prepare(EVERYONE)
    assert _state(supervisor, "fake").state == "idle"

    mine = ToolScope(enabled=frozenset({"fake"}))
    await supervisor.prepare(mine)
    assert _state(supervisor, "fake", mine).state == "running"
    assert _state(supervisor, "fake", mine).enabled is True
    assert await _call(supervisor, mine, "mcp__fake__echo", text="hi") == "echo: hi"
    assert supervisor.tools(EVERYONE) == []

    supervisor.check_toggle(mine, "fake")
    with pytest.raises(McpServerError, match="no MCP server named nope"):
        supervisor.check_toggle(mine, "nope")


async def test_toggling_a_server_that_is_always_on_or_off_says_how_to_change_it() -> None:
    supervisor = McpSupervisor({"on": _settings(), "off": _settings(enabled=False)})
    with pytest.raises(McpServerError, match='set enabled = "on_demand"'):
        supervisor.check_toggle(EVERYONE, "on")
    with pytest.raises(McpServerError, match=r"turned off in config\.toml"):
        supervisor.check_toggle(EVERYONE, "off")


async def test_a_trusted_projects_servers_join_its_sessions_only(
    running: list[McpSupervisor], tmp_path: Path
) -> None:
    trusted, untrusted = tmp_path / "trusted", tmp_path / "other"
    for project in (trusted, untrusted):
        (project / ".golem").mkdir(parents=True)
        (project / ".golem" / "config.toml").write_text(
            _toml("fake", extra='env = { FROM = "project" }\n') + _toml("extra"), encoding="utf-8"
        )
    supervisor = McpSupervisor(
        {"fake": _settings(env={"FROM": "user"})}, trusted=lambda root: root == trusted, timing=FAST
    )
    running.append(supervisor)
    supervisor.start()
    here = ToolScope(root=trusted)
    await supervisor.prepare(here)
    assert [(status.name, status.project) for status in supervisor.statuses(here)] == [
        ("extra", str(trusted)),
        ("fake", str(trusted)),
    ]
    assert await _call(supervisor, here, "mcp__fake__env", name="FROM") == "project"
    assert await _call(supervisor, EVERYONE, "mcp__fake__env", name="FROM") == "user"

    elsewhere = ToolScope(root=untrusted)
    await supervisor.prepare(elsewhere)
    assert [status.name for status in supervisor.statuses(elsewhere)] == ["fake"]
    assert await _call(supervisor, elsewhere, "mcp__fake__env", name="FROM") == "user"
    assert supervisor.statuses() == supervisor.statuses(None)
    assert [status.project for status in supervisor.statuses()] == [None]


async def test_a_server_that_exits_comes_back_on_its_own(running: list[McpSupervisor]) -> None:
    sent: list[McpServerStatusNotification] = []
    supervisor = McpSupervisor(
        {"fake": _settings()},
        broadcast=lambda note: sent.append(note),  # pyright: ignore[reportArgumentType]
        timing=FAST,
    )
    running.append(supervisor)
    supervisor.start()
    await supervisor.prepare(EVERYONE)
    before = await _call(supervisor, EVERYONE, "mcp__fake__pid")
    with pytest.raises(McpError):
        await _call(supervisor, EVERYONE, "mcp__fake__crash")
    await _until(
        lambda: [note.params.state for note in sent][-3:] == ["failed", "starting", "running"]
    )
    assert await _call(supervisor, EVERYONE, "mcp__fake__pid") != before
    states = [note.params.state for note in sent]
    assert states[-3:] == ["failed", "starting", "running"]
    failed = next(note.params for note in reversed(sent) if note.params.state == "failed")
    assert failed.error == "the server exited with code 3: going down"
    assert failed.retry_seconds == 0.05


async def test_a_server_that_stops_answering_is_started_again(running: list[McpSupervisor]) -> None:
    sent: list[McpServerStatusNotification] = []
    timing = Timing(backoff_first=0.05, health_seconds=0.1, ping_seconds=0.2)
    supervisor = McpSupervisor(
        {"fake": _settings("--deaf")},
        broadcast=lambda note: sent.append(note),  # pyright: ignore[reportArgumentType]
        timing=timing,
    )
    running.append(supervisor)
    supervisor.start()
    await _until(lambda: any(note.params.state == "failed" for note in sent))
    failed = next(note.params for note in sent if note.params.state == "failed")
    assert (failed.error or "").startswith("the server stopped answering: ping got no answer")


async def test_a_changed_config_restarts_adds_and_removes_servers(
    running: list[McpSupervisor], tmp_path: Path
) -> None:
    config = tmp_path / "config.toml"
    config.write_text(_toml("fake") + _toml("gone"), encoding="utf-8")
    supervisor = McpSupervisor(
        {"fake": _settings(), "gone": _settings()}, user_config=config, timing=FAST
    )
    running.append(supervisor)
    supervisor.start()
    await supervisor.prepare(EVERYONE)
    before = await _call(supervisor, EVERYONE, "mcp__fake__pid")

    config.write_text(
        _toml("fake", extra='env = { MODE = "new" }\n') + _toml("added"), encoding="utf-8"
    )
    await _until(lambda: [status.name for status in supervisor.statuses()] == ["added", "fake"])
    await supervisor.prepare(EVERYONE)
    assert await _call(supervisor, EVERYONE, "mcp__fake__env", name="MODE") == "new"
    assert await _call(supervisor, EVERYONE, "mcp__fake__pid") != before
    assert _state(supervisor, "added").state == "running"

    config.write_text("[mcp.broken]\nnot_a_setting = 1\n", encoding="utf-8")
    await asyncio.sleep(0.2)
    assert [status.name for status in supervisor.statuses()] == ["added", "fake"]


async def test_a_server_waits_for_its_secret_and_restarts_when_it_is_stored(
    running: list[McpSupervisor],
) -> None:
    stored: dict[str, str] = {}
    settings = _settings(env={"API_TOKEN": "keychain:mcp/fake"})
    supervisor = McpSupervisor(
        {"fake": settings}, secrets=stored.get, timing=Timing(backoff_first=60)
    )
    running.append(supervisor)
    supervisor.start()
    await supervisor.prepare(EVERYONE)
    assert _state(supervisor, "fake").error == (
        "no secret mcp/fake in the Keychain: run golem auth set mcp/fake"
    )
    stored["mcp/fake"] = "s3cret"
    supervisor.secret_changed("mcp/fake")
    await supervisor.prepare(EVERYONE)
    assert await _call(supervisor, EVERYONE, "mcp__fake__env", name="API_TOKEN") == "s3cret"


async def test_prepare_does_not_wait_forever_for_a_slow_start(running: list[McpSupervisor]) -> None:
    supervisor = McpSupervisor(
        {"slow": McpServerSettings(command="sh", args=["-c", "sleep 30"])},
        timing=Timing(prepare_seconds=0.1),
    )
    running.append(supervisor)
    supervisor.start()
    await asyncio.wait_for(supervisor.prepare(EVERYONE), 2)
    assert _state(supervisor, "slow").state == "starting"
    assert supervisor.tools(EVERYONE) == []


def test_the_tool_text_helper_reads_echo() -> None:
    from golem.mcp.client import CallResult

    assert result_text(CallResult(content=[{"type": "text", "text": "a"}], is_error=False)) == "a"


async def test_a_server_lists_its_tools_restarts_and_names_its_file(
    running: list[McpSupervisor], tmp_path: Path
) -> None:
    config = tmp_path / "config.toml"
    config.write_text(_toml("fake"), encoding="utf-8")
    supervisor = McpSupervisor({"fake": _settings()}, user_config=config, timing=FAST)
    running.append(supervisor)
    supervisor.start()
    await supervisor.prepare(EVERYONE)
    tools = supervisor.tool_list(EVERYONE, "fake")
    assert tools[0] == ("mcp__fake__echo", "Says the text back.")
    assert supervisor.config_file(EVERYONE, "fake") == config
    assert supervisor.status(EVERYONE, "fake").config == str(config)

    before = await _call(supervisor, EVERYONE, "mcp__fake__pid")
    assert supervisor.restart(EVERYONE, "fake").state == "starting"
    await supervisor.prepare(EVERYONE)
    assert await _call(supervisor, EVERYONE, "mcp__fake__pid") != before

    config.write_text(_toml("fake", extra="enabled = false\n"), encoding="utf-8")
    supervisor.reload(config)
    assert supervisor.status(EVERYONE, "fake").state == "disabled"
    with pytest.raises(McpServerError, match="turned off; enable it first"):
        supervisor.restart(EVERYONE, "fake")
    with pytest.raises(McpServerError, match="no MCP server named nope"):
        supervisor.tool_list(EVERYONE, "nope")


async def test_a_project_server_names_the_projects_file(
    running: list[McpSupervisor], tmp_path: Path
) -> None:
    (tmp_path / ".golem").mkdir()
    (tmp_path / ".golem" / "config.toml").write_text(_toml("fake"), encoding="utf-8")
    supervisor = McpSupervisor({}, trusted=lambda _root: True, timing=FAST)
    running.append(supervisor)
    here = ToolScope(root=tmp_path)
    assert supervisor.config_file(here, "fake") == tmp_path / ".golem" / "config.toml"
    with pytest.raises(McpServerError, match="no MCP server named fake"):
        supervisor.config_file(EVERYONE, "fake")
