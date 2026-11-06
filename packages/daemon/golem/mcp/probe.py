"""Try a server without saving it: find it, start it, shake hands, list its tools, ping it.

``mcp.test`` runs this. It builds the same transport the supervisor would,
outside the supervisor, so a server that is not saved yet (or a saved one that
fails) can be looked at step by step. Each step has its own timeout and timing,
a failure skips the rest, and :func:`test_hint` turns the failure into one next
step for the person. Secrets sent with the request are used for this test and
then forgotten, and every line that leaves here has the secrets' values
replaced by ``•••``.
"""

from __future__ import annotations

import asyncio
import contextlib
import os
import time
from collections import deque
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from golem.config import McpServerSettings
from golem.mcp.client import McpClient, McpTool
from golem.mcp.launch import Secrets, find_command, search_path, transport_for
from golem.mcp.transport import McpError

StepState = Literal["running", "ok", "failed", "skipped"]
REDACTED = "•••"
STDERR_TAIL = 50

NODE_COMMANDS = frozenset({"npx", "node", "npm"})
UV_COMMANDS = frozenset({"uvx", "uv"})
DOWNLOADING = frozenset({"npx", "uvx", "pnpm", "bunx"})


@dataclass(frozen=True, slots=True)
class Timeouts:
    """How long each step may take. Tests make them short."""

    resolve: float = 10.0
    initialize: float = 60.0
    tools: float = 30.0
    ping: float = 10.0


DEFAULT_TIMEOUTS = Timeouts()


@dataclass(frozen=True, slots=True)
class Step:
    """One step and how it went. ``elapsed_ms`` is 0 until it ends."""

    step: str
    state: StepState
    elapsed_ms: int = 0
    detail: str | None = None


@dataclass(frozen=True, slots=True)
class Hint:
    """One next step. ``runtime`` is set when a UI can offer to install Node or uv."""

    text: str
    runtime: Literal["node", "uv"] | None = None


@dataclass(slots=True)
class ProbeResult:
    ok: bool
    steps: list[Step]
    server_name: str | None = None
    server_version: str | None = None
    protocol_version: str | None = None
    tools: list[McpTool] = field(default_factory=list[McpTool])
    stderr_tail: list[str] = field(default_factory=list[str])
    hint: Hint | None = None


Progress = Callable[[Step], None]


