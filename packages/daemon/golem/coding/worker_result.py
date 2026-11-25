"""What a worker returns: the files of its diff and how the project's checks ended in its copy.

The diff comes from :func:`golem.coding.copies.diff_since_baseline`. :func:`files_of` reads the
files and the line counts out of that patch (a binary file counts 0 and 0), and :func:`run_checks`
runs the project's checks in the copy. A check that times out counts as failed: it did not pass,
and the lead reads its name in ``checks_failed``. No sandbox, no checks: ``none`` with a note.
"""

from __future__ import annotations

import os
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from golem.coding.checks import Check, checks_for
from golem.config import CodingSettings, ShellSettings
from golem.tools import sandbox

CheckOutcome = Literal["passed", "failed", "timed_out"]
CheckRunner = Callable[[Check, Path], Awaitable[CheckOutcome]]
"""Runs one check in a folder. The default runs it in the shell sandbox."""

NO_CHANGES = "no changes"
NO_CHECKS = "no checks found"
NO_SANDBOX = "checks need the shell sandbox"
CHECKS_OFF = "checks are off"
STOPPED = "stopped before the checks finished"

_HEADER = re.compile(r"^diff --git \"?a/(.*?)\"? \"?b/(.*?)\"?$")
FileStatus = Literal["created", "modified", "deleted"]


@dataclass(slots=True)
class FileChange:
    path: str
    status: FileStatus = "modified"
    added: int = 0
    removed: int = 0


@dataclass(frozen=True, slots=True)
class CheckResult:
    checks: Literal["passed", "failed", "none"]
    failed: list[str] = field(default_factory=list[str])
    note: str | None = None


def files_of(patch: str) -> list[FileChange]:
    """The files of a ``git diff --binary`` patch with the lines each added and removed."""
    found: list[FileChange] = []
    in_hunk = False
    for line in patch.split("\n"):
        header = _HEADER.match(line)
        if header is not None:  # a hunk line always starts with space, + or -
            found.append(FileChange(header.group(2)))
            in_hunk = False
            continue
        if not found:
            continue
        current = found[-1]
        if line.startswith("@@"):
            in_hunk = True
        elif line.startswith(("GIT binary patch", "Binary files")):
            in_hunk = False
        elif in_hunk:
            if line.startswith("+"):
                current.added += 1
            elif line.startswith("-"):
                current.removed += 1
        elif line.startswith("new file mode"):
            current.status = "created"
        elif line.startswith("deleted file mode"):
            current.status = "deleted"
        elif line.startswith("rename to "):
            current.path = line.removeprefix("rename to ").strip('"')
    return found


def default_runner(settings: ShellSettings) -> CheckRunner:
    """Runs a check in the shell sandbox with its own timeout."""

    async def run(check: Check, root: Path) -> CheckOutcome:
        login = os.environ.get("SHELL") or "/bin/zsh"
        done = await sandbox.run(
            [login, "-lc", check.command],
            root=root,
            settings=settings,
            timeout=check.timeout_seconds,
            sandboxed=True,
        )
        return "timed_out" if done.timed_out else "passed" if done.exit_code == 0 else "failed"

    return run


async def run_checks(
    root: Path, coding: CodingSettings, runner: CheckRunner | None, shell: ShellSettings
) -> CheckResult:
    """Run the checks of ``root``. ``runner`` None means the sandbox, which may be missing."""
    if coding.checks == "off":
        return CheckResult("none", note=CHECKS_OFF)
    checks = checks_for(root, coding)
    if not checks:
        return CheckResult("none", note=NO_CHECKS)
    if runner is None:
        if not sandbox.available():
            return CheckResult("none", note=NO_SANDBOX)
        runner = default_runner(shell)
    failed: list[str] = []
    timed_out: list[str] = []
    for check in checks:
        outcome = await runner(check, root)
        if outcome != "passed":
            failed.append(check.name)
        if outcome == "timed_out":
            timed_out.append(check.name)
    note = f"timed out: {', '.join(timed_out)}" if timed_out else None
    return CheckResult("failed" if failed else "passed", failed, note)


__all__ = [
    "CHECKS_OFF",
    "NO_CHANGES",
    "NO_CHECKS",
    "NO_SANDBOX",
    "STOPPED",
    "CheckOutcome",
    "CheckResult",
    "CheckRunner",
    "FileChange",
    "default_runner",
    "files_of",
    "run_checks",
]
