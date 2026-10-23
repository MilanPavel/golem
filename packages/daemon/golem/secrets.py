"""Every secret golem keeps, in the OS credential store and nowhere else.

On macOS that is the login Keychain, through ``keyring``, under the service
``golem``. A secret has a name in a namespace:

- ``provider/<name>``: a model provider's API key. Its Keychain account is
  the provider name alone, as before namespaces, so stored keys keep working.
- ``mcp/<name>``: an MCP server's token, named as ``keychain:mcp/<name>`` in ``[mcp.*]``.
- ``hook/<name>``: a hook endpoint's token, such as ``hook/token`` (plan step 4.5).

A setting that needs a secret holds a :data:`SecretRef`, ``keychain:<name>``,
and the daemon resolves it when it uses it. A config file never holds the
secret itself.
"""

from __future__ import annotations

import contextlib
import re
import sys
from pathlib import Path
from typing import Annotated, Protocol

from pydantic import AfterValidator

from golem.paths import resolve_paths

SERVICE = "golem"
KEYCHAIN_PREFIX = "keychain:"

_NAME = re.compile(r"^(provider|mcp|hook)/[A-Za-z0-9][A-Za-z0-9._-]*$")
"""Provider accounts have no ``/``, so they never meet the other namespaces' accounts."""


class SecretStoreError(Exception):
    """The credential store could not be read or written."""


class SecretMissingError(Exception):
    """A setting names a secret the store does not have."""


def check_name(name: str) -> str:
    """``name`` when it is ``provider/<name>``, ``mcp/<server>``, or ``hook/<name>``."""
    if _NAME.fullmatch(name) is None:
        raise ValueError(
            f"{name!r} is not a secret name: use provider/<name>, mcp/<server>, or hook/<name>"
        )
    return name


def account(name: str) -> str:
    """The Keychain account for ``name``. A provider key keeps its provider name."""
    check_name(name)
    return name.removeprefix("provider/")


def _ref(value: str) -> str:
    if not value.startswith(KEYCHAIN_PREFIX):
        raise ValueError(
            f"a secret is set as {KEYCHAIN_PREFIX}<name>, never inline; store it with golem auth"
        )
    check_name(value.removeprefix(KEYCHAIN_PREFIX))
    return value


SecretRef = Annotated[str, AfterValidator(_ref)]
"""A setting that points at a secret: ``keychain:mcp/github``."""


class SecretStore(Protocol):
    def get(self, name: str) -> str | None: ...

    def set(self, name: str, value: str) -> None: ...

    def delete(self, name: str) -> bool:
        """Remove the secret. Returns False when there was none."""
        ...


def resolve(ref: str, store: SecretStore) -> str:
    """The secret a :data:`SecretRef` names. Raises :class:`SecretMissingError`."""
    name = _ref(ref).removeprefix(KEYCHAIN_PREFIX)
    value = store.get(name)
    if not value:
        raise SecretMissingError(f"no secret {name} in the Keychain")
    return value


class KeychainSecrets:
    """``keyring`` with a read cache. Golem changes secrets only through this object."""

    def __init__(self, service: str = SERVICE) -> None:
        self._service = service
        self._cache: dict[str, str | None] = {}

    def get(self, name: str) -> str | None:
        if name in self._cache:
            return self._cache[name]
        import keyring
        from keyring.errors import KeyringError

        try:
            value = keyring.get_password(self._service, account(name))
        except KeyringError as exc:
            raise SecretStoreError(f"keychain is unavailable: {exc}") from exc
        self._cache[name] = value
        if value:
            self._claim(name, value)
        return value

    def set(self, name: str, value: str) -> None:
        import keyring
        from keyring.errors import KeyringError

        try:
            keyring.set_password(self._service, account(name), value)
        except KeyringError as exc:
            raise SecretStoreError(f"keychain is unavailable: {exc}") from exc
        self._cache[name] = value

    def delete(self, name: str) -> bool:
        import keyring
        from keyring.errors import KeyringError, PasswordDeleteError

        try:
            keyring.delete_password(self._service, account(name))
        except PasswordDeleteError:
            self._cache[name] = None
            return False
        except KeyringError as exc:
            raise SecretStoreError(f"keychain is unavailable: {exc}") from exc
        self._cache[name] = None
        return True

    def _claim(self, name: str, value: str) -> None:
        """A frozen build rewrites the item once so this binary owns it.

        The first read may prompt. Deleting and storing again makes the new
        executable the owner, and ``run/keychain-migrated`` records the name.
        """
        if not getattr(sys, "frozen", False):
            return
        marker = resolve_paths().run_dir / "keychain-migrated"
        claimed = _read_claimed(marker)
        if name in claimed:
            return
        import keyring
        from keyring.errors import KeyringError, PasswordDeleteError

        try:
            with contextlib.suppress(PasswordDeleteError):
                keyring.delete_password(self._service, account(name))
            keyring.set_password(self._service, account(name), value)
        except KeyringError as exc:
            raise SecretStoreError(f"keychain is unavailable: {exc}") from exc
        claimed.add(name)
        _write_claimed(marker, claimed)
        self._cache[name] = value


def _read_claimed(path: Path) -> set[str]:
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return set()
    return {line for line in text.splitlines() if line}


def _write_claimed(path: Path, names: set[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(f"{name}\n" for name in sorted(names)), encoding="utf-8")


class MemorySecrets:
    """A store that lives in this process. For tests."""

    def __init__(self, secrets: dict[str, str] | None = None) -> None:
        self.secrets: dict[str, str] = dict(secrets or {})

    def get(self, name: str) -> str | None:
        return self.secrets.get(check_name(name))

    def set(self, name: str, value: str) -> None:
        self.secrets[check_name(name)] = value

    def delete(self, name: str) -> bool:
        return self.secrets.pop(check_name(name), None) is not None


__all__ = [
    "KEYCHAIN_PREFIX",
    "SERVICE",
    "KeychainSecrets",
    "MemorySecrets",
    "SecretMissingError",
    "SecretRef",
    "SecretStore",
    "SecretStoreError",
    "account",
    "check_name",
    "resolve",
]
