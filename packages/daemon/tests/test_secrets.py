"""One secret store: names in namespaces, Keychain accounts, references, and no inline secrets."""

from __future__ import annotations

import asyncio
import shlex
import subprocess
import sys
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import keyring
import pytest
from keyring.backend import KeyringBackend
from keyring.errors import PasswordDeleteError
from pydantic import BaseModel, ValidationError
from test_server import HELLO, RpcClient, rpc_result, start_daemon, stop_daemon

from golem.config import GolemSettings, ProviderSettings
from golem.models.keys import KeychainStore, ProviderKeys
from golem.models.router import ModelRouter
from golem.secrets import (
    KeychainSecrets,
    MemorySecrets,
    SecretMissingError,
    SecretRef,
    SecretStoreError,
    account,
    resolve,
)


class _Backend(KeyringBackend):
    priority = 1  # pyright: ignore[reportAssignmentType]

    def __init__(self) -> None:
        super().__init__()
        self.items: dict[tuple[str, str], str] = {}
        self.writes: list[str] = []

    def get_password(self, service: str, username: str) -> str | None:
        return self.items.get((service, username))

    def set_password(self, service: str, username: str, password: str) -> None:
        self.writes.append(username)
        self.items[(service, username)] = password

    def delete_password(self, service: str, username: str) -> None:
        if self.items.pop((service, username), None) is None:
            raise PasswordDeleteError(username)


@pytest.fixture(autouse=True)
def _keyring_path(monkeypatch: pytest.MonkeyPatch) -> None:
    """Tests that do not ask for ``security`` use ``keyring``, as on Linux."""
    monkeypatch.setattr("golem.secrets._uses_security", lambda: False)


@pytest.fixture
def backend() -> Iterator[_Backend]:
    previous = keyring.get_keyring()
    fake = _Backend()
    keyring.set_keyring(fake)
    yield fake
    keyring.set_keyring(previous)


def test_provider_keys_keep_their_old_keychain_account(backend: _Backend) -> None:
    keys = KeychainStore()
    keys.set("anthropic", "sk-a")
    secrets = KeychainSecrets()
    secrets.set("mcp/github", "ghp-1")
    secrets.set("hook/token", "h-1")
    assert backend.items == {
        ("golem", "anthropic"): "sk-a",
        ("golem", "mcp/github"): "ghp-1",
        ("golem", "hook/token"): "h-1",
    }
    assert keys.delete("anthropic") is True
    assert keys.delete("anthropic") is False


