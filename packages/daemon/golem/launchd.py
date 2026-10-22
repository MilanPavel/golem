"""launchd user agent for the daemon.

``install`` writes ``~/Library/LaunchAgents/dev.golem.daemon.plist`` and
bootstraps it. ``stop`` unloads the job, so launchd does not restart it.
A kill leaves the job loaded, and launchd starts the daemon again.
``restart`` swaps the running daemon for the one the plist names, after an
upgrade. ``uninstall`` unloads the job and deletes the plist; data stays.
"""

from __future__ import annotations

import os
import plistlib
import subprocess
import sys
from pathlib import Path
from typing import Any, cast

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


def serve_command() -> list[str]:
    """How launchd should start this daemon.

    A frozen build is its own executable, named by its stable path. A checkout or
    a venv still runs the module.
    """
    if getattr(sys, "frozen", False):
        return [str(stable_path(Path(sys.executable))), "serve"]
    return [sys.executable, "-m", "golem", "serve"]


def stable_path(executable: Path) -> Path:
    """``executable`` through Homebrew's ``opt`` link when it is in a keg.

    Homebrew installs each version in ``<prefix>/Cellar/<formula>/<version>/``
    and points ``<prefix>/opt/<formula>`` at the current one. A plist that named
    the version folder would keep starting the old daemon after ``brew upgrade``
    and fail once ``brew cleanup`` deletes it. Any other path is kept as is.
    """
    real = executable.resolve()
    parts = real.parts
    for index in range(len(parts) - 4, 0, -1):
        if parts[index] != "Cellar":
            continue
        formula, rest = parts[index + 1], parts[index + 3 :]
        candidate = Path(*parts[:index], "opt", formula, *rest)
        if candidate.resolve() == real:
            return candidate
    return executable


def plist_payload(paths: GolemPaths, program: list[str]) -> dict[str, Any]:
    """The job launchd should run. ``program`` is an absolute command."""
    return {
        "Label": LABEL,
        "ProgramArguments": program,
        "RunAtLoad": True,
        "KeepAlive": True,
        "ThrottleInterval": 2,
        "WorkingDirectory": str(Path.home()),
        "EnvironmentVariables": {"GOLEM_HOME": str(paths.home)},
        "StandardOutPath": str(paths.logs_dir / "launchd.stdout.log"),
        "StandardErrorPath": str(paths.logs_dir / "launchd.stderr.log"),
        "ProcessType": "Background",
    }


def render_plist(paths: GolemPaths, program: list[str]) -> bytes:
    return plistlib.dumps(plist_payload(paths, program), fmt=plistlib.FMT_XML)


def install() -> None:
    """Write the plist and bootstrap it. Reloads the job when it is already loaded."""
    require_darwin()
    paths = resolve_paths()
    paths.ensure_layout()
    destination = plist_path()
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(render_plist(paths, serve_command()))
    if job_loaded():
        subprocess.run(["launchctl", "bootout", service_target()], check=False)
    _run(["launchctl", "bootstrap", domain(), str(destination)])


def restart() -> None:
    """Stop the running daemon and start the one the plist names.

    launchd sends SIGTERM, so the old daemon cancels running answers, keeps
    what they said, and releases the lock before the new one takes it. When the
    plist names another daemon than this one, it says so: ``install`` switches.
    """
    require_darwin()
    destination = plist_path()
    if not destination.is_file():
        raise LaunchdError("plist missing; run golem daemon install")
    named = installed_program(destination)
    if named is not None and not same_program(named, serve_command()):
        print(
            f"launchd runs {named[0]}, not this golem; run golem daemon install to switch",
            file=sys.stderr,
        )
    start()


def uninstall() -> None:
    """Unload the job and delete the plist. ``GOLEM_HOME`` and its data stay."""
    require_darwin()
    if job_loaded():
        _run(["launchctl", "bootout", service_target()])
    destination = plist_path()
    if not destination.is_file():
        print("daemon is not installed", file=sys.stderr)
        return
    destination.unlink()


def installed_program(destination: Path) -> list[str] | None:
    """``ProgramArguments`` from the plist, or ``None`` when it has none."""
    try:
        payload: object = plistlib.loads(destination.read_bytes())
    except (OSError, plistlib.InvalidFileException):
        return None
    if not isinstance(payload, dict):
        return None
    program = cast(dict[str, object], payload).get("ProgramArguments")
    if not isinstance(program, list) or not program:
        return None
    return [str(part) for part in cast(list[object], program)]


def same_program(left: list[str], right: list[str]) -> bool:
    """Equal commands, with the executable compared after resolving symlinks.

    Homebrew's ``opt`` link and a venv's ``python`` are links to the real file.
    """
    if left[1:] != right[1:]:
        return False
    return Path(left[0]).resolve() == Path(right[0]).resolve()


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
