"""Handlers that write MCP servers and ``config.toml``: add, update, remove, and the raw text.

The browser may call all of them (ADR-037), so each one holds the two
checks that keep an edit from moving a secret: a server names only its own
secrets, and a server whose address changed must be sent its secrets again.
A secret value is stored before the file names it, and is never returned.
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Any, Literal

from pydantic import ValidationError

from golem.config import McpServerSettings
from golem.config_edit import (
    McpExistsError,
    McpTableError,
    RawConflictError,
    add_mcp_server,
    has_mcp_server,
    read_raw,
    remove_mcp_server,
    replace_mcp_server,
    write_raw,
)
from golem.config_raw import ADDRESS_FIELDS, check_text, owns
from golem.mcp import McpServerError, McpSupervisor
from golem.mcp.catalog import CatalogError, build, find_entry, unavailable
from golem.secrets import SecretStore, SecretStoreError, check_name
from golem.server.dispatcher import (
    INTERNAL_ERROR,
    INVALID_PARAMS,
    KEYCHAIN_UNAVAILABLE,
    SESSION_NOT_FOUND,
    RequestContext,
    RpcCallError,
)
from golem.sessions.manager import SessionNotFoundError
from golem.tools.registry import ToolScope
from golem_protocol.commands import (
    ConfigError,
    ConfigRawGetParams,
    ConfigRawGetResult,
    ConfigRawResult,
    ConfigRawSetParams,
    McpAddParams,
    McpRemoveParams,
    McpRemoveResult,
    McpSecretInfo,
    McpServer,
    McpServerConfig,
    McpServerDetail,
    McpServerParams,
    McpUpdateParams,
)

log = logging.getLogger("golem.server")

MCP_PREFIX = "mcp/"


async def mcp_get(ctx: RequestContext, params: McpServerParams) -> McpServerDetail:
    mcp = get_mcp(ctx)
    scope = await get_scope(ctx, params.session_id)
    try:
        path = mcp.config_file(scope, params.name)
        settings = mcp.settings(scope, params.name)
        status = mcp.status(scope, params.name)
    except McpServerError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    stored = await asyncio.to_thread(_stored, ctx, settings.secrets)
    return McpServerDetail(
        server=status,
        config=McpServerConfig.model_validate(settings.model_dump(mode="json")),
        scope="user" if path == ctx.state.paths.config_file else "project",
        path=str(path),
        secrets=[McpSecretInfo(ref=ref, stored=ref in stored) for ref in settings.secrets],
    )


async def mcp_add(ctx: RequestContext, params: McpAddParams) -> McpServer:
    mcp = get_mcp(ctx)
    scope = ToolScope()
    if params.catalog_id is not None:
        scope = await get_scope(ctx, params.session_id)
        path = await config_target(ctx, params.scope, scope)
        table, values = _catalog_table(params, scope)
    elif params.config is None:
        table = _short_table(params)
        path = ctx.state.paths.config_file
        sent = {f"{MCP_PREFIX}{params.name}": params.token} if params.token is not None else {}
        values = {ref: value.get_secret_value() for ref, value in sent.items()}
    else:
        table = to_table(params.config)
        scope = await get_scope(ctx, params.session_id)
        path = await config_target(ctx, params.scope, scope)
        values = {ref: value.get_secret_value() for ref, value in params.secrets.items()}
    settings = to_settings(table)
    own_secrets(params.name, settings)
    check_sent(values, settings)
    if params.scope == "user" and mcp.config_files(params.name):
        raise RpcCallError(
            INVALID_PARAMS,
            f"mcp server {params.name} already exists: golem mcp remove {params.name} first",
        )
    try:
        # A table the servers skipped, such as an invalid one, still blocks the name.
        listed = await asyncio.to_thread(has_mcp_server, path, params.name)
    except (OSError, ValueError) as exc:
        raise RpcCallError(INTERNAL_ERROR, f"could not read the config file: {exc}") from exc
    if listed:
        raise RpcCallError(
            INVALID_PARAMS, f"{path} already has [mcp.{params.name}]: fix or remove it"
        )
    # Stored first, so the server never starts without them.
    await store_secrets(ctx, values)
    try:
        await asyncio.to_thread(add_mcp_server, path, params.name, table)
    except McpExistsError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    except OSError as exc:
        raise RpcCallError(INTERNAL_ERROR, f"could not write the config file: {exc}") from exc
    mcp.reload(path)
    try:
        return mcp.status(scope, params.name)
    except McpServerError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc


async def mcp_update(ctx: RequestContext, params: McpUpdateParams) -> McpServer:
    mcp = get_mcp(ctx)
    scope = await get_scope(ctx, params.session_id)
    try:
        path = mcp.config_file(scope, params.name)
        old = mcp.settings(scope, params.name)
    except McpServerError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    name = params.new_name or params.name
    renamed = name != params.name
    table = to_table(params.config)
    new = to_settings(table)
    own_secrets(name, new)
    values = {ref: value.get_secret_value() for ref, value in params.secrets.items()}
    check_sent(values, new)
    if renamed:
        try:
            clash = await asyncio.to_thread(has_mcp_server, path, name)
        except (OSError, ValueError) as exc:
            raise RpcCallError(INTERNAL_ERROR, f"could not read the config file: {exc}") from exc
        if clash:
            raise RpcCallError(INVALID_PARAMS, f"{path} already has [mcp.{name}]")

    def counterpart(ref: str) -> str:
        """The secret ``ref`` was before a rename."""
        prefix = f"{MCP_PREFIX}{name}"
        return (
            f"{MCP_PREFIX}{params.name}{ref[len(prefix) :]}" if renamed and owns(name, ref) else ref
        )

    moved = any(getattr(old, field) != getattr(new, field) for field in ADDRESS_FIELDS)
    if moved:
        stored = await asyncio.to_thread(
            _stored, ctx, [*new.secrets, *(counterpart(ref) for ref in new.secrets)]
        )
        for ref in new.secrets:
            if ref not in values and (ref in stored or counterpart(ref) in stored):
                raise RpcCallError(
                    INVALID_PARAMS,
                    f"{params.name} changed where it runs or connects, and it names the stored "
                    f"secret {ref}: send the secret again in secrets",
                )
    await store_secrets(ctx, values)
    if renamed:
        await _carry_secrets(ctx, new.secrets, values, counterpart)
    try:
        await asyncio.to_thread(
            replace_mcp_server, path, params.name, table, name if renamed else None
        )
    except (McpTableError, McpExistsError) as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    except OSError as exc:
        raise RpcCallError(INTERNAL_ERROR, f"could not write the config file: {exc}") from exc
    mcp.reload(path)
    await _forget(ctx, mcp, old.secrets)
    try:
        return mcp.status(scope, name)
    except McpServerError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc


async def mcp_remove(ctx: RequestContext, params: McpRemoveParams) -> McpRemoveResult:
    mcp = get_mcp(ctx)
    scope = await get_scope(ctx, params.session_id)
    user = ctx.state.paths.config_file
    files = mcp.config_files(params.name)
    if params.session_id is not None:
        try:
            path = mcp.config_file(scope, params.name)
        except McpServerError as exc:
            raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    else:
        if not files:
            raise RpcCallError(INVALID_PARAMS, f"no mcp server named {params.name}")
        if user not in files:
            raise RpcCallError(
                INVALID_PARAMS,
                f"mcp server {params.name} is in {files[0]}: remove it from that file",
            )
        path = user
    try:
        old = mcp.settings(scope, params.name).secrets
    except McpServerError:
        old = []
    try:
        await asyncio.to_thread(remove_mcp_server, path, params.name)
    except McpTableError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    except OSError as exc:
        raise RpcCallError(INTERNAL_ERROR, f"could not write the config file: {exc}") from exc
    mcp.reload(path)
    removed = await _forget(ctx, mcp, [*old, f"{MCP_PREFIX}{params.name}"])
    return McpRemoveResult(name=params.name, secret=removed)


async def config_raw_get(ctx: RequestContext, params: ConfigRawGetParams) -> ConfigRawGetResult:
    path = await config_target(ctx, params.scope, await get_scope(ctx, params.session_id))
    try:
        text, mtime = await asyncio.to_thread(read_raw, path)
    except (OSError, ValueError) as exc:
        raise RpcCallError(INTERNAL_ERROR, f"could not read {path}: {exc}") from exc
    return ConfigRawGetResult(path=str(path), text=text, mtime_ns=mtime, exists=mtime is not None)


async def config_raw_set(ctx: RequestContext, params: ConfigRawSetParams) -> ConfigRawResult:
    """The browser's write: a change inside a protected section is refused."""
    return await _raw_set(ctx, params, protected=True)


