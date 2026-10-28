"""Runs the MCP servers from ``[mcp.<name>]`` and decides which session sees which.

Where servers come from:

- The user's ``config.toml``. ``enabled = true`` servers start with the
  daemon and every session gets their tools. ``"on_demand"`` servers start
  the first time a session turns one on with ``/mcp enable``, and only
  those sessions get them. ``false`` ones never start.
- A project's ``.golem/config.toml``, for sessions in that folder, when the
  folder is in ``trusted_projects``: a project names programs to run, so an
  untrusted one cannot. A project server takes the place of the user's
  server of the same name in that folder.

Each server runs in a loop. It starts, answers a ``ping`` every
``health_seconds``, and when it exits or stops answering it is ``failed``
and starts again after a wait that doubles from ``backoff_first`` up to
``backoff_max``, and goes back to the first after a minute of running.
A changed ``[mcp.*]`` table restarts that server, without a daemon restart.

Servers start in the background, so the daemon answers at once. A model
call waits up to ``prepare_seconds`` for a server its session needs that is
still starting, so the first message after ``/mcp enable`` can use it.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from golem.config import McpServers, McpServerSettings, load_mcp
from golem.mcp.client import CallResult, McpClient, McpError
from golem.mcp.launch import Secrets, transport_for
from golem.mcp.tools import mcp_tools
from golem.tools.registry import Tool, ToolScope
from golem_protocol.commands import McpServer, McpServerState
from golem_protocol.rpc import McpServerStatusNotification

log = logging.getLogger(__name__)

START_SECONDS = 60.0
"""How long a server may take to answer ``initialize``. ``npx`` may download it first."""
LIST_SECONDS = 30.0
STABLE_SECONDS = 60.0
CHARS_PER_TOKEN = 4

Broadcast = Callable[[BaseModel], None]


class McpServerError(Exception):
    """A request named a server the session does not have, or asked what it cannot do."""


@dataclass(frozen=True, slots=True)
class Timing:
    """How often and how long the supervisor waits. Tests make it fast."""

    backoff_first: float = 1.0
    backoff_max: float = 60.0
    health_seconds: float = 30.0
    reload_seconds: float = 2.0
    prepare_seconds: float = 10.0
    ping_seconds: float = 10.0


DEFAULT_TIMING = Timing()


@dataclass
class _Server:
    name: str
    project: Path | None
    settings: McpServerSettings
    status: McpServer
    client: McpClient | None = None
    tools: list[Tool[Any]] = field(default_factory=list[Tool[Any]])
    task: asyncio.Task[None] | None = None

    @property
    def on_demand(self) -> bool:
        return self.settings.enabled == "on_demand"


class McpSupervisor:
    """The MCP servers, as a :class:`~golem.tools.registry.ToolSource`.

    :meth:`start` once, :meth:`aclose` on shutdown. ``user_config`` is read
    again when it changes. ``trusted`` says whether a project folder may
    start its own servers, and ``secrets`` reads ``keychain:mcp/…`` values.
    """

    def __init__(
        self,
        servers: McpServers,
        *,
        user_config: Path | None = None,
        trusted: Callable[[Path], bool] = lambda _root: False,
        secrets: Secrets = lambda _name: None,
        broadcast: Broadcast | None = None,
        environ: Mapping[str, str] | None = None,
        timing: Timing = DEFAULT_TIMING,
    ) -> None:
        self.broadcast: Broadcast = broadcast or (lambda _notification: None)
        self._user_config = user_config
        self._trusted = trusted
        self._secrets = secrets
        self._environ = dict(os.environ if environ is None else environ)
        self._timing = timing
        self._servers: dict[tuple[str, Path | None], _Server] = {}
        self._projects: set[Path] = set()
        self._stamps: dict[Path, tuple[int, int] | None] = {}
        self._background: set[asyncio.Task[None]] = set()
        # Servers being stopped. Shutdown waits for these instead of cancelling them.
        self._stopping: set[asyncio.Task[None]] = set()
        self._started = False
        if user_config is not None:
            self._stamps[user_config] = _stamp(user_config)
        self._replace(None, servers)

    def start(self) -> None:
        """Start the user's always-on servers, and watch the config files."""
        self._started = True
        for server in list(self._servers.values()):
            if server.project is None and server.settings.enabled is True:
                self._start(server)
        self._spawn(self._watch(), "mcp-watch")

    def tools(self, scope: ToolScope) -> list[Tool[Any]]:
        return [tool for server in self._visible(scope) for tool in server.tools]

    async def prepare(self, scope: ToolScope) -> None:
        servers = self._visible(scope)
        for server in servers:
            self._start(server)
        deadline = time.monotonic() + self._timing.prepare_seconds
        while any(server.status.state == "starting" for server in servers):
            if time.monotonic() >= deadline:
                return
            await asyncio.sleep(0.05)

    def start_for(self, scope: ToolScope) -> None:
        """Start what ``scope`` needs, without waiting for it."""
        for server in self._visible(scope):
            self._start(server)

    def statuses(self, scope: ToolScope | None = None) -> list[McpServer]:
        """The user's servers, and with ``scope`` its project's, saying which it has on."""
        if scope is None:
            return [server.status for server in self._shown(None)]
        on = {id(server) for server in self._visible(scope)}
        return [
            server.status.model_copy(update={"enabled": id(server) in on})
            for server in self._shown(scope.root)
        ]

    def check_toggle(self, scope: ToolScope, name: str) -> None:
        """Raises :class:`McpServerError` unless ``name`` is an on-demand server here."""
        server = self._find(scope, name)
        if server.settings.enabled is True:
            raise McpServerError(
                f'{name} is on for every session; set enabled = "on_demand" to choose per session'
            )
        if server.settings.enabled is False:
            raise McpServerError(f"{name} is turned off in config.toml (enabled = false)")

    def tool_list(self, scope: ToolScope, name: str) -> list[tuple[str, str]]:
        """Each running tool of server ``name``: its name and its description."""
        return [(tool.name, tool.description) for tool in self._find(scope, name).tools]

    def restart(self, scope: ToolScope, name: str) -> McpServer:
        """Start server ``name`` again now, or start it when it has not started yet."""
        server = self._find(scope, name)
        if server.settings.enabled is False:
            raise McpServerError(f"{name} is turned off; enable it first")
        self._restart(server)
        return server.status

    def config_file(self, scope: ToolScope, name: str) -> Path:
        """The file that names server ``name``, for editing it."""
        server = self._find(scope, name)
        if server.project is not None:
            return _project_config(server.project)
        if self._user_config is None:
            raise McpServerError(f"{name} has no config file to edit")
        return self._user_config

    def status(self, scope: ToolScope, name: str) -> McpServer:
        found = [status for status in self.statuses(scope) if status.name == name]
        if not found:
            raise McpServerError(f"no MCP server named {name}")
        return found[0]

    def reload(self, path: Path) -> None:
        """Apply ``path``'s ``[mcp.*]`` tables now, without waiting for the watcher."""
        self._stamps[path] = _stamp(path)
        project = None if path == self._user_config else path.parent.parent
        try:
            servers = load_mcp(path)
        except (OSError, ValueError) as exc:
            log.warning("%s has invalid MCP servers, keeping the last good ones: %s", path, exc)
            return
        log.info("reloading MCP servers from %s", path)
        self._replace(project, servers)

    def secret_names(self) -> list[str]:
        """Every ``mcp/…`` secret a known server names."""
        return sorted(
            {name for server in self._servers.values() for name in server.settings.secrets}
        )

    def secret_changed(self, name: str) -> None:
        """Start again every running server that uses secret ``name``."""
        for server in list(self._servers.values()):
            if name in server.settings.secrets and server.task is not None:
                self._restart(server)

    async def aclose(self) -> None:
        tasks = [*self._background, *(s.task for s in self._servers.values() if s.task)]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        # A stop cancelled halfway leaves its server running, with nobody to wait for it.
        await asyncio.gather(*self._stopping, return_exceptions=True)
        clients = [server.client for server in self._servers.values() if server.client]
        await asyncio.gather(*(client.close() for client in clients), return_exceptions=True)

    def _find(self, scope: ToolScope, name: str) -> _Server:
        server = {server.name: server for server in self._shown(scope.root)}.get(name)
        if server is None:
            raise McpServerError(f"no MCP server named {name}")
        return server

    def _visible(self, scope: ToolScope) -> list[_Server]:
        """The servers whose tools ``scope`` gets, started or not."""
        return [
            server
            for server in self._shown(scope.root)
            if server.settings.enabled is True
            or (server.on_demand and server.name in scope.enabled)
        ]

    def _shown(self, root: Path | None) -> list[_Server]:
        """The user's servers, with a trusted ``root``'s in place of the same names."""
        found = {
            name: server for (name, project), server in self._servers.items() if project is None
        }
        if root is not None and self._trusted(root):
            self._attach(root)
            for (name, project), server in self._servers.items():
                if project == root:
                    found[name] = server
        return [found[name] for name in sorted(found)]

    def _attach(self, root: Path) -> None:
        if root in self._projects:
            return
        self._projects.add(root)
        path = _project_config(root)
        self._stamps[path] = _stamp(path)
        try:
            servers = load_mcp(path)
        except (OSError, ValueError) as exc:
            log.warning("%s has invalid MCP servers: %s", path, exc)
            return
        self._replace(root, servers)

    def _replace(self, project: Path | None, servers: McpServers) -> None:
        """Make ``project``'s servers (the user's for None) match ``servers``."""
        for (name, owner), server in list(self._servers.items()):
            if owner != project:
                continue
            settings = servers.get(name)
            if settings == server.settings:
                continue
            self._stop_soon(server)
            del self._servers[(name, owner)]
            if settings is None:
                log.info("mcp server %s was removed", name)
        for name, settings in sorted(servers.items()):
            if (name, project) in self._servers:
                continue
            server = _Server(
                name=name,
                project=project,
                settings=settings,
                status=McpServer(
                    name=name,
                    state=_idle_state(settings),
                    command=settings.target,
                    project=None if project is None else str(project),
                    on_demand=settings.enabled == "on_demand",
                    config=self._config_label(project),
                ),
            )
            self._servers[(name, project)] = server
            if self._started and settings.enabled is True:
                self._start(server)
            else:
                self._set(server, server.status.state)

    def _config_label(self, project: Path | None) -> str | None:
        if project is not None:
            return str(_project_config(project))
        return None if self._user_config is None else str(self._user_config)

    def _start(self, server: _Server) -> None:
        if server.task is not None or server.settings.enabled is False:
            return
        self._set(server, "starting")
        server.task = asyncio.create_task(self._run(server), name=f"mcp-{server.name}")

    def _restart(self, server: _Server) -> None:
        self._stop_soon(server)
        server.task = None
        self._start(server)

    def _stop_soon(self, server: _Server) -> None:
        task, client = server.task, server.client
        server.task, server.client, server.tools = None, None, []

        async def stop() -> None:
            if task is not None:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
            if client is not None:
                await client.close()

        if task is not None or client is not None:
            self._spawn(stop(), f"mcp-{server.name}-stop", stopping=True)

    async def _run(self, server: _Server) -> None:
        delay = self._timing.backoff_first
        while True:
            began = time.monotonic()
            reason = await self._serve(server)
            if time.monotonic() - began >= STABLE_SECONDS:
                delay = self._timing.backoff_first
            log.warning("mcp server %s failed: %s; trying again in %gs", server.name, reason, delay)
            self._set(server, "failed", error=reason, retry=delay)
            await asyncio.sleep(delay)
            delay = min(delay * 2, self._timing.backoff_max)
            self._set(server, "starting")

    async def _serve(self, server: _Server) -> str:
        """Run the server once, until it exits or stops answering. Returns why it went down."""
        try:
            transport = await asyncio.to_thread(
                transport_for, server.settings, self._environ, self._secrets, project=server.project
            )
            client = McpClient(transport, on_tools_changed=lambda: self._relist_soon(server))
            server.client = client
            await client.start(START_SECONDS)
            await self._list(server, client)
            return await self._watch_health(client)
        except McpError as exc:
            return str(exc)
        except Exception as exc:
            log.exception("mcp server %s broke", server.name)
            return f"{type(exc).__name__}: {exc}"
        finally:
            server.tools = []
            if server.client is not None:
                await server.client.close()
                server.client = None

    async def _watch_health(self, client: McpClient) -> str:
        closed = asyncio.create_task(client.wait_closed())
        try:
            while True:
                done, _ = await asyncio.wait({closed}, timeout=self._timing.health_seconds)
                if done:
                    return closed.result()
                try:
                    await client.ping(self._timing.ping_seconds)
                except McpError as exc:
                    return f"the server stopped answering: {exc}"
        finally:
            closed.cancel()

    async def _list(self, server: _Server, client: McpClient) -> None:
        timeout = float(server.settings.timeout_seconds)

        async def call(name: str, arguments: Mapping[str, object]) -> CallResult:
            return await client.call_tool(name, arguments, timeout)

        listed = await client.list_tools(LIST_SECONDS)
        server.tools = mcp_tools(server.name, listed, call)
        log.info("mcp server %s is running with %d tools", server.name, len(server.tools))
        self._set(server, "running")

    def _relist_soon(self, server: _Server) -> None:
        client = server.client

        async def relist() -> None:
            if client is not None:
                with contextlib.suppress(McpError):
                    await self._list(server, client)

        self._spawn(relist(), f"mcp-{server.name}-relist")

    async def _watch(self) -> None:
        """Read a config file again when it changes, and apply its ``[mcp.*]`` tables."""
        while True:
            await asyncio.sleep(self._timing.reload_seconds)
            for path, before in list(self._stamps.items()):
                if _stamp(path) != before:
                    self.reload(path)

    def _set(
        self,
        server: _Server,
        state: McpServerState,
        *,
        error: str | None = None,
        retry: float | None = None,
    ) -> None:
        running = state == "running"
        server.status = server.status.model_copy(
            update={
                "state": state,
                "tools": [tool.name for tool in server.tools] if running else [],
                "schema_tokens": _schema_tokens(server.tools) if running else None,
                "error": error,
                "retry_seconds": retry,
            }
        )
        try:
            self.broadcast(McpServerStatusNotification(params=server.status))
        except Exception:
            log.debug("broadcast failed", exc_info=True)

    def _spawn(self, work: Any, name: str, *, stopping: bool = False) -> None:
        task: asyncio.Task[None] = asyncio.create_task(work, name=name)
        tasks = self._stopping if stopping else self._background
        tasks.add(task)
        task.add_done_callback(tasks.discard)


def _idle_state(settings: McpServerSettings) -> McpServerState:
    if settings.enabled is False:
        return "disabled"
    return "idle" if settings.enabled == "on_demand" else "starting"


def _schema_tokens(tools: list[Tool[Any]]) -> int:
    """Roughly what the schemas cost in a prompt: four characters a token."""
    return sum(len(json.dumps(tool.schema())) for tool in tools) // CHARS_PER_TOKEN


def _project_config(root: Path) -> Path:
    return root / ".golem" / "config.toml"


def _stamp(path: Path) -> tuple[int, int] | None:
    try:
        info = path.stat()
    except OSError:
        return None
    return info.st_mtime_ns, info.st_size


__all__ = ["McpServerError", "McpSupervisor", "Timing"]
