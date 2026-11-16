"""golem coding bench: the tasks, a task run on a scripted model, and the report."""

from __future__ import annotations

from pathlib import Path

import pytest
from fakes import ToolCallingChatModel
from langchain_core.language_models.chat_models import BaseChatModel

from golem.cli import main
from golem.coding.bench import MAX_CALLS, Task, TaskResult, report, run_all, run_task
from golem.coding.bench_tasks import TASKS
from golem.models.router import ModelRouter
from golem.tools.write import (
    EditFileArgs,
    WriteFileArgs,
    commit,
    plan_edit,
    plan_write,
)

Calls = list[tuple[str, dict[str, str]]]


def _task(name: str) -> Task:
    return next(task for task in TASKS if task.name == name)


def _edit(path: str, old: str, new: str) -> tuple[str, dict[str, str]]:
    return ("edit_file", {"path": path, "old_string": old, "new_string": new})


def _read(path: str) -> tuple[str, dict[str, str]]:
    return ("read_file", {"path": path})


_PAGING_FIX = _edit("paging.py", "items[start : start + size + 1]", "items[start : start + size]")


async def test_a_solved_task_counts_its_edit(tmp_path: Path) -> None:
    model = ToolCallingChatModel(replies=[[_read("paging.py")], [_PAGING_FIX], "Fixed."])
    result = await run_task(model, _task("off_by_one"), tmp_path)
    assert result.solved
    assert (result.edit_calls, result.failed_edits, result.rungs) == (1, 0, ("exact",))
    assert "start + size]" in (tmp_path / "paging.py").read_text(encoding="utf-8")
    assert model.bound == ["read_file", "edit_file", "write_file"]


async def test_a_failed_edit_is_counted_and_the_retry_can_solve(tmp_path: Path) -> None:
    wrong = _edit("paging.py", "items[start:start + size + 2]", "items[start:start + size]")
    model = ToolCallingChatModel(replies=[[wrong], [_PAGING_FIX], "Fixed."])
    result = await run_task(model, _task("off_by_one"), tmp_path)
    assert result.solved
    assert (result.edit_calls, result.failed_edits, result.rungs) == (2, 1, ("exact",))


async def test_a_model_that_gives_up_leaves_the_task_unsolved(tmp_path: Path) -> None:
    model = ToolCallingChatModel(replies=["I cannot change that file."])
    result = await run_task(model, _task("off_by_one"), tmp_path)
    assert not result.solved
    assert (result.edit_calls, result.failed_edits, result.rungs) == (0, 0, ())


async def test_a_wrong_edit_that_applies_is_not_solved(tmp_path: Path) -> None:
    wrong = _edit("paging.py", "start + size + 1", "start + size + 2")
    model = ToolCallingChatModel(replies=[[wrong], "Done."])
    result = await run_task(model, _task("off_by_one"), tmp_path)
    assert not result.solved
    assert result.edit_calls == 1


async def test_the_rung_of_a_fuzzy_match_is_reported(tmp_path: Path) -> None:
    flat = _edit(
        "notify.py",
        'if name.startswith("urgent"):\n    log.warning("Queue is full, dropping the message")',
        'if name.startswith("urgent"):\n    log.warning("Queue is full, retrying later")',
    )
    model = ToolCallingChatModel(replies=[[flat], "Done."])
    result = await run_task(model, _task("deep_indent"), tmp_path)
    assert result.solved
    assert result.rungs == ("indent",)


async def test_the_run_stops_after_the_call_limit(tmp_path: Path) -> None:
    model = ToolCallingChatModel(replies=[[_read("paging.py")] for _ in range(MAX_CALLS + 5)])
    result = await run_task(model, _task("off_by_one"), tmp_path)
    assert not result.solved
    assert len(model.seen) <= MAX_CALLS


async def test_a_model_that_raises_does_not_stop_the_bench(tmp_path: Path) -> None:
    model = ToolCallingChatModel(replies=[])
    result = await run_task(model, _task("off_by_one"), tmp_path)
    assert not result.solved


async def test_run_all_gives_each_task_its_own_folder(tmp_path: Path) -> None:
    model = ToolCallingChatModel(replies=["no", "no"])
    results = await run_all(model, [_task("off_by_one"), _task("tabs")], tmp_path)
    assert [result.name for result in results] == ["off_by_one", "tabs"]
    assert sorted(path.name for path in tmp_path.iterdir()) == ["00-off_by_one", "01-tabs"]


def _results() -> list[TaskResult]:
    return [
        TaskResult("rename_function", True, 3, 0, ("exact", "exact", "exact"), 4.25),
        TaskResult("tabs", True, 2, 1, ("indent",), 3.0),
        TaskResult("crlf", False, 0, 0, (), 0.5),
    ]


def test_the_report_has_a_table_and_a_summary_line() -> None:
    lines = report(_results()).splitlines()
    assert lines[0].split() == [
        "task",
        "solved",
        "edit",
        "calls",
        "failed",
        "edits",
        "rungs",
        "seconds",
    ]
    assert lines[1].split(None, 3)[:3] == ["rename_function", "yes", "3"]
    assert "exact x3" in lines[1]
    assert lines[2].endswith("3.0") and "indent" in lines[2]
    assert lines[3].split()[1] == "no" and " - " in lines[3]
    assert lines[-1] == "solved 2/3 · first-try edits 80% · fuzzy matches 1"


