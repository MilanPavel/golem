"""``golem doctor``: what is wrong with this install, and how to fix each part.

The daemon's executable runs these checks, because it reads the same plist,
config, Keychain items, and model servers the daemon does. ``golem doctor``
in the CLI adds what only it can see (whether it found this executable, and
whether the running daemon has its version) and prints the checklist.

Everything that touches the machine goes through :class:`Platform`, so the
tests run each check against a fake one.
"""

from __future__ import annotations

import os
import shutil
import stat
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Protocol, cast

import httpx
from pydantic import ValidationError

from golem import launchd
from golem.config import GolemSettings, load_settings
from golem.mcp.launch import Secrets, find_command
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

Status = Literal["ok", "warn", "fail"]

MIN_FREE_BYTES = 1_000_000_000
_OLLAMA_TIMEOUT = 2.0


@dataclass(frozen=True, slots=True)
class Check:
    """One line of the checklist. ``fix`` says what to run when it is not ok."""

    name: str
    status: Status
    detail: str
    fix: str | None = None


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

    def has_command(self, name: str) -> bool: ...

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

    def has_command(self, name: str) -> bool:
        return shutil.which(name) is not None

    def mcp_command(self, command: str) -> str | None:
        return find_command(command, os.environ)


def run_checks(
    paths: GolemPaths,
    platform: Platform,
    keys: KeyStore,
    secrets: Secrets = lambda _name: None,
) -> list[Check]:
    """Every check, in the order the checklist shows them.

    ``secrets`` reads the ``mcp/…`` secrets MCP servers name.
    """
    checks = [service_check(platform)]
    socket = socket_check(paths)
    if socket is not None:
        checks.append(socket)
    settings, config = config_check(paths)
    checks.append(config)
    if settings is not None:
        checks.extend(model_checks(settings, platform, keys))
        checks.extend(mcp_checks(settings, platform, secrets))
    checks.append(disk_check(paths, platform))
    return checks


def service_check(platform: Platform) -> Check:
    program = platform.installed_program()
    if program is None:
        return Check("service", "fail", "launchd has no golem job", "golem daemon install")
    this = platform.this_program()
    if not program or not launchd.same_program(program, this):
        named = program[0] if program else "nothing"
        return Check(
            "service", "fail", f"launchd runs {named}, not this golem", "golem daemon install"
        )
    if not platform.service_loaded():
        return Check("service", "fail", "installed, but stopped", "golem daemon start")
    return Check("service", "ok", f"launchd runs {program[0]}")


def socket_check(paths: GolemPaths) -> Check | None:
    """Only you may open the socket. None when there is no socket to check."""
    try:
        info = paths.socket_path.lstat()
    except FileNotFoundError:
        return None
    mode = stat.S_IMODE(info.st_mode)
    if not stat.S_ISSOCK(info.st_mode):
        return Check(
            "socket", "fail", f"{paths.socket_path} is not a socket", "golem daemon restart"
        )
    if info.st_uid != os.getuid():
        return Check("socket", "fail", "owned by another user", "golem daemon restart")
    if mode & 0o077:
        return Check("socket", "fail", f"others can open it ({mode:04o})", "golem daemon restart")
    return Check("socket", "ok", f"only you can open it ({mode:04o})")


def config_check(paths: GolemPaths) -> tuple[GolemSettings | None, Check]:
    """The settings the daemon loads. The daemon is per user, so no project config."""
    try:
        settings = load_settings(home=paths.home, project_dir=paths.home)
    except (OSError, ValueError) as exc:
        return None, Check("config", "fail", _reason(exc), f"edit {paths.config_file}")
    if not paths.config_file.is_file():
        return settings, Check("config", "ok", "no config.toml, using the defaults")
    return settings, Check("config", "ok", f"{paths.config_file} is valid")


