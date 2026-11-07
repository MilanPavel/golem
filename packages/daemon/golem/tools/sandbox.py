"""Run a command under macOS ``sandbox-exec``, with its output streamed and capped.

The profile allows what a build or a test run needs and little more:

- **Writes** go only to the session folder, the temp folders, the usual tool
  caches, and any ``[shell] writable`` folder. When the session folder is in a
  git checkout whose git folders are outside it, such as a git worktree, those
  git folders are writable too, so ``git fetch`` and ``git commit`` work.
- **Network** is denied unless ``[shell] network = true``. Local Unix sockets
  stay open, so a tool can still reach a daemon of its own.
- **Reads** are allowed, except in folders that hold credentials, golem's own
  home among them. Golem's skills folder is the one part of its home a
  command may read, so a skill can run its own scripts.

The command runs in its own process group. A timeout or a cancelled run
kills the whole group, so a test runner's children die with it.
"""

from __future__ import annotations

import asyncio
import contextlib
import functools
import os
import re
import signal
import subprocess
import sys
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path

from golem.config import ShellSettings

SANDBOX_EXEC = Path("/usr/bin/sandbox-exec")

SECRET_DIRS = (
    ".ssh",
    ".gnupg",
    ".aws",
    ".azure",
    ".kube",
    ".docker",
    ".netrc",
    ".config/gh",
    ".config/gcloud",
    ".golem",
    "Library/Keychains",
)
"""Under the home folder. A command may not read these."""

SKILL_DIRS = (".golem/skills",)
"""Under the home folder, inside a :data:`SECRET_DIRS` folder. A command may read these."""

CACHE_DIRS = (".cache", "Library/Caches", ".npm", "Library/pnpm", ".cargo/registry")
"""Under the home folder. Builds write here, so a command may too."""

HEAD_CHARS = 1_000_000
TAIL_CHARS = 4_000_000
STREAM_LIMIT = 64_000
FLUSH_CHARS = 2_000
FLUSH_SECONDS = 0.2
KILL_GRACE_SECONDS = 2.0

_SECRET_ENV = ("_API_KEY", "_TOKEN", "_SECRET", "PASSWORD", "_PASSWD")


