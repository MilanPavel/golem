"""One secret store: names in namespaces, Keychain accounts, references, and no inline secrets."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

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
    account,
    resolve,
)


class _Backend(KeyringBackend):
    priority = 1  # pyright: ignore[reportAssignmentType]

    def __init__(self) -> None:
        super().__init__()
        self.items: dict[tuple[str, str], str] = {}

    def get_password(self, service: str, username: str) -> str | None:
        return self.items.get((service, username))

    def set_password(self, service: str, username: str, password: str) -> None:
        self.items[(service, username)] = password

    def delete_password(self, service: str, username: str) -> None:
        if self.items.pop((service, username), None) is None:
            raise PasswordDeleteError(username)


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
        rpc_result(await client.call("auth.set", {"provider": "anthropic", "key": key}))
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
