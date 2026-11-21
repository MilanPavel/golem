"""The gateway's methods: ``relay.sign``, ``relay.dh``, ``device.sync``, ``connection.identify``.

All four are ``local`` (ADR-051): only a client on the daemon's Unix socket may call them. The
Mac's private keys stay here. A failure never says more than what was refused.
"""

from __future__ import annotations

import asyncio
import logging
import socket
from urllib.parse import quote

from golem.config import load_settings
from golem.pairing import PairingError, PairingManager
from golem.relay_keys import RelayKeyError, RelayKeys, b64, unb64
from golem.secrets import SecretStoreError
from golem.server.dispatcher import (
    DEVICE_REFUSED,
    INTERNAL_ERROR,
    INVALID_PARAMS,
    KEYCHAIN_UNAVAILABLE,
    RequestContext,
    RpcCallError,
)
from golem.store.devices import Device, DeviceStore
from golem_protocol.commands import (
    ConnectionIdentifyParams,
    ConnectionIdentifyResult,
    DeviceInfo,
    DeviceListParams,
    DeviceListResult,
    DevicePairBeginParams,
    DevicePairBeginResult,
    DevicePairConfirmParams,
    DevicePairConfirmResult,
    DevicePairRequestParams,
    DevicePairRequestResult,
    DeviceRenameParams,
    DeviceRenameResult,
    DeviceRevokeParams,
    DeviceRevokeResult,
    DeviceRule,
    DeviceSyncParams,
    DeviceSyncResult,
    RelayDevice,
    RelayDhParams,
    RelayDhResult,
    RelayPair,
    RelaySignParams,
    RelaySignResult,
)

log = logging.getLogger(__name__)


def _keys(ctx: RequestContext) -> RelayKeys:
    secrets = ctx.state.secrets
    if secrets is None:
        raise RpcCallError(KEYCHAIN_UNAVAILABLE, "this daemon has no key store")
    return RelayKeys(secrets)


def _slots(ctx: RequestContext) -> list[tuple[str, int]]:
    pairing = ctx.state.pairing
    return [] if pairing is None else pairing.slots()


def _pairing(ctx: RequestContext) -> PairingManager:
    pairing = ctx.state.pairing
    if pairing is None:
        raise RpcCallError(INTERNAL_ERROR, "the device registry is not ready")
    return pairing


def _devices(ctx: RequestContext) -> DeviceStore:
    devices = ctx.state.devices
    if devices is None:
        raise RpcCallError(INTERNAL_ERROR, "the device registry is not ready")
    return devices


async def relay_sign(ctx: RequestContext, params: RelaySignParams) -> RelaySignResult:
    keys = _keys(ctx)
    try:
        sig = await asyncio.to_thread(keys.sign, unb64(params.message))
    except RelayKeyError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    except SecretStoreError as exc:
        raise RpcCallError(KEYCHAIN_UNAVAILABLE, str(exc)) from exc
    return RelaySignResult(sig=b64(sig))


async def relay_dh(ctx: RequestContext, params: RelayDhParams) -> RelayDhResult:
    keys = _keys(ctx)
    try:
        shared = await asyncio.to_thread(keys.dh, unb64(params.public_key))
    except RelayKeyError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    except SecretStoreError as exc:
        raise RpcCallError(KEYCHAIN_UNAVAILABLE, str(exc)) from exc
    return RelayDhResult(shared=b64(shared))


async def device_sync(ctx: RequestContext, params: DeviceSyncParams) -> DeviceSyncResult:
    del params
    keys = _keys(ctx)
    devices = _devices(ctx)
    paths = ctx.state.paths
    settings = await asyncio.to_thread(load_settings, home=paths.home, project_dir=paths.home)
    try:
        mac_key, noise_key, room = await asyncio.to_thread(
            lambda: (keys.mac_key(), keys.noise_key(), keys.room())
        )
    except RelayKeyError as exc:
        raise RpcCallError(INTERNAL_ERROR, str(exc)) from exc
    except SecretStoreError as exc:
        raise RpcCallError(KEYCHAIN_UNAVAILABLE, str(exc)) from exc
    # Read the seq first: a change between the two reads makes the next sync newer, never stale.
    seq = await devices.seq()
    paired = await devices.list()
    return DeviceSyncResult(
        url=settings.relay.url,
        room=room,
        mac_key=b64(mac_key),
        noise_key=b64(noise_key),
        seq=seq,
        devices=[
            RelayDevice(id=device.id, key=b64(device.public_key))
            for device in paired
            if device.public_key is not None
        ],
        pairs=[RelayPair(slot=slot, exp=exp) for slot, exp in _slots(ctx)],
    )


async def connection_identify(
    ctx: RequestContext, params: ConnectionIdentifyParams
) -> ConnectionIdentifyResult:
    devices = _devices(ctx)
    device = await devices.get(params.device)
    if device is None:
        raise RpcCallError(DEVICE_REFUSED, "unknown device", {"reason": "unknown_device"})
    if device.revoked:
        raise RpcCallError(DEVICE_REFUSED, "device revoked", {"reason": "revoked"})
    ctx.connection.device = device.id
    await devices.touch(device.id, ctx.state.clock())
    return ConnectionIdentifyResult()