def test_the_report_without_edits_has_no_first_try_share() -> None:
    last = report([TaskResult("tabs", False, 0, 0, (), 1.0)]).splitlines()[-1]
    assert last == "solved 0/1 · first-try edits n/a · fuzzy matches 0"


def test_there_are_twelve_tasks_with_unique_names() -> None:
    assert len(TASKS) == 12
    assert len({task.name for task in TASKS}) == 12
    python = [task for task in TASKS if any(path.endswith(".py") for path in task.files)]
    assert len(python) == 6


@pytest.mark.parametrize("task", TASKS, ids=lambda task: task.name)
def test_a_task_changes_the_folder_and_its_files_are_a_sensible_size(task: Task) -> None:
    assert task.files != task.expect
    for path, text in task.files.items():
        assert 30 <= len(text.splitlines()) <= 150, path


# The edits that solve each task, kept here by hand, so a task whose `expect` cannot be
# reached by the real edit tool fails. An empty old text writes the whole file.
_SOLUTIONS: dict[str, list[tuple[str, str, str]]] = {
    "rename_function": [
        ("billing.py", "def calc_fee(", "def compute_fee("),
        ("billing.py", "subtotal + calc_fee(", "subtotal + compute_fee("),
        ("billing.py", "subtotal - calc_fee(", "subtotal - compute_fee("),
    ],
    "add_parameter": [
        ("greeting.py", "def greet(name: str)", 'def greet(name: str, punctuation: str = "!")'),
        ("greeting.py", 'Hello, {name}!"', 'Hello, {name}{punctuation}"'),
    ],
    "off_by_one": [("paging.py", "size + 1]", "size]")],
    "add_import": [
        ("stats.py", "import math", "import math\nimport statistics"),
        (
            "stats.py",
            "    total = 0.0\n    for value in values:\n        total += value\n"
            "    return total / len(values)",
            "    return statistics.fmean(values)",
        ),
    ],
    "deep_indent": [("notify.py", "dropping the message", "retrying later")],
    "add_method": [
        (
            "counter.py",
            "        return self.count\n",
            "        return self.count\n\n    def reset(self) -> None:\n        self.count = 0\n",
        )
    ],
    "tabs": [("src/config.ts", "8080", "9090")],
    "crlf": [
        ("src/queue.ts", "take(): T {", "take(): T | undefined {"),
        ("src/queue.ts", 'throw new Error("queue is empty");', "return undefined;"),
    ],
    "delete_function": [
        (
            "src/format.ts",
            "export function legacyFormat(value: number): string {\n"
            "  const rounded = Math.round(value * 100) / 100;\n"
            "  return rounded.toFixed(2);\n}\n\n",
            "",
        )
    ],
    "two_files": [
        ("src/user.ts", "  fullName: string;", "  displayName: string;"),
        ("src/user.ts", "fullName: string, email", "displayName: string, email"),
        ("src/user.ts", "{ id, fullName, email }", "{ id, displayName, email }"),
        ("src/greet.ts", "${user.fullName}", "${user.displayName}"),
        ("src/greet.ts", "return user.fullName", "return user.displayName"),
    ],
    "create_file": [
        (
            "src/clamp.ts",
            "",
            "export function clamp(value: number, min: number, max: number): number {\n"
            "  return Math.min(Math.max(value, min), max);\n}\n",
        ),
        ("src/index.ts", 'part29.ts";\n', 'part29.ts";\nexport * from "./clamp.ts";\n'),
    ],
    "ambiguous_block": [
        (
            "src/handlers.ts",
            '5000, retries: 2 };\n  const body = await get("/orders"',
            '10000, retries: 2 };\n  const body = await get("/orders"',
        )
    ],
}


def test_every_task_has_a_solution() -> None:
    assert set(_SOLUTIONS) == {task.name for task in TASKS}


@pytest.mark.parametrize("task", TASKS, ids=lambda task: task.name)
def test_every_expected_folder_is_reachable_with_the_edit_tools(task: Task, tmp_path: Path) -> None:
    for path, text in task.files.items():
        (tmp_path / path).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / path).write_bytes(text.encode())
    for path, old, new in _SOLUTIONS[task.name]:
        if old == "":
            commit(plan_write(tmp_path, WriteFileArgs(path=path, content=new)))
        else:
            commit(plan_edit(tmp_path, EditFileArgs(path=path, old_string=old, new_string=new)))
    found = {
        path.relative_to(tmp_path).as_posix(): path.read_bytes().decode()
        for path in tmp_path.rglob("*")
        if path.is_file()
    }
    assert found == task.expect


def test_coding_bench_runs_the_tasks_and_exits_zero(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("GOLEM_HOME", str(tmp_path / "home"))
    model = ToolCallingChatModel(replies=["no"])

    def chat_model(
        _self: ModelRouter, profile: str, *_rest: object, **_more: object
    ) -> BaseChatModel:
        assert profile == "local"
        return model

    monkeypatch.setattr(ModelRouter, "chat_model", chat_model)
    assert main(["coding", "bench", "local", "--task", "off_by_one"]) == 0
    out = capsys.readouterr().out
    assert "off_by_one" in out
    assert out.splitlines()[-1] == "solved 0/1 · first-try edits n/a · fuzzy matches 0"
    assert not (tmp_path / "home" / "paging.py").exists()


def test_coding_bench_names_the_tasks_when_one_is_unknown(
    capsys: pytest.CaptureFixture[str],
) -> None:
    assert main(["coding", "bench", "local", "--task", "nope"]) == 1
    assert "off_by_one" in capsys.readouterr().out
