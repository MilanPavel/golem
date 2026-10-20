"""File-changing tools: ``write_file`` and ``edit_file``.

Each call is planned before it is applied. :func:`plan_write` and
:func:`plan_edit` read the file and work out its new text without writing
anything, so the same plan can be shown as a diff before the call is
approved. :func:`apply` then writes the new text atomically.

Paths stay inside the session folder and out of ``.golem/`` and ``.git/``.
These tools run in the daemon, not in the shell's sandbox, so that check is
the guard.
"""

from __future__ import annotations

import asyncio
import difflib
import os
import re
import tempfile
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field

from golem.tools.fs import MAX_READ_BYTES
from golem.tools.paths import inside, relative, session_root, writable
from golem.tools.registry import Preview, Tool, ToolContext, ToolError, ToolResult

DIFF_CONTEXT = 3
DIFF_CHARS = 64_000
"""The most of a diff an approval shows, and stores in its event."""
NO_NEWLINE = "\\ No newline at end of file"
CHANGED_SINCE_APPROVAL = (
    "{path} changed after the user approved this change, so it was not applied; "
    "read the file again and make the change again"
)

_ARGS = ConfigDict(extra="forbid")
_LINE = re.compile(r"[^\n]*\n|[^\n]+")


def _umask() -> int:
    current = os.umask(0)
    os.umask(current)
    return current


_NEW_FILE_MODE = 0o666 & ~_umask()


class WriteFileArgs(BaseModel):
    model_config = _ARGS

    path: str = Field(min_length=1, description="File path, relative to the project folder.")
    content: str = Field(description="The whole new content of the file.")


class EditFileArgs(BaseModel):
    model_config = _ARGS

    path: str = Field(min_length=1, description="File path, relative to the project folder.")
    old_string: str = Field(
        min_length=1,
        description="Exact text to replace, with enough context to be unique in the file.",
    )
    new_string: str = Field(description="The text to put in its place.")
    replace_all: bool = Field(
        default=False, description="Replace every occurrence instead of exactly one."
    )


@dataclass(frozen=True, slots=True)
class Change:
    """A planned change to one file. ``before`` is None for a new file."""

    root: Path
    path: Path
    shown: str
    before: str | None
    after: str


def plan_write(
    root: Path, args: WriteFileArgs, planned: Mapping[Path, str] | None = None
) -> Change:
    """``planned`` is the text files will have after the earlier calls of the same reply."""
    path = writable(root, args.path)
    if path.is_dir():
        raise ToolError(f"{args.path} is a folder")
    if path.exists() and not path.is_file():
        raise ToolError(f"{args.path} is not a regular file")
    before = _current(path, args.path, planned) if _exists(path, planned) else None
    return Change(root, path, relative(root, path), before, args.content)


def plan_edit(root: Path, args: EditFileArgs, planned: Mapping[Path, str] | None = None) -> Change:
    path = writable(root, args.path)
    if not _exists(path, planned):
        raise ToolError(f"{args.path} does not exist; use write_file to create it")
    if args.old_string == args.new_string:
        raise ToolError("old_string and new_string are the same, so nothing would change")
    before = _current(path, args.path, planned)
    count = before.count(args.old_string)
    if count == 0:
        hint = (
            "; the file has CRLF line endings, so old_string needs them too"
            if "\r\n" in before and "\r\n" not in args.old_string and "\n" in args.old_string
            else "; read the file and copy it exactly"
        )
        raise ToolError(f"old_string is not in {args.path}{hint}")
    if count > 1 and not args.replace_all:
        raise ToolError(
            f"old_string is in {args.path} {count} times; add context to make it unique, "
            "or set replace_all"
        )
    after = before.replace(args.old_string, args.new_string)
    return Change(root, path, relative(root, path), before, after)


def apply(change: Change) -> None:
    """Write ``change.after`` through a temp file in the same folder, keeping the file mode.

    The path is checked again first, in case a folder on it became a symlink
    since the change was planned. A new file gets the mode the umask allows.
    """
    path = change.path
    if writable(change.root, change.shown) != path:
        raise ToolError(f"{change.shown} moved since the change was planned")
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        mode = path.stat().st_mode & 0o7777 if path.exists() else _NEW_FILE_MODE
        fd, temp = tempfile.mkstemp(dir=path.parent, prefix=".golem-", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="") as handle:
                handle.write(change.after)
                handle.flush()
                os.fsync(handle.fileno())
            os.chmod(temp, mode)
            os.replace(temp, path)
        except BaseException:
            Path(temp).unlink(missing_ok=True)
            raise
    except UnicodeEncodeError as exc:
        raise ToolError(f"cannot write {change.shown}: the text is not valid Unicode") from exc
    except OSError as exc:
        raise ToolError(f"cannot write {change.shown}: {exc.strerror or exc}") from exc


def unified_diff(change: Change) -> str:
    """The change as a unified diff with ``a/`` and ``b/`` paths relative to the folder."""
    before = change.before if change.before is not None else ""
    lines = difflib.unified_diff(
        _lines(before),
        _lines(change.after),
        fromfile="/dev/null" if change.before is None else f"a/{change.shown}",
        tofile=f"b/{change.shown}",
        n=DIFF_CONTEXT,
    )
    return "".join(line if line.endswith("\n") else f"{line}\n{NO_NEWLINE}\n" for line in lines)


