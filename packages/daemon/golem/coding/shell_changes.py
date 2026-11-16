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
from collections.abc import Awaitable, Callable, Iterator
from dataclasses import dataclass
from itertools import chain
from pathlib import Path
from typing import Literal

from golem.tools import sandbox
from golem.tools.registry import FileEdit

MAX_BYTES = 1_000_000
MAX_FILES = 200
MAX_WORKTREES = 8
_SKIPPED = (".git", ".golem")
# Runs a shell script in the session folder, with ``git`` defined as the safe, sandboxed git and
# the strings as ``"$@"``. Its output, or None when it fails, times out, or is cut.
RunGit = Callable[[str, tuple[str, ...]], Awaitable[str | None]]

_STATUS = 'git -C "$1" status --porcelain=v1 -z -uall --no-renames'
_DONE = "E"
# One line of base64 for each folder in ``"$@"``: its top folder, a newline, its status
# (NUL-separated) and ``_DONE`` if git finished. Nothing for a folder that is not a checkout.
_STATUSES = (
    'one() { top=$(git -C "$1" rev-parse --show-toplevel) || return 0; '
    '{ printf "%s\\n" "$top"; ' + _STATUS + ' && printf E; } | base64 | tr -d "\\n"; }; '
    'for folder in "$@"; do one "$folder"; printf "\\n"; done'
)
# For each checkout, ``git cat-file --batch`` gives, for each path in order, ``<id> blob <size>``
# and the bytes, or ``<name> missing``. It goes through base64 so the sandbox's text keeps every
# byte, and the reader finds each file by its size, which no content can fake. The arguments are,
# for each checkout, its folder, the number of paths, and the paths; the output is a line each.
_SHOW = (
    'names() { k=$1; shift; while [ "$k" -gt 0 ]; do printf "HEAD:%s\\n" "$1"; shift; '
    "k=$((k-1)); done; }; "
    "while [ $# -gt 0 ]; do folder=$1; n=$2; shift 2; "
    'names "$n" "$@" | git -C "$folder" cat-file --batch | base64 | tr -d "\\n"; printf "\\n"; '
    'shift "$n"; done'
)


@dataclass(frozen=True, slots=True)
class State:
    """One watched checkout before a command. A path in ``dirty`` was already changed or new.

    ``dirty`` maps it to its text, None when the file is gone. ``hashes`` has a
    fingerprint of each such file that exists, including a file too big or not
    UTF-8: it has a hash and no text, and is never reported.
    """

    top: Path
    dirty: dict[str, str | None]
    hashes: dict[str, str]


@dataclass(frozen=True, slots=True)
class Before:
    """The state before a command: one ``State`` per watched checkout, and the worktrees seen."""

    root: Path
    states: tuple[State, ...]
    seen: frozenset[Path]


async def look(root: Path, run_git: RunGit) -> Before | None:
    """What ``git status`` lists now, with each file's text, in the session folder's checkout
    and in each git worktree inside the session folder.

    None outside a git repository, and where there is no sandbox to run git in. A checkout
    with too many files is not watched; the others still are.
    """
    if not sandbox.available():
        return None
    if not sandbox.git_dirs(root):
        return None
    root = root.resolve()
    trees = worktrees(root)
    answers = await _statuses([root, *trees], run_git)
    if answers is None or answers[0] is None:
        return None
    states = [state for answer in answers if answer and (state := _state(*answer))]
    return Before(root=root, states=tuple(states), seen=frozenset(trees)) if states else None


def worktrees(root: Path) -> list[Path]:
    """The git worktrees inside ``root``, from ``<common git folder>/worktrees/*/gitdir``.

    Each file holds the path of the worktree's ``.git`` file. A folder outside ``root``, ``root``
    itself, a missing folder and a broken file are skipped. At most ``MAX_WORKTREES``, sorted.
    """
    gits = sandbox.git_dirs(root)
    if not gits:
        return []
    root = root.resolve()
    found: set[Path] = set()
    try:
        entries = list((gits[-1] / "worktrees").iterdir())
    except OSError:
        return []
    for entry in entries:
        try:
            pointer = (entry / "gitdir").read_text("utf-8").strip()
            folder = Path(pointer).parent.resolve()
            if pointer and folder != root and folder.is_relative_to(root) and folder.is_dir():
                found.add(folder)
        except (OSError, UnicodeDecodeError, ValueError):
            continue
    return sorted(found)[:MAX_WORKTREES]


async def changed(before: Before, run_git: RunGit) -> list[FileEdit]:
    """The files that differ now from ``before``, in every watched checkout and in each
    worktree the command made."""
    new = [tree for tree in worktrees(before.root) if tree not in before.seen]
    answers = await _statuses([*(state.top for state in before.states), *new], run_git)
    if answers is None:
        return []
    found: list[_Found] = []
    for index, answer in enumerate(answers):
        if answer is None:
            continue
        top, listed = answer
        state = before.states[index] if index < len(before.states) else State(top, {}, {})
        found.append(_found_in(before.root, state, listed))
    committed = iter(
        await _committed([(one.top, [p for p, _ in one.clean]) for one in found], run_git)
    )
    edits: list[FileEdit] = []
    for one in found:
        olds: dict[int, str | Literal[False] | None] = {
            index: next(committed) for _, index in one.clean
        }
        for index, (shown, old, after) in enumerate(one.files):
            text = olds.get(index, old)
            if text is not False and text != after:
                edits.append(FileEdit(shown, text, after))
    return edits