# ---- the owner's methods (browser) and the pairing request (local) ----


def _info(device: Device, rules: int) -> DeviceInfo:
    return DeviceInfo(
        id=device.id,
        name=device.name,
        paired_at=device.paired_at,
        last_seen=device.last_seen,
        revoked_at=device.revoked_at,
        rules=rules,
    )


async def _known(devices: DeviceStore, device: str) -> Device:
    found = await devices.get(device)
    if found is None:
        raise RpcCallError(INVALID_PARAMS, "unknown device", {"reason": "unknown_device"})
    return found


def _refused(error: PairingError) -> RpcCallError:
    return RpcCallError(DEVICE_REFUSED, str(error), {"reason": error.reason})


async def device_list(ctx: RequestContext, params: DeviceListParams) -> DeviceListResult:
    del params
    devices = _devices(ctx)
    counts = await devices.rule_counts()
    listed = await devices.list(include_revoked=True)
    return DeviceListResult(devices=[_info(d, counts.get(d.id, 0)) for d in listed])


def _mac_name() -> str:
    name = socket.gethostname().removesuffix(".local").strip()
    return "".join(ch for ch in name if ch.isprintable())[:64] or "Mac"


def _compressed(key: bytes) -> bytes:
    """A 65-byte uncompressed P-256 key as 33 bytes (the QR code's form)."""
    return bytes([2 + (key[64] & 1)]) + key[1:33]


async def device_pair_begin(
    ctx: RequestContext, params: DevicePairBeginParams
) -> DevicePairBeginResult:
    del params
    keys = _keys(ctx)
    pairing = _pairing(ctx)
    paths = ctx.state.paths
    settings = await asyncio.to_thread(load_settings, home=paths.home, project_dir=paths.home)
    relay = settings.relay.url
    if relay is None:
        raise RpcCallError(
            INVALID_PARAMS,
            'no relay is set: add [relay] url = "wss://..." to config.toml'
            " (for a local test, run `just relay` and use ws://127.0.0.1:8080)",
            {"reason": "relay_not_configured"},
        )
    try:
        mac_key, noise_key = await asyncio.to_thread(lambda: (keys.mac_key(), keys.noise_key()))
    except RelayKeyError as exc:
        raise RpcCallError(INTERNAL_ERROR, str(exc)) from exc
    except SecretStoreError as exc:
        raise RpcCallError(KEYCHAIN_UNAVAILABLE, str(exc)) from exc
    pair, code, expires = pairing.begin()
    # The link holds the one-time code. It is returned to the caller and never logged.
    uri = (
        f"golem://pair?v=1&relay={quote(relay, safe=':/')}"
        f"&mac={b64(_compressed(mac_key) + noise_key)}&code={b64(code)}"
        f"&exp={int(expires.timestamp())}&name={quote(_mac_name(), safe='')}"
    )
    return DevicePairBeginResult(pair=pair, uri=uri, expires_at=int(expires.timestamp()))


async def device_pair_request(
    ctx: RequestContext, params: DevicePairRequestParams
) -> DevicePairRequestResult:
    pairing = _pairing(ctx)
    try:
        key = unb64(params.key)
        code = unb64(params.code)
    except ValueError as exc:
        raise RpcCallError(INVALID_PARAMS, "not base64url") from exc
    try:
        pair = await pairing.request(code, key, params.name, params.model, params.words)
    except PairingError as exc:
        raise _refused(exc) from exc
    return DevicePairRequestResult(pair=pair)


async def device_pair_confirm(
    ctx: RequestContext, params: DevicePairConfirmParams
) -> DevicePairConfirmResult:
    pairing = _pairing(ctx)
    try:
        device = await pairing.confirm(params.pair, params.accept)
    except PairingError as exc:
        raise _refused(exc) from exc
    if device is None:
        return DevicePairConfirmResult()
    return DevicePairConfirmResult(device=_info(device, 0))


async def device_rename(ctx: RequestContext, params: DeviceRenameParams) -> DeviceRenameResult:
    devices = _devices(ctx)
    name = "".join(ch for ch in params.name if ch.isprintable()).strip()
    if not name:
        raise RpcCallError(INVALID_PARAMS, "a device needs a name")
    found = await _known(devices, params.device)
    if found.revoked:
        raise RpcCallError(INVALID_PARAMS, "this device was revoked")
    await devices.rename(found.id, name[:64])
    renamed = await _known(devices, found.id)
    return DeviceRenameResult(device=_info(renamed, (await devices.rule_counts()).get(found.id, 0)))


async def device_revoke(ctx: RequestContext, params: DeviceRevokeParams) -> DeviceRevokeResult:
    devices = _devices(ctx)
    await _known(devices, params.device)
    revoked = await devices.revoke(params.device, ctx.state.clock().isoformat())
    after = await _known(devices, params.device)
    rules = await devices.rules_of(params.device)
    seen: dict[str, str] = {}
    for origin in rules:
        seen.setdefault(origin.rule, origin.at)
    return DeviceRevokeResult(
        device=_info(after, len(seen)),
        revoked=revoked,
        rules=[DeviceRule(rule=rule, at=at) for rule, at in seen.items()],
    )
