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
import tempfile
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field

from golem.tools.fs import MAX_READ_BYTES
from golem.tools.paths import inside, relative, session_root, writable
from golem.tools.registry import Tool, ToolContext, ToolError, ToolResult

DIFF_CONTEXT = 3
NO_NEWLINE = "\\ No newline at end of file"

_ARGS = ConfigDict(extra="forbid")


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

    path: Path
    shown: str
    before: str | None
    after: str


def plan_write(root: Path, args: WriteFileArgs) -> Change:
    path = writable(root, args.path)
    if path.is_dir():
        raise ToolError(f"{args.path} is a folder")
    before = _read_text(path, args.path) if path.exists() else None
    return Change(path=path, shown=relative(root, path), before=before, after=args.content)


def plan_edit(root: Path, args: EditFileArgs) -> Change:
    path = writable(root, args.path)
    if not path.is_file():
        raise ToolError(f"{args.path} does not exist; use write_file to create it")
    if args.old_string == args.new_string:
        raise ToolError("old_string and new_string are the same, so nothing would change")
    before = _read_text(path, args.path)
    count = before.count(args.old_string)
    if count == 0:
        raise ToolError(f"old_string is not in {args.path}; read the file and copy it exactly")
    if count > 1 and not args.replace_all:
        raise ToolError(
            f"old_string is in {args.path} {count} times; add context to make it unique, "
            "or set replace_all"
        )
    after = before.replace(args.old_string, args.new_string)
    return Change(path=path, shown=relative(root, path), before=before, after=after)


def apply(change: Change) -> None:
    """Write ``change.after`` through a temp file in the same folder, keeping the file mode."""
    path = change.path
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        mode = path.stat().st_mode & 0o7777 if path.exists() else None
        fd, temp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".golem")
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="") as handle:
                handle.write(change.after)
            if mode is not None:
                os.chmod(temp, mode)
            os.replace(temp, path)
        except BaseException:
            Path(temp).unlink(missing_ok=True)
            raise
    except OSError as exc:
        raise ToolError(f"cannot write {change.shown}: {exc.strerror or exc}") from exc


def unified_diff(change: Change) -> str:
    """The change as a unified diff with ``a/`` and ``b/`` paths relative to the folder."""
    before = change.before if change.before is not None else ""
    lines = difflib.unified_diff(
        before.splitlines(keepends=True),
        change.after.splitlines(keepends=True),
        fromfile="/dev/null" if change.before is None else f"a/{change.shown}",
        tofile=f"b/{change.shown}",
        n=DIFF_CONTEXT,
    )
    return "".join(line if line.endswith("\n") else f"{line}\n{NO_NEWLINE}\n" for line in lines)


def diff_counts(diff: str) -> tuple[int, int]:
    """Lines added and removed in a unified diff."""
    added = removed = 0
    for line in diff.splitlines():
        if line.startswith("+") and not line.startswith("+++"):
            added += 1
        elif line.startswith("-") and not line.startswith("---"):
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


async def _write_file(args: WriteFileArgs, ctx: ToolContext) -> ToolResult:
    root = session_root(ctx)
    return await asyncio.to_thread(_commit, plan_write(root, args))


async def _edit_file(args: EditFileArgs, ctx: ToolContext) -> ToolResult:
    root = session_root(ctx)
    return await asyncio.to_thread(_commit, plan_edit(root, args))


def _commit(change: Change) -> ToolResult:
    diff = unified_diff(change)
    apply(change)
    added, removed = diff_counts(diff)
    created = "new file " if change.before is None else ""
    summary = f"{created}+{added} -{removed} {change.shown}"
    return ToolResult(output=diff or f"{change.shown} is unchanged", summary=summary)


def _read_text(path: Path, shown: str) -> str:
    try:
        if path.stat().st_size > MAX_READ_BYTES:
            raise ToolError(f"{shown} is larger than {MAX_READ_BYTES // 1_000_000} MB")
        raw = path.read_bytes()
    except OSError as exc:
        raise ToolError(f"cannot read {shown}: {exc.strerror or exc}") from exc
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
)

WRITE_TOOLS = (WRITE_FILE, EDIT_FILE)

__all__ = [
    "EDIT_FILE",
    "WRITE_FILE",
    "WRITE_TOOLS",
    "Change",
    "EditFileArgs",
    "WriteFileArgs",
    "apply",
    "diff_counts",
    "path_subject",
    "plan_edit",
    "plan_write",
    "unified_diff",
]
