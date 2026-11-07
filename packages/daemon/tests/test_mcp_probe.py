"""``mcp.test`` steps and hints, the log buffer, and ``mcp.call``."""

from __future__ import annotations

import asyncio
import json
import sys
import threading
from collections.abc import AsyncIterator, Iterator
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import cast

import pytest
from fakes import ToolCallingChatModel
from test_server import HELLO, RpcClient, error_code, rpc_result, start_daemon, stop_daemon

from golem.config import McpServerSettings
from golem.mcp import McpSupervisor, Timing
from golem.mcp.catalog import CatalogEntry
from golem.mcp.probe import Hint, Step, Timeouts, probe
from golem.mcp.probe import test_hint as hint_for
from golem.models.router import ModelRouter
from golem.secrets import MemorySecrets
from golem.server.dispatcher import INVALID_PARAMS
from golem.tools.registry import ToolScope

SERVER = str(Path(__file__).with_name("fake_mcp_server.py"))
EVERYONE = ToolScope()
ENVIRON = {"HOME": str(Path.home()), "PATH": "/usr/bin:/bin"}
QUICK = Timeouts(resolve=5, initialize=1.5, tools=2, ping=2)


def _stdio(*flags: str, **extra: object) -> McpServerSettings:
    return McpServerSettings.model_validate(
        {"command": sys.executable, "args": [SERVER, *flags], **extra}
    )


def _states(steps: list[Step]) -> list[tuple[str, str]]:
    return [(step.step, step.state) for step in steps]


async def test_every_step_passes_for_a_good_server() -> None:
    seen: list[tuple[str, str]] = []
    result = await probe(
        _stdio(), ENVIRON, lambda _ref: None, progress=lambda s: seen.append((s.step, s.state))
    )
    assert result.ok and result.hint is None
    assert _states(result.steps) == [
        ("resolve", "ok"),
        ("spawn", "ok"),
        ("initialize", "ok"),
        ("tools", "ok"),
        ("ping", "ok"),
    ]
    assert (result.server_name, result.server_version) == ("fake", "1")
    assert result.protocol_version is not None
    assert len(result.tools) == 9 and result.tools[0].name == "echo"
    assert ("initialize", "running") in seen and seen[-1] == ("ping", "ok")
    assert all(step.elapsed_ms >= 0 for step in result.steps)


async def test_a_missing_command_fails_at_resolve_and_the_rest_are_skipped() -> None:
    settings = McpServerSettings(command="no-such-mcp-command")
    result = await probe(settings, ENVIRON, lambda _ref: None)
    assert not result.ok
    assert _states(result.steps) == [
        ("resolve", "failed"),
        ("spawn", "skipped"),
        ("initialize", "skipped"),
        ("tools", "skipped"),
        ("ping", "skipped"),
    ]
    assert "command not found: no-such-mcp-command" in (result.steps[0].detail or "")


async def test_a_server_that_exits_at_once_says_why() -> None:
    result = await probe(_stdio("--exit-at-start"), ENVIRON, lambda _ref: None, timeouts=QUICK)
    assert [step.state for step in result.steps][:3] == ["ok", "ok", "failed"]
    assert result.steps[2].detail is not None and "exited with code 2" in result.steps[2].detail
    assert result.stderr_tail == ["cannot start: no config"]
    assert result.hint == Hint("cannot start: no config")


async def test_a_server_that_never_answers_initialize_times_out() -> None:
    result = await probe(_stdio("--hang"), ENVIRON, lambda _ref: None, timeouts=QUICK)
    assert result.steps[2].state == "failed"
    assert result.steps[2].detail == "initialize got no answer within 1.5 s"
    assert result.hint is None  # python, not a package runner


async def test_a_missing_secret_fails_the_spawn_step() -> None:
    settings = _stdio(env={"API_TOKEN": "keychain:mcp/fake"})
    result = await probe(settings, ENVIRON, lambda _ref: None)
    assert result.steps[1].state == "failed"
    assert "no secret mcp/fake" in (result.steps[1].detail or "")
    assert result.hint == Hint("A secret is missing: paste it again in the server's form")


