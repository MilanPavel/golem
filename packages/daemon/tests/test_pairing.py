"""Pairing a phone: ``device.pair.*`` (ADR-051, Pairing)."""

from __future__ import annotations

import hashlib
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import cast
from urllib.parse import parse_qs, urlsplit

import pytest
from test_devices import new_key
from test_server import HELLO, RpcClient, error_code, rpc_result, start_daemon, stop_daemon

from golem.relay_keys import b64, device_id, unb64
from golem.secrets import MemorySecrets
from golem.server.app import DaemonApp
from golem.server.dispatcher import DEVICE_REFUSED, INVALID_PARAMS

START = datetime(2026, 11, 21, 10, 0, tzinfo=UTC)
WORDS = ["kiln", "otter", "maple"]


class Clock:
    def __init__(self) -> None:
        self.now = START

    def __call__(self) -> datetime:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += timedelta(seconds=seconds)


@pytest.fixture
async def daemon(short_home: Path) -> AsyncIterator[DaemonApp]:
    app, task = await start_daemon(short_home, secrets=MemorySecrets())
    app.paths.config_file.write_text('[relay]\nurl = "wss://relay.example.com"\n', "utf-8")
    try:
        yield app
    finally:
        await stop_daemon(app, task)


@pytest.fixture
def clock(daemon: DaemonApp) -> Clock:
    clock = Clock()
    daemon.state.clock = clock
    return clock


async def owner(app: DaemonApp, client: str = "web") -> RpcClient:
    connection = await RpcClient.connect(app.paths.socket_path)
    rpc_result(await connection.call("hello", {**HELLO, "client": client}))
    return connection


def error_reason(payload: dict[str, object]) -> object:
    error = cast(dict[str, object], payload["error"])
    return cast(dict[str, object], error["data"])["reason"]


async def begin(client: RpcClient) -> tuple[dict[str, object], bytes]:
    result = rpc_result(await client.call("device.pair.begin"))
    query = parse_qs(urlsplit(cast(str, result["uri"])).query)
    return result, unb64(query["code"][0])


async def request(client: RpcClient, code: bytes, key: bytes | None = None) -> dict[str, object]:
    return await client.call(
        "device.pair.request",
        {
            "code": b64(code),
            "key": b64(key or new_key()),
            "name": "iPhone 16",
            "model": "iPhone17,3",
            "words": WORDS,
        },
    )


def changes(client: RpcClient) -> list[dict[str, object]]:
    return [
        cast(dict[str, object], n["params"])
        for n in client.notices
        if n["method"] == "device.pair.changed"
    ]


async def test_begin_fails_clearly_without_a_relay(daemon: DaemonApp) -> None:
    daemon.paths.config_file.write_text("", "utf-8")
    client = await owner(daemon)
    try:
        reply = await client.call("device.pair.begin")
        assert error_code(reply) == INVALID_PARAMS
        assert error_reason(reply) == "relay_not_configured"
        assert "just relay" in str(cast(dict[str, object], reply["error"])["message"])
    finally:
        await client.close()


async def test_the_link_holds_the_keys_the_code_and_the_end(
    daemon: DaemonApp, clock: Clock
) -> None:
    client = await owner(daemon)
    try:
        result, code = await begin(client)
        query = parse_qs(urlsplit(cast(str, result["uri"])).query)
        assert result["uri"].startswith("golem://pair?v=1&relay=wss://relay.example.com&mac=")  # type: ignore[union-attr]
        assert query["v"] == ["1"]
        assert query["exp"] == [str(int(START.timestamp()) + 300)]
        assert result["expires_at"] == int(START.timestamp()) + 300
        assert len(code) == 16
        mac = unb64(query["mac"][0])
        sync = rpc_result(await client.call("device.sync"))
        full = unb64(cast(str, sync["mac_key"]))
        assert len(mac) == 33 + 32
        assert mac[:33] == bytes([2 + (full[64] & 1)]) + full[1:33]
        assert mac[33:] == unb64(cast(str, sync["noise_key"]))
        # The relay hears only the slot.
        assert sync["pairs"] == [
            {"slot": b64(hashlib.sha256(code).digest()), "exp": int(START.timestamp()) + 300}
        ]
        assert b64(code) not in str(sync)
    finally:
        await client.close()


