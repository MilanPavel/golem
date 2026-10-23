"""Starts the MCP servers from ``[mcp.<name>]`` and keeps track of them.

Servers start in the background, so the daemon answers at once and a slow
``npx`` download does not hold it up. A running server's tools join the
next model call. A server that exits stays ``failed`` until the daemon
restarts: restarting with backoff is plan step 1.3.

launchd starts the daemon with a short ``PATH``, so a server's command is
also looked for where Homebrew and ``pipx`` or ``uv`` put programs. A
server gets a small environment, not the daemon's: nothing such as an API
key in the daemon's environment reaches it unless ``env`` names it.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import shlex
import shutil
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from golem.config import McpServerSettings
from golem.mcp.client import CallResult, Launch, McpClient, McpError
from golem.mcp.tools import mcp_tools
from golem.tools.registry import Tool
from golem_protocol.commands import McpServer, McpServerState
from golem_protocol.rpc import McpServerStatusNotification

log = logging.getLogger(__name__)

START_SECONDS = 60.0
"""How long a server may take to answer ``initialize``. ``npx`` may download it first."""
LIST_SECONDS = 30.0
EXTRA_PATH = ("/opt/homebrew/bin", "/usr/local/bin", "~/.local/bin")
PASSED_ENV = ("HOME", "LOGNAME", "USER", "SHELL", "TERM", "LANG", "TMPDIR")

Broadcast = Callable[[BaseModel], None]


@dataclass
class _Server:
    name: str
    settings: McpServerSettings
    status: McpServer
    client: McpClient | None = None
    tools: list[Tool[Any]] = field(default_factory=list[Tool[Any]])
    task: asyncio.Task[None] | None = None


class McpSupervisor:
    """The configured servers. :meth:`start` once, :meth:`aclose` on shutdown."""

    def __init__(
        self,
        servers: Mapping[str, McpServerSettings],
        *,
        broadcast: Broadcast | None = None,
        environ: Mapping[str, str] | None = None,
    ) -> None:
        self.broadcast: Broadcast = broadcast or (lambda _notification: None)
        self._environ = dict(os.environ if environ is None else environ)
        self._relists: set[asyncio.Task[None]] = set()
        self._servers = {
            name: _Server(
                name=name,
                settings=settings,
                status=McpServer(
                    name=name,
                    state="starting" if settings.enabled else "disabled",
                    command=shlex.join([settings.command, *settings.args]),
                ),
            )
            for name, settings in sorted(servers.items())
        }

    def start(self) -> None:
        """Start every enabled server in the background."""
        for server in self._servers.values():
            if server.settings.enabled and server.task is None:
                server.task = asyncio.create_task(self._run(server), name=f"mcp-{server.name}")

    def statuses(self) -> list[McpServer]:
        return [server.status for server in self._servers.values()]

    def tools(self) -> list[Tool[Any]]:
        """The tools of every running server, for :class:`~golem.tools.registry.ToolRegistry`."""
        return [tool for server in self._servers.values() for tool in server.tools]

    async def aclose(self) -> None:
        for task in self._relists:
            task.cancel()
        for server in self._servers.values():
            if server.task is not None:
                server.task.cancel()
        tasks = [server.task for server in self._servers.values() if server.task is not None]
        await asyncio.gather(*tasks, return_exceptions=True)
        await asyncio.gather(
            *(
                server.client.close()
                for server in self._servers.values()
                if server.client is not None
            )
        )

    async def _run(self, server: _Server) -> None:
        try:
            launch = self.launch(server.settings)
            client = McpClient(launch, on_tools_changed=lambda: self._relist_soon(server))
            server.client = client
            await client.start(START_SECONDS)
            await self._list(server)
            reason = await client.wait_closed()
        except McpError as exc:
            reason = str(exc)
        except Exception as exc:
            log.exception("mcp server %s broke", server.name)
            reason = f"{type(exc).__name__}: {exc}"
        server.tools = []
        log.warning("mcp server %s failed: %s", server.name, reason)
        self._set(server, "failed", error=reason)
        if server.client is not None:
            await server.client.close()

    async def _list(self, server: _Server) -> None:
        client = server.client
        assert client is not None
        timeout = float(server.settings.timeout_seconds)

        async def call(name: str, arguments: Mapping[str, object]) -> CallResult:
            return await client.call_tool(name, arguments, timeout)

        listed = await client.list_tools(LIST_SECONDS)
        server.tools = mcp_tools(server.name, listed, call)
        log.info("mcp server %s is running with %d tools", server.name, len(server.tools))
        self._set(server, "running")

    def _relist_soon(self, server: _Server) -> None:
        async def relist() -> None:
            with contextlib.suppress(McpError):
                await self._list(server)

        self._relists.add(asyncio.create_task(relist(), name=f"mcp-{server.name}-relist"))
        for task in [task for task in self._relists if task.done()]:
            self._relists.discard(task)

    def _set(self, server: _Server, state: McpServerState, *, error: str | None = None) -> None:
        tools = [tool.name for tool in server.tools] if state == "running" else []
        server.status = server.status.model_copy(
            update={"state": state, "tools": tools, "error": error}
        )
        try:
            self.broadcast(McpServerStatusNotification(params=server.status))
        except Exception:
            log.debug("broadcast failed", exc_info=True)

    def launch(self, settings: McpServerSettings) -> Launch:
        """The process for ``settings``. Raises :class:`McpError` when it cannot run."""
        env = {key: self._environ[key] for key in PASSED_ENV if key in self._environ}
        home = Path(env.get("HOME") or Path.home())
        searched = [*self._environ.get("PATH", "").split(os.pathsep)]
        for extra in EXTRA_PATH:
            folder = str(Path(extra.replace("~", str(home), 1)))
            if folder not in searched:
                searched.append(folder)
        path = os.pathsep.join(part for part in searched if part)
        env["PATH"] = path
        env.update(settings.env)
        command = shutil.which(os.path.expanduser(settings.command), path=path)
        if command is None:
            raise McpError(f"command not found: {settings.command} (looked in {path})")
        cwd = home if settings.cwd is None else Path(os.path.expanduser(settings.cwd))
        if not cwd.is_dir():
            raise McpError(f"no such folder: {cwd}")
        return Launch(argv=[command, *settings.args], env=env, cwd=cwd)


__all__ = ["McpSupervisor"]