async def config_raw_set_protected(
    ctx: RequestContext, params: ConfigRawSetParams
) -> ConfigRawResult:
    """The terminal's write: the same checks, without the protected sections."""
    return await _raw_set(ctx, params, protected=False)


async def _raw_set(
    ctx: RequestContext, params: ConfigRawSetParams, *, protected: bool
) -> ConfigRawResult:
    path = await config_target(ctx, params.scope, await get_scope(ctx, params.session_id))
    try:
        current, mtime = await asyncio.to_thread(read_raw, path)
    except (OSError, ValueError) as exc:
        raise RpcCallError(INTERNAL_ERROR, f"could not read {path}: {exc}") from exc
    if mtime != params.base_mtime_ns:
        return _failed("config.toml changed on disk; reload")
    checked = await asyncio.to_thread(
        check_text,
        params.text,
        current,
        project=params.scope == "project",
        protected=protected,
        stored=lambda ref: ref in _stored(ctx, [ref]),
    )
    if checked.issues:
        return ConfigRawResult(
            ok=False,
            errors=[
                ConfigError(line=i.line, column=i.column, path=i.path, message=i.message)
                for i in checked.issues
            ],
        )
    if params.dry_run:
        return ConfigRawResult(ok=True, restart_needed=checked.restart_needed, mtime_ns=mtime)
    try:
        written = await asyncio.to_thread(write_raw, path, params.text, params.base_mtime_ns)
    except RawConflictError as exc:
        return _failed(str(exc))
    except OSError as exc:
        raise RpcCallError(INTERNAL_ERROR, f"could not write {path}: {exc}") from exc
    if ctx.state.mcp is not None:
        ctx.state.mcp.reload(path)
    log.info("wrote %s (%d bytes)", path, len(params.text))
    return ConfigRawResult(ok=True, restart_needed=checked.restart_needed, mtime_ns=written)