@dataclass(slots=True)
class _Found:
    """The files of one checkout that differ now, with their paths relative to the session folder.

    ``clean`` lists the files git had at HEAD, each with its place in ``files``: their text
    before the command is the one at HEAD, which is not known yet.
    """

    top: Path
    files: list[tuple[str, str | None, str | None]]  # shown, before, after
    clean: list[tuple[str, int]]  # path, index into files


def _found_in(root: Path, before: State, listed: str) -> _Found:
    untracked = _paths(listed, before.top)
    one = _Found(before.top, [], [])
    for path in sorted({*untracked, *before.dirty}):
        shown = _shown(before.top, root, path)
        if shown is None:
            continue
        digest, after = _snapshot(before.top / path)
        if digest is not None and (digest == before.hashes.get(path) or after is None):
            continue  # unchanged, too big, or not UTF-8
        if path in before.dirty:
            one.files.append((shown, before.dirty[path], after))
        elif path in before.hashes:
            continue  # too big or not UTF-8 before the command
        elif untracked.get(path):
            one.files.append((shown, None, after))
        else:
            one.clean.append((path, len(one.files)))
            one.files.append((shown, None, after))
        if len(one.files) >= MAX_FILES:
            break
    return one


def _state(top: Path, listed: str) -> State | None:
    """The state of one checkout, or None when it lists too many files."""
    paths = list(_paths(listed, top))
    if len(paths) > MAX_FILES:
        return None
    dirty: dict[str, str | None] = {}
    hashes: dict[str, str] = {}
    for path in paths:
        digest, text = _snapshot(top / path)
        if digest is None:
            dirty[path] = None
            continue
        hashes[path] = digest
        if text is not None:
            dirty[path] = text
    return State(top, dirty, hashes)


async def _statuses(folders: list[Path], run_git: RunGit) -> list[tuple[Path, str] | None] | None:
    """The top folder and the status of each checkout, in one sandbox run.

    One entry per folder, None for one that is not a checkout or whose status failed or was
    cut. Each checkout is one line of base64, which no file name or content can break, and its
    text ends in ``_DONE`` only if git finished. None when the lines do not read back exactly.
    """
    out = await run_git(_STATUSES, tuple(str(folder) for folder in folders))
    if out is None:
        return None
    lines = out.split("\n")
    if lines.pop() != "" or len(lines) != len(folders):
        return None
    answers: list[tuple[Path, str] | None] = []
    for line in lines:
        raw = _bytes(line)
        try:
            text = raw.decode("utf-8") if raw else ""
        except UnicodeDecodeError:
            return None
        top, found, listed = text.partition("\n")
        done = found and listed.endswith(_DONE)
        answers.append((Path(top), listed.removesuffix(_DONE)) if done else None)
    return answers


def _shown(top: Path, root: Path, path: str) -> str | None:
    """The path relative to the session folder, or None for one that is not watched."""
    if path.split("/", 1)[0] in _SKIPPED:
        return None
    try:
        return (top / path).relative_to(root).as_posix()
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


async def _committed(
    groups: list[tuple[Path, list[str]]], run_git: RunGit
) -> list[str | Literal[False] | None]:
    """The text of each path at HEAD in one run, in order: None for a file git does not have.

    ``groups`` pairs a checkout's top folder with its paths. False is a file to skip: not
    UTF-8, too big, or a name git cannot be asked about by line. When the output was cut or
    does not read back exactly, every file is skipped, so no text is ever reported wrong.
    """
    count = sum(len(paths) for _, paths in groups)
    asked = [(top, [p for p in paths if "\n" not in p]) for top, paths in groups]
    asked = [(top, paths) for top, paths in asked if paths]
    args = [item for top, paths in asked for item in (str(top), str(len(paths)), *paths)]
    texts: list[list[str | Literal[False] | None]] = []
    if args:
        out = await run_git(_SHOW, tuple(args))
        lines = out.split("\n") if out is not None else []
        if out is None or lines.pop() != "" or len(lines) != len(asked):
            return [False] * count
        for line, (_, paths) in zip(lines, asked, strict=True):
            raw = _bytes(line)
            found = _read_batch(raw, len(paths)) if raw is not None else None
            if found is None:
                return [False] * count
            texts.append(found)
    answers: Iterator[str | Literal[False] | None] = chain.from_iterable(texts)
    result: list[str | Literal[False] | None] = []
    for _, paths in groups:
        for path in paths:
            if "\n" in path:
                result.append(False)
            else:
                result.append(next(answers))
    return result


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