async def test_a_sent_secret_is_used_and_redacted_everywhere() -> None:
    settings = McpServerSettings.model_validate(
        {
            "command": sys.executable,
            "args": [SERVER, "--noise"],
            "env": {"NOISE": "keychain:mcp/fake"},
        }
    )
    kept: list[str] = []
    result = await probe(
        settings,
        ENVIRON,
        lambda ref: kept.append(ref),  # the Keychain must not be asked for a sent secret
        sent={"mcp/fake": "s3cret-value"},
    )
    assert result.ok and kept == []
    assert result.stderr_tail == ["starting with •••"]
    assert "s3cret-value" not in json.dumps([result.stderr_tail, [s.detail for s in result.steps]])


@pytest.fixture
def http_server() -> Iterator[tuple[str, dict[str, object]]]:
    """A server that answers every POST with the status and header in ``mode``."""
    mode: dict[str, object] = {"status": 401, "header": None}

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            self.rfile.read(int(self.headers.get("content-length", 0)))
            self.send_response(cast(int, mode["status"]))
            if mode["header"]:
                self.send_header("WWW-Authenticate", str(mode["header"]))
            self.send_header("Content-Length", "0")
            self.end_headers()

        def log_message(self, format: str, *args: object) -> None:
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_port}/mcp", mode
    server.shutdown()
    server.server_close()


async def test_a_refused_token_gets_the_token_hint_and_oauth_gets_its_own(
    http_server: tuple[str, dict[str, object]],
) -> None:
    url, mode = http_server
    settings = McpServerSettings(url=url)
    refused = await probe(settings, ENVIRON, lambda _ref: None, timeouts=QUICK)
    assert _states(refused.steps)[:3] == [
        ("resolve", "ok"),
        ("connect", "ok"),
        ("initialize", "failed"),
    ]
    assert refused.hint == Hint("The token was refused: paste a new one")
    mode["header"] = 'Bearer resource_metadata="https://x.test/.well-known"'
    oauth = await probe(settings, ENVIRON, lambda _ref: None, timeouts=QUICK)
    assert oauth.hint == Hint("This server signs in with OAuth")


async def test_an_unreachable_host_says_it_cannot_be_reached() -> None:
    result = await probe(
        McpServerSettings(url="http://127.0.0.1:1/mcp"), ENVIRON, lambda _ref: None, timeouts=QUICK
    )
    assert result.steps[2].state == "failed"
    assert result.hint == Hint("Can't reach 127.0.0.1")


async def test_an_unknown_host_fails_at_resolve() -> None:
    settings = McpServerSettings(url="http://no-such-host.invalid/mcp")
    result = await probe(settings, ENVIRON, lambda _ref: None, timeouts=QUICK)
    assert _states(result.steps)[0] == ("resolve", "failed")
    assert result.hint == Hint("Can't reach no-such-host.invalid")


def _failed(step: str, detail: str) -> list[Step]:
    return [Step(step, "failed", 5, detail)]


