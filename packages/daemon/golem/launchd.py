"""launchd user agent for the daemon.

``install`` writes ``~/Library/LaunchAgents/dev.golem.daemon.plist`` and
bootstraps it. ``stop`` unloads the job, so launchd does not restart it.
A kill leaves the job loaded, and launchd starts the daemon again.
"""

from __future__ import annotations

import os
import plistlib
import subprocess
import sys
from pathlib import Path
from typing import Any

from golem.paths import GolemPaths, resolve_paths

LABEL = "dev.golem.daemon"


class LaunchdError(Exception):
    """launchd is unavailable, or a launchctl command failed."""


def launch_agents_dir() -> Path:
    return Path.home() / "Library" / "LaunchAgents"


def plist_path() -> Path:
    return launch_agents_dir() / f"{LABEL}.plist"


def domain() -> str:
    return f"gui/{os.getuid()}"


def service_target() -> str:
    return f"{domain()}/{LABEL}"


def require_darwin() -> None:
    if sys.platform != "darwin":
        raise LaunchdError("launchd is macOS-only")


def plist_payload(paths: GolemPaths, python: str) -> dict[str, Any]:
    """The job launchd should run. ``python`` is an absolute interpreter path."""
    return {
        "Label": LABEL,
        "ProgramArguments": [python, "-m", "golem", "serve"],
        "RunAtLoad": True,
        "KeepAlive": True,
        "ThrottleInterval": 2,
        "WorkingDirectory": str(Path.home()),
        "EnvironmentVariables": {"GOLEM_HOME": str(paths.home)},
        "StandardOutPath": str(paths.logs_dir / "launchd.stdout.log"),
        "StandardErrorPath": str(paths.logs_dir / "launchd.stderr.log"),
        "ProcessType": "Background",
    }


def render_plist(paths: GolemPaths, python: str) -> bytes:
    return plistlib.dumps(plist_payload(paths, python), fmt=plistlib.FMT_XML)


def install() -> None:
    """Write the plist and bootstrap it. Reloads the job when it is already loaded."""
    require_darwin()
    paths = resolve_paths()
    paths.ensure_layout()
    destination = plist_path()
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(render_plist(paths, sys.executable))
    if job_loaded():
        subprocess.run(["launchctl", "bootout", service_target()], check=False)
    _run(["launchctl", "bootstrap", domain(), str(destination)])


def start() -> None:
    """Bootstrap the job if needed, then kickstart it."""
    require_darwin()
    destination = plist_path()
    if not destination.is_file():
        raise LaunchdError("plist missing; run golem daemon install")
    if not job_loaded():
        _run(["launchctl", "bootstrap", domain(), str(destination)])
    _run(["launchctl", "kickstart", "-k", service_target()])


def stop() -> None:
    """Unload the job. The daemon stays down until the next start."""
    require_darwin()
    if not job_loaded():
        print("daemon is not loaded", file=sys.stderr)
        return
    _run(["launchctl", "bootout", service_target()])


def job_loaded() -> bool:
    result = subprocess.run(
        ["launchctl", "print", service_target()],
        capture_output=True,
        text=True,
        check=False,
    )
    return result.returncode == 0


def _run(args: list[str]) -> None:
    result = subprocess.run(args, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip()
        message = " ".join(args[:2]) + " failed"
        if detail:
            message = f"{message}: {detail}"
        raise LaunchdError(message)
