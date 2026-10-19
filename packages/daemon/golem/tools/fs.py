"""Read-only file tools: ``read_file``, ``list_dir``, ``glob``, and ``grep``.

Every path is resolved inside the session folder first. File reads run in a
thread so a large folder does not stall the event loop.
"""

from __future__ import annotations

import asyncio
import os
import re
from collections.abc import Iterator
from fnmatch import fnmatch
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field

from golem.tools.paths import inside, relative, session_root
from golem.tools.registry import Tool, ToolContext, ToolError, ToolResult

SKIPPED_DIRS = frozenset(
    {
        ".git",
        ".hg",
        ".svn",
        ".venv",
        "venv",
        "node_modules",
        "__pycache__",
        ".mypy_cache",
        ".pytest_cache",
        ".ruff_cache",
        ".next",
        ".turbo",
        "dist",
        "build",
    }
)
"""Folders ``glob`` and ``grep`` never walk into. ``list_dir`` still shows them."""

MAX_READ_BYTES = 5_000_000
DEFAULT_READ_LINES = 2_000
MAX_LINE_CHARS = 2_000
MAX_ENTRIES = 500
MAX_MATCHES = 200
MAX_GREP_FILE_BYTES = 1_000_000

_ARGS = ConfigDict(extra="forbid")


class ReadFileArgs(BaseModel):
    model_config = _ARGS

    path: str = Field(min_length=1, description="File path, relative to the project folder.")
    offset: int = Field(default=1, ge=1, description="First line to read, from 1.")
    limit: int = Field(
        default=DEFAULT_READ_LINES, ge=1, le=DEFAULT_READ_LINES, description="Lines to read."
    )


class ListDirArgs(BaseModel):
    model_config = _ARGS

    path: str = Field(
        default=".", description="Folder, relative to the project. Empty is the project."
    )


class GlobArgs(BaseModel):
    model_config = _ARGS

    pattern: str = Field(min_length=1, description="Glob such as **/*.py, matched under path.")
    path: str = Field(default=".", description="Folder to search from. Empty is the project.")


class GrepArgs(BaseModel):
    model_config = _ARGS

    pattern: str = Field(min_length=1, description="Python regular expression.")
    path: str = Field(default=".", description="File or folder to search. Empty is the project.")
    include: str | None = Field(
        default=None, description="Only files whose name matches this glob, such as *.ts."
    )
    ignore_case: bool = False


async def _read_file(args: ReadFileArgs, ctx: ToolContext) -> ToolResult:
    return await asyncio.to_thread(read_file, session_root(ctx), args)


async def _list_dir(args: ListDirArgs, ctx: ToolContext) -> ToolResult:
    return await asyncio.to_thread(list_dir, session_root(ctx), args)


async def _glob(args: GlobArgs, ctx: ToolContext) -> ToolResult:
    return await asyncio.to_thread(glob_files, session_root(ctx), args)


async def _grep(args: GrepArgs, ctx: ToolContext) -> ToolResult:
    return await asyncio.to_thread(grep, session_root(ctx), args)


def read_file(root: Path, args: ReadFileArgs) -> ToolResult:
    path = inside(root, args.path)
    if not path.is_file():
        raise ToolError(f"{args.path} is not a file")
    if path.stat().st_size > MAX_READ_BYTES:
        raise ToolError(f"{args.path} is larger than {MAX_READ_BYTES // 1_000_000} MB")
    raw = _read_bytes(path, args.path)
    if b"\0" in raw[:8192]:
        raise ToolError(f"{args.path} looks like a binary file")
    lines = raw.decode("utf-8", errors="replace").splitlines()
    start = args.offset - 1
    chosen = lines[start : start + args.limit]
    numbered = [f"{start + index + 1:>6}|{_clip(line)}" for index, line in enumerate(chosen)]
    if not lines:
        return ToolResult(output="(empty file)", summary="empty")
    if not chosen:
        raise ToolError(f"{args.path} has {len(lines)} lines; offset {args.offset} is past the end")
    if len(chosen) == len(lines):
        summary = _count(len(lines), "line")
    else:
        summary = f"lines {start + 1}-{start + len(chosen)} of {len(lines)}"
    return ToolResult(output="\n".join(numbered), summary=summary)


def list_dir(root: Path, args: ListDirArgs) -> ToolResult:
    path = inside(root, args.path)
    if not path.is_dir():
        raise ToolError(f"{args.path} is not a folder")
    try:
        children = sorted(path.iterdir(), key=lambda child: child.name)
    except OSError as exc:
        raise ToolError(f"cannot list {args.path}: {exc.strerror or exc}") from exc
    names = [f"{child.name}/" if child.is_dir() else child.name for child in children]
    shown = names[:MAX_ENTRIES]
    output = "\n".join(shown) if shown else "(empty folder)"
    if len(names) > len(shown):
        output += f"\n[{len(names) - len(shown)} more entries]"
    return ToolResult(output=output, summary=_count(len(names), "entry", "entries"))


