"""The gateway's methods on the Unix socket: ``device.sync``, ``relay.*``, and identify."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from pathlib import Path
from types import SimpleNamespace
from typing import Any, cast

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import x25519
from test_devices import new_key
from test_server import HELLO, RpcClient, error_code, rpc_result, start_daemon, stop_daemon

from golem.relay_keys import SIGN_PREFIX, b64, device_id, unb64, verify
from golem.secrets import MemorySecrets
from golem.server.app import DaemonApp
from golem.server.dispatcher import (
    DEVICE_REFUSED,
    HELLO_REQUIRED,
    INVALID_PARAMS,
    METHOD_NOT_FOUND,
    RequestContext,
)
from golem.server.handlers import standard_methods
from golem.server.state import DaemonState
from golem.store.devices import DeviceStore
from golem_protocol.commands import ApprovalRespondParams

AT = "2026-11-21T10:00:00+01:00"


@pytest.fixture
async def daemon(short_home: Path) -> AsyncIterator[DaemonApp]:
    app, task = await start_daemon(short_home, secrets=MemorySecrets())
    try:
        yield app
    finally:
        await stop_daemon(app, task)


def registry(app: DaemonApp) -> DeviceStore:
    devices = app.state.devices
    assert devices is not None
    return devices


async def client_of(app: DaemonApp, *, hello: bool = True) -> RpcClient:
    client = await RpcClient.connect(app.paths.socket_path)
    if hello:
        rpc_result(await client.call("hello", {**HELLO, "client": "gateway"}))
    return client


def message(tail: bytes = b"mac" + b"relay.example" + b"nonce") -> str:
    return b64(SIGN_PREFIX + tail)


async def test_device_sync_has_the_shape_of_the_record(daemon: DaemonApp) -> None:
    client = await client_of(daemon)
    try:
        first = rpc_result(await client.call("device.sync"))
        assert set(first) == {"url", "room", "mac_key", "noise_key", "seq", "devices", "pairs"}
        assert first["url"] is None
        assert first["seq"] == 0
        assert first["devices"] == []
        assert first["pairs"] == []
        assert len(unb64(cast(str, first["mac_key"]))) == 65
        assert len(unb64(cast(str, first["noise_key"]))) == 32
        assert len(unb64(cast(str, first["room"]))) == 32
        again = rpc_result(await client.call("device.sync"))
        assert again == first
    finally:
        await client.close()


async def test_device_sync_lists_a_device_and_bumps_seq_and_device_changed_is_sent(
    daemon: DaemonApp,
) -> None:
    client = await client_of(daemon)
    try:
        key = new_key()
        device = await registry(daemon).add(key, "iPhone 16", AT)
        await client.take_events()
        assert [note["method"] for note in client.notices] == ["device.changed"]
        sync = rpc_result(await client.call("device.sync"))
        assert sync["seq"] == 1
        assert sync["devices"] == [{"id": device.id, "key": b64(key)}]

        await registry(daemon).revoke(device.id, AT)
        await client.take_events()
        assert [note["method"] for note in client.notices] == ["device.changed"] * 2
        sync = rpc_result(await client.call("device.sync"))
        assert sync["seq"] == 2
        assert sync["devices"] == []
    finally:
        await client.close()


async def test_device_sync_reads_the_relay_url(daemon: DaemonApp) -> None:
    daemon.paths.config_file.write_text('[relay]\nurl = "wss://relay.example.com"\n', "utf-8")
    client = await client_of(daemon)
    try:
        assert rpc_result(await client.call("device.sync"))["url"] == "wss://relay.example.com"
    finally:
        await client.close()


async def test_relay_sign_signs_a_relay_message_that_verifies_with_the_synced_key(
    daemon: DaemonApp,
) -> None:
    client = await client_of(daemon)
    try:
        mac_key = unb64(cast(str, rpc_result(await client.call("device.sync"))["mac_key"]))
        text = message()
        result = rpc_result(await client.call("relay.sign", {"message": text}))
        assert set(result) == {"sig"}
        sig = unb64(cast(str, result["sig"]))
        assert len(sig) == 64
        assert verify(mac_key, unb64(text), sig)
        assert not verify(mac_key, unb64(message(b"other")), sig)
    finally:
        await client.close()


@pytest.mark.parametrize("raw", [b"golem-auth-v1" + b"h" * 32, b"golem-relay-v1", b"x"])
async def test_relay_sign_refuses_any_other_message(daemon: DaemonApp, raw: bytes) -> None:
    client = await client_of(daemon)
    try:
        refused = await client.call("relay.sign", {"message": b64(raw)})
        assert error_code(refused) == INVALID_PARAMS
        assert "result" not in refused
        assert error_code(await client.call("relay.sign", {"message": "not base64!"})) == (
            INVALID_PARAMS
        )
    finally:
        await client.close()


async def test_relay_dh_agrees_with_an_x25519_from_the_other_side(daemon: DaemonApp) -> None:
    client = await client_of(daemon)
    try:
        noise = unb64(cast(str, rpc_result(await client.call("device.sync"))["noise_key"]))
        phone = x25519.X25519PrivateKey.generate()
        public = phone.public_key().public_bytes(
            serialization.Encoding.Raw, serialization.PublicFormat.Raw
        )
        result = rpc_result(await client.call("relay.dh", {"public_key": b64(public)}))
        assert set(result) == {"shared"}
        assert unb64(cast(str, result["shared"])) == phone.exchange(
            x25519.X25519PublicKey.from_public_bytes(noise)
        )
    finally:
        await client.close()


async def test_relay_dh_refuses_an_all_zero_result(daemon: DaemonApp) -> None:
    client = await client_of(daemon)
    try:
        refused = await client.call("relay.dh", {"public_key": b64(bytes(32))})
        assert error_code(refused) == INVALID_PARAMS
    finally:
        await client.close()


async def test_the_private_keys_never_come_back(daemon: DaemonApp) -> None:
    secrets = daemon.state.secrets
    assert isinstance(secrets, MemorySecrets)
    client = await client_of(daemon)
    try:
        replies = [
            await client.call("device.sync"),
            await client.call("relay.sign", {"message": message()}),
        ]
    finally:
        await client.close()
    assert set(secrets.secrets) == {"relay/identity", "relay/noise"}
    for stored in secrets.secrets.values():
        assert not any(stored in str(reply) for reply in replies)


async def test_identify_sets_the_device_before_hello_and_refuses_an_unknown_one(
    daemon: DaemonApp,
) -> None:
    device = await registry(daemon).add(new_key(), "iPhone", AT)
    client = await client_of(daemon, hello=False)
    try:
        unknown = await client.call("connection.identify", {"device": "0" * 32})
        assert error_code(unknown) == DEVICE_REFUSED
        assert unknown["error"]["data"] == {"reason": "unknown_device"}  # type: ignore[index]
        bad = await client.call("connection.identify", {"device": "nope"})
        assert error_code(bad) == INVALID_PARAMS
        assert rpc_result(await client.call("connection.identify", {"device": device.id})) == {}
        assert error_code(await client.call("ping", {"nonce": "x"})) == HELLO_REQUIRED
        rpc_result(await client.call("hello", HELLO))
        assert rpc_result(await client.call("ping", {"nonce": "x"}))["nonce"] == "x"
        seen = await registry(daemon).get(device.id)
        assert seen is not None
        assert seen.last_seen is not None
    finally:
        await client.close()


async def test_identify_refuses_a_revoked_device(daemon: DaemonApp) -> None:
    device = await registry(daemon).add(new_key(), "iPhone", AT)
    await registry(daemon).revoke(device.id, AT)
    client = await client_of(daemon, hello=False)
    try:
        refused = await client.call("connection.identify", {"device": device.id})
        assert error_code(refused) == DEVICE_REFUSED
        assert refused["error"]["data"] == {"reason": "revoked"}  # type: ignore[index]
        assert error_code(await client.call("ping", {"nonce": "x"})) == HELLO_REQUIRED
    finally:
        await client.close()


async def test_a_call_from_a_revoked_device_is_refused_and_its_connection_closed(
    daemon: DaemonApp,
) -> None:
    devices = registry(daemon)
    device = await devices.add(new_key(), "iPhone", AT)
    client = await client_of(daemon, hello=False)
    other = await client_of(daemon)
    try:
        rpc_result(await client.call("connection.identify", {"device": device.id}))
        rpc_result(await client.call("hello", HELLO))
        # The registry closes the connection of a device the moment it is revoked.
        await devices.revoke(device.id, AT)
        await asyncio.wait_for(client._pump, 2)  # pyright: ignore[reportPrivateUsage]
        # Another client is not touched.
        assert rpc_result(await other.call("ping", {"nonce": "y"}))["nonce"] == "y"
    finally:
        await client.close()
        await other.close()


async def test_every_call_of_a_revoked_device_is_refused_even_if_it_was_still_open(
    daemon: DaemonApp,
) -> None:
    devices = registry(daemon)
    device = await devices.add(new_key(), "iPhone", AT)
    client = await client_of(daemon, hello=False)
    try:
        rpc_result(await client.call("connection.identify", {"device": device.id}))
        rpc_result(await client.call("hello", HELLO))
        # Revoke under the dispatcher's feet: no on_change, so only the per-call check runs.
        devices.on_change = None
        await devices.revoke(device.id, AT)
        refused = await client.call(
            "approval.respond", {"session_id": "s", "call_id": "c", "decision": "allow"}
        )
        assert error_code(refused) == DEVICE_REFUSED
        await asyncio.wait_for(client._pump, 2)  # pyright: ignore[reportPrivateUsage]
    finally:
        await client.close()


async def test_a_plain_client_has_no_device(daemon: DaemonApp) -> None:
    client = await client_of(daemon)
    try:
        assert rpc_result(await client.call("ping", {"nonce": "z"}))["nonce"] == "z"
        assert error_code(await client.call("nope.nothing")) == METHOD_NOT_FOUND
    finally:
        await client.close()


async def test_approval_respond_passes_the_identified_device_to_the_session_manager() -> None:
    seen: list[dict[str, Any]] = []

    class Sessions:
        async def respond(self, *args: object, **kwargs: object) -> str:
            seen.append({"args": args, "kwargs": kwargs})
            return "run_1"

    state = cast(DaemonState, SimpleNamespace(sessions=Sessions()))
    params = ApprovalRespondParams(session_id="s1", call_id="c1", decision="allow_always")
    call = standard_methods()["approval.respond"].call
    device = device_id(new_key())
    for named in (device, None):
        connection = SimpleNamespace(device=named)
        await call(RequestContext(state=state, connection=cast(Any, connection)), params)
    assert [entry["kwargs"] for entry in seen] == [{"device": device}, {"device": None}]