async def test_a_right_code_shows_the_words_and_confirming_stores_the_phone(
    daemon: DaemonApp, clock: Clock
) -> None:
    client = await owner(daemon)
    gateway = await owner(daemon, "gateway")
    try:
        started, code = await begin(client)
        key = new_key()
        got = rpc_result(await request(gateway, code, key))
        assert got == {"pair": started["pair"]}
        await client.take_events()
        states = changes(client)
        assert [s["state"] for s in states] == ["waiting", "words"]
        assert states[1]["words"] == WORDS
        assert states[1]["device"] == {
            "id": device_id(key),
            "name": "iPhone 16",
            "model": "iPhone17,3",
        }
        # The code is spent: the slot is gone from the sync.
        assert rpc_result(await client.call("device.sync"))["pairs"] == []

        done = rpc_result(await client.call("device.pair.confirm", {"pair": started["pair"]}))
        assert cast(dict[str, object], done["device"])["id"] == device_id(key)
        await client.take_events()
        assert changes(client)[-1]["state"] == "paired"
        assert "device.changed" in [n["method"] for n in client.notices]
        listed = rpc_result(await client.call("device.list"))["devices"]
        assert [d["id"] for d in listed] == [device_id(key)]  # type: ignore[index]
        sync = rpc_result(await client.call("device.sync"))
        assert sync["devices"] == [{"id": device_id(key), "key": b64(key)}]
    finally:
        await client.close()
        await gateway.close()


async def test_a_spent_code_is_refused_even_when_the_owner_never_confirmed(
    daemon: DaemonApp, clock: Clock
) -> None:
    client = await owner(daemon)
    try:
        _, code = await begin(client)
        rpc_result(await request(client, code))
        again = await request(client, code)
        assert error_code(again) == DEVICE_REFUSED
        assert error_reason(again) == "pair_expired"
    finally:
        await client.close()


async def test_the_code_ends_after_five_minutes(daemon: DaemonApp, clock: Clock) -> None:
    client = await owner(daemon)
    try:
        _, code = await begin(client)
        clock.advance(299)
        assert len(rpc_result(await client.call("device.sync"))["pairs"]) == 1  # type: ignore[arg-type]
        clock.advance(2)
        assert rpc_result(await client.call("device.sync"))["pairs"] == []
        daemon.state.pairing.expire_due()  # type: ignore[union-attr]
        await client.take_events()
        assert changes(client)[-1]["state"] == "expired"
        late = await request(client, code)
        assert error_reason(late) == "pair_expired"
    finally:
        await client.close()


async def test_a_wrong_code_counts_and_the_third_cancels(daemon: DaemonApp, clock: Clock) -> None:
    client = await owner(daemon)
    try:
        _, code = await begin(client)
        for _ in range(2):
            assert error_reason(await request(client, b"\x01" * 16)) == "pair_wrong_code"
        assert error_reason(await request(client, b"\x02" * 16)) == "pair_wrong_code"
        await client.take_events()
        assert changes(client)[-1]["state"] == "refused"
        assert error_reason(await request(client, code)) == "pair_expired"
        assert rpc_result(await client.call("device.list"))["devices"] == []
    finally:
        await client.close()


async def test_refusing_stores_nothing_and_needs_a_new_code(
    daemon: DaemonApp, clock: Clock
) -> None:
    client = await owner(daemon)
    try:
        started, code = await begin(client)
        rpc_result(await request(client, code))
        done = rpc_result(
            await client.call("device.pair.confirm", {"pair": started["pair"], "accept": False})
        )
        assert done == {"device": None}
        await client.take_events()
        assert changes(client)[-1]["state"] == "refused"
        assert rpc_result(await client.call("device.list"))["devices"] == []
        assert error_reason(await request(client, code)) == "pair_expired"
    finally:
        await client.close()


