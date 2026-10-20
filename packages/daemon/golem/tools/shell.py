"""``shell`` and the git helpers: commands run in the session folder, under the sandbox.

``shell`` is not read-only, so the default policy asks before each command.
A rule's ``match`` is checked against the command, so ``match = "git status"``
or ``match = "pnpm test*"`` can allow one command and no other.

The git helpers only read. They run git directly, not through a shell, with
the repository settings that run code switched off: fsmonitor, hooks,
external diff drivers, and text conversion.
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field

from golem.tools import sandbox
from golem.tools.paths import inside, relative, session_root
from golem.tools.registry import Tool, ToolContext, ToolError, ToolResult

NO_SANDBOX = (
    "the shell needs a macOS sandbox, and none can be applied here (no sandbox-exec, or golem "
    "itself runs inside a sandbox), so commands do not run"
)

_ARGS = ConfigDict(extra="forbid")

_GIT_SAFE = (
    "--no-pager",
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "color.ui=false",
)


class ShellArgs(BaseModel):
    model_config = _ARGS

    command: str = Field(min_length=1, description="The command, run by the user's shell.")
    timeout_seconds: int | None = Field(
        default=None, gt=0, le=3600, description="Kill the command after this many seconds."
    )


class GitStatusArgs(BaseModel):
    model_config = _ARGS


class GitDiffArgs(BaseModel):
    model_config = _ARGS

    path: str = Field(default="", description="Only this file or folder. Empty is everything.")
    staged: bool = Field(default=False, description="The staged changes instead of unstaged.")


class GitLogArgs(BaseModel):
    model_config = _ARGS

    path: str = Field(default="", description="Only commits that touch this file or folder.")
    limit: int = Field(default=10, ge=1, le=100)


async def _shell(args: ShellArgs, ctx: ToolContext) -> ToolResult:
    root = _sandboxed_root(ctx)
    timeout = min(args.timeout_seconds or ctx.shell.timeout_seconds, ctx.shell.timeout_seconds)
    login = os.environ.get("SHELL") or "/bin/zsh"
    done = await sandbox.run(
        [login, "-lc", args.command],
        root=root,
        settings=ctx.shell,
        timeout=timeout,
        on_output=ctx.output,
    )
    if done.timed_out:
        ending = f"[killed after {timeout} seconds]"
        summary = f"timed out after {timeout}s"
    else:
        ending = f"[exit code {done.exit_code}]"
        summary = "exit 0" if done.exit_code == 0 else f"exit {done.exit_code}"
    output = done.output.rstrip("\n")
    return ToolResult(output=f"{output}\n{ending}" if output else ending, summary=summary)


async def _git_status(args: GitStatusArgs, ctx: ToolContext) -> ToolResult:
    del args
    output = await _git(ctx, ["status", "--porcelain=v1", "--branch"])
    lines = [line for line in output.splitlines() if line]
    changed = [line for line in lines if not line.startswith("##")]
    summary = "clean" if not changed else _count(len(changed), "change")
    return ToolResult(output="\n".join(lines) or "(no output)", summary=summary)


async def _git_diff(args: GitDiffArgs, ctx: ToolContext) -> ToolResult:
    command = ["diff", "--no-ext-diff", "--no-textconv", "--no-color"]
    if args.staged:
        command.append("--cached")
    command += ["--", _git_path(ctx, args.path)]
    output = await _git(ctx, command)
    lines = output.splitlines()
    files = sum(1 for line in lines if line.startswith("diff --git "))
    added = sum(1 for line in lines if line.startswith("+") and not line.startswith("+++"))
    removed = sum(1 for line in lines if line.startswith("-") and not line.startswith("---"))
    if files == 0:
        return ToolResult(output="(no changes)", summary="no changes")
    return ToolResult(output=output, summary=f"{_count(files, 'file')}, +{added} -{removed}")


async def _git_log(args: GitLogArgs, ctx: ToolContext) -> ToolResult:
    command = [
        "log",
        f"-n{args.limit}",
        "--date=short",
        "--format=%h %ad %an: %s",
        "--",
        _git_path(ctx, args.path),
    ]
    output = (await _git(ctx, command)).strip()
    count = len(output.splitlines()) if output else 0
    return ToolResult(output=output or "(no commits)", summary=_count(count, "commit"))


async def _git(ctx: ToolContext, command: list[str]) -> str:
    root = _sandboxed_root(ctx)
    git = shutil.which("git", path=sandbox.environment(dict(os.environ), home=Path.home())["PATH"])
    done = await sandbox.run(
        [git or "/usr/bin/git", *_GIT_SAFE, *command],
        root=root,
        settings=ctx.shell.model_copy(update={"network": False}),
        timeout=30,
    )
    if done.timed_out:
        raise ToolError("git did not answer within 30 seconds")
    if done.exit_code != 0:
        raise ToolError(done.output.strip() or f"git exited with {done.exit_code}")
    return done.output


def _git_path(ctx: ToolContext, raw: str) -> str:
    root = session_root(ctx)
    return relative(root, inside(root, raw or "."))


def _sandboxed_root(ctx: ToolContext) -> Path:
    root = session_root(ctx)
    if not sandbox.available():
        raise ToolError(NO_SANDBOX)
    return root


def _count(n: int, one: str) -> str:
    return f"{n} {one}" if n == 1 else f"{n} {one}s"


SHELL = Tool(
    name="shell",
    description=(
        "Run a shell command in the project folder, such as tests or a build. Network "
        "is off and writes outside the project are refused. Output is stdout and stderr "
        "together, and ends with the exit code."
    ),
    args=ShellArgs,
    run=_shell,
    match_arg="command",
)
GIT_STATUS = Tool(
    name="git_status",
    description="The branch and the changed files of the project's git repository.",
    args=GitStatusArgs,
    run=_git_status,
    read_only=True,
)
GIT_DIFF = Tool(
    name="git_diff",
    description="Unstaged changes as a unified diff, or staged ones with staged=true.",
    args=GitDiffArgs,
    run=_git_diff,
    read_only=True,
    path_arg="path",
)
GIT_LOG = Tool(
    name="git_log",
    description="Recent commits: short hash, date, author, and subject.",
    args=GitLogArgs,
    run=_git_log,
    read_only=True,
    path_arg="path",
)

SHELL_TOOLS = (SHELL, GIT_STATUS, GIT_DIFF, GIT_LOG)

__all__ = [
    "GIT_DIFF",
    "GIT_LOG",
    "GIT_STATUS",
    "NO_SANDBOX",
    "SHELL",
    "SHELL_TOOLS",
    "GitDiffArgs",
    "GitLogArgs",
    "ShellArgs",
]
