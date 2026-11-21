"""The gateway's methods: ``relay.sign``, ``relay.dh``, ``device.sync``, ``connection.identify``.

All four are ``local`` (ADR-051): only a client on the daemon's Unix socket may call them. The
Mac's private keys stay here. A failure never says more than what was refused.
"""

from __future__ import annotations

import asyncio
import logging

from golem.config import load_settings
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
from golem.store.devices import DeviceStore
from golem_protocol.commands import (
    ConnectionIdentifyParams,
    ConnectionIdentifyResult,
    DeviceSyncParams,
    DeviceSyncResult,
    RelayDevice,
    RelayDhParams,
    RelayDhResult,
    RelaySignParams,
    RelaySignResult,
)

log = logging.getLogger(__name__)


def _keys(ctx: RequestContext) -> RelayKeys:
    secrets = ctx.state.secrets
    if secrets is None:
        raise RpcCallError(KEYCHAIN_UNAVAILABLE, "this daemon has no key store")
    return RelayKeys(secrets)


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
        pairs=[],
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