def _failed(message: str) -> ConfigRawResult:
    return ConfigRawResult(ok=False, errors=[ConfigError(message=message)])


def catalog_table(
    catalog_id: str,
    inputs: dict[str, str],
    secrets: dict[str, str],
    *,
    name: str | None,
    scope: ToolScope,
) -> tuple[dict[str, Any], dict[str, str]]:
    """The table for a catalog entry, and the secrets to store by reference."""
    entry = find_entry(catalog_id)
    if entry is None:
        raise RpcCallError(INVALID_PARAMS, f"there is no catalog entry {catalog_id}")
    if (why := unavailable(entry)) is not None:
        raise RpcCallError(INVALID_PARAMS, f"{entry.title} is not available yet: {why}")
    folder = None if scope.root is None else str(scope.root)
    try:
        return build(entry, inputs, secrets, name=name, folder=folder)
    except CatalogError as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc


def _catalog_table(params: McpAddParams, scope: ToolScope) -> tuple[dict[str, Any], dict[str, str]]:
    assert params.catalog_id is not None
    secrets = {key: value.get_secret_value() for key, value in params.secrets.items()}
    return catalog_table(params.catalog_id, params.inputs, secrets, name=params.name, scope=scope)


def _short_table(params: McpAddParams) -> dict[str, Any]:
    """The ``[mcp.<name>]`` keys for the short form, checked before anything is stored."""
    if (params.command is None) == (params.url is None):
        raise RpcCallError(INVALID_PARAMS, "pass either a command or a url")
    secret = f"keychain:{MCP_PREFIX}{params.name}"
    table: dict[str, Any] = {}
    if params.url is not None:
        if params.token_env is not None:
            raise RpcCallError(
                INVALID_PARAMS, "a url server sends its token as a header: drop --token-env"
            )
        table["url"] = params.url
        if params.token is not None:
            table["headers"] = {"Authorization": f"Bearer {secret}"}
    else:
        table["command"] = params.command
        if params.args:
            table["args"] = params.args
        if params.token is not None:
            if params.token_env is None:
                raise RpcCallError(
                    INVALID_PARAMS, "a token for a command needs token_env, the variable to set"
                )
            table["env"] = {params.token_env: secret}
    if params.token is None and params.token_env is not None:
        raise RpcCallError(INVALID_PARAMS, "token_env needs a token to put in it")
    to_settings(table)
    return table


def to_table(config: McpServerConfig) -> dict[str, Any]:
    """The keys to write: what differs from the defaults."""
    return config.model_dump(mode="json", exclude_defaults=True)


