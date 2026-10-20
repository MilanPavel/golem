"""Model providers' API keys: the ``provider/<name>`` part of the secret store.

The secrets themselves live in :mod:`golem.secrets`. This is the view the
model router needs, by provider name.
"""

from __future__ import annotations

from typing import Protocol

from golem.secrets import SERVICE, KeychainSecrets, SecretStore, SecretStoreError

KeyStoreError = SecretStoreError


class KeyStore(Protocol):
    def get(self, provider: str) -> str | None: ...

    def set(self, provider: str, key: str) -> None: ...

    def delete(self, provider: str) -> bool:
        """Remove the key. Returns False when there was none."""
        ...


class ProviderKeys:
    """Provider keys in a :class:`~golem.secrets.SecretStore`, under ``provider/<name>``."""

    def __init__(self, secrets: SecretStore) -> None:
        self._secrets = secrets

    def get(self, provider: str) -> str | None:
        return self._secrets.get(f"provider/{provider}")

    def set(self, provider: str, key: str) -> None:
        self._secrets.set(f"provider/{provider}", key)

    def delete(self, provider: str) -> bool:
        return self._secrets.delete(f"provider/{provider}")


class KeychainStore(ProviderKeys):
    """Provider keys in the Keychain."""

    def __init__(self, service: str = SERVICE) -> None:
        super().__init__(KeychainSecrets(service))


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


__all__ = [
    "SERVICE",
    "KeyStore",
    "KeyStoreError",
    "KeychainStore",
    "MemoryKeyStore",
    "ProviderKeys",
]
