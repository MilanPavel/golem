"""API keys in the OS credential store.

On macOS that is the login Keychain, through ``keyring``. Each key is a
generic password with the service ``golem`` and the provider name as the
account. The daemon is the only writer, so the Keychain lets it read its own
items without a prompt.
"""

from __future__ import annotations

from typing import Protocol

SERVICE = "golem"


class KeyStoreError(Exception):
    """The credential store could not be read or written."""


class KeyStore(Protocol):
    def get(self, provider: str) -> str | None: ...

    def set(self, provider: str, key: str) -> None: ...

    def delete(self, provider: str) -> bool:
        """Remove the key. Returns False when there was none."""
        ...


class KeychainStore:
    """``keyring`` with a read cache. Golem changes keys only through this object."""

    def __init__(self, service: str = SERVICE) -> None:
        self._service = service
        self._cache: dict[str, str | None] = {}

    def get(self, provider: str) -> str | None:
        if provider in self._cache:
            return self._cache[provider]
        import keyring
        from keyring.errors import KeyringError

        try:
            key = keyring.get_password(self._service, provider)
        except KeyringError as exc:
            raise KeyStoreError(f"keychain is unavailable: {exc}") from exc
        self._cache[provider] = key
        return key

    def set(self, provider: str, key: str) -> None:
        import keyring
        from keyring.errors import KeyringError

        try:
            keyring.set_password(self._service, provider, key)
        except KeyringError as exc:
            raise KeyStoreError(f"keychain is unavailable: {exc}") from exc
        self._cache[provider] = key

    def delete(self, provider: str) -> bool:
        import keyring
        from keyring.errors import KeyringError, PasswordDeleteError

        try:
            keyring.delete_password(self._service, provider)
        except PasswordDeleteError:
            self._cache[provider] = None
            return False
        except KeyringError as exc:
            raise KeyStoreError(f"keychain is unavailable: {exc}") from exc
        self._cache[provider] = None
        return True


class MemoryKeyStore:
    """A store that lives in this process. For tests."""

    def __init__(self, keys: dict[str, str] | None = None) -> None:
        self.keys: dict[str, str] = dict(keys or {})

    def get(self, provider: str) -> str | None:
        return self.keys.get(provider)

    def set(self, provider: str, key: str) -> None:
        self.keys[provider] = key

    def delete(self, provider: str) -> bool:
        return self.keys.pop(provider, None) is not None
