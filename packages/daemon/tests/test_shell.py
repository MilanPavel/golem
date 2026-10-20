"""The sandboxed shell and the git helpers."""

from __future__ import annotations

import asyncio
import os
import subprocess
import time
from pathlib import Path

import pytest

from golem.config import ShellSettings
from golem.permissions.policy import Policy
from golem.tools import default_registry, sandbox
from golem.tools.registry import ToolContext, ToolError, ToolResult

needs_sandbox = pytest.mark.skipif(not sandbox.available(), reason="needs macOS sandbox-exec")


@pytest.fixture
def root(tmp_path: Path) -> Path:
    folder = tmp_path / "project"
    folder.mkdir()
    return folder


def test_the_profile_limits_writes_network_and_secret_reads(tmp_path: Path) -> None:
    home = tmp_path / "home"
    root = tmp_path / "project"
    root.mkdir()
    text = sandbox.profile(root, ShellSettings(writable=["~/extra"]), home=home)
    assert "(deny file-write*)" in text
    assert f'(subpath "{root.resolve()}")' in text
    assert f'(subpath "{(home / "extra").resolve()}")' in text
    assert f'(subpath "{(home / ".ssh").resolve()}")' in text
    assert f'(subpath "{(home / ".golem").resolve()}")' in text
    assert "(deny network*)" in text
    assert "(deny network*)" not in sandbox.profile(root, ShellSettings(network=True), home=home)


def test_credentials_leave_the_environment(tmp_path: Path) -> None:
    env = sandbox.environment(
        {
            "PATH": "/usr/bin:/bin",
            "ANTHROPIC_API_KEY": "k",
            "GITHUB_TOKEN": "t",
            "DB_PASSWORD": "p",
            "LANG": "en_US.UTF-8",
        },
        home=tmp_path,
    )
    assert "ANTHROPIC_API_KEY" not in env and "GITHUB_TOKEN" not in env and "DB_PASSWORD" not in env
    assert env["LANG"] == "en_US.UTF-8"
    assert env["PATH"].startswith("/opt/homebrew/bin:")
    assert env["PATH"].endswith("/usr/bin:/bin")
    assert env["GIT_TERMINAL_PROMPT"] == "0"


async def _run(root: Path, command: str, **kwargs: object) -> sandbox.Finished:
    settings = kwargs.pop("settings", ShellSettings())
    assert isinstance(settings, ShellSettings)
    timeout = kwargs.pop("timeout", 10.0)
    assert isinstance(timeout, float | int)
    home = kwargs.pop("home", None)
    assert home is None or isinstance(home, Path)
    on_output = kwargs.pop("on_output", None)
    return await sandbox.run(
        ["/bin/sh", "-c", command],
        root=root,
        settings=settings,
        timeout=float(timeout),
        home=home,
        on_output=on_output,  # type: ignore[arg-type]
    )


@needs_sandbox
async def test_a_command_runs_in_the_folder_and_reports_its_exit_code(root: Path) -> None:
    done = await _run(root, "echo hi > a.txt && cat a.txt && pwd && exit 3")
    assert done.exit_code == 3
    assert done.output.splitlines() == ["hi", str(root.resolve())]
    assert (root / "a.txt").read_text(encoding="utf-8") == "hi\n"


@needs_sandbox
async def test_writes_outside_the_folder_are_refused(root: Path, short_home: Path) -> None:
    outside = short_home / "outside.txt"
    done = await _run(root, f"echo x > {outside}")
    assert done.exit_code != 0
    assert not outside.exists()


@needs_sandbox
async def test_secret_folders_cannot_be_read(root: Path, tmp_path: Path) -> None:
    home = tmp_path / "home"
    (home / ".ssh").mkdir(parents=True)
    (home / ".ssh" / "id_rsa").write_text("PRIVATE\n", encoding="utf-8")
    done = await _run(root, f"cat {home}/.ssh/id_rsa", home=home)
    assert done.exit_code != 0
    assert "PRIVATE" not in done.output


