# examples/workflows/hello.py
from pathlib import Path

from golem.workflow import Run, manual, workflow


def find_files(folder: str) -> list[str]:
    files = sorted(str(p) for p in Path(folder).expanduser().glob("*.md"))
    if len(files) < 3:
        raise ValueError(f"need three .md files in {folder}, found {len(files)}")
    return files[:3]


def count_lines(path: str) -> int:
    with open(path, encoding="utf-8") as handle:
        return sum(1 for _ in handle)


def add_up(counts: list[int]) -> int:
    return sum(counts)


@workflow(trigger=manual(), inputs={"folder": str}, description="Count lines in three Markdown files.")
async def hello(run: Run) -> None:
    files = await run.step("find files", find_files, run.inputs["folder"])
    counts = await run.parallel([run.step(f"count {Path(f).name}", count_lines, f) for f in files])
    await run.step("add up", add_up, counts)
