"""``golem doctor``: what is wrong with this install, and how to fix each part.

The daemon's executable runs these checks, because it reads the same plist,
config, Keychain items, and model servers the daemon does. ``golem doctor``
in the CLI adds what only it can see (whether it found this executable, and
whether the running daemon has its version) and prints the checklist.

Everything that touches the machine goes through :class:`Platform`, so the
tests run each check against a fake one.
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import stat
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal, Protocol, cast

import httpx
from pydantic import ValidationError

from golem import launchd
from golem.config import GolemSettings, McpServerSettings, load_settings
from golem.mcp.launch import Secrets, find_command
from golem.mcp.probe import Step, probe, test_hint
from golem.models import ollama
from golem.models.keys import KeyStore, KeyStoreError
from golem.models.router import (
    OLLAMA_BASE_URL,
    ModelConfigError,
    ModelRouter,
    Provider,
    ResolvedModel,
)
from golem.paths import GolemPaths
from golem.secrets import SecretStoreError
from golem_protocol.commands import McpListResult, McpServer
from golem_protocol.version import PROTOCOL_MAJOR

Status = Literal["ok", "warn", "fail"]
Part = Literal["service", "socket", "config", "engine", "model", "tools", "disk"]
Action = Literal["install_ollama", "start_ollama", "pick_model", "set_key", "edit_config"]

MIN_FREE_BYTES = 1_000_000_000
_OLLAMA_TIMEOUT = 2.0


@dataclass(frozen=True, slots=True)
class Check:
    """One line of the checklist. ``fix`` says what to run when it is not ok.

    ``part`` groups the line on a setup screen, and ``action`` is what that
    screen offers in place of ``fix``, with ``target`` the provider or model
    it is about. ``setup.status`` sends the same lines. Two checks are equal
    when they say the same thing, wherever a screen puts them.
    """

    name: str
    status: Status
    detail: str
    fix: str | None = None
    part: Part = field(default="config", compare=False)
    action: Action | None = field(default=None, compare=False)
    target: str | None = field(default=None, compare=False)


class Platform(Protocol):
    def installed_program(self) -> list[str] | None:
        """The command the service runs, or None when it is not installed."""
        ...

    def service_loaded(self) -> bool: ...

    def this_program(self) -> list[str]:
        """The command the service should run: this daemon."""
        ...

    def free_bytes(self, path: Path) -> int: ...

    def ollama_models(self, base_url: str) -> list[str] | None:
        """The models an Ollama server has, or None when it does not answer."""
        ...

    def ollama_installed(self) -> bool: ...

    def mcp_command(self, command: str) -> str | None:
        """Where an MCP server's command is, searched as the daemon searches, or None."""
        ...


class MacPlatform:
    """launchd, the local disk, and HTTP to the model servers."""

    def installed_program(self) -> list[str] | None:
        destination = launchd.plist_path()
        if not destination.is_file():
            return None
        return launchd.installed_program(destination) or []

    def service_loaded(self) -> bool:
        return launchd.job_loaded()

    def this_program(self) -> list[str]:
        return launchd.serve_command()

    def free_bytes(self, path: Path) -> int:
        return shutil.disk_usage(path).free

    def ollama_models(self, base_url: str) -> list[str] | None:
        try:
            response = httpx.get(f"{base_url}/api/tags", timeout=_OLLAMA_TIMEOUT)
            response.raise_for_status()
            body: object = response.json()
        except (httpx.HTTPError, ValueError):
            return None
        if not isinstance(body, dict):
            return None
        models = cast(dict[str, object], body).get("models")
        if not isinstance(models, list):
            return None
        items = cast(list[object], models)
        return [
            name
            for item in items
            if isinstance(item, dict)
            and isinstance(name := cast(dict[str, object], item).get("name"), str)
        ]

    def ollama_installed(self) -> bool:
        return ollama.installed()

    def mcp_command(self, command: str) -> str | None:
        return find_command(command, os.environ)


def run_checks(
    paths: GolemPaths,
    platform: Platform,
    keys: KeyStore,
    secrets: Secrets = lambda _name: None,
    *,
    live_mcp: Sequence[McpServer] | None = None,
    probe_mcp: bool = False,
) -> list[Check]:
    """Every check, in the order the checklist shows them.

    ``secrets`` reads the ``mcp/…`` secrets MCP servers name. ``live_mcp`` is
    what the running daemon says about its servers, so a server shows how it
    is doing and not only that its command exists. ``probe_mcp`` tries each
    enabled server instead, as ``mcp.test`` does.
    """
    checks = [service_check(platform)]
    socket = socket_check(paths)
    if socket is not None:
        checks.append(socket)
    settings, config = config_check(paths)
    checks.append(config)
    if settings is not None:
        checks.extend(model_checks(settings, platform, keys))
        if probe_mcp:
            checks.extend(probe_checks(settings, secrets))
        else:
            checks.extend(mcp_checks(settings, platform, secrets, live_mcp))
    checks.append(disk_check(paths, platform))
    return checks