def to_settings(table: dict[str, Any]) -> McpServerSettings:
    try:
        return McpServerSettings.model_validate(table)
    except ValidationError as exc:
        message = "; ".join(
            str(error["msg"]).removeprefix("Value error, ") for error in exc.errors()
        )
        raise RpcCallError(INVALID_PARAMS, message) from exc


def own_secrets(name: str, settings: McpServerSettings) -> None:
    """A server names only its own secrets, so it cannot be sent another one's value."""
    for ref in settings.secrets:
        if not owns(name, ref):
            raise RpcCallError(
                INVALID_PARAMS,
                f"{name} may name only its own secrets, mcp/{name} or mcp/{name}-…, not {ref}",
            )


def check_sent(values: dict[str, str], settings: McpServerSettings) -> None:
    for ref in values:
        try:
            check_name(ref)
        except ValueError as exc:
            raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
        if ref not in settings.secrets:
            raise RpcCallError(INVALID_PARAMS, f"{ref} is sent, but config does not name it")


async def store_secrets(ctx: RequestContext, values: dict[str, str]) -> None:
    if not values:
        return
    store = _secret_store(ctx)
    for ref, value in values.items():
        try:
            await asyncio.to_thread(store.set, ref, value)
        except SecretStoreError as exc:
            raise RpcCallError(KEYCHAIN_UNAVAILABLE, str(exc)) from exc
        log.info("stored secret %s", ref)


async def _carry_secrets(
    ctx: RequestContext,
    refs: list[str],
    sent: dict[str, str],
    counterpart: Any,
) -> None:
    """After a rename, give each new secret the value its old name held."""
    store = _secret_store(ctx)
    for ref in refs:
        if ref in sent:
            continue
        try:
            value = await asyncio.to_thread(store.get, counterpart(ref))
            if value and counterpart(ref) != ref:
                await asyncio.to_thread(store.set, ref, value)
        except SecretStoreError as exc:
            raise RpcCallError(KEYCHAIN_UNAVAILABLE, str(exc)) from exc


async def _forget(ctx: RequestContext, mcp: McpSupervisor, refs: list[str]) -> bool:
    """Delete each of ``refs`` that no server names any more. True when one was stored."""
    store = ctx.state.secrets
    if store is None:
        return False
    still = set(mcp.secret_names())
    removed = False
    for ref in dict.fromkeys(refs):
        if ref in still:
            continue
        try:
            removed = await asyncio.to_thread(store.delete, ref) or removed
        except SecretStoreError as exc:
            raise RpcCallError(KEYCHAIN_UNAVAILABLE, str(exc)) from exc
        log.info("removed secret %s", ref)
    return removed


def _stored(ctx: RequestContext, refs: list[str]) -> set[str]:
    """The ``refs`` the secret store has. Reads the store, so call it off the event loop."""
    store = ctx.state.secrets
    if store is None:
        return set()
    try:
        return {ref for ref in refs if store.get(ref)}
    except SecretStoreError:
        return set()


def _secret_store(ctx: RequestContext) -> SecretStore:
    if ctx.state.secrets is None:
        raise RpcCallError(KEYCHAIN_UNAVAILABLE, "this daemon has no secret store")
    return ctx.state.secrets


def get_mcp(ctx: RequestContext) -> McpSupervisor:
    if ctx.state.mcp is None:
        raise RpcCallError(INTERNAL_ERROR, "MCP servers are not ready")
    return ctx.state.mcp


async def get_scope(ctx: RequestContext, session_id: str | None) -> ToolScope:
    if session_id is None:
        return ToolScope()
    sessions = ctx.state.sessions
    if sessions is None:
        raise RpcCallError(INTERNAL_ERROR, "sessions are not ready")
    try:
        return await sessions.tool_scope(session_id)
    except SessionNotFoundError as exc:
        raise RpcCallError(SESSION_NOT_FOUND, f"session not found: {session_id}") from exc


async def config_target(
    ctx: RequestContext, kind: Literal["user", "project"], scope: ToolScope
) -> Path:
    """The config file for ``kind``. A project's needs a session in a trusted folder."""
    if kind == "user":
        return ctx.state.paths.config_file
    root = scope.root
    if root is None:
        raise RpcCallError(INVALID_PARAMS, "project scope needs a session_id")
    policy = ctx.state.policy
    if policy is None or not policy.trusted(root):
        raise RpcCallError(
            INVALID_PARAMS, f"{root} is not in trusted_projects: trust it before it adds servers"
        )
    return root / ".golem" / "config.toml"