async def probe(
    settings: McpServerSettings,
    environ: Mapping[str, str],
    secrets: Secrets,
    *,
    sent: Mapping[str, str] | None = None,
    project: Path | None = None,
    progress: Progress | None = None,
    timeouts: Timeouts = DEFAULT_TIMEOUTS,
) -> ProbeResult:
    """Run the steps for ``settings``. ``sent`` are secrets for this test only.

    ``secrets`` reads the Keychain for the ones not sent. ``progress`` gets each
    step as it starts and as it ends.
    """
    http = settings.url is not None
    names = ["resolve", "connect" if http else "spawn", "initialize", "tools", "ping"]
    steps: list[Step] = []
    used: set[str] = set()
    stderr: deque[str] = deque(maxlen=500)

    def read(ref: str) -> str | None:
        value = (sent or {}).get(ref) or secrets(ref)
        if value:
            used.add(value)
        return value

    def redact(text: str) -> str:
        for value in sorted(used, key=len, reverse=True):
            text = text.replace(value, REDACTED)
        return text

    def emit(step: Step) -> None:
        if progress is not None:
            progress(step)

    result = ProbeResult(ok=False, steps=steps)
    client: McpClient | None = None
    transport: object = None

    async def run(name: str, work: Awaitable[str | None]) -> bool:
        emit(Step(name, "running"))
        began = time.monotonic()
        try:
            detail = await work
        except (McpError, OSError, TimeoutError) as exc:
            step = Step(name, "failed", _ms(began), redact(str(exc) or type(exc).__name__))
            steps.append(step)
            emit(step)
            return False
        step = Step(name, "ok", _ms(began), None if detail is None else redact(detail))
        steps.append(step)
        emit(step)
        return True

    async def resolve() -> str | None:
        async with asyncio.timeout(timeouts.resolve):
            if settings.url is not None:
                parts = urlsplit(settings.url)
                host = parts.hostname or ""
                try:
                    await asyncio.get_running_loop().getaddrinfo(
                        host, parts.port or (443 if parts.scheme == "https" else 80)
                    )
                except OSError as exc:
                    raise McpError(f"cannot resolve {host}") from exc
                return host
            assert settings.command is not None
            found = find_command(settings.command, environ)
            if found is None:
                raise McpError(
                    f"command not found: {settings.command} (looked in {search_path(environ)})"
                )
            return found

    async def open_transport() -> str | None:
        nonlocal client, transport
        # Secrets are read here, off the event loop: the Keychain may wait for a prompt.
        built = await asyncio.to_thread(
            transport_for,
            settings,
            environ,
            read,
            project=project,
            on_stderr=stderr.append,
        )
        transport = built
        client = McpClient(built)
        await client.open()
        return settings.url if settings.url is not None else None

    async def initialize() -> str | None:
        assert client is not None
        await client.initialize(timeouts.initialize)
        info = client.server_info
        name, version = info.get("name"), info.get("version")
        result.server_name = name if isinstance(name, str) else None
        result.server_version = version if isinstance(version, str) else None
        result.protocol_version = client.protocol_version
        said = " ".join(str(part) for part in (name, version) if part)
        return said or None

    async def list_tools() -> str | None:
        assert client is not None
        result.tools = await client.list_tools(timeouts.tools)
        count = len(result.tools)
        return f"{count} tool" + ("" if count == 1 else "s")

    async def ping() -> str | None:
        assert client is not None
        await client.ping(timeouts.ping)
        return None

    work: list[Callable[[], Awaitable[str | None]]] = [
        resolve,
        open_transport,
        initialize,
        list_tools,
        ping,
    ]
    try:
        for name, step_work in zip(names, work, strict=True):
            if not await run(name, step_work()):
                break
    finally:
        if client is not None:
            with contextlib.suppress(Exception):
                await asyncio.shield(client.close())
    result.ok = len(steps) == len(names) and all(step.state == "ok" for step in steps)
    for name in names[len(steps) :]:
        skipped = Step(name, "skipped")
        steps.append(skipped)
        emit(skipped)
    result.stderr_tail = [redact(line) for line in list(stderr)[-STDERR_TAIL:]]
    if not result.ok:
        status = getattr(transport, "status", None)
        authenticate = getattr(transport, "authenticate", None)
        result.hint = test_hint(
            steps,
            result.stderr_tail,
            settings=settings,
            http_status=status if isinstance(status, int) else None,
            authenticate=authenticate if isinstance(authenticate, str) else None,
        )
    return result


def test_hint(
    steps: list[Step],
    stderr: list[str],
    *,
    settings: McpServerSettings,
    http_status: int | None = None,
    authenticate: str | None = None,
) -> Hint | None:
    """One next step for the first step that failed, or None when nothing useful can be said."""
    failed = next((step for step in steps if step.state == "failed"), None)
    if failed is None:
        return None
    detail = failed.detail or ""
    program = os.path.basename(settings.command or "")
    if detail.startswith("no secret"):
        return Hint("A secret is missing: paste it again in the server's form")
    if failed.step == "resolve" and settings.command is not None:
        if program in NODE_COMMANDS:
            return Hint("Node is missing: golem can install it", "node")
        if program in UV_COMMANDS:
            return Hint("uv is missing: golem can install it", "uv")
        if program == "docker":
            return Hint("Install Docker Desktop or OrbStack")
        return Hint(f"Install {program}, or set command to its full path")
    host = urlsplit(settings.url).hostname if settings.url is not None else None
    if http_status in (401, 403):
        if authenticate:
            return Hint("This server signs in with OAuth")
        return Hint("The token was refused: paste a new one")
    if failed.step == "initialize" and "got no answer" in detail and program in DOWNLOADING:
        return Hint("The first run downloads the package: try again")
    if detail.startswith("the server exited"):
        return Hint(stderr[-1] if stderr else detail)
    if host is not None and (failed.step == "resolve" or "cannot reach" in detail):
        return Hint(f"Can't reach {host}")
    return None


def _ms(began: float) -> int:
    return round((time.monotonic() - began) * 1000)


__all__ = ["Hint", "ProbeResult", "Step", "Timeouts", "probe", "test_hint"]
