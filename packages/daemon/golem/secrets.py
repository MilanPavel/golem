"""Every secret golem keeps, in the OS credential store and nowhere else.

On macOS that is the login Keychain, through ``/usr/bin/security``, under the
service ``golem``; elsewhere it is whatever ``keyring`` finds. A secret has a name in a namespace:

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
import subprocess
import sys
import threading
from collections.abc import Callable, Generator
from pathlib import Path
from typing import Annotated, Protocol

from pydantic import AfterValidator

from golem.paths import resolve_paths

SERVICE = "golem"
# A Keychain read that takes longer than this is waiting on macOS: most likely
# its dialog asking whether golem may use the item. A build signed without an
# Apple Team ID gets a new partition each release, so macOS asks after every
# upgrade (ADR-021).
WAIT_NOTICE_SECONDS = 0.5
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


SECURITY = "/usr/bin/security"
_NOT_FOUND = 44
"""``security`` exits with this when an item does not exist."""

SecurityRunner = Callable[[str], tuple[int, str, str]]
"""Runs ``security -i`` with a text on stdin. Returns ``(exit code, stdout, stderr)``."""


def _run_security(commands: str) -> tuple[int, str, str]:
    try:
        done = subprocess.run(  # fixed program; the commands go on stdin
            [SECURITY, "-i", "-p", ""],
            input=commands,
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError as exc:
        raise SecretStoreError(f"keychain is unavailable: {exc}") from exc
    return done.returncode, done.stdout, done.stderr


def _quote(text: str) -> str:
    """``text`` as one ``security -i`` word.

    ``security -i`` splits its line like a shell. Inside double quotes only
    ``"`` and ``\\`` are special, so those two are escaped and everything else,
    spaces, ``$``, quotes and ``#`` included, stays literal. A newline would
    end the command and start another, so only printable ASCII passes. It is
    also all ``security -w`` prints back as text: anything else comes back as hex.
    """
    if not all(" " <= ch <= "~" for ch in text):
        raise SecretStoreError("the Keychain holds only printable ASCII text")
    return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _uses_security() -> bool:
    return sys.platform == "darwin"


class KeychainSecrets:
    """The OS credential store with a read cache. Golem changes secrets only through this object.

    On macOS it talks to ``/usr/bin/security``, which Apple signs and which does
    not change between golem releases, so an upgrade never asks to unlock an
    item again (ADR-021). Elsewhere it uses ``keyring``.
    """

    def __init__(
        self,
        service: str = SERVICE,
        *,
        wait_notice_seconds: float = WAIT_NOTICE_SECONDS,
        use_security: bool | None = None,
        runner: SecurityRunner | None = None,
    ) -> None:
        self._service = service
        self._cache: dict[str, str | None] = {}
        self._wait_notice_seconds = wait_notice_seconds
        self._security = _uses_security() if use_security is None else use_security
        self._runner = runner or _run_security
        self.on_wait: Callable[[str, bool], None] | None = None
        """Called with ``(name, True)`` when a read is slow, then ``(name, False)`` when it ends.

        It runs on whatever thread reads the Keychain.
        """

    # -- the two stores -------------------------------------------------

    def _security_run(self, command: str, *, secret: bool = False) -> tuple[int, str]:
        """``(0, stdout)`` or ``(44, "")`` for a missing item; other failures raise.

        ``secret`` keeps the command, and so any echo of it, out of the error.
        """
        code, out, err = self._runner(command + "\n")
        if code == 0:
            return 0, out
        if code == _NOT_FOUND or "could not be found" in err:
            return _NOT_FOUND, ""
        detail = "" if secret else f": {err.strip().splitlines()[-1] if err.strip() else ''}"
        raise SecretStoreError(f"keychain is unavailable (security exit {code}){detail}")

    def _item(self, name: str) -> str:
        return f"-s {_quote(self._service)} -a {_quote(account(name))}"

    def _security_get(self, name: str) -> str | None:
        code, out = self._security_run(f"find-generic-password {self._item(name)} -w")
        if code == _NOT_FOUND:
            return None
        return out.removesuffix("\n")

    def _security_set(self, name: str, value: str) -> None:
        command = f"add-generic-password -U {self._item(name)} -w {_quote(value)}"
        self._security_run(command, secret=True)

    def _security_delete(self, name: str) -> bool:
        code, _ = self._security_run(f"delete-generic-password {self._item(name)}")
        return code == 0

    def _keyring_get(self, name: str) -> str | None:
        import keyring
        from keyring.errors import KeyringError

        try:
            return keyring.get_password(self._service, account(name))
        except KeyringError as exc:
            raise SecretStoreError(f"keychain is unavailable: {exc}") from exc

    # -- the API --------------------------------------------------------

    def get(self, name: str) -> str | None:
        if name in self._cache:
            return self._cache[name]
        with self._watch(name):
            if self._security and self._needs_claim(name):
                # An item an earlier build stored belongs to that build. Read it
                # once the old way, then move it to ``security``.
                value = self._keyring_get(name)
                self._cache[name] = value
                if value:
                    self._claim(name, value)
            else:
                value = self._security_get(name) if self._security else self._keyring_get(name)
                self._cache[name] = value
        return value

    @contextlib.contextmanager
    def _watch(self, name: str) -> Generator[None]:
        """Tell :attr:`on_wait` when the read inside takes a moment, and when it ends."""
        listener = self.on_wait
        if listener is None:
            yield
            return
        fired = threading.Event()

        def slow() -> None:
            fired.set()
            listener(name, True)

        timer = threading.Timer(self._wait_notice_seconds, slow)
        timer.daemon = True
        timer.start()
        try:
            yield
        finally:
            timer.cancel()
            # Timer.cancel can't stop a callback that already began, so wait for it.
            if timer.is_alive():
                timer.join()
            if fired.is_set():
                listener(name, False)

    def set(self, name: str, value: str) -> None:
        if self._security:
            if self._needs_claim(name):
                # Replace, not update: an update keeps the old owner of the item.
                self._security_delete(name)
            self._security_set(name, value)
            self._mark_claimed(name)
        else:
            import keyring
            from keyring.errors import KeyringError

            try:
                keyring.set_password(self._service, account(name), value)
            except KeyringError as exc:
                raise SecretStoreError(f"keychain is unavailable: {exc}") from exc
        self._cache[name] = value

    def delete(self, name: str) -> bool:
        if self._security:
            found = self._security_delete(name)
            self._mark_claimed(name)
            self._cache[name] = None
            return found
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

    # -- moving items from ``keyring`` to ``security`` -------------------

    @staticmethod
    def _marker() -> Path:
        return resolve_paths().run_dir / "keychain-security"

    def _needs_claim(self, name: str) -> bool:
        """A frozen macOS build has not yet moved ``name`` to ``security``."""
        return (
            self._security
            and bool(getattr(sys, "frozen", False))
            and name not in _read_claimed(self._marker())
        )

    def _mark_claimed(self, name: str) -> None:
        if self._security and getattr(sys, "frozen", False):
            marker = self._marker()
            claimed = _read_claimed(marker)
            if name not in claimed:
                claimed.add(name)
                _write_claimed(marker, claimed)

    def _claim(self, name: str, value: str) -> None:
        """A frozen build stores an item again through ``security``, once.

        The read through ``keyring`` may have prompted: it is the last prompt.
        Deleting and adding the item makes ``security`` its owner, so no later
        build is a new program to the Keychain. ``run/keychain-security``
        records the name. A value ``security`` cannot hold stays where it is.
        """
        if not self._needs_claim(name):
            return
        try:
            _quote(value)
        except SecretStoreError:
            return
        self._security_delete(name)
        self._security_set(name, value)
        self._mark_claimed(name)


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
    "SecurityRunner",
    "account",
    "check_name",
    "resolve",
]
