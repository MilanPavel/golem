"""Files a shell command changed, found with git.

golem cannot know what a file held before a command ran unless it looked first.
In a git repository it can: git lists the files that are already changed or new,
and ``git show HEAD:<path>`` gives the text of any other file. A folder that is
not a git repository records nothing, and neither does a machine with no sandbox:
git runs through ``run_git``, which the shell tool backs with the sandbox.
Ignored files are not listed, which is intended: build output is not a change to review.
"""

from __future__ import annotations

import base64
import hashlib
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from golem.tools import sandbox
from golem.tools.registry import FileEdit

MAX_BYTES = 1_000_000
MAX_FILES = 200
_SKIPPED = (".git", ".golem")
# Runs a shell script in the session folder, with ``git`` defined as the safe, sandboxed git and
# the strings as ``"$@"``. Its output, or None when it fails, times out, or is cut.
RunGit = Callable[[str, tuple[str, ...]], Awaitable[str | None]]

_STATUS = "git status --porcelain=v1 -z -uall --no-renames"
# The top folder on the first line, then the status, which is NUL-separated.
_LOOK = 'top=$(git rev-parse --show-toplevel) || exit 1; printf "%s\\n" "$top"; ' + _STATUS
# ``git cat-file --batch`` gives, for each path in order, ``<id> blob <size>`` and the bytes, or
# ``<name> missing``. It goes through base64 so the sandbox's text keeps every byte, and the
# reader finds each file by its size, which no content can fake.
_SHOW = 'printf "HEAD:%s\\n" "$@" | git cat-file --batch | base64 | tr -d "\\n"'


@dataclass(frozen=True, slots=True)
class Before:
    """The state before a command. A path in ``dirty`` is one git already saw as changed or new.

    ``dirty`` maps it to its text, None when the file is gone. ``hashes`` has a
    fingerprint of each such file that exists, including a file too big or not
    UTF-8: it has a hash and no text, and is never reported.
    """

    top: Path
    root: Path
    dirty: dict[str, str | None]
    hashes: dict[str, str]


async def look(root: Path, run_git: RunGit) -> Before | None:
    """What ``git status`` lists now, with each file's text.

    None outside a git repository, and where there is no sandbox to run git in.
    """
    if not sandbox.available():
        return None
    if not sandbox.git_dirs(root):
        return None
    root = root.resolve()
    out = await run_git(_LOOK, ())
    if out is None or "\n" not in out:
        return None
    top, listed = out.split("\n", 1)
    top_path = Path(top)
    paths = list(_paths(listed, top_path))
    if len(paths) > MAX_FILES:
        return None
    dirty: dict[str, str | None] = {}
    hashes: dict[str, str] = {}
    for path in paths:
        digest, text = _snapshot(top_path / path)
        if digest is None:
            dirty[path] = None
            continue
        hashes[path] = digest
        if text is not None:
            dirty[path] = text
    return Before(top=top_path, root=root, dirty=dirty, hashes=hashes)


async def changed(before: Before, run_git: RunGit) -> list[FileEdit]:
    """The files that differ now from ``before``."""
    listed = await run_git(_STATUS, ())
    if listed is None:
        return []
    untracked = _paths(listed, before.top)
    found: list[tuple[str, str | None, str | None]] = []  # shown, before, after
    clean: list[tuple[str, int]] = []  # path, index into found
    for path in sorted({*untracked, *before.dirty}):
        shown = _shown(before, path)
        if shown is None:
            continue
        digest, after = _snapshot(before.top / path)
        if digest is not None and (digest == before.hashes.get(path) or after is None):
            continue  # unchanged, too big, or not UTF-8
        if path in before.dirty:
            found.append((shown, before.dirty[path], after))
        elif path in before.hashes:
            continue  # too big or not UTF-8 before the command
        elif untracked.get(path):
            found.append((shown, None, after))
        else:
            clean.append((path, len(found)))
            found.append((shown, None, after))
        if len(found) >= MAX_FILES:
            break
    committed = await _committed([path for path, _ in clean], run_git)
    skipped: set[int] = set()
    for (_, index), old in zip(clean, committed, strict=True):
        if old is False:
            skipped.add(index)
        else:
            found[index] = (found[index][0], old, found[index][2])
    return [
        FileEdit(shown, old, after)
        for index, (shown, old, after) in enumerate(found)
        if index not in skipped and old != after
    ]


def _shown(before: Before, path: str) -> str | None:
    """The path relative to the session folder, or None for one that is not watched."""
    if path.split("/", 1)[0] in _SKIPPED:
        return None
    try:
        return (before.top / path).relative_to(before.root).as_posix()
    except ValueError:
        return None


def _paths(out: str, top: Path) -> dict[str, bool]:
    """The files ``git status -z`` lists, each with whether git has never seen it."""
    found: dict[str, bool] = {}
    for entry in out.split("\0"):
        path = entry[3:]
        if path and not (top / path).is_dir():
            found[path] = entry.startswith("??")
    return found


async def _committed(paths: list[str], run_git: RunGit) -> list[str | Literal[False] | None]:
    """The text of each path at HEAD in one run: None for a file git does not have at HEAD.

    False is a file to skip: not UTF-8, too big, or a name git cannot be asked about by line.
    When the output was cut or does not read back exactly, every file is skipped, so no
    text is ever reported wrong.
    """
    asked = [path for path in paths if "\n" not in path]
    out = await run_git(_SHOW, tuple(asked)) if asked else ""
    raw = _bytes(out)
    found = _read_batch(raw, len(asked)) if raw is not None else None
    if found is None:
        return [False] * len(paths)
    texts = iter(found)
    return [False if "\n" in path else next(texts) for path in paths]


def _bytes(encoded: str | None) -> bytes | None:
    if encoded is None:
        return None
    try:
        return base64.b64decode(encoded, validate=True)
    except ValueError:
        return None


def _read_batch(raw: bytes, count: int) -> list[str | Literal[False] | None] | None:
    """The ``count`` answers in ``git cat-file --batch`` output, or None if it does not fit."""
    texts: list[str | Literal[False] | None] = []
    at = 0
    for _ in range(count):
        end = raw.find(b"\n", at)
        if end < 0:
            return None
        header = raw[at:end].split(b" ")
        at = end + 1
        if header[-1] == b"missing":
            texts.append(None)
            continue
        if len(header) != 3 or not header[2].isdigit():
            return None
        size = int(header[2])
        body = raw[at : at + size]
        if len(body) != size or raw[at + size : at + size + 1] != b"\n":
            return None
        at += size + 1
        if header[1] != b"blob" or size > MAX_BYTES:
            texts.append(False)
            continue
        try:
            texts.append(body.decode("utf-8"))
        except UnicodeDecodeError:
            texts.append(False)
    return texts if at == len(raw) else None


def _snapshot(path: Path) -> tuple[str | None, str | None]:
    """A fingerprint and the text. No fingerprint is a missing file, no text one to skip."""
    try:
        if path.is_dir():
            return "dir", None
        size = path.stat().st_size
        if size > MAX_BYTES:
            return f"big:{size}:{path.stat().st_mtime_ns}", None
        raw = path.read_bytes()
    except OSError:
        return None, None
    digest = hashlib.sha256(raw).hexdigest()
    try:
        return digest, raw.decode("utf-8")
    except UnicodeDecodeError:
        return digest, None
