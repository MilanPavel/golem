"""The folders a page may browse to choose a project folder (``fs.list_dirs``, ADR-040).

The listing is narrow on purpose. It stays under the home folder, shows only
folders, and leaves out dot-folders, ``~/Library``, and the secret folders of
the sandbox. No file name, size, time, or content is ever returned.
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
from pathlib import Path

from golem.tools.sandbox import SECRET_DIRS
from golem_protocol.commands import DirEntry, FsListDirsResult

log = logging.getLogger("golem.folders")

MAX_ENTRIES = 500
"""One call stays small: a longer list is cut, and ``truncated`` says so."""

OUTSIDE = "That folder is outside your home folder."


class FolderError(Exception):
    """A folder that cannot be listed. The message is for the person."""


def hidden_folders(home: Path) -> list[Path]:
    """The folders under ``home`` that are never listed, nor entered."""
    return [(home / name).resolve() for name in ("Library", *SECRET_DIRS)]


def is_under(path: Path, root: Path) -> bool:
    return path == root or root in path.parents


def _browsable(path: Path, home: Path, hidden: list[Path]) -> bool:
    """Whether ``path``, already resolved, is home or a folder below it that may be shown."""
    if not is_under(path, home):
        return False
    if any(is_under(path, folder) for folder in hidden):
        return False
    return not any(part.startswith(".") for part in path.relative_to(home).parts)


def checked_folder(path: str, home: Path) -> str:
    """``path`` resolved, if it is an existing folder the page may ask about."""
    if not Path(path).is_absolute():
        raise FolderError("path must be an absolute path")
    root = home.resolve()
    try:
        target = Path(path).resolve()
    except (OSError, RuntimeError) as exc:
        raise FolderError(OUTSIDE) from exc
    if not is_under(target, root) or any(
        is_under(target, hidden) for hidden in hidden_folders(root)
    ):
        raise FolderError(OUTSIDE)
    if not target.is_dir():
        raise FolderError(f"There is no folder at {path}.")
    return str(target)


def list_dirs(path: Path | None, home: Path) -> FsListDirsResult:
    """The folders directly under ``path`` (home when None), as ``fs.list_dirs`` returns them.

    Raises :class:`FolderError` for a path outside ``home`` (symlinks and ``..``
    are resolved first), a path that is not a folder, and a folder that cannot
    be read.
    """
    root = home.resolve()
    hidden = hidden_folders(root)
    try:
        target = root if path is None else path.resolve()
    except (OSError, RuntimeError) as exc:
        raise FolderError(OUTSIDE) from exc
    if not _browsable(target, root, hidden):
        raise FolderError(OUTSIDE)
    if not target.is_dir():
        raise FolderError(f"There is no folder at {path}.")
    entries: list[DirEntry] = []
    try:
        with os.scandir(target) as children:
            for child in children:
                if child.name.startswith("."):
                    continue
                try:
                    if not child.is_dir():
                        continue
                    resolved = Path(child.path).resolve()
                    git = (resolved / ".git").exists()
                except OSError:
                    continue
                if not _browsable(resolved, root, hidden):
                    continue
                entries.append(DirEntry(name=child.name, path=str(resolved), git=git))
    except OSError as exc:
        raise FolderError(f"golem can't read {target}.") from exc
    entries.sort(key=lambda entry: (entry.name.lower(), entry.name))
    return FsListDirsResult(
        path=str(target),
        home=str(root),
        parent=None if target == root else str(target.parent),
        entries=entries[:MAX_ENTRIES],
        truncated=len(entries) > MAX_ENTRIES,
    )


DIALOG_SECONDS = 300.0
"""How long the folder dialog may stay open before golem closes it."""

_SCRIPT = (
    "on run argv",
    "set start to item 1 of argv",
    "set picked to choose folder with prompt (item 2 of argv) default location (POSIX file start)",
    "return POSIX path of picked",
    "end run",
)
_PROMPT = "Choose a folder for golem"
_CANCELLED = "-128"

_dialog_open = False


class DialogUnsupportedError(FolderError):
    """The platform has no folder dialog."""


class RevealFailedError(FolderError):
    """``open`` could not show the folder in Finder."""


class DialogBusyError(FolderError):
    """Another folder dialog is already open."""


def dialog_supported() -> bool:
    """Whether this platform can show the folder dialog (macOS only)."""
    return sys.platform == "darwin"


async def _run_osascript(start: str) -> tuple[int, str, str]:
    """Run the dialog and wait for it. The start folder and the prompt are script arguments."""
    args = ["osascript"]
    for line in _SCRIPT:
        args += ["-e", line]
    args += ["--", start, _PROMPT]
    process = await asyncio.create_subprocess_exec(
        *args,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        async with asyncio.timeout(DIALOG_SECONDS):
            out, err = await process.communicate()
    except BaseException:
        process.kill()
        await process.wait()
        raise
    return process.returncode or 0, out.decode(errors="replace"), err.decode(errors="replace")


async def choose_folder(start: Path | None, home: Path) -> str | None:
    """Open the macOS folder dialog and return the folder chosen, or None when it is cancelled.

    The dialog opens in ``start`` when that is a folder, else in ``home``. The path has no
    trailing slash. Raises :class:`DialogUnsupportedError` off macOS and
    :class:`DialogBusyError` while another dialog is open. A dialog left open for
    :data:`DIALOG_SECONDS` is closed and counts as cancelled.
    """
    global _dialog_open
    if not dialog_supported():
        raise DialogUnsupportedError("The folder dialog is only available on macOS.")
    if _dialog_open:
        raise DialogBusyError("A folder dialog is already open.")
    _dialog_open = True
    try:
        folder = start if start is not None and start.is_dir() else home
        try:
            code, out, err = await _run_osascript(str(folder))
        except TimeoutError:
            return None
        except OSError as exc:
            raise FolderError("golem could not open the folder dialog.") from exc
    finally:
        _dialog_open = False
    if code != 0:
        if _CANCELLED in err:
            return None
        log.warning("the folder dialog failed: %s", err.strip())
        raise FolderError("golem could not open the folder dialog.")
    chosen = out.strip()
    if not chosen:
        return None
    return chosen if chosen == "/" else chosen.rstrip("/")


OPEN_SECONDS = 10.0
"""How long ``open`` may take to hand the folder to Finder."""


async def _run_open(path: str) -> int:
    """Run ``open`` on ``path`` and return its exit code. The path is one argument."""
    process = await asyncio.create_subprocess_exec(
        "open",
        "--",
        path,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
    )
    try:
        async with asyncio.timeout(OPEN_SECONDS):
            return await process.wait()
    except BaseException:
        process.kill()
        await process.wait()
        raise


async def reveal_folder(path: str, home: Path) -> None:
    """Open ``path`` in Finder on this Mac.

    The path is checked as ``git.info`` checks it. Raises :class:`DialogUnsupportedError` off
    macOS, :class:`FolderError` for a path that is refused, and :class:`RevealFailedError` when
    ``open`` fails.
    """
    if not dialog_supported():
        raise DialogUnsupportedError("Open in Finder is only available on macOS.")
    folder = checked_folder(path, home)
    try:
        code = await _run_open(folder)
    except (OSError, TimeoutError) as exc:
        raise RevealFailedError("golem could not open the folder in Finder.") from exc
    if code != 0:
        raise RevealFailedError("golem could not open the folder in Finder.")