def test_an_unfrozen_daemon_leaves_keychain_items_alone(
    backend: _Backend,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delattr(sys, "frozen", raising=False)
    monkeypatch.setenv("GOLEM_HOME", str(tmp_path))
    backend.items[("golem", "anthropic")] = "sk-a"
    assert KeychainSecrets().get("provider/anthropic") == "sk-a"
    assert backend.writes == []
    assert not (tmp_path / "run" / "keychain-security").exists()


class _FakeSecurity:
    """Stands in for ``security -i``: parses the stdin it is given, as the real one does."""

    def __init__(self) -> None:
        self.items: dict[tuple[str, str], str] = {}
        self.stdin: list[str] = []
        self.fail_with: int | None = None

    def __call__(self, text: str) -> tuple[int, str, str]:
        self.stdin.append(text)
        lines = text.split("\n")
        assert lines[-1] == "" and len(lines) == 2, f"one command per run: {text!r}"
        if self.fail_with is not None:
            return self.fail_with, "", "security: something broke\n"
        words = shlex.split(lines[0])
        command, args = words[0], words[1:]
        key = (args[args.index("-s") + 1], args[args.index("-a") + 1])
        if command == "add-generic-password":
            assert "-U" in args
            self.items[key] = args[args.index("-w") + 1]
            return 0, "", ""
        if key not in self.items:
            err = "security: SecKeychainSearchCopyNext: The specified item could not be found"
            return 44, "", err + "\n"
        if command == "find-generic-password":
            return 0, self.items[key] + "\n", ""
        assert command == "delete-generic-password"
        del self.items[key]
        return 0, "", ""


@pytest.fixture
def fake() -> _FakeSecurity:
    return _FakeSecurity()


def _store(fake: _FakeSecurity) -> KeychainSecrets:
    return KeychainSecrets(use_security=True, runner=fake)


def test_security_gets_sets_and_deletes(fake: _FakeSecurity) -> None:
    secrets = _store(fake)
    assert secrets.get("provider/anthropic") is None
    secrets.set("provider/anthropic", "sk-a")
    secrets.set("mcp/github", "ghp-1")
    assert fake.items == {("golem", "anthropic"): "sk-a", ("golem", "mcp/github"): "ghp-1"}
    assert _store(fake).get("provider/anthropic") == "sk-a"
    assert secrets.delete("provider/anthropic") is True
    assert secrets.delete("provider/anthropic") is False
    assert secrets.get("provider/anthropic") is None
    assert ("golem", "anthropic") not in fake.items


def test_a_read_is_cached(fake: _FakeSecurity) -> None:
    fake.items[("golem", "openai")] = "sk-o"
    secrets = _store(fake)
    assert secrets.get("provider/openai") == "sk-o"
    assert secrets.get("provider/openai") == "sk-o"
    assert len(fake.stdin) == 1


def test_another_failure_is_a_store_error_without_the_secret(fake: _FakeSecurity) -> None:
    fake.fail_with = 128
    secrets = _store(fake)
    with pytest.raises(SecretStoreError, match="exit 128"):
        secrets.get("provider/openai")
    with pytest.raises(SecretStoreError, match="exit 128") as info:
        secrets.set("provider/openai", "sk-secret-value")
    assert "sk-secret-value" not in str(info.value)
    with pytest.raises(SecretStoreError, match="exit 128"):
        secrets.delete("provider/openai")


def test_a_missing_security_program_is_a_store_error(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("golem.secrets.SECURITY", "/nonexistent/security")
    with pytest.raises(SecretStoreError, match="unavailable"):
        KeychainSecrets(use_security=True).get("provider/openai")


def test_a_secret_is_never_in_argv(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[list[str], str]] = []

    def run(argv: list[str], **kwargs: Any) -> subprocess.CompletedProcess[str]:
        calls.append((argv, kwargs["input"]))
        return subprocess.CompletedProcess(argv, 0, "", "")

    monkeypatch.setattr(subprocess, "run", run)
    KeychainSecrets(use_security=True).set("provider/openai", "sk-secret-value")
    ((argv, stdin),) = calls
    assert argv == ["/usr/bin/security", "-i", "-p", ""]
    assert "sk-secret-value" not in " ".join(argv)
    assert "sk-secret-value" in stdin


@pytest.mark.parametrize(
    "value",
    [
        'a"b',
        "a\\b",
        "a b  c",
        'end\\"',
        "\\",
        '"',
        "$HOME `id` ; # 'x' !",
        "",
        "-w sk",
        "".join(chr(c) for c in range(0x20, 0x7F)),
    ],
)
def test_a_value_reaches_security_as_one_word(fake: _FakeSecurity, value: str) -> None:
    secrets = _store(fake)
    secrets.set("mcp/github", value)
    assert fake.items[("golem", "mcp/github")] == value
    assert _store(fake).get("mcp/github") == value
    assert all(len(text.splitlines()) == 1 for text in fake.stdin)


@pytest.mark.parametrize(
    "value", ["a\nb", "a\rb", "x\ndelete-generic-password -s golem", "é", "a\0b"]
)
def test_a_value_that_could_start_another_command_is_refused(
    fake: _FakeSecurity, value: str
) -> None:
    with pytest.raises(SecretStoreError, match="printable ASCII"):
        _store(fake).set("mcp/github", value)
    assert fake.stdin == []


def test_a_frozen_daemon_moves_each_key_to_security_once(
    backend: _Backend,
    fake: _FakeSecurity,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GOLEM_HOME", str(tmp_path))
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    backend.items[("golem", "anthropic")] = "sk-a"
    assert _store(fake).get("provider/anthropic") == "sk-a"
    assert fake.items == {("golem", "anthropic"): "sk-a"}
    assert backend.writes == []
    marker = tmp_path / "run" / "keychain-security"
    assert marker.read_text(encoding="utf-8") == "provider/anthropic\n"
    # The next process reads through security only: gone from keyring, still found.
    backend.items.clear()
    fake.stdin.clear()
    assert _store(fake).get("provider/anthropic") == "sk-a"
    assert len(fake.stdin) == 1
    assert fake.stdin[0].startswith("find-generic-password")


def test_a_write_in_a_frozen_daemon_marks_the_name_done(
    backend: _Backend,
    fake: _FakeSecurity,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GOLEM_HOME", str(tmp_path))
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    _store(fake).set("provider/openai", "sk-o")
    marker = tmp_path / "run" / "keychain-security"
    assert marker.read_text(encoding="utf-8") == "provider/openai\n"
    assert _store(fake).get("provider/openai") == "sk-o"
    assert backend.items == {}


def test_a_value_security_cannot_hold_stays_in_keyring(
    backend: _Backend,
    fake: _FakeSecurity,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GOLEM_HOME", str(tmp_path))
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    backend.items[("golem", "anthropic")] = "sk-é"
    assert _store(fake).get("provider/anthropic") == "sk-é"
    assert fake.items == {}
    assert not (tmp_path / "run" / "keychain-security").exists()


def test_an_unfrozen_macos_daemon_reads_through_security_only(
    backend: _Backend, fake: _FakeSecurity, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delattr(sys, "frozen", raising=False)
    fake.items[("golem", "anthropic")] = "sk-a"
    assert _store(fake).get("provider/anthropic") == "sk-a"
    assert backend.items == {}
    assert backend.writes == []


def test_other_platforms_keep_keyring(backend: _Backend, fake: _FakeSecurity) -> None:
    secrets = KeychainSecrets(use_security=False, runner=fake)
    secrets.set("mcp/github", "ghp-1")
    assert backend.items == {("golem", "mcp/github"): "ghp-1"}
    assert KeychainSecrets(use_security=False, runner=fake).get("mcp/github") == "ghp-1"
    assert secrets.delete("mcp/github") is True
    assert fake.stdin == []


def test_the_platform_picks_the_store(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.undo()
    monkeypatch.setattr(sys, "platform", "linux")
    assert KeychainSecrets()._security is False  # pyright: ignore[reportPrivateUsage]
    monkeypatch.setattr(sys, "platform", "darwin")
    assert KeychainSecrets()._security is True  # pyright: ignore[reportPrivateUsage]


@pytest.mark.parametrize("name", ["anthropic", "mcp/", "provider/a b", "hook", "../x"])
def test_a_name_outside_the_namespaces_is_refused(name: str) -> None:
    with pytest.raises(ValueError, match="not a secret name"):
        account(name)


class _Server(BaseModel):
    token: SecretRef


def test_a_setting_names_a_secret_and_never_holds_one() -> None:
    store = MemorySecrets({"mcp/github": "ghp-1"})
    server = _Server(token="keychain:mcp/github")
    assert resolve(server.token, store) == "ghp-1"
    with pytest.raises(ValidationError, match="never inline"):
        _Server(token="ghp-1")
    with pytest.raises(SecretMissingError, match="no secret mcp/other"):
        resolve("keychain:mcp/other", store)
    keys = ProviderKeys(store)
    keys.set("openai", "sk-o")
    assert store.secrets["provider/openai"] == "sk-o"


@pytest.mark.parametrize(
    "field", ["api_key", "apikey", "token", "password", "client_secret", "apiKey", "authorization"]
)
def test_a_secret_written_into_a_config_table_is_refused(field: str) -> None:
    with pytest.raises(ValidationError, match="golem auth set"):
        ProviderSettings.model_validate({field: "sk-inline"})
    with pytest.raises(ValidationError, match="looks like a secret"):
        GolemSettings.model_validate({field: "sk-inline"})
    assert ProviderSettings.model_validate({"api_key_env": "MY_KEY"}).api_key_env == "MY_KEY"


async def test_no_file_under_the_golem_home_holds_a_stored_key(short_home: Path) -> None:
    secrets = MemorySecrets()
    router = ModelRouter(GolemSettings(), keys=ProviderKeys(secrets))
    app, task = await start_daemon(short_home, router=router)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        key = "sk-ant-golem-secret-test-1234567890"
        params = {"provider": "anthropic", "key": key, "check": False}
        rpc_result(await client.call("auth.set", params))
        await client.call("auth.list")
    finally:
        await client.close()
        await stop_daemon(app, task)
    assert secrets.secrets == {"provider/anthropic": key}
    for path in short_home.rglob("*"):
        if path.is_file():
            assert key.encode() not in path.read_bytes(), path


def test_a_provider_name_the_keychain_cannot_hold_is_a_store_error() -> None:
    from golem.models.keys import KeyStoreError

    with pytest.raises(KeyStoreError, match="cannot hold a key"):
        ProviderKeys(MemorySecrets()).get("my provider")


class _SlowBackend(_Backend):
    """Waits on each read, as the Keychain does while macOS shows its dialog."""

    def __init__(self, delay: float) -> None:
        super().__init__()
        self.delay = delay

    def get_password(self, service: str, username: str) -> str | None:
        time.sleep(self.delay)
        return super().get_password(service, username)


def _slow(delay: float) -> Iterator[_SlowBackend]:
    previous = keyring.get_keyring()
    fake = _SlowBackend(delay)
    keyring.set_keyring(fake)
    yield fake
    keyring.set_keyring(previous)


@pytest.fixture
def slow_backend() -> Iterator[_SlowBackend]:
    yield from _slow(0.2)


def test_a_slow_read_says_it_waits_and_when_it_ends(slow_backend: _SlowBackend) -> None:
    slow_backend.items[("golem", "openai")] = "sk-o"
    secrets = KeychainSecrets(wait_notice_seconds=0.02)
    seen: list[tuple[str, bool]] = []
    secrets.on_wait = lambda name, waiting: seen.append((name, waiting))
    assert secrets.get("provider/openai") == "sk-o"
    assert seen == [("provider/openai", True), ("provider/openai", False)]
    # A cached read doesn't touch the Keychain.
    assert secrets.get("provider/openai") == "sk-o"
    assert len(seen) == 2


def test_a_quick_read_says_nothing(backend: _Backend) -> None:
    backend.items[("golem", "openai")] = "sk-o"
    secrets = KeychainSecrets(wait_notice_seconds=1.0)
    seen: list[tuple[str, bool]] = []
    secrets.on_wait = lambda name, waiting: seen.append((name, waiting))
    assert secrets.get("provider/openai") == "sk-o"
    assert seen == []


async def test_every_client_hears_that_the_keychain_waits(
    short_home: Path, slow_backend: _SlowBackend
) -> None:
    slow_backend.items[("golem", "openai")] = "sk-o"
    secrets = KeychainSecrets(wait_notice_seconds=0.02)
    app, task = await start_daemon(short_home, secrets=secrets)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        assert await asyncio.to_thread(secrets.get, "provider/openai") == "sk-o"
        for _ in range(100):
            await client.take_events()
            if len(client.notices) >= 2:
                break
            await asyncio.sleep(0.01)
        assert [(n["method"], n["params"]) for n in client.notices] == [
            ("keychain.wait", {"name": "provider/openai", "provider": "openai", "waiting": True}),
            ("keychain.wait", {"name": "provider/openai", "provider": "openai", "waiting": False}),
        ]
    finally:
        await client.close()
        await stop_daemon(app, task)
    assert secrets.on_wait is None
