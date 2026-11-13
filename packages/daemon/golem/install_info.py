"""Where golem is installed and what runs it, for ``setup.status``."""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from golem import __version__, launchd
from golem.paths import GolemPaths

WEB_LABEL = "dev.golem.web"
DAEMON_LABEL = launchd.LABEL

_PID = re.compile(r"^\s*pid = (\d+)\s*$", re.MULTILINE)

Method = Literal["homebrew", "script", "dev"]


@dataclass(frozen=True, slots=True)
class Install:
    method: Method
    version: str
    binary: str | None
    daemon_binary: str


@dataclass(frozen=True, slots=True)
class Job:
    label: str
    plist: str
    loaded: bool
    pid: int | None


def _keg_prefix(executable: Path) -> Path | None:
    """The Homebrew prefix when ``executable`` is in a keg, else ``None``."""
    parts = executable.resolve().parts
    for index in range(len(parts) - 4, 0, -1):
        if parts[index] == "Cellar":
            return Path(*parts[:index])
    return None


def install_facts(
    *,
    frozen: bool | None = None,
    executable: Path | None = None,
    which: Callable[[str], str | None] = shutil.which,
) -> Install:
    """How this golem was installed: a Homebrew keg, a downloaded build, or a checkout."""
    is_frozen = bool(getattr(sys, "frozen", False)) if frozen is None else frozen
    program = executable if executable is not None else Path(sys.executable)
    if not is_frozen:
        return Install("dev", __version__, which("golem"), str(program))
    daemon = launchd.stable_path(program)
    prefix = _keg_prefix(program)
    if prefix is not None:
        link = prefix / "bin" / "golem"
        return Install(
            "homebrew", __version__, str(link) if link.exists() else which("golem"), str(daemon)
        )
    return Install("script", __version__, which("golem"), str(daemon))


def _launchctl_print(target: str) -> str | None:
    """What ``launchctl print`` says of a job, or ``None`` when it is not loaded."""
    try:
        result = subprocess.run(
            ["launchctl", "print", target],
            capture_output=True,
            text=True,
            check=False,
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return result.stdout if result.returncode == 0 else None


def job_facts(
    label: str,
    plist: Path,
    printer: Callable[[str], str | None] | None = None,
) -> Job:
    text = (printer or _launchctl_print)(f"gui/{os.getuid()}/{label}")
    if text is None:
        return Job(label, str(plist), False, None)
    match = _PID.search(text)
    return Job(label, str(plist), True, int(match.group(1)) if match else None)


def jobs(printer: Callable[[str], str | None] | None = None) -> list[Job]:
    agents = launchd.launch_agents_dir()
    return [
        job_facts(DAEMON_LABEL, agents / f"{DAEMON_LABEL}.plist", printer),
        job_facts(WEB_LABEL, agents / f"{WEB_LABEL}.plist", printer),
    ]


def path_facts(paths: GolemPaths) -> dict[str, str]:
    return {
        "home": str(paths.home),
        "config": str(paths.config_file),
        "logs": str(paths.log_file),
        "socket": str(paths.socket_path),
    }