async def test_the_owner_has_two_minutes_to_confirm(daemon: DaemonApp, clock: Clock) -> None:
    client = await owner(daemon)
    try:
        started, code = await begin(client)
        rpc_result(await request(client, code))
        clock.advance(119)
        daemon.state.pairing.expire_due()  # type: ignore[union-attr]
        ok = rpc_result(await client.call("device.pair.confirm", {"pair": started["pair"]}))
        assert ok["device"] is not None

        started, code = await begin(client)
        rpc_result(await request(client, code))
        clock.advance(121)
        late = await client.call("device.pair.confirm", {"pair": started["pair"]})
        assert error_code(late) == DEVICE_REFUSED
        assert error_reason(late) == "pair_expired"
    finally:
        await client.close()


async def test_a_phone_that_was_paired_before_is_refused(daemon: DaemonApp, clock: Clock) -> None:
    client = await owner(daemon)
    try:
        key = new_key()
        await daemon.state.devices.add(key, "Old", START.isoformat())  # type: ignore[union-attr]
        started, code = await begin(client)
        rpc_result(await request(client, code, key))
        reply = await client.call("device.pair.confirm", {"pair": started["pair"]})
        assert error_reason(reply) == "pair_refused"
    finally:
        await client.close()


async def test_only_one_pairing_is_open_and_a_new_one_replaces_it(
    daemon: DaemonApp, clock: Clock
) -> None:
    client = await owner(daemon)
    try:
        _, first = await begin(client)
        _, second = await begin(client)
        assert error_reason(await request(client, first)) == "pair_wrong_code"
        rpc_result(await request(client, second))
    finally:
        await client.close()


async def test_a_paired_phones_connection_does_not_hear_pairing_notes(
    daemon: DaemonApp, clock: Clock
) -> None:
    phone_key = new_key()
    phone = await daemon.state.devices.add(phone_key, "Mine", START.isoformat())  # type: ignore[union-attr]
    from_phone = await RpcClient.connect(daemon.paths.socket_path)
    rpc_result(await from_phone.call("connection.identify", {"device": phone.id}))
    rpc_result(await from_phone.call("hello", {**HELLO, "client": "gateway"}))
    client = await owner(daemon)
    try:
        await begin(client)
        await from_phone.take_events()
        await client.take_events()
        assert changes(client) != []
        assert changes(from_phone) == []
    finally:
        await client.close()
        await from_phone.close()


async def test_rename_and_revoke_list_the_rules_the_phone_made(
    daemon: DaemonApp, clock: Clock
) -> None:
    devices = daemon.state.devices
    assert devices is not None
    client = await owner(daemon)
    try:
        phone = await devices.add(new_key(), "iPhone", START.isoformat())
        await devices.note_rule("shell(git status)", phone.id, START.isoformat())
        await devices.note_rule("fs.write(docs/**)", phone.id, START.isoformat())
        listed = rpc_result(await client.call("device.list"))["devices"]
        assert listed[0]["rules"] == 2  # type: ignore[index]

        renamed = rpc_result(
            await client.call("device.rename", {"device": phone.id, "name": "Milan's"})
        )
        assert cast(dict[str, object], renamed["device"])["name"] == "Milan's"

        revoked = rpc_result(await client.call("device.revoke", {"device": phone.id}))
        assert revoked["revoked"] is True
        assert [r["rule"] for r in revoked["rules"]] == ["shell(git status)", "fs.write(docs/**)"]  # type: ignore[index]
        assert cast(dict[str, object], revoked["device"])["revoked_at"] is not None
        # They stay in the registry, and the list still shows the revoked phone last.
        again = rpc_result(await client.call("device.revoke", {"device": phone.id}))
        assert again["revoked"] is False
        assert len(cast(list[object], again["rules"])) == 2
        assert (await devices.get(phone.id)).public_key is None  # type: ignore[union-attr]

        bad = await client.call("device.revoke", {"device": "0" * 32})
        assert error_code(bad) == INVALID_PARAMS
        gone = await client.call("device.rename", {"device": phone.id, "name": "x"})
        assert error_code(gone) == INVALID_PARAMS
    finally:
        await client.close()


async def test_the_code_is_in_no_log_line(
    daemon: DaemonApp, clock: Clock, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level("DEBUG")
    client = await owner(daemon)
    try:
        _, code = await begin(client)
        await request(client, code)
        assert b64(code) not in caplog.text
    finally:
        await client.close()
