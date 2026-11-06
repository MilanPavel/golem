"""A sandbox refusal says it was the sandbox, and how to allow it."""

from __future__ import annotations

from pathlib import Path

import pytest

from golem.config import ShellSettings
from golem.tools import default_registry, sandbox
from golem.tools.registry import ToolContext, ToolResult

needs_sandbox = pytest.mark.skipif(not sandbox.available(), reason="needs macOS sandbox-exec")


def _refusals(output: str, root: Path, home: Path, **settings: object) -> list[str]:
    return sandbox.refusals(output, root, ShellSettings.model_validate(settings), home=home)


@pytest.fixture
def root(tmp_path: Path) -> Path:
    folder = tmp_path / "project"
    folder.mkdir()
    return folder


def test_a_credentials_folder_names_the_folder_and_shell_unsandboxed(
    tmp_path: Path, root: Path
) -> None:
    home = tmp_path / "home"
    gh = home / ".config/gh/config.yml"
    output = f"failed to read configuration: open {gh}: operation not permitted"
    [line] = _refusals(output, root, home)
    assert f"blocked {gh.resolve()}: ~/.config/gh holds credentials" in line
    assert "shell_unsandboxed" in line
    # A tilde path, as a shell prints it, counts too.
    [line] = _refusals("ls: ~/.ssh: Operation not permitted", root, home)
    assert "~/.ssh holds credentials" in line


def test_a_write_outside_the_writable_folders_names_the_setting(tmp_path: Path, root: Path) -> None:
    home = tmp_path / "home"
    outside = Path("/opt/golem-test-elsewhere/x.txt")
    [line] = _refusals(f"touch: {outside}: Operation not permitted", root, home)
    assert f"{outside.resolve()} is outside them" in line
    assert "[shell] writable" in line and "shell_unsandboxed" in line
    assert (
        _refusals(
            f"touch: {outside}: Operation not permitted", root, home, writable=[str(outside.parent)]
        )
        == []
    )


def test_a_path_golem_allows_is_not_blamed_on_the_sandbox(tmp_path: Path, root: Path) -> None:
    home = tmp_path / "home"
    for path in (root / "a.txt", home / ".golem/skills/x/run.sh", home / ".cache/x"):
        assert _refusals(f"sh: {path}: Operation not permitted", root, home) == [], path
    assert _refusals(f"cat: {home}/.ssh/id: No such file or directory", root, home) == []


def test_a_connection_error_is_the_sandbox_only_while_the_network_is_off(
    tmp_path: Path, root: Path
) -> None:
    home = tmp_path / "home"
    output = (
        "fatal: unable to access 'https://github.com/x/y.git/': Failed to connect to github.com"
    )
    [line] = _refusals(output, root, home)
    assert "[shell] network is off" in line and "network = true" in line
    assert _refusals(output, root, home, network=True) == []
    assert _refusals("all tests passed", root, home) == []


async def _shell(root: Path, command: str) -> ToolResult:
    return await default_registry().call("shell", {"command": command}, ToolContext(root=root))


@needs_sandbox
async def test_the_shell_result_says_what_the_sandbox_blocked(root: Path, short_home: Path) -> None:
    read = await _shell(root, "ls ~/.ssh")
    assert read.summary.endswith(", blocked by the sandbox")
    assert "~/.ssh holds credentials" in read.output
    assert read.output.endswith("]\n[exit code 1]")

    write = await _shell(root, f"touch {short_home / 'probe'}")
    assert write.summary == "exit 1, blocked by the sandbox"
    assert "is outside them" in write.output

    network = await _shell(root, "curl -sS -m 5 http://127.0.0.1:9/ -o /dev/null")
    assert network.summary.endswith(", blocked by the sandbox")
    assert "[shell] network is off" in network.output

    fine = await _shell(root, "echo ok")
    assert (fine.output, fine.summary) == ("ok\n[exit code 0]", "exit 0")
