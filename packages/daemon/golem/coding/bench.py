"""``golem coding bench``: how often a model's edits apply.

``run_task`` puts a small folder in a temporary directory, asks the model for one change with
the chat graph and only ``read_file``, ``edit_file`` and ``write_file``, then compares the
folder with the one the task expects. It counts the ``edit_file`` calls, the ones that failed,
and the rung of the match ladder that matched each applied edit. ``report`` turns the results
into the table. Only a person running the command reaches a real model.
"""

from __future__ import annotations

import asyncio
import time
from collections import Counter
from collections.abc import Sequence
from contextlib import aclosing
from dataclasses import dataclass, field, replace
from pathlib import Path

from langchain_core.language_models.chat_models import BaseChatModel
from langgraph.checkpoint.memory import InMemorySaver

from golem.graphs.adapter import TextCompleted, ToolErrored, ToolFinished, Translator
from golem.graphs.chat import open_chat
from golem.models.router import ModelRouter
from golem.tools.fs import READ_FILE
from golem.tools.paths import session_root
from golem.tools.registry import Tool, ToolContext, ToolError, ToolRegistry, ToolResult
from golem.tools.write import EDIT_FILE, WRITE_FILE, EditFileArgs, plan_edit

MAX_CALLS = 8
"""Model calls a task may use. The run stops after the tools of the last one have run."""

SCHEMA_VERSION = 1


@dataclass(frozen=True, slots=True)
class Task:
    """One request on a small folder. ``expect`` is the whole folder after the request."""

    name: str
    files: dict[str, str]
    request: str
    expect: dict[str, str]


@dataclass(frozen=True, slots=True)
class TaskResult:
    """What one task cost the model. ``rungs`` has one entry per applied edit."""

    name: str
    solved: bool
    edit_calls: int
    failed_edits: int
    rungs: tuple[str, ...]
    seconds: float


@dataclass(slots=True)
class _Edits:
    calls: int = 0
    failed: int = 0
    rungs: list[str] = field(default_factory=list[str])


def _counting_edit(edits: _Edits) -> Tool[EditFileArgs]:
    async def run(args: EditFileArgs, ctx: ToolContext) -> ToolResult:
        edits.calls += 1
        try:
            rung = (await asyncio.to_thread(plan_edit, session_root(ctx), args)).rung
            result = await EDIT_FILE.run(args, ctx)
        except ToolError:
            edits.failed += 1
            raise
        edits.rungs.append(rung)
        return result

    return replace(EDIT_FILE, run=run)


def _normal(text: str) -> str:
    """``text`` without spaces and tabs at the end of a line, and without a blank end."""
    return "\n".join(line.rstrip(" \t") for line in text.split("\n")).rstrip()


def _folder(root: Path) -> dict[str, str]:
    found: dict[str, str] = {}
    for path in sorted(root.rglob("*")):
        if path.is_file():
            found[path.relative_to(root).as_posix()] = path.read_bytes().decode("utf-8", "replace")
    return found


def _matches(found: dict[str, str], expect: dict[str, str]) -> bool:
    if found.keys() != expect.keys():
        return False
    return all(_normal(found[path]) == _normal(text) for path, text in expect.items())


async def run_task(model: BaseChatModel, task: Task, tmp: Path) -> TaskResult:
    """Run ``task`` on ``model`` in the folder ``tmp``, which must be empty and temporary."""
    for path, text in task.files.items():
        target = tmp / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(text.encode("utf-8"))
    edits = _Edits()
    tools = ToolRegistry([READ_FILE, _counting_edit(edits), WRITE_FILE])
    router = ModelRouter(model=model)
    runtime = open_chat(router, InMemorySaver(), tools)
    translate = Translator()
    completed = 0
    pending: set[str] = set()
    started = time.monotonic()
    stream = runtime.stream(
        session_id="bench",
        text=task.request,
        model_profile=router.profile_name,
        schema_version=SCHEMA_VERSION,
        user_message_id="m_bench_user",
        assistant_message_id="m_bench_reply",
        cwd=str(tmp),
        permission_mode="autopilot",
        checks=False,
    )
    try:
        async with aclosing(stream):
            async for part in stream:
                for fact in translate(part):
                    if isinstance(fact, TextCompleted):
                        completed += 1
                        pending.update(call.call_id for call in fact.calls)
                    elif isinstance(fact, ToolFinished | ToolErrored):
                        pending.discard(fact.call_id)
                # Stop once the last allowed call's tools have run, before the next call.
                if completed >= MAX_CALLS and not pending:
                    break
    except Exception:  # a failed model call leaves the task unsolved, not the bench
        pass
    seconds = time.monotonic() - started
    solved = await asyncio.to_thread(lambda: _matches(_folder(tmp), task.expect))
    return TaskResult(
        name=task.name,
        solved=solved,
        edit_calls=edits.calls,
        failed_edits=edits.failed,
        rungs=tuple(edits.rungs),
        seconds=seconds,
    )


async def run_all(model: BaseChatModel, tasks: Sequence[Task], parent: Path) -> list[TaskResult]:
    """Run ``tasks`` one after another, each in its own new folder under ``parent``."""
    results: list[TaskResult] = []
    for index, task in enumerate(tasks):
        folder = parent / f"{index:02d}-{task.name}"
        folder.mkdir()
        results.append(await run_task(model, task, folder))
    return results


def _rungs(rungs: Sequence[str]) -> str:
    if not rungs:
        return "-"
    return ", ".join(
        f"{name} x{count}" if count > 1 else name for name, count in Counter(rungs).items()
    )


def report(results: Sequence[TaskResult]) -> str:
    """The table, then ``solved 9/12 · first-try edits 71% · fuzzy matches 3``.

    First-try edits are the share of ``edit_file`` calls that applied. Fuzzy matches are
    applied edits whose rung was not ``exact``.
    """
    rows = [("task", "solved", "edit calls", "failed edits", "rungs", "seconds")]
    for result in results:
        rows.append(
            (
                result.name,
                "yes" if result.solved else "no",
                str(result.edit_calls),
                str(result.failed_edits),
                _rungs(result.rungs),
                f"{result.seconds:.1f}",
            )
        )
    widths = [max(len(row[column]) for row in rows) for column in range(6)]
    lines = [
        "  ".join(cell.ljust(widths[i]) for i, cell in enumerate(row)).rstrip() for row in rows
    ]
    calls = sum(result.edit_calls for result in results)
    failed = sum(result.failed_edits for result in results)
    fuzzy = sum(1 for result in results for rung in result.rungs if rung != "exact")
    solved = sum(1 for result in results if result.solved)
    first_try = "n/a" if calls == 0 else f"{round(100 * (calls - failed) / calls)}%"
    lines.append("")
    lines.append(
        f"solved {solved}/{len(results)} · first-try edits {first_try} · fuzzy matches {fuzzy}"
    )
    return "\n".join(lines)


__all__ = ["MAX_CALLS", "Task", "TaskResult", "report", "run_all", "run_task"]
