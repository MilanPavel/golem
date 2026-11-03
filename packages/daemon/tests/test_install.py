"""The daemon installs Ollama with brew and streams what brew prints."""

from __future__ import annotations

import asyncio
from collections.abc import Mapping
from pathlib import Path
from typing import cast

import pytest
from pydantic import BaseModel
from test_doctor import FakePlatform
from test_server import HELLO, RpcClient, error_code, rpc_result, start_daemon, stop_daemon

from golem.models.install import InstallError, OllamaInstaller, Process, brew_env
from golem.server.dispatcher import OLLAMA_FAILED
from golem_protocol.rpc import OllamaInstallDoneNotification, OllamaInstallOutputNotification


class FakeBrew:
    """A brew process that prints ``output`` and exits with ``code``, or waits to be stopped."""

    def __init__(self, output: list[bytes], code: int = 0, *, hang: bool = False) -> None:
        self.stdout: asyncio.StreamReader | None = asyncio.StreamReader()
        for chunk in output:
            self.stdout.feed_data(chunk)
        if not hang:
            self.stdout.feed_eof()
        self._code = code
        self._done = asyncio.Event()
        if not hang:
            self._done.set()
        self.returncode: int | None = None
        self.terminated = False

    async def wait(self) -> int:
        await self._done.wait()
        self.returncode = -15 if self.terminated else self._code
        return self.returncode

    def terminate(self) -> None:
        self.terminated = True
        assert self.stdout is not None
        self.stdout.feed_eof()
        self._done.set()

    def kill(self) -> None:
        self.terminate()


def _installer(
    brew: FakeBrew, *, installed: bool = True, found: str | None = "/opt/homebrew/bin/brew"
) -> tuple[OllamaInstaller, list[BaseModel], list[tuple[str, list[str], Mapping[str, str]]]]:
    sent: list[BaseModel] = []
    calls: list[tuple[str, list[str], Mapping[str, str]]] = []

    async def spawn(command: str, args: list[str], env: Mapping[str, str]) -> Process:
        calls.append((command, args, env))
        return brew

    installer = OllamaInstaller(
        broadcast=sent.append,
        find=lambda: found,
        installed=lambda: installed,
        spawn=spawn,
        env={"HOME": "/Users/me"},
    )
    return installer, sent, calls


async def _ended(installer: OllamaInstaller) -> None:
    for _ in range(100):
        if not installer.running:
            return
        await asyncio.sleep(0.01)
    raise AssertionError("the install did not end")


async def test_brew_runs_by_its_path_and_its_output_reaches_every_client() -> None:
    installer, sent, calls = _installer(
        FakeBrew([b"==> Downloading ollama\n", b"\xe2\x9c\x94 done\n"])
    )
    assert await installer.start() is True
    await _ended(installer)
    command, args, env = calls[0]
    assert (command, args) == ("/opt/homebrew/bin/brew", ["install", "ollama"])
    assert env["HOMEBREW_NO_AUTO_UPDATE"] == "1"
    assert env["HOMEBREW_NO_ANALYTICS"] == "1"
    assert env["PATH"].startswith("/opt/homebrew/bin:")
    texts = [n.params.text for n in sent if isinstance(n, OllamaInstallOutputNotification)]
    assert "".join(texts) == "==> Downloading ollama\n✔ done\n"
    done = sent[-1]
    assert isinstance(done, OllamaInstallDoneNotification)
    assert (done.params.outcome, done.params.reason) == ("installed", None)


async def test_a_failed_install_says_the_last_line_brew_printed() -> None:
    installer, sent, _calls = _installer(
        FakeBrew([b"==> Fetching\nError: no space left\n"], code=1), installed=False
    )
    await installer.start()
    await _ended(installer)
    done = sent[-1]
    assert isinstance(done, OllamaInstallDoneNotification)
    assert done.params.outcome == "failed"
    assert done.params.reason == "brew install ollama exited with code 1: Error: no space left"


async def test_one_install_at_a_time_and_cancel_stops_it() -> None:
    brew = FakeBrew([b"==> Downloading\n"], hang=True)
    installer, sent, calls = _installer(brew)
    assert await installer.start() is True
    assert await installer.start() is False
    assert len(calls) == 1
    assert await installer.cancel() is True
    assert brew.terminated
    done = sent[-1]
    assert isinstance(done, OllamaInstallDoneNotification)
    assert done.params.outcome == "stopped"
    assert await installer.cancel() is False


async def test_no_homebrew_is_its_own_error() -> None:
    installer, _sent, calls = _installer(FakeBrew([]), found=None)
    with pytest.raises(InstallError, match="Homebrew isn't installed") as caught:
        await installer.start()
    assert caught.value.no_brew
    assert calls == []


def test_brew_keeps_the_daemons_path_after_homebrews() -> None:
    env = brew_env({"PATH": "/custom/bin"})
    assert env["PATH"].endswith(":/custom/bin")
    assert env["PATH"].startswith("/opt/homebrew/bin:")


async def test_ollama_install_without_brew_answers_with_no_brew(
    short_home: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("golem.models.install.find_brew", lambda: None)
    app, task = await start_daemon(short_home)
    assert app.state.installer is not None
    app.state.installer = OllamaInstaller(find=lambda: None)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        reply = await client.call("ollama.install")
        assert error_code(reply) == OLLAMA_FAILED
        error = reply["error"]
        assert isinstance(error, dict)
        assert error["data"] == {"no_brew": True}
        cancelled = rpc_result(await client.call("ollama.install_cancel"))
        assert cancelled == {"cancelled": False}
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_setup_status_sends_the_doctor_checks(
    short_home: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("golem.server.handlers.MacPlatform", FakePlatform)
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        result = rpc_result(await client.call("setup.status"))
        rows = cast(list[dict[str, object]], result["rows"])
        by_name = {cast(str, row["name"]): row for row in rows}
        assert by_name["model"]["state"] == "warn"
        assert by_name["model"]["part"] == "model"
        assert by_name["model"]["action"] == "pick_model"
        assert by_name["disk"]["part"] == "disk"
        assert "ollama" in by_name
        assert by_name["ollama"]["part"] == "engine"
    finally:
        await client.close()
        await stop_daemon(app, task)
