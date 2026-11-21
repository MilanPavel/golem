"""The device registry: paired phones, and the origin of the rules they wrote (ADR-051).

A revoked row stays, so the rules that came from the device can still name it. Its key and
its push token are deleted. ``seq`` grows by one with each change the gateway must hear of:
a device added, renamed, or revoked. ``last_seen`` and a push token change nothing it uses.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime

from golem.relay_keys import check_public_key, device_id
from golem.store.database import Database, Transaction

__all__ = ["LAST_SEEN_EVERY", "Device", "DeviceExistsError", "DeviceStore", "RuleOrigin"]

LAST_SEEN_EVERY = 60.0
"""``last_seen`` is written at most this often, in seconds."""

_COLUMNS = "id, name, public_key, paired_at, last_seen, apns_token, apns_env, revoked_at"


class DeviceExistsError(Exception):
    """A device with this key was already paired. A revoked one is not paired again."""


@dataclass(frozen=True, slots=True)
class Device:
    id: str
    name: str
    public_key: bytes | None
    """65 bytes, uncompressed. None once the device is revoked."""
    paired_at: str
    last_seen: str | None
    apns_token: str | None
    apns_env: str | None
    revoked_at: str | None

    @property
    def revoked(self) -> bool:
        return self.revoked_at is not None


@dataclass(frozen=True, slots=True)
class RuleOrigin:
    """The device that wrote a rule: its id, its name then, and when."""

    rule: str
    device_id: str
    device_name: str
    at: str


def _device(row: sqlite3.Row) -> Device:
    key = row["public_key"]
    return Device(
        id=row["id"],
        name=row["name"],
        public_key=None if key is None else bytes(key),
        paired_at=row["paired_at"],
        last_seen=row["last_seen"],
        apns_token=row["apns_token"],
        apns_env=row["apns_env"],
        revoked_at=row["revoked_at"],
    )


async def _bump(tx: Transaction) -> None:
    await tx.execute("UPDATE device_state SET seq = seq + 1 WHERE id = 1")


class DeviceStore:
    def __init__(self, database: Database) -> None:
        self._database = database
        self.on_change: Callable[[], None] | None = None
        """Called after a change the gateway must sync again for."""

    def _changed(self) -> None:
        if self.on_change is not None:
            self.on_change()

    async def seq(self) -> int:
        row = await self._database.fetch_one("SELECT seq FROM device_state WHERE id = 1")
        return 0 if row is None else int(row["seq"])

    async def get(self, device: str) -> Device | None:
        row = await self._database.fetch_one(
            f"SELECT {_COLUMNS} FROM devices WHERE id = ?", (device,)
        )
        return None if row is None else _device(row)

    async def active(self, device: str) -> bool:
        """Whether ``device`` exists and is not revoked."""
        row = await self._database.fetch_one(
            "SELECT 1 FROM devices WHERE id = ? AND revoked_at IS NULL", (device,)
        )
        return row is not None

    async def list(self, *, include_revoked: bool = False) -> list[Device]:
        where = "" if include_revoked else " WHERE revoked_at IS NULL"
        rows = await self._database.fetch_all(
            f"SELECT {_COLUMNS} FROM devices{where} ORDER BY revoked_at IS NOT NULL, paired_at, id"
        )
        return [_device(row) for row in rows]

    async def add(self, public_key: bytes, name: str, at: str) -> Device:
        """Pair a device. Raises :class:`ValueError` for a bad key, :class:`DeviceExistsError`."""
        check_public_key(public_key)
        device = device_id(public_key)
        async with self._database.transaction() as tx:
            if await tx.fetch_all("SELECT 1 FROM devices WHERE id = ?", (device,)):
                raise DeviceExistsError(device)
            await tx.execute(
                "INSERT INTO devices (id, name, public_key, paired_at) VALUES (?, ?, ?, ?)",
                (device, name, public_key, at),
            )
            await _bump(tx)
        self._changed()
        created = await self.get(device)
        assert created is not None
        return created

    async def rename(self, device: str, name: str) -> bool:
        """Returns False for an unknown device."""
        async with self._database.transaction() as tx:
            changed = await tx.execute("UPDATE devices SET name = ? WHERE id = ?", (name, device))
            if changed:
                await _bump(tx)
        if changed:
            self._changed()
        return bool(changed)

    async def revoke(self, device: str, at: str) -> bool:
        """Mark it revoked and delete its key and token. False when unknown or already revoked."""
        async with self._database.transaction() as tx:
            changed = await tx.execute(
                "UPDATE devices SET revoked_at = ?, public_key = NULL, apns_token = NULL,"
                " apns_env = NULL WHERE id = ? AND revoked_at IS NULL",
                (at, device),
            )
            if changed:
                await _bump(tx)
        if changed:
            self._changed()
        return bool(changed)

    async def touch(self, device: str, now: datetime) -> bool:
        """Write ``last_seen``, at most once a minute. Returns whether it wrote."""
        async with self._database.transaction() as tx:
            rows = await tx.fetch_all(
                "SELECT last_seen FROM devices WHERE id = ? AND revoked_at IS NULL", (device,)
            )
            if not rows:
                return False
            last = rows[0]["last_seen"]
            if last is not None:
                try:
                    if (now - datetime.fromisoformat(last)).total_seconds() < LAST_SEEN_EVERY:
                        return False
                except ValueError:
                    pass
            await tx.execute(
                "UPDATE devices SET last_seen = ? WHERE id = ?", (now.isoformat(), device)
            )
        return True

    async def set_push(self, device: str, token: str, env: str) -> bool:
        """Remember the phone's push token. False for an unknown or revoked device."""
        async with self._database.transaction() as tx:
            changed = await tx.execute(
                "UPDATE devices SET apns_token = ?, apns_env = ? WHERE id = ?"
                " AND revoked_at IS NULL",
                (token, env, device),
            )
        return bool(changed)

    async def note_rule(self, rule: str, device: str, at: str) -> None:
        """Record that ``device`` wrote ``rule``, with the device's name now."""
        async with self._database.transaction() as tx:
            await tx.execute(
                "INSERT INTO rule_origins (rule, device_id, device_name, at)"
                " SELECT ?, id, name, ? FROM devices WHERE id = ?",
                (rule, at, device),
            )

    async def rule_origins(self, rule: str) -> list[RuleOrigin]:
        rows = await self._database.fetch_all(
            "SELECT rule, device_id, device_name, at FROM rule_origins WHERE rule = ?"
            " ORDER BY origin_id",
            (rule,),
        )
        return [RuleOrigin(r["rule"], r["device_id"], r["device_name"], r["at"]) for r in rows]

    async def rules_of(self, device: str) -> list[RuleOrigin]:
        """The rules ``device`` wrote, oldest first. They stay after a revoke."""
        rows = await self._database.fetch_all(
            "SELECT rule, device_id, device_name, at FROM rule_origins WHERE device_id = ?"
            " ORDER BY origin_id",
            (device,),
        )
        return [RuleOrigin(r["rule"], r["device_id"], r["device_name"], r["at"]) for r in rows]

    async def rule_counts(self) -> dict[str, int]:
        """How many rules each device wrote, by device id."""
        rows = await self._database.fetch_all(
            "SELECT device_id, COUNT(DISTINCT rule) AS n FROM rule_origins GROUP BY device_id"
        )
        return {r["device_id"]: int(r["n"]) for r in rows}
