"""Commit files of a session folder with the user's own git, and suggest the message.

This is an action of the user, not of the model: git runs in the session folder,
outside the sandbox, with the user's hooks, as if they typed it. Nothing is pushed.
"""

from __future__ import annotations

import asyncio
import os
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel

from golem.models.structured import structured
from golem.tools.paths import inside

GIT_SECONDS = 60.0
OUTPUT_CHARS = 4_000
DIFF_CHARS = 12_000
SUGGEST_SECONDS = 60.0

_INSTRUCTION = (
    "Write a commit message for this diff. Match the style of the recent subjects."
    " Subject at most 72 characters. Body optional, plain sentences."
)


@dataclass(frozen=True)
class GitResult:
    """How one git call ended. ``output`` holds stdout and stderr together."""

    code: int
    output: str

    @property
    def ok(self) -> bool:
        return self.code == 0


@dataclass(frozen=True)
class CommitOutcome:
    ok: bool
    sha: str | None
    output: str


class CommitText(BaseModel):
    """The shape the model answers in."""

    subject: str
    body: str = ""


async def run_git(folder: str, *args: str, seconds: float = GIT_SECONDS) -> GitResult:
    """Run git in ``folder``. It never reads stdin or asks for a password."""
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GIT_OPTIONAL_LOCKS": "0"}
    try:
        process = await asyncio.create_subprocess_exec(
            "git",
            "--literal-pathspecs",
            *args,
            cwd=folder,
            env=env,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
    except OSError as exc:
        return GitResult(-1, f"git could not start: {exc}")
    try:
        async with asyncio.timeout(seconds):
            data, _ = await process.communicate()
    except TimeoutError:
        process.kill()
        await process.wait()
        return GitResult(-1, f"git took longer than {seconds:g} seconds and was stopped")
    except asyncio.CancelledError:
        # A caller that stops waiting must not leave git running behind it.
        process.kill()
        await asyncio.shield(process.wait())
        raise
    code = process.returncode if process.returncode is not None else -1
    return GitResult(code, data.decode("utf-8", errors="replace"))


def relative_paths(folder: str, paths: Sequence[str]) -> list[str]:
    """``paths`` as paths under ``folder``. Raises :class:`ToolError` for one outside it."""
    base = Path(folder).resolve()
    return [str(inside(base, path).relative_to(base)) for path in paths]


def _tail(text: str) -> str:
    return text[-OUTPUT_CHARS:]


async def commit(folder: str, paths: Sequence[str], message: str) -> CommitOutcome:
    """Add, then commit, ``paths``, with the user's hooks."""
    targets = relative_paths(folder, paths)
    added = await run_git(folder, "add", "--", *targets)
    if not added.ok:
        return CommitOutcome(False, None, _tail(added.output))
    done = await run_git(folder, "commit", "-m", message, "--", *targets)
    if not done.ok:
        return CommitOutcome(False, None, _tail(done.output))
    head = await run_git(folder, "rev-parse", "--short", "HEAD")
    sha = head.output.strip() if head.ok and head.output.strip() else None
    return CommitOutcome(True, sha, _tail(done.output))


@dataclass(frozen=True)
class CommitInfo:
    repository: bool
    branch: str | None
    paths: list[str]


def _changed_paths(raw: str, prefix: str) -> list[str]:
    """The paths of ``status --porcelain=v1 -z``, relative to the session folder."""
    found: list[str] = []
    entries = iter(raw.split("\0"))
    for entry in entries:
        if len(entry) < 4:
            continue
        if entry[0] in "RC" or entry[1] in "RC":
            next(entries, None)
        found.append(entry[3:].removeprefix(prefix))
    return found


async def info(folder: str, paths: Sequence[str]) -> CommitInfo:
    """Whether ``folder`` is in a work tree, its branch, and which of ``paths`` git sees changed."""
    inside_tree = await run_git(folder, "rev-parse", "--is-inside-work-tree")
    if not inside_tree.ok or inside_tree.output.strip() != "true":
        return CommitInfo(False, None, [])
    branch = await run_git(folder, "branch", "--show-current")
    name = branch.output.strip() if branch.ok else ""
    if not paths:
        return CommitInfo(True, name or None, [])
    prefix = await run_git(folder, "rev-parse", "--show-prefix")
    status = await run_git(
        folder, "status", "--porcelain=v1", "-z", "--untracked-files=all", "--", *paths
    )
    changed = _changed_paths(status.output, prefix.output.strip()) if status.ok else []
    return CommitInfo(True, name or None, changed)


class SuggestError(Exception):
    """No message could be suggested. The text says why."""


async def suggest(folder: str, paths: Sequence[str], model: BaseChatModel) -> str:
    """Ask ``model`` for a commit message for the diff of ``paths``.

    Raises :class:`SuggestError`, or :class:`~golem.tools.registry.ToolError` for a
    path outside the folder.
    """
    targets = relative_paths(folder, paths)
    diff = await run_git(folder, "diff", "HEAD", "--", *targets)
    if not diff.ok:
        raise SuggestError(_tail(diff.output).strip() or "git diff failed")
    log = await run_git(folder, "log", "-8", "--format=%s")
    subjects = log.output.strip() if log.ok else ""
    prompt = f"Recent subjects:\n{subjects or '(none)'}\n\nDiff:\n{diff.output[:DIFF_CHARS]}"
    try:
        answer = await structured(
            model,
            CommitText,
            [SystemMessage(_INSTRUCTION), HumanMessage(prompt)],
            timeout=SUGGEST_SECONDS,
        )
    except Exception as exc:
        raise SuggestError(f"the model could not write a message: {exc}") from exc
    subject = " ".join(answer.subject.split())
    if not subject:
        raise SuggestError("the model returned an empty subject")
    body = answer.body.strip()
    return f"{subject}\n\n{body}" if body else subject
