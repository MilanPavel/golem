"""From ``[mcp.<name>]`` to a transport: where the command is, its environment, its secrets.

launchd starts the daemon with a short ``PATH``, so a command is also looked
for where Homebrew, ``pipx``, and ``uv tool`` put programs. A stdio server
gets a small environment, not the daemon's: nothing such as an API key in the
daemon's environment reaches it unless ``env`` names it. ``keychain:mcp/…``
in ``env`` or ``headers`` is replaced by the secret when the server starts.
"""

from __future__ import annotations

import os
import re
import shutil
from collections.abc import Callable, Mapping
from pathlib import Path

from golem.config import MCP_SECRET, McpServerSettings
from golem.mcp.transport import HttpTransport, Launch, McpError, StdioTransport, Transport

EXTRA_PATH = ("/opt/homebrew/bin", "/usr/local/bin", "~/.local/bin")
PASSED_ENV = ("HOME", "LOGNAME", "USER", "SHELL", "TERM", "LANG", "TMPDIR")

Secrets = Callable[[str], str | None]
"""Reads a secret by name, ``mcp/<name>``. None when the store has none."""


def search_path(environ: Mapping[str, str]) -> str:
    """``PATH`` with Homebrew's folders and ``~/.local/bin`` after it."""
    home = environ.get("HOME") or str(Path.home())
    folders = [part for part in environ.get("PATH", "").split(os.pathsep) if part]
    for extra in EXTRA_PATH:
        folder = str(Path(extra.replace("~", home, 1)))
        if folder not in folders:
            folders.append(folder)
    return os.pathsep.join(folders)


def find_command(command: str, environ: Mapping[str, str]) -> str | None:
    """The absolute path ``command`` runs, or None when it is nowhere on the search path."""
    return shutil.which(os.path.expanduser(command), path=search_path(environ))


def transport_for(
    settings: McpServerSettings,
    environ: Mapping[str, str],
    secrets: Secrets,
    *,
    project: Path | None = None,
) -> Transport:
    """The transport for ``settings``. Raises :class:`McpError` when it cannot be built.

    A project server's relative ``cwd`` is relative to the project folder.
    """
    if settings.url is not None:
        headers = {key: _with_secrets(value, secrets) for key, value in settings.headers.items()}
        return HttpTransport(settings.url, headers)
    return StdioTransport(launch(settings, environ, secrets, project=project))


def launch(
    settings: McpServerSettings,
    environ: Mapping[str, str],
    secrets: Secrets,
    *,
    project: Path | None = None,
) -> Launch:
    """The process for a stdio server. Raises :class:`McpError` when it cannot run."""
    assert settings.command is not None
    path = search_path(environ)
    env = {key: environ[key] for key in PASSED_ENV if key in environ}
    env["PATH"] = path
    env.update({key: _with_secrets(value, secrets) for key, value in settings.env.items()})
    command = find_command(settings.command, environ)
    if command is None:
        raise McpError(f"command not found: {settings.command} (looked in {path})")
    home = Path(environ.get("HOME") or Path.home())
    if settings.cwd is None:
        cwd = project or home
    else:
        cwd = Path(os.path.expanduser(settings.cwd))
        if not cwd.is_absolute():
            cwd = (project or home) / cwd
    if not cwd.is_dir():
        raise McpError(f"no such folder: {cwd}")
    return Launch(argv=[command, *settings.args], env=env, cwd=cwd)


def _with_secrets(value: str, secrets: Secrets) -> str:
    def replace(found: re.Match[str]) -> str:
        name = found.group(1)
        secret = secrets(name)
        if not secret:
            raise McpError(f"no secret {name} in the Keychain: run golem auth set {name}")
        return secret

    return MCP_SECRET.sub(replace, value)


__all__ = ["EXTRA_PATH", "Secrets", "find_command", "launch", "search_path", "transport_for"]