def service_check(platform: Platform) -> Check:
    program = platform.installed_program()
    if program is None:
        return Check(
            "service", "fail", "launchd has no golem job", "golem daemon install", "service"
        )
    this = platform.this_program()
    if not program or not launchd.same_program(program, this):
        named = program[0] if program else "nothing"
        return Check(
            "service",
            "fail",
            f"launchd runs {named}, not this golem",
            "golem daemon install",
            "service",
        )
    if not platform.service_loaded():
        return Check("service", "fail", "installed, but stopped", "golem daemon start", "service")
    return Check("service", "ok", f"launchd runs {program[0]}", part="service")


def socket_check(paths: GolemPaths) -> Check | None:
    """Only you may open the socket. None when there is no socket to check."""
    try:
        info = paths.socket_path.lstat()
    except FileNotFoundError:
        return None
    mode = stat.S_IMODE(info.st_mode)
    if not stat.S_ISSOCK(info.st_mode):
        return Check(
            "socket",
            "fail",
            f"{paths.socket_path} is not a socket",
            "golem daemon restart",
            "socket",
        )
    if info.st_uid != os.getuid():
        return Check("socket", "fail", "owned by another user", "golem daemon restart", "socket")
    if mode & 0o077:
        return Check(
            "socket", "fail", f"others can open it ({mode:04o})", "golem daemon restart", "socket"
        )
    return Check("socket", "ok", f"only you can open it ({mode:04o})", part="socket")


def config_check(paths: GolemPaths) -> tuple[GolemSettings | None, Check]:
    """The settings the daemon loads. The daemon is per user, so no project config."""
    try:
        settings = load_settings(home=paths.home, project_dir=paths.home)
    except (OSError, ValueError) as exc:
        return None, Check(
            "config", "fail", _reason(exc), f"edit {paths.config_file}", action="edit_config"
        )
    if not paths.config_file.is_file():
        return settings, Check("config", "ok", "no config.toml, using the defaults")
    return settings, Check("config", "ok", f"{paths.config_file} is valid")


def model_checks(settings: GolemSettings, platform: Platform, keys: KeyStore) -> list[Check]:
    """The default model, then one line per provider the profiles use.

    A stopped Ollama is one line however many profiles need it. It is ok when
    it is installed here and golem may start it.
    """
    router = ModelRouter(settings, keys=keys)
    checks: list[Check] = []
    used: dict[str, list[ResolvedModel]] = {}
    default = router.profile_name
    for name in dict.fromkeys([default, *sorted(router.profiles())]):
        try:
            resolved = router.resolve(name)
        except ModelConfigError as exc:
            checks.append(_unresolved(name, name == default, settings, exc))
            continue
        if name == default:
            checks.append(Check("model", "ok", f"new chats start on {resolved.ref}", part="model"))
        used.setdefault(resolved.provider_name, []).append(resolved)
    if not used:
        # Nothing chosen yet: say what could think, so a setup screen starts from it.
        checks.extend(_engines(router, platform, keys, settings.ollama.start))
    for provider_name in sorted(used):
        models = used[provider_name]
        provider = models[0].provider
        if provider.kind == "ollama":
            checks.extend(
                _ollama_checks(provider_name, provider, models, platform, settings.ollama.start)
            )
        else:
            checks.append(_key_check(provider_name, provider, keys))
    return checks


def mcp_checks(
    settings: GolemSettings,
    platform: Platform,
    secrets: Secrets,
    live: Sequence[McpServer] | None = None,
) -> list[Check]:
    """One line per MCP server that may start: its command is found, and its secrets stored.

    With ``live``, a server the daemon is running or failed to run says so, with its
    error. One that is idle (on demand) or unknown to the daemon gets the static checks.
    """
    checks: list[Check] = []
    seen = {server.name: server for server in live or [] if server.project is None}
    for name, server in sorted(settings.mcp.items()):
        if server.enabled is False:
            continue
        label = f"mcp {name}"
        if (running := seen.get(name)) is not None and running.state in (
            "running",
            "failed",
            "starting",
        ):
            checks.append(_live_check(label, running, server))
            continue
        try:
            missing = [secret for secret in server.secrets if not secrets(secret)]
        except SecretStoreError as exc:
            checks.append(
                Check(label, "fail", str(exc), "unlock the login Keychain, then try again", "tools")
            )
            continue
        if missing:
            checks.append(
                Check(
                    label,
                    "fail",
                    f"no secret {missing[0]} in the Keychain",
                    f"golem auth set {missing[0]}",
                    "tools",
                )
            )
            continue
        if server.command is None:
            checks.append(Check(label, "ok", f"reaches {server.url}", part="tools"))
            continue
        found = platform.mcp_command(server.command)
        if found is None:
            hint = test_hint(
                [Step("resolve", "failed", detail=f"command not found: {server.command}")],
                [],
                settings=server,
            )
            fix = "install it, or set command to its full path in config.toml"
            if hint is not None and hint.runtime is not None:
                fix = hint.text
            checks.append(
                Check(label, "fail", f"command not found: {server.command}", fix, "tools")
            )
            continue
        checks.append(Check(label, "ok", f"runs {found}", part="tools"))
    return checks


