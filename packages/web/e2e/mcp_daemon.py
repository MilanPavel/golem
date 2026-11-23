"""The real daemon with its secrets kept in memory, for the MCP token test.

The daemon keeps tokens in the OS credential store: the login Keychain on macOS. A test must
not write there, and CI has none. This launcher swaps the one store the daemon builds for a
dict, on the one place it is made, and then runs ``golem-daemon serve`` unchanged. Product
code is untouched.
"""

from __future__ import annotations

import sys

from golem.cli import main
from golem.secrets import KeychainSecrets
from golem.server import app


class MemorySecrets(KeychainSecrets):
    """Secrets in a dict, gone when the daemon stops."""

    def __init__(self) -> None:
        super().__init__()
        self._items: dict[str, str] = {}

    def get(self, name: str) -> str | None:
        return self._items.get(name)

    def set(self, name: str, value: str) -> None:
        self._items[name] = value

    def delete(self, name: str) -> bool:
        return self._items.pop(name, None) is not None


def run() -> int:
    app.KeychainSecrets = MemorySecrets  # type: ignore[misc,assignment]
    return main(["serve"])


if __name__ == "__main__":
    sys.exit(run())