def glob_files(root: Path, args: GlobArgs) -> ToolResult:
    base = inside(root, args.path)
    if not base.is_dir():
        raise ToolError(f"{args.path} is not a folder")
    if Path(args.pattern).is_absolute() or ".." in Path(args.pattern).parts:
        raise ToolError("the pattern must be relative and stay under path")
    found: list[str] = []
    for match in sorted(base.glob(args.pattern)):
        if not match.is_file() or _skipped(match.relative_to(base)):
            continue
        try:
            resolved = inside(root, str(match))
        except ToolError:
            continue
        found.append(relative(root, resolved))
        if len(found) > MAX_ENTRIES:
            break
    shown = found[:MAX_ENTRIES]
    output = "\n".join(shown) if shown else "(no files match)"
    if len(found) > len(shown):
        output += f"\n[more than {MAX_ENTRIES} files; narrow the pattern]"
    return ToolResult(output=output, summary=_count(len(shown), "file"))


def grep(root: Path, args: GrepArgs) -> ToolResult:
    base = inside(root, args.path)
    try:
        regex = re.compile(args.pattern, re.IGNORECASE if args.ignore_case else 0)
    except re.error as exc:
        raise ToolError(f"invalid regular expression: {exc}") from exc
    if base.is_file():
        files: Iterator[Path] = iter([base])
    elif base.is_dir():
        files = _walk(base)
    else:
        raise ToolError(f"{args.path} does not exist")
    matches: list[str] = []
    files_hit = 0
    for path in files:
        if args.include is not None and not fnmatch(path.name, args.include):
            continue
        hits = _grep_file(root, path, regex)
        if hits:
            files_hit += 1
            matches.extend(hits)
        if len(matches) >= MAX_MATCHES:
            break
    shown = matches[:MAX_MATCHES]
    if not shown:
        return ToolResult(output="(no matches)", summary="no matches")
    output = "\n".join(shown)
    if len(matches) > len(shown) or len(matches) == MAX_MATCHES:
        output += f"\n[stopped at {MAX_MATCHES} matches; narrow the pattern or path]"
    summary = f"{_count(len(shown), 'match', 'matches')} in {_count(files_hit, 'file')}"
    return ToolResult(output=output, summary=summary)


def _grep_file(root: Path, path: Path, regex: re.Pattern[str]) -> list[str]:
    try:
        shown = relative(root, inside(root, str(path)))
    except ToolError:
        return []
    try:
        if path.stat().st_size > MAX_GREP_FILE_BYTES:
            return []
        raw = path.read_bytes()
    except OSError:
        return []
    if b"\0" in raw[:8192]:
        return []
    hits: list[str] = []
    for number, line in enumerate(raw.decode("utf-8", errors="replace").splitlines(), start=1):
        if regex.search(line):
            hits.append(f"{shown}:{number}: {_clip(line)}")
    return hits


def _walk(base: Path) -> Iterator[Path]:
    for folder, dirs, names in os.walk(base):
        dirs[:] = sorted(name for name in dirs if name not in SKIPPED_DIRS)
        for name in sorted(names):
            yield Path(folder) / name


def _skipped(rel: Path) -> bool:
    return any(part in SKIPPED_DIRS for part in rel.parts[:-1])


def _read_bytes(path: Path, shown: str) -> bytes:
    try:
        return path.read_bytes()
    except OSError as exc:
        raise ToolError(f"cannot read {shown}: {exc.strerror or exc}") from exc


def _clip(line: str) -> str:
    if len(line) <= MAX_LINE_CHARS:
        return line
    return f"{line[:MAX_LINE_CHARS]}… [line cut]"


def _count(n: int, one: str, many: str | None = None) -> str:
    return f"{n} {one if n == 1 else (many or one + 's')}"


READ_FILE = Tool(
    name="read_file",
    description=(
        "Read a text file in the project folder. Lines come numbered. "
        f"Reads up to {DEFAULT_READ_LINES} lines from offset."
    ),
    args=ReadFileArgs,
    run=_read_file,
    read_only=True,
    path_arg="path",
)
LIST_DIR = Tool(
    name="list_dir",
    description="List a folder in the project. Folders end with /.",
    args=ListDirArgs,
    run=_list_dir,
    read_only=True,
    path_arg="path",
)
GLOB = Tool(
    name="glob",
    description="Find files in the project by glob pattern, such as **/*.py.",
    args=GlobArgs,
    run=_glob,
    read_only=True,
    path_arg="path",
    match_arg="pattern",
)
GREP = Tool(
    name="grep",
    description="Search file contents in the project with a regular expression.",
    args=GrepArgs,
    run=_grep,
    read_only=True,
    path_arg="path",
    match_arg="pattern",
)

READ_ONLY_TOOLS = (READ_FILE, LIST_DIR, GLOB, GREP)

__all__ = [
    "GLOB",
    "GREP",
    "LIST_DIR",
    "READ_FILE",
    "READ_ONLY_TOOLS",
    "SKIPPED_DIRS",
    "GlobArgs",
    "GrepArgs",
    "ListDirArgs",
    "ReadFileArgs",
    "glob_files",
    "grep",
    "list_dir",
    "read_file",
]