def _live_check(label: str, server: McpServer, settings: McpServerSettings) -> Check:
    if server.state == "running":
        count = len(server.tools)
        return Check(
            label, "ok", f"running, {count} tool" + ("" if count == 1 else "s"), part="tools"
        )
    if server.state == "starting":
        return Check(label, "warn", "still starting", "golem doctor --mcp", "tools")
    error = server.error or "failed"
    step = "resolve" if error.startswith("command not found") else "initialize"
    hint = test_hint([Step(step, "failed", detail=error)], [], settings=settings)
    fix = hint.text if hint is not None else "golem doctor --mcp"
    return Check(label, "fail", error, fix, "tools")


def probe_checks(settings: GolemSettings, secrets: Secrets) -> list[Check]:
    """Try every enabled MCP server as ``mcp.test`` does, and say what stopped it."""

    async def run() -> list[Check]:
        checks: list[Check] = []
        for name, server in sorted(settings.mcp.items()):
            if server.enabled is False:
                continue
            label = f"mcp {name}"
            try:
                found = await probe(server, os.environ, secrets)
            except SecretStoreError as exc:
                checks.append(
                    Check(label, "fail", str(exc), "unlock the login Keychain, try again", "tools")
                )
                continue
            if found.ok:
                said = found.server_name or "the server"
                count = len(found.tools)
                detail = f"{said} answers with {count} tool" + ("" if count == 1 else "s")
                checks.append(Check(label, "ok", detail, part="tools"))
                continue
            step = next(step for step in found.steps if step.state == "failed")
            detail = f"{step.step}: {step.detail}"
            fix = None if found.hint is None else found.hint.text
            checks.append(Check(label, "fail", detail, fix, "tools"))
        return checks

    return asyncio.run(run())


def live_mcp(paths: GolemPaths) -> list[McpServer] | None:
    """The servers the running daemon has, or None when it does not answer."""

    async def ask() -> list[McpServer]:
        reader, writer = await asyncio.open_unix_connection(str(paths.socket_path))

        async def call(number: int, method: str, params: Mapping[str, object]) -> object:
            request = {"jsonrpc": "2.0", "id": number, "method": method, "params": params}
            writer.write(json.dumps(request).encode() + b"\n")
            await writer.drain()
            while True:
                reply: object = json.loads(await reader.readline())
                if isinstance(reply, dict):
                    found = cast(dict[str, object], reply)
                    if found.get("id") == number:
                        return found.get("result")

        try:
            hello = {"protocol_major": PROTOCOL_MAJOR, "protocol_minor": 0, "client": "doctor"}
            await call(1, "hello", hello)
            return McpListResult.model_validate(await call(2, "mcp.list", {})).servers
        finally:
            writer.close()

    try:
        return asyncio.run(asyncio.wait_for(ask(), 3))
    except (OSError, ValueError, TimeoutError, ValidationError):
        return None


def disk_check(paths: GolemPaths, platform: Platform) -> Check:
    existing = paths.home
    while not existing.exists() and existing != existing.parent:
        existing = existing.parent
    free = platform.free_bytes(existing)
    detail = f"{free / 1e9:.1f} GB free"
    if free < MIN_FREE_BYTES:
        return Check(
            "disk", "fail", detail, "free some space: golem's database and models need room", "disk"
        )
    return Check("disk", "ok", detail, part="disk")


def _unresolved(name: str, default: bool, settings: GolemSettings, exc: ModelConfigError) -> Check:
    if default and settings.default_model is None:
        return Check(
            "model",
            "warn",
            "no model chosen yet",
            "golem tui, then pick one",
            "model",
            "pick_model",
        )
    label = "model" if default else f"model {name}"
    return Check(
        label,
        "fail",
        str(exc),
        "golem tui, then pick another with /setup",
        "model",
        "pick_model",
        name,
    )