def test_each_hint_row() -> None:
    def hint(
        steps: list[Step],
        command: str | None = None,
        *,
        stderr: list[str] | None = None,
        url: str | None = None,
        status: int | None = None,
        authenticate: str | None = None,
    ) -> Hint | None:
        settings = McpServerSettings(url=url) if url else McpServerSettings(command=command or "x")
        return hint_for(
            steps, stderr or [], settings=settings, http_status=status, authenticate=authenticate
        )

    missing = _failed("resolve", "command not found: x")
    assert hint(missing, "npx") == Hint("Node is missing: golem can install it", "node")
    assert hint(missing, "node") == Hint("Node is missing: golem can install it", "node")
    assert hint(missing, "/opt/homebrew/bin/uvx") == Hint(
        "uv is missing: golem can install it", "uv"
    )
    assert hint(missing, "docker") == Hint("Install Docker Desktop or OrbStack")
    assert hint(missing, "mytool") == Hint("Install mytool, or set command to its full path")
    slow = _failed("initialize", "initialize got no answer within 60 s")
    assert hint(slow, "npx") == Hint("The first run downloads the package: try again")
    assert hint(slow, "uvx") == Hint("The first run downloads the package: try again")
    assert hint(slow, "python") is None
    exited = _failed("initialize", "the server exited with code 1: boom")
    assert hint(exited, "node", stderr=["a", "boom"]) == Hint("boom")
    assert hint(exited, "node") == Hint("the server exited with code 1: boom")
    http = _failed("initialize", "HTTP 401")
    assert hint(http, url="http://h.test/mcp", status=401) == Hint(
        "The token was refused: paste a new one"
    )
    assert hint(http, url="http://h.test/mcp", status=403, authenticate="Bearer") == Hint(
        "This server signs in with OAuth"
    )
    reach = _failed("initialize", "cannot reach http://h.test/mcp: boom")
    assert hint(reach, url="http://h.test/mcp") == Hint("Can't reach h.test")
    assert hint([Step("ping", "ok")], "x") is None
    assert hint(_failed("tools", "odd"), "x") is None


@pytest.fixture
async def started() -> AsyncIterator[list[McpSupervisor]]:
    made: list[McpSupervisor] = []
    yield made
    for supervisor in made:
        await supervisor.aclose()


async def test_the_log_keeps_500_lines_across_restarts_and_batches_notifications(
    started: list[McpSupervisor],
) -> None:
    batches: list[int] = []
    supervisor = McpSupervisor(
        {"fake": _stdio("--exit-at-start")},
        broadcast=lambda note: (
            batches.append(len(note.params.lines))  # pyright: ignore
            if getattr(note, "method", "") == "mcp.server.log"
            else None
        ),
        timing=Timing(backoff_first=0.05, backoff_max=0.1, log_batch_seconds=0.1),
    )
    started.append(supervisor)
    supervisor.start()
    async with asyncio.timeout(10):
        while (
            len([line for line in supervisor.logs(EVERYONE, "fake", 500) if "retry" in line.text])
            < 3
        ):
            await asyncio.sleep(0.02)
    lines = supervisor.logs(EVERYONE, "fake", 500)
    texts = [line.text for line in lines]
    assert texts[0] == "starting"
    assert any(text.startswith("failed: the server exited with code 2") for text in texts)
    assert any(text.startswith("retry in ") for text in texts)
    assert [line.text for line in lines if line.kind == "stderr"][:2] == [
        "cannot start: no config",
        "cannot start: no config",
    ]
    assert len(supervisor.logs(EVERYONE, "fake", 2)) == 2
    # Several lines go out together, not one notification each.
    await asyncio.sleep(0.2)
    assert batches and max(batches) > 1
    with pytest.raises(Exception, match="no MCP server"):
        supervisor.logs(EVERYONE, "nope", 10)


async def test_the_buffer_holds_at_most_500_lines_and_redacts_secrets(
    started: list[McpSupervisor],
) -> None:
    settings = McpServerSettings.model_validate(
        {
            "command": sys.executable,
            "args": [SERVER, "--noise"],
            "env": {"NOISE": "keychain:mcp/fake"},
        }
    )
    supervisor = McpSupervisor(
        {"fake": settings},
        secrets=lambda ref: "hunter2-secret" if ref == "mcp/fake" else None,
        timing=Timing(log_batch_seconds=0.05),
    )
    started.append(supervisor)
    supervisor.start()
    await supervisor.prepare(EVERYONE)
    lines = supervisor.logs(EVERYONE, "fake", 500)
    assert [line.text for line in lines if line.kind == "stderr"] == ["starting with •••"]
    assert not any("hunter2" in line.text for line in lines)
    assert "running (9 tools)" in [line.text for line in lines]
    server = next(iter(supervisor._servers.values()))  # pyright: ignore[reportPrivateUsage]
    for number in range(700):
        supervisor._log(server, "stderr", f"line {number}")  # pyright: ignore[reportPrivateUsage]
    kept = supervisor.logs(EVERYONE, "fake", 500)
    assert len(kept) == 500 and kept[-1].text == "line 699"