def diff_counts(diff: str) -> tuple[int, int]:
    """Lines added and removed in a unified diff. The ``---`` and ``+++`` header is skipped."""
    added = removed = 0
    in_hunk = False
    for line in diff.split("\n"):
        if line.startswith("@@"):
            in_hunk = True
        elif in_hunk and line.startswith("+"):
            added += 1
        elif in_hunk and line.startswith("-"):
            removed += 1
    return added, removed


def path_subject(args: Mapping[str, object], root: Path | None) -> str | None:
    """The file a call changes, relative to the session folder, as its subject."""
    raw = args.get("path")
    if not isinstance(raw, str) or raw.strip() == "" or root is None:
        return None
    try:
        return relative(root, inside(root, raw))
    except ToolError:
        return None


def shown_diff(change: Change) -> str:
    """The diff as an approval shows it: cut at :data:`DIFF_CHARS`."""
    diff = unified_diff(change)
    if len(diff) <= DIFF_CHARS:
        return diff
    return f"{diff[:DIFF_CHARS]}\n[diff cut at {DIFF_CHARS} characters]\n"


def commit(change: Change, approved_diff: str | None = None) -> ToolResult:
    """Apply ``change``, when it still makes ``approved_diff`` if one was approved."""
    if approved_diff is not None and shown_diff(change) != approved_diff:
        raise ToolError(CHANGED_SINCE_APPROVAL.format(path=change.shown))
    if change.before == change.after:
        return ToolResult(output=f"{change.shown} already has this content", summary="unchanged")
    diff = unified_diff(change)
    apply(change)
    added, removed = diff_counts(diff)
    created = "new file " if change.before is None else ""
    summary = f"{created}+{added} -{removed} {change.shown}"
    return ToolResult(output=diff or f"created {change.shown}, empty", summary=summary)


async def _write_file(args: WriteFileArgs, ctx: ToolContext) -> ToolResult:
    root = session_root(ctx)
    return await asyncio.to_thread(lambda: commit(plan_write(root, args), ctx.approved_diff))


async def _edit_file(args: EditFileArgs, ctx: ToolContext) -> ToolResult:
    root = session_root(ctx)
    return await asyncio.to_thread(lambda: commit(plan_edit(root, args), ctx.approved_diff))


async def _preview_write(args: WriteFileArgs, ctx: ToolContext) -> Preview:
    root = session_root(ctx)
    return await asyncio.to_thread(lambda: _preview(plan_write(root, args, ctx.planned)))


async def _preview_edit(args: EditFileArgs, ctx: ToolContext) -> Preview:
    root = session_root(ctx)
    return await asyncio.to_thread(lambda: _preview(plan_edit(root, args, ctx.planned)))


def _preview(change: Change) -> Preview:
    return Preview(diff=shown_diff(change), path=change.path, after=change.after)


def _lines(text: str) -> list[str]:
    """Lines split on ``\\n`` only, each with its ending, unlike ``str.splitlines``."""
    return _LINE.findall(text)


def _exists(path: Path, planned: Mapping[Path, str] | None) -> bool:
    return (planned is not None and path in planned) or path.is_file()


def _current(path: Path, shown: str, planned: Mapping[Path, str] | None) -> str:
    if planned is not None and path in planned:
        return planned[path]
    return _read_text(path, shown)


def _read_text(path: Path, shown: str) -> str:
    try:
        with path.open("rb") as handle:
            raw = handle.read(MAX_READ_BYTES + 1)
    except OSError as exc:
        raise ToolError(f"cannot read {shown}: {exc.strerror or exc}") from exc
    if len(raw) > MAX_READ_BYTES:
        raise ToolError(f"{shown} is larger than {MAX_READ_BYTES // 1_000_000} MB")
    if b"\0" in raw[:8192]:
        raise ToolError(f"{shown} looks like a binary file")
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ToolError(f"{shown} is not UTF-8 text") from exc


WRITE_FILE = Tool(
    name="write_file",
    description=(
        "Create a file in the project folder, or replace all of its content. "
        "Prefer edit_file for a change to part of an existing file."
    ),
    args=WriteFileArgs,
    run=_write_file,
    path_arg="path",
    subject=path_subject,
    preview=_preview_write,
)
EDIT_FILE = Tool(
    name="edit_file",
    description=(
        "Replace exact text in a file in the project folder. old_string must match the "
        "file exactly, including indentation, and be unique unless replace_all is set. "
        "Read the file first."
    ),
    args=EditFileArgs,
    run=_edit_file,
    path_arg="path",
    subject=path_subject,
    preview=_preview_edit,
)

WRITE_TOOLS = (WRITE_FILE, EDIT_FILE)

__all__ = [
    "CHANGED_SINCE_APPROVAL",
    "DIFF_CHARS",
    "EDIT_FILE",
    "WRITE_FILE",
    "WRITE_TOOLS",
    "Change",
    "EditFileArgs",
    "WriteFileArgs",
    "apply",
    "commit",
    "diff_counts",
    "path_subject",
    "plan_edit",
    "plan_write",
    "shown_diff",
    "unified_diff",
]