def _engines(router: ModelRouter, platform: Platform, keys: KeyStore, start: bool) -> list[Check]:
    """The local Ollama and every provider with a stored key, when no model uses them yet.

    Nothing here is a failure: golem works with any one of them.
    """
    checks: list[Check] = []
    local = router.provider("ollama")
    if local is not None and local.kind == "ollama":
        base = (local.base_url or OLLAMA_BASE_URL).strip().rstrip("/").removesuffix("/v1")
        pulled = platform.ollama_models(base)
        if pulled is not None and ollama.is_local(base) and not platform.ollama_installed():
            checks.append(_ollama_stray("ollama"))
        elif pulled is not None:
            count = f"{len(pulled)} model" + ("" if len(pulled) == 1 else "s")
            checks.append(Check("ollama", "ok", f"running, {count} downloaded", part="engine"))
        elif not platform.ollama_installed():
            checks.append(
                Check(
                    "ollama",
                    "warn",
                    "Ollama is not installed",
                    "golem tui, then pick On this Mac",
                    "engine",
                    "install_ollama",
                )
            )
        else:
            detail = "installed, not running" + (", golem starts it" if start else "")
            checks.append(Check("ollama", "ok", detail, part="engine", action="start_ollama"))
    for name, provider in sorted(router.providers().items()):
        if provider.kind == "ollama":
            continue
        try:
            stored = keys.get(name)
        except KeyStoreError:
            continue
        if stored:
            checks.append(Check(name, "ok", "API key in the Keychain", part="engine"))
    return checks


def _ollama_checks(
    name: str,
    provider: Provider,
    models: list[ResolvedModel],
    platform: Platform,
    start: bool,
) -> list[Check]:
    base = (provider.base_url or OLLAMA_BASE_URL).strip().rstrip("/").removesuffix("/v1")
    pulled = platform.ollama_models(base)
    if pulled is None:
        return [_ollama_down(name, base, platform, start)]
    if ollama.is_local(base) and not platform.ollama_installed():
        return [_ollama_stray(name)]
    have = {_with_tag(model) for model in pulled}
    missing = sorted({model.model_id for model in models if _with_tag(model.model_id) not in have})
    count = f"{len(pulled)} model" + ("" if len(pulled) == 1 else "s")
    checks = [Check(name, "ok", f"running at {base}, {count} downloaded", part="engine")]
    checks.extend(
        Check(
            f"model {model}",
            "fail",
            "not downloaded",
            f"ollama pull {model}, or pick another in /setup",
            "model",
            "pick_model",
            f"{name}/{model}",
        )
        for model in missing
    )
    return checks


def _ollama_stray(name: str) -> Check:
    """A local server that answers from an install that was removed: it cannot run a model."""
    return Check(
        name,
        "fail",
        ollama.STRAY_MESSAGE,
        ollama.STRAY_HINT + ", your downloaded models are kept",
        "engine",
        "install_ollama",
    )


def _ollama_down(name: str, base: str, platform: Platform, start: bool) -> Check:
    """A server that does not answer. golem starts a local one it can find."""
    if not ollama.is_local(base):
        return Check(name, "fail", f"not answering at {base}", f"start Ollama at {base}", "engine")
    if not platform.ollama_installed():
        # golem installs Ollama from /setup, and only starts it when it may.
        fix = (
            "golem tui, then /setup installs it, or brew install ollama"
            if start
            else "brew install ollama && brew services start ollama"
        )
        return Check(name, "fail", "Ollama is not installed", fix, "engine", "install_ollama")
    if start:
        return Check(
            name,
            "ok",
            "not running, golem starts it when a local model needs it",
            part="engine",
            action="start_ollama",
        )
    return Check(
        name,
        "fail",
        f"not answering at {base}, and [ollama] start is false",
        "brew services start ollama, or open the Ollama app",
        "engine",
        "start_ollama",
    )


def _key_check(name: str, provider: Provider, keys: KeyStore) -> Check:
    try:
        stored = keys.get(name)
    except KeyStoreError as exc:
        return Check(name, "fail", str(exc), "unlock the login Keychain, then try again", "engine")
    if stored:
        return Check(name, "ok", "API key in the Keychain", part="engine")
    env = provider.api_key_env
    if env is not None and os.environ.get(env, "").strip():
        # launchd does not pass the shell's environment to the daemon.
        return Check(
            name,
            "warn",
            f"key only in ${env}, which the daemon does not see",
            f"golem auth set {name}",
            "engine",
            "set_key",
            name,
        )
    if env is not None:
        return Check(
            name, "fail", "no API key", f"golem auth set {name}", "engine", "set_key", name
        )
    return Check(name, "ok", "no key needed", part="engine")


def _with_tag(model: str) -> str:
    return model if ":" in model else f"{model}:latest"


def _reason(exc: BaseException) -> str:
    """One line for the checklist: the first validation error, or the first line."""
    if isinstance(exc, ValidationError):
        first = exc.errors()[0]
        where = ".".join(str(part) for part in first["loc"])
        return f"{where}: {first['msg']}" if where else first["msg"]
    lines = str(exc).strip().splitlines()
    return lines[0] if lines else type(exc).__name__