async def _daemon(home: Path, secrets: MemorySecrets | None = None):
    app, task = await start_daemon(
        home, router=ModelRouter(model=ToolCallingChatModel(replies=[])), secrets=secrets
    )
    client = await RpcClient.connect(app.paths.socket_path)
    await client.call("hello", HELLO)
    return app, task, client


async def test_mcp_test_over_the_socket_streams_progress_and_stores_nothing(
    short_home: Path,
) -> None:
    secrets = MemorySecrets()
    app, task, client = await _daemon(short_home, secrets)
    try:
        config = {
            "command": sys.executable,
            "args": [SERVER, "--noise"],
            "env": {"NOISE": "keychain:mcp/fake"},
        }
        params = {
            "test_id": "t1",
            "config": config,
            "secrets": {"mcp/fake": "over-the-wire"},
        }
        response = await client.call("mcp.test", params)
        result = rpc_result(response)
        assert result["ok"] is True and result["test_id"] == "t1"
        assert "over-the-wire" not in json.dumps(response)
        assert cast(dict[str, object], result["server_info"])["name"] == "fake"
        assert len(cast(list[object], result["tools"])) == 9
        assert result["stderr_tail"] == ["starting with •••"]
        await client.take_events()
        progress = [n["params"] for n in client.notices if n["method"] == "mcp.test.progress"]
        steps = [
            (cast(dict[str, object], p)["step"], cast(dict[str, object], p)["state"])
            for p in progress
        ]
        assert steps[0] == ("resolve", "running") and steps[-1] == ("ping", "ok")
        assert {cast(dict[str, object], p)["test_id"] for p in progress} == {"t1"}
        assert secrets.secrets == {}
        assert not (short_home / "config.toml").exists()

        both = {"test_id": "t2", "name": "x", "config": config}
        assert error_code(await client.call("mcp.test", both)) == INVALID_PARAMS
        neither = {"test_id": "t3"}
        assert error_code(await client.call("mcp.test", neither)) == INVALID_PARAMS
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_an_unsaved_config_cannot_read_a_stored_secret(short_home: Path) -> None:
    secrets = MemorySecrets()
    secrets.secrets["mcp/github"] = "stored-token"
    app, task, client = await _daemon(short_home, secrets)
    try:
        config = {
            "command": sys.executable,
            "args": [SERVER, "--noise"],
            "env": {"NOISE": "keychain:mcp/github"},
        }
        # Naming a secret the request does not send is refused, not read from the Keychain.
        result = rpc_result(await client.call("mcp.test", {"test_id": "t", "config": config}))
        assert result["ok"] is False
        steps = cast(list[dict[str, object]], result["steps"])
        assert "no secret mcp/github" in str(steps[1]["detail"])
        assert "stored-token" not in json.dumps(result)
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_mcp_test_of_a_saved_server_marks_hidden_tools_and_reads_its_secret(
    short_home: Path,
) -> None:
    secrets = MemorySecrets()
    secrets.secrets["mcp/fake"] = "kept-secret"
    (short_home / "config.toml").write_text(
        f"[mcp.fake]\ncommand = {json.dumps(sys.executable)}\n"
        f'args = [{json.dumps(SERVER)}, "--noise"]\nenabled = false\n'
        'env = { NOISE = "keychain:mcp/fake" }\ntools = { include = ["echo"] }\n',
        encoding="utf-8",
    )
    app, task, client = await _daemon(short_home, secrets)
    try:
        result = rpc_result(await client.call("mcp.test", {"test_id": "s", "name": "fake"}))
        assert result["ok"] is True
        assert result["stderr_tail"] == ["starting with •••"]
        tools = cast(list[dict[str, object]], result["tools"])
        assert [tool["hidden"] for tool in tools][:3] == [False, True, True]
        missing = await client.call("mcp.test", {"test_id": "m", "name": "nope"})
        assert error_code(missing) == INVALID_PARAMS
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_logs_and_call_over_the_socket(short_home: Path) -> None:
    (short_home / "config.toml").write_text(
        f"[mcp.fake]\ncommand = {json.dumps(sys.executable)}\nargs = [{json.dumps(SERVER)}]\n",
        encoding="utf-8",
    )
    app, task, client = await _daemon(short_home)
    try:
        async with asyncio.timeout(10):
            while True:
                logs = rpc_result(await client.call("mcp.logs", {"name": "fake"}))
                lines = cast(list[dict[str, object]], logs["lines"])
                if "running (9 tools)" in [line["text"] for line in lines]:
                    break
                await asyncio.sleep(0.05)
        assert [line["kind"] for line in lines][:1] == ["event"]
        assert (
            len(
                cast(
                    list[object],
                    rpc_result(await client.call("mcp.logs", {"name": "fake", "limit": 1}))[
                        "lines"
                    ],
                )
            )
            == 1
        )
        assert error_code(await client.call("mcp.logs", {"name": "nope"})) == INVALID_PARAMS

        called = rpc_result(
            await client.call(
                "mcp.call", {"name": "fake", "tool": "echo", "arguments": {"text": "hi"}}
            )
        )
        assert called == {"text": "echo: hi", "is_error": False, "structured": None}
        failed = rpc_result(await client.call("mcp.call", {"name": "fake", "tool": "fail"}))
        assert failed["is_error"] is True and failed["text"] == "it broke"
        unknown = await client.call("mcp.call", {"name": "fake", "tool": "nope"})
        assert "error" in unknown
        assert (
            error_code(await client.call("mcp.call", {"name": "x", "tool": "echo"}))
            == INVALID_PARAMS
        )
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_mcp_test_of_a_catalog_entry_uses_the_secret_it_is_sent_and_stores_nothing(
    short_home: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    entry = CatalogEntry.model_validate(
        {
            "id": "fakeserver",
            "name": "fakeserver",
            "title": "Fake",
            "description": "a fake",
            "category": "other",
            "homepage": "https://example.test",
            "runtime": "uvx",
            "auth": "token",
            "template": {
                "command": sys.executable,
                "args": [SERVER, "--noise"],
                "env": {"NOISE": "{secret.token}"},
            },
            "inputs": [{"id": "token", "kind": "secret", "label": "Token"}],
        }
    )
    monkeypatch.setattr("golem.mcp.catalog.load_catalog", lambda: [entry])
    secrets = MemorySecrets()
    app, task, client = await _daemon(short_home, secrets)
    try:
        params = {"test_id": "c1", "catalog_id": "fakeserver", "secrets": {"token": "typed-secret"}}
        response = await client.call("mcp.test", params)
        result = rpc_result(response)
        assert result["ok"] is True
        assert result["stderr_tail"] == ["starting with •••"]
        assert "typed-secret" not in json.dumps(response)
        assert secrets.secrets == {}
        assert not (short_home / "config.toml").exists()

        missing = await client.call("mcp.test", {"test_id": "c2", "catalog_id": "fakeserver"})
        assert error_code(missing) == INVALID_PARAMS
        unknown = await client.call("mcp.test", {"test_id": "c3", "catalog_id": "nope"})
        assert error_code(unknown) == INVALID_PARAMS
        both = {"test_id": "c4", "catalog_id": "fakeserver", "config": {"url": "http://x.test"}}
        assert error_code(await client.call("mcp.test", both)) == INVALID_PARAMS
        stray = {"test_id": "c5", "name": "x", "inputs": {"a": "b"}}
        assert error_code(await client.call("mcp.test", stray)) == INVALID_PARAMS
    finally:
        await client.close()
        await stop_daemon(app, task)