def model_checks(settings: GolemSettings, platform: Platform, keys: KeyStore) -> list[Check]:
    """The default model, then one line per provider the profiles use.

    A stopped Ollama is one line however many profiles need it.
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
            checks.append(Check("model", "ok", f"new chats start on {resolved.ref}"))
        used.setdefault(resolved.provider_name, []).append(resolved)
    for provider_name in sorted(used):
        models = used[provider_name]
        provider = models[0].provider
        if provider.kind == "ollama":
            checks.extend(_ollama_checks(provider_name, provider, models, platform))
        else:
            checks.append(_key_check(provider_name, provider, keys))
    return checks


def mcp_checks(settings: GolemSettings, platform: Platform, secrets: Secrets) -> list[Check]:
    """One line per MCP server that may start: its command is found, and its secrets stored."""
    checks: list[Check] = []
    for name, server in sorted(settings.mcp.items()):
        if server.enabled is False:
            continue
        label = f"mcp {name}"
        try:
            missing = [secret for secret in server.secrets if not secrets(secret)]
        except SecretStoreError as exc:
            checks.append(
                Check(label, "fail", str(exc), "unlock the login Keychain, then try again")
            )
            continue
        if missing:
            checks.append(
                Check(
                    label,
                    "fail",
                    f"no secret {missing[0]} in the Keychain",
                    f"golem auth set {missing[0]}",
                )
            )
            continue
        if server.command is None:
            checks.append(Check(label, "ok", f"reaches {server.url}"))
            continue
        found = platform.mcp_command(server.command)
        if found is None:
            fix = "install it, or set command to its full path in config.toml"
            checks.append(Check(label, "fail", f"command not found: {server.command}", fix))
            continue
        checks.append(Check(label, "ok", f"runs {found}"))
    return checks


def disk_check(paths: GolemPaths, platform: Platform) -> Check:
    existing = paths.home
    while not existing.exists() and existing != existing.parent:
        existing = existing.parent
    free = platform.free_bytes(existing)
    detail = f"{free / 1e9:.1f} GB free"
    if free < MIN_FREE_BYTES:
        return Check(
            "disk", "fail", detail, "free some space: golem's database and models need room"
        )
    return Check("disk", "ok", detail)


def _unresolved(name: str, default: bool, settings: GolemSettings, exc: ModelConfigError) -> Check:
    if default and settings.default_model is None:
        return Check("model", "warn", "no model chosen yet", "open golem and pick one with /model")
    label = "model" if default else f"model {name}"
    return Check(label, "fail", str(exc), "pick another with /model, or fix config.toml")


def _ollama_checks(
    name: str, provider: Provider, models: list[ResolvedModel], platform: Platform
) -> list[Check]:
    base = (provider.base_url or OLLAMA_BASE_URL).strip().rstrip("/").removesuffix("/v1")
    pulled = platform.ollama_models(base)
    if pulled is None:
        if platform.has_command("ollama"):
            fix = "brew services start ollama, or open the Ollama app"
        else:
            fix = "brew install ollama && brew services start ollama"
        return [Check(name, "fail", f"not answering at {base}", fix)]
    have = {_with_tag(model) for model in pulled}
    missing = sorted({model.model_id for model in models if _with_tag(model.model_id) not in have})
    count = f"{len(pulled)} model" + ("" if len(pulled) == 1 else "s")
    checks = [Check(name, "ok", f"running at {base}, {count} downloaded")]
    checks.extend(
        Check(
            f"model {model}", "fail", "not downloaded", f"ollama pull {model}, or pick it in /model"
        )
        for model in missing
    )
    return checks


def _key_check(name: str, provider: Provider, keys: KeyStore) -> Check:
    try:
        stored = keys.get(name)
    except KeyStoreError as exc:
        return Check(name, "fail", str(exc), "unlock the login Keychain, then try again")
    if stored:
        return Check(name, "ok", "API key in the Keychain")
    env = provider.api_key_env
    if env is not None and os.environ.get(env, "").strip():
        # launchd does not pass the shell's environment to the daemon.
        return Check(
            name,
            "warn",
            f"key only in ${env}, which the daemon does not see",
            f"golem auth set {name}",
        )
    if env is not None:
        return Check(name, "fail", "no API key", f"golem auth set {name}")
    return Check(name, "ok", "no key needed")


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