@needs_sandbox
async def test_the_network_is_off_unless_the_settings_allow_it(root: Path) -> None:
    async def answer(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        await reader.read(100)
        writer.write(b"HTTP/1.0 200 OK\r\nContent-Length: 2\r\n\r\nok")
        await writer.drain()
        writer.close()

    server = await asyncio.start_server(answer, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    try:
        command = f"curl -s -m 3 http://127.0.0.1:{port}/"
        blocked = await _run(root, command)
        allowed = await _run(root, command, settings=ShellSettings(network=True))
    finally:
        server.close()
    assert blocked.exit_code != 0
    assert (allowed.exit_code, allowed.output) == (0, "ok")


@needs_sandbox
async def test_a_timeout_kills_the_whole_process_group(root: Path) -> None:
    started = time.monotonic()
    done = await _run(root, "sleep 100 & echo $! > child; sleep 100", timeout=0.5)
    assert done.timed_out and done.exit_code is None
    assert time.monotonic() - started < 5
    child = int((root / "child").read_text(encoding="utf-8"))
    await asyncio.sleep(0.2)
    with pytest.raises(ProcessLookupError):
        os.kill(child, 0)


@needs_sandbox
async def test_cancelling_kills_the_command(root: Path) -> None:
    task = asyncio.create_task(_run(root, "echo $$ > pid; sleep 100"))
    pid_file = root / "pid"
    async with asyncio.timeout(5):
        while not pid_file.exists() or pid_file.read_text(encoding="utf-8") == "":
            await asyncio.sleep(0.02)
    pid = int(pid_file.read_text(encoding="utf-8"))
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    await asyncio.sleep(0.2)
    with pytest.raises(ProcessLookupError):
        os.kill(pid, 0)


@needs_sandbox
async def test_output_streams_while_the_command_runs(root: Path) -> None:
    chunks: list[str] = []
    done = await _run(
        root, "for i in 1 2 3; do echo line$i; sleep 0.3; done", on_output=chunks.append
    )
    assert len(chunks) >= 2
    assert "".join(chunks) == done.output == "line1\nline2\nline3\n"


@needs_sandbox
async def test_long_output_keeps_its_head_and_tail(root: Path) -> None:
    done = await _run(root, "seq 1 60000")
    assert done.cut
    assert done.output.startswith("1\n2\n")
    assert done.output.endswith("59999\n60000\n")
    assert "[… output cut …]" in done.output
    assert len(done.output) < sandbox.HEAD_CHARS + sandbox.TAIL_CHARS + 100


async def _call(root: Path, name: str, **args: object) -> ToolResult:
    return await default_registry().call(name, args, ToolContext(root=root))


@needs_sandbox
async def test_the_shell_tool_ends_with_the_exit_code(root: Path) -> None:
    ok = await _call(root, "shell", command="echo hello")
    assert (ok.output, ok.summary) == ("hello\n[exit code 0]", "exit 0")
    failed = await _call(root, "shell", command="echo boom >&2; exit 2")
    assert (failed.output, failed.summary) == ("boom\n[exit code 2]", "exit 2")
    slow = await _call(root, "shell", command="sleep 5", timeout_seconds=1)
    assert slow.summary == "timed out after 1s"


def _git(root: Path, *args: str) -> None:
    subprocess.run(
        ["git", "-c", "user.name=T", "-c", "user.email=t@e", *args],
        cwd=root,
        check=True,
        capture_output=True,
    )


@needs_sandbox
async def test_git_helpers_read_the_repository(root: Path) -> None:
    _git(root, "init", "-q", "-b", "main")
    (root / "a.txt").write_text("one\n", encoding="utf-8")
    _git(root, "add", "a.txt")
    _git(root, "commit", "-q", "-m", "First commit")
    clean = await _call(root, "git_status")
    assert clean.summary == "clean"
    assert clean.output.startswith("## main")

    (root / "a.txt").write_text("one\ntwo\n", encoding="utf-8")
    status = await _call(root, "git_status")
    assert (status.summary, status.output.splitlines()[1]) == ("1 change", " M a.txt")
    diff = await _call(root, "git_diff")
    assert diff.summary == "1 file, +1 -0"
    assert "+two" in diff.output
    log = await _call(root, "git_log")
    assert log.summary == "1 commit"
    assert log.output.endswith("T: First commit")
    with pytest.raises(ToolError, match="outside"):
        await _call(root, "git_diff", path="/etc")


@needs_sandbox
async def test_git_helpers_do_not_run_repository_hooks(root: Path) -> None:
    _git(root, "init", "-q")
    marker = root / "pwned"
    _git(root, "config", "core.fsmonitor", f"touch {marker} #")
    await _call(root, "git_status")
    assert not marker.exists()


def test_shell_asks_by_default_and_rules_match_the_command(tmp_path: Path, root: Path) -> None:
    registry = default_registry()
    config = tmp_path / "config.toml"
    config.write_text(
        '[[rule]]\ntool = "shell"\nmatch = "git status|pnpm test*"\naction = "allow"\n',
        encoding="utf-8",
    )
    policy = Policy(config, home=tmp_path)
    assert policy.check(registry, "shell", {"command": "pnpm test --watch"}, root).allowed
    assert policy.check(registry, "shell", {"command": "rm -rf ."}, root).action == "ask"
    assert policy.check(registry, "git_status", {}, root).allowed
    assert (
        Policy(None, home=tmp_path).check(registry, "shell", {"command": "ls"}, root).action
        == "ask"
    )


def test_shell_settings_come_from_the_user_config(tmp_path: Path) -> None:
    config = tmp_path / "config.toml"
    config.write_text("[shell]\nnetwork = true\ntimeout_seconds = 30\n", encoding="utf-8")
    assert Policy(config, home=tmp_path).shell() == ShellSettings(network=True, timeout_seconds=30)
    assert Policy(None, home=tmp_path).shell() == ShellSettings()
