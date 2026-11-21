"""One open pairing of a phone (ADR-051, Pairing).

``begin`` makes a 16-byte code that lasts 5 minutes and works once. The first handshake that
presents it spends it, whether or not the owner then confirms. A wrong code counts, and the third
wrong one cancels the pairing. The owner has 2 minutes to compare the three words with the phone
and confirm. Only one pairing is open at a time. The code is never logged and never leaves the
daemon except in the QR link and, as ``SHA-256(code)``, in the relay's pair slot.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import logging
import re
import secrets as randomness
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from golem.relay_keys import b64, device_id
from golem.store.devices import Device, DeviceExistsError, DeviceStore
from golem_protocol.commands import DevicePairChanged, PairingDevice, PairState
from golem_protocol.rpc import DevicePairChangedNotification

log = logging.getLogger(__name__)

CODE_BYTES = 16
CODE_LIFETIME = timedelta(minutes=5)
CONFIRM_WINDOW = timedelta(minutes=2)
MAX_WRONG_CODES = 3
_WORD = re.compile(r"^[a-z]{3,8}$")


class PairingError(Exception):
    """A pairing step was refused. ``reason`` is the gateway's error code (ADR-051)."""

    def __init__(self, reason: str, message: str) -> None:
        super().__init__(message)
        self.reason = reason


@dataclass(slots=True)
class _Open:
    pair: str
    code: bytes
    expires: datetime
    state: PairState = "waiting"
    wrong: int = 0
    key: bytes | None = None
    name: str = ""
    model: str = ""
    words: list[str] = field(default_factory=list[str])
    confirm_by: datetime | None = None
    device: str | None = None


class PairingManager:
    def __init__(
        self,
        devices: DeviceStore,
        clock: Callable[[], datetime],
        notify: Callable[[DevicePairChangedNotification], None],
        changed: Callable[[], None],
    ) -> None:
        self._devices = devices
        self._clock = clock
        self._notify = notify
        self._changed = changed
        self._open: _Open | None = None
        self._timer: asyncio.TimerHandle | None = None

    # ---- what the gateway and the pages read ----

    def slots(self) -> list[tuple[str, int]]:
        """The relay's pair slots: ``SHA-256(code)`` and its end, for a pairing still waiting."""
        current = self._open
        if current is None or current.state != "waiting" or current.expires <= self._clock():
            return []
        return [(b64(hashlib.sha256(current.code).digest()), int(current.expires.timestamp()))]

    # ---- the steps ----

    def begin(self) -> tuple[str, bytes, datetime]:
        """Open a pairing and return its id, its code, and when it ends. Replaces an open one."""
        self.expire_due()
        if self._open is not None:
            self._finish("expired")
        now = self._clock()
        opened = _Open(
            pair=randomness.token_urlsafe(9),
            code=randomness.token_bytes(CODE_BYTES),
            expires=now + CODE_LIFETIME,
        )
        self._open = opened
        self._arm()
        self._changed()  # the relay link learns of the slot
        self._emit(opened)
        return opened.pair, opened.code, opened.expires

    async def request(
        self, code: bytes, key: bytes, name: str, model: str, words: list[str]
    ) -> str:
        """A phone presents ``code`` (the gateway checked its signature). Spends the code."""
        self.expire_due()
        current = self._open
        if current is None or current.state != "waiting":
            raise PairingError("pair_expired", "no pairing is open, or its code was used")
        if not hmac.compare_digest(code, current.code):
            current.wrong += 1
            if current.wrong >= MAX_WRONG_CODES:
                self._finish("refused")
            raise PairingError("pair_wrong_code", "the pairing code is wrong")
        if not all(_WORD.match(word) for word in words):
            raise PairingError("pair_refused", "the confirmation words are not words")
        current.state = "words"
        current.key = key
        current.name = _clean(name) or "Phone"
        current.model = _clean(model)
        current.words = list(words)
        current.confirm_by = self._clock() + CONFIRM_WINDOW
        current.device = device_id(key)
        self._arm()
        self._changed()  # the slot is spent: the relay link drops it
        self._emit(current)
        return current.pair

    async def confirm(self, pair: str, accept: bool) -> Device | None:
        """The owner compared the words. Stores the phone on accept."""
        self.expire_due()
        current = self._open
        if current is None or current.pair != pair:
            raise PairingError("pair_expired", "this pairing is over")
        if not accept:
            self._finish("refused")
            return None
        if current.state != "words" or current.key is None:
            raise PairingError("pair_refused", "no phone has asked to pair yet")
        key, name = current.key, current.name
        try:
            device = await self._devices.add(key, name, self._clock().isoformat())
        except DeviceExistsError:
            self._finish("refused")
            raise PairingError("pair_refused", "this phone was paired before") from None
        except ValueError:
            self._finish("refused")
            raise PairingError("pair_refused", "the phone's key is not usable") from None
        self._finish("paired")
        return device

    def expire_due(self) -> None:
        """End a pairing whose code or confirmation window has run out."""
        current = self._open
        if current is None:
            return
        now = self._clock()
        if (current.state == "waiting" and current.expires <= now) or (
            current.state == "words"
            and current.confirm_by is not None
            and current.confirm_by <= now
        ):
            self._finish("expired")

    def close(self) -> None:
        if self._timer is not None:
            self._timer.cancel()
            self._timer = None

    # ---- inside ----

    def _finish(self, state: PairState) -> None:
        current = self._open
        if current is None:
            return
        self._open = None
        current.state = state
        if self._timer is not None:
            self._timer.cancel()
            self._timer = None
        self._emit(current)
        self._changed()

    def _emit(self, current: _Open) -> None:
        shows = current.state in ("words", "paired")
        device = (
            PairingDevice(id=current.device, name=current.name, model=current.model)
            if shows and current.device is not None
            else None
        )
        self._notify(
            DevicePairChangedNotification(
                params=DevicePairChanged(
                    pair=current.pair,
                    state=current.state,
                    words=current.words if shows else None,
                    device=device,
                )
            )
        )

    def _arm(self) -> None:
        if self._timer is not None:
            self._timer.cancel()
            self._timer = None
        current = self._open
        if current is None:
            return
        due = current.expires if current.state == "waiting" else current.confirm_by
        if due is None:
            return
        delay = max(0.0, (due - self._clock()).total_seconds())
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        self._timer = loop.call_later(delay + 0.05, self.expire_due)


def _clean(text: str) -> str:
    """Cut to 64 characters and drop control characters (the phone's name is its own claim)."""
    return "".join(ch for ch in text if ch.isprintable())[:64].strip()