@functools.cache
def available() -> bool:
    """Whether a sandbox can be applied here. Not inside another sandbox, for one."""
    if sys.platform != "darwin" or not SANDBOX_EXEC.exists():
        return False
    try:
        probe = subprocess.run(
            [str(SANDBOX_EXEC), "-p", "(version 1)(allow default)", "/usr/bin/true"],
            capture_output=True,
            timeout=5,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    return probe.returncode == 0


@dataclass(frozen=True, slots=True)
class Finished:
    """``output`` is the head and tail of what the command printed, stdout and stderr together."""

    exit_code: int | None
    output: str
    timed_out: bool
    cut: bool


def writable_dirs(root: Path, settings: ShellSettings, *, home: Path) -> list[Path]:
    """The folders a command in ``root`` may write to, resolved."""
    writable = [root.resolve(), Path("/private/tmp"), Path("/private/var/folders")]
    writable += [(home / name).resolve() for name in CACHE_DIRS]
    writable += [_expand(raw, home) for raw in settings.writable]
    writable += [folder for folder in git_dirs(root) if not folder.is_relative_to(root.resolve())]
    return writable


def profile(root: Path, settings: ShellSettings, *, home: Path) -> str:
    """The SBPL profile for a command in ``root``."""
    writable = writable_dirs(root, settings, home=home)
    lines = [
        "(version 1)",
        "(allow default)",
        "(deny file-write*)",
        "(allow file-write*",
        *[f"  (subpath {_quote(path)})" for path in writable],
        '  (literal "/dev/null") (literal "/dev/zero")',
        '  (regex #"^/dev/tty") (regex #"^/dev/fd/") (literal "/dev/dtracehelper"))',
        "(deny file-read*",
        *[f"  (subpath {_quote((home / name).resolve())})" for name in SECRET_DIRS],
        ")",
        "(allow file-read*",
        *[f"  (subpath {_quote((home / name).resolve())})" for name in SKILL_DIRS],
        ")",
    ]
    if not settings.network:
        lines += ["(deny network*)", "(allow network* (remote unix-socket))"]
    return "\n".join(lines) + "\n"


UNSANDBOXED_HINT = "or run the command with shell_unsandboxed, which the user approves first"

_DENIED = re.compile(r"operation not permitted", re.IGNORECASE)
_PATH = re.compile(r"(?<![\w.~/-])(~?/[^\s:'\"`,;()\[\]]+)")
_NO_NETWORK = re.compile(
    r"couldn't connect to server|could not connect to server|failed to connect to"
    r"|could not resolve host|network is unreachable|connection refused|econnrefused"
    r"|enotfound|getaddrinfo|nodename nor servname|temporary failure in name resolution"
    r"|name or service not known",
    re.IGNORECASE,
)


def refusals(output: str, root: Path, settings: ShellSettings, *, home: Path) -> list[str]:
    """What golem's sandbox blocked, by the errors in ``output``: one line each, with the fix.

    A path in an ``Operation not permitted`` line counts only when the profile
    closes it: a credentials folder, or a folder outside the writable ones.
    A connection error counts only while ``[shell] network`` is off.
    """
    home = home.resolve()
    secrets = [((home / name).resolve(), name) for name in SECRET_DIRS]
    readable = [(home / name).resolve() for name in SKILL_DIRS]
    writable = writable_dirs(root, settings, home=home)
    found: dict[str, str] = {}
    for line in output.splitlines():
        if not _DENIED.search(line):
            continue
        for raw in _PATH.findall(line):
            path = (home / raw[2:]).resolve() if raw.startswith("~/") else Path(raw).resolve()
            secret = next((name for folder, name in secrets if path.is_relative_to(folder)), None)
            if secret is not None and not any(path.is_relative_to(r) for r in readable):
                found.setdefault(
                    f"secret:{secret}",
                    f"golem's sandbox blocked {path}: ~/{secret} holds credentials, so a "
                    f"sandboxed command may not read it. A command that needs it, such as gh "
                    f"or git push, can run with shell_unsandboxed, which the user approves first.",
                )
                break
            if secret is None and not any(path.is_relative_to(w) for w in writable):
                found.setdefault(
                    "write",
                    f"golem's sandbox lets a command write only in the project folder, the temp "
                    f"folders, and [shell] writable, and {path} is outside them. If the command "
                    f"wrote there, add the folder to [shell] writable in the user's config.toml, "
                    f"{UNSANDBOXED_HINT}.",
                )
                break
    if not settings.network and _NO_NETWORK.search(output):
        found["network"] = (
            "golem's sandbox blocked the network, because [shell] network is off. To allow it, "
            "set [shell] network = true in the user's config.toml, "
            f"{UNSANDBOXED_HINT}."
        )
    return list(found.values())


def git_dirs(root: Path) -> list[Path]:
    """The git folders of the checkout ``root`` is in, or none outside a checkout.

    A clone has one, ``.git``. A git worktree has a ``.git`` file that points
    to its own folder, and that folder's ``commondir`` points to the folder it
    shares with the main checkout. The files are read here, not by running git,
    so a missing or broken git changes nothing.
    """
    start = root.resolve()
    for folder in (start, *start.parents):
        dot_git = folder / ".git"
        if dot_git.is_dir():
            return [dot_git]
        if dot_git.is_file():
            own = _pointed(dot_git, "gitdir:", folder)
            if own is None:
                return []
            common = _pointed(own / "commondir", "", own)
            return [own] if common is None or common == own else [own, common]
    return []


def _pointed(file: Path, prefix: str, base: Path) -> Path | None:
    """The folder that ``file`` names after ``prefix``, relative to ``base``, if it exists."""
    try:
        text = file.read_text("utf-8").strip()
    except (OSError, UnicodeDecodeError):
        return None
    name = text.removeprefix(prefix).strip()
    if not text.startswith(prefix) or not name:
        return None
    target = (base / name).resolve()
    return target if target.is_dir() else None


def environment(base: dict[str, str], *, home: Path, credentials: bool = False) -> dict[str, str]:
    """``base`` without anything that looks like a credential, and with a usable PATH.

    With ``credentials``, such variables stay, as for a command the user
    approved to run outside the sandbox.
    """
    env = {
        key: value
        for key, value in base.items()
        if credentials or not any(marker in key.upper() for marker in _SECRET_ENV)
    }
    extra = [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        str(home / ".local/bin"),
        str(home / ".cargo/bin"),
    ]
    path = env.get("PATH", "/usr/bin:/bin:/usr/sbin:/sbin").split(":")
    env["PATH"] = ":".join([*[item for item in extra if item not in path], *path])
    env.update(
        {
            "HOME": str(home),
            "TERM": "dumb",
            "NO_COLOR": "1",
            "PAGER": "cat",
            "GIT_PAGER": "cat",
            "GIT_TERMINAL_PROMPT": "0",
        }
    )
    return env


async def run(
    argv: Sequence[str],
    *,
    root: Path,
    settings: ShellSettings,
    timeout: float,
    on_output: Callable[[str], None] | None = None,
    home: Path | None = None,
    sandboxed: bool = True,
) -> Finished:
    """Run ``argv`` in ``root`` under the sandbox. Cancelling kills the process group.

    With ``sandboxed=False`` it runs without one, and keeps the variables that
    hold credentials. Only a call the user approved for that may ask for it.
    """
    home = (home if home is not None else Path.home()).resolve()
    command = list(argv)
    if sandboxed:
        command = [str(SANDBOX_EXEC), "-p", profile(root, settings, home=home), *command]
    process = await asyncio.create_subprocess_exec(
        *command,
        cwd=root,
        env=environment(dict(os.environ), home=home, credentials=not sandboxed),
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        start_new_session=True,
    )
    capture = _Capture(on_output)
    deadline = time.monotonic() + timeout
    timed_out = False
    try:
        assert process.stdout is not None
        while True:
            left = deadline - time.monotonic()
            if left <= 0:
                timed_out = True
                break
            try:
                chunk = await asyncio.wait_for(process.stdout.read(4096), left)
            except TimeoutError:
                timed_out = True
                break
            if not chunk:
                break
            capture.add(chunk.decode("utf-8", errors="replace"))
        if timed_out:
            await _kill(process)
        else:
            await process.wait()
    except asyncio.CancelledError:
        await asyncio.shield(_kill(process))
        raise
    capture.flush()
    return Finished(
        exit_code=None if timed_out else process.returncode,
        output=capture.text(),
        timed_out=timed_out,
        cut=capture.cut,
    )


class _Capture:
    """Keeps the head and the tail, and streams in batches of a few kilobytes."""

    def __init__(self, on_output: Callable[[str], None] | None) -> None:
        self._on_output = on_output
        self._head: list[str] = []
        self._head_size = 0
        self._tail = ""
        self.cut = False
        self._pending = ""
        self._streamed = 0
        self._last_flush = time.monotonic()

    def add(self, text: str) -> None:
        self.push(text)
        if self._head_size < HEAD_CHARS:
            room = HEAD_CHARS - self._head_size
            self._head.append(text[:room])
            self._head_size += min(room, len(text))
            text = text[room:]
        if text:
            self._tail += text
            if len(self._tail) > TAIL_CHARS:
                self._tail = self._tail[-TAIL_CHARS:]
                self.cut = True

    def text(self) -> str:
        head = "".join(self._head)
        if self.cut:
            return f"{head}\n[… output cut …]\n{self._tail}"
        return head + self._tail

    def flush(self) -> None:
        if self._pending and self._on_output is not None:
            self._on_output(self._pending)
        self._pending = ""

    def push(self, text: str) -> None:
        if self._on_output is None or self._streamed >= STREAM_LIMIT:
            return
        room = STREAM_LIMIT - self._streamed
        part = text[:room]
        self._streamed += len(part)
        self._pending += part
        if len(part) < len(text):
            self._pending += "\n[more output is not shown here]\n"
        now = time.monotonic()
        if len(self._pending) >= FLUSH_CHARS or now - self._last_flush >= FLUSH_SECONDS:
            self.flush()
            self._last_flush = now


async def _kill(process: asyncio.subprocess.Process) -> None:
    for sig, wait in ((signal.SIGTERM, KILL_GRACE_SECONDS), (signal.SIGKILL, 5.0)):
        if process.returncode is not None:
            return
        with contextlib.suppress(ProcessLookupError, PermissionError):
            os.killpg(process.pid, sig)
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(process.wait(), wait)


def _expand(raw: str, home: Path) -> Path:
    if raw == "~" or raw.startswith("~/"):
        return (home / raw[2:]).resolve()
    return Path(raw).resolve()


def _quote(path: Path) -> str:
    text = str(path).replace("\\", "\\\\").replace('"', '\\"')
    return f'"{text}"'


__all__ = [
    "CACHE_DIRS",
    "SECRET_DIRS",
    "SKILL_DIRS",
    "Finished",
    "available",
    "environment",
    "git_dirs",
    "profile",
    "refusals",
    "run",
    "writable_dirs",
]
