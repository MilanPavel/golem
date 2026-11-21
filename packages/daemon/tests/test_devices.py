"""The device registry: a ``devices`` table, ``seq``, revoke, and where a rule came from."""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from golem.relay_keys import device_id
from golem.store.database import Database
from golem.store.devices import DeviceExistsError, DeviceStore

AT = "2026-11-21T10:00:00+01:00"


def new_key() -> bytes:
    return (
        ec.generate_private_key(ec.SECP256R1())
        .public_key()
        .public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    )


async def test_a_device_is_added_with_the_id_of_its_key(database: Database) -> None:
    store = DeviceStore(database)
    key = new_key()
    device = await store.add(key, "iPhone 16", AT)
    assert device.id == device_id(key)
    assert (device.name, device.public_key, device.paired_at) == ("iPhone 16", key, AT)
    assert device.last_seen is None
    assert not device.revoked
    assert await store.get(device.id) == device
    assert await store.active(device.id)
    assert await store.list() == [device]


async def test_a_bad_key_and_a_repeated_key_are_refused(database: Database) -> None:
    store = DeviceStore(database)
    with pytest.raises(ValueError, match="65 bytes"):
        await store.add(b"\x04" * 10, "x", AT)
    key = new_key()
    await store.add(key, "one", AT)
    with pytest.raises(DeviceExistsError):
        await store.add(key, "two", AT)
    assert await store.seq() == 1


async def test_seq_grows_by_one_with_each_change_and_on_change_is_called(
    database: Database,
) -> None:
    store = DeviceStore(database)
    calls: list[int] = []
    store.on_change = lambda: calls.append(1)
    assert await store.seq() == 0
    device = await store.add(new_key(), "a", AT)
    assert (await store.seq(), len(calls)) == (1, 1)
    assert await store.rename(device.id, "b")
    assert (await store.seq(), len(calls)) == (2, 2)
    assert await store.revoke(device.id, AT)
    assert (await store.seq(), len(calls)) == (3, 3)
    # Nothing changed, so nothing is announced.
    assert not await store.rename("0" * 32, "x")
    assert not await store.revoke(device.id, AT)
    assert (await store.seq(), len(calls)) == (3, 3)


async def test_revoke_keeps_the_row_and_deletes_the_key_and_the_token(database: Database) -> None:
    store = DeviceStore(database)
    device = await store.add(new_key(), "iPhone", AT)
    assert await store.set_push(device.id, "ab12", "sandbox")
    assert (await store.get(device.id)) is not None
    await store.revoke(device.id, "2026-11-22T10:00:00+01:00")
    revoked = await store.get(device.id)
    assert revoked is not None
    assert revoked.revoked_at == "2026-11-22T10:00:00+01:00"
    assert (revoked.public_key, revoked.apns_token, revoked.apns_env) == (None, None, None)
    assert revoked.name == "iPhone"
    assert not await store.active(device.id)
    assert await store.list() == []
    assert await store.list(include_revoked=True) == [revoked]
    assert not await store.set_push(device.id, "cd34", "production")


async def test_last_seen_is_written_at_most_once_a_minute(database: Database) -> None:
    store = DeviceStore(database)
    device = await store.add(new_key(), "a", AT)
    start = datetime.fromisoformat(AT)
    assert await store.touch(device.id, start)
    assert not await store.touch(device.id, start + timedelta(seconds=59))
    assert await store.touch(device.id, start + timedelta(seconds=61))
    seen = await store.get(device.id)
    assert seen is not None
    assert seen.last_seen == (start + timedelta(seconds=61)).isoformat()
    assert await store.seq() == 1
    assert not await store.touch("0" * 32, start)


async def test_a_rule_keeps_the_device_that_wrote_it_even_after_a_revoke(
    database: Database,
) -> None:
    store = DeviceStore(database)
    device = await store.add(new_key(), "iPhone 16", AT)
    await store.note_rule("~/config.toml rule 3", device.id, AT)
    await store.revoke(device.id, AT)
    [origin] = await store.rule_origins("~/config.toml rule 3")
    assert (origin.device_id, origin.device_name, origin.at) == (device.id, "iPhone 16", AT)
    assert await store.rule_origins("~/config.toml rule 4") == []
    # An unknown device writes no origin.
    await store.note_rule("~/config.toml rule 5", "f" * 32, AT)
    assert await store.rule_origins("~/config.toml rule 5") == []
