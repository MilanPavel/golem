"""A new workflow file from scratch (step 3.13.12, #1935).

``file_name`` turns what a person typed ("Weekly invoices") into the file and function name
(``weekly_invoices``). ``create_file`` checks the text, then writes ``<folder>/<name>.py`` and
never overwrites a file. ``skeleton`` is the two-step file of "Empty file".
"""

from __future__ import annotations

import keyword
import os
import re
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path

from golem.workflows.check import Problem
from golem.workflows.outline import OutlineError, outline
from golem.workflows.registry import PROJECT_DIR

__all__ = ["CreateError", "Named", "create_file", "file_name", "skeleton", "suggest_free"]

MAX_NAME = 60


class CreateError(Exception):
    """A new workflow that cannot be made; the text says why."""


@dataclass(frozen=True, slots=True)
class Named:
    """What a typed name stands for: the file and function ``file`` and the ``title`` words."""

    file: str
    title: str


def file_name(typed: str) -> Named:
    """The file name and the title for a typed name. Raises :class:`CreateError`.

    Words become a lower-case name with ``_`` between them. A name already written as such
    (``weekly_invoices``) is kept, and its title is its words with a capital.
    """
    words = typed.strip()
    if not words:
        raise CreateError("give the workflow a name")
    if len(words) > MAX_NAME:
        raise CreateError(f"the name is too long (at most {MAX_NAME} characters)")
    plain = re.sub(r"[^a-z0-9]+", "_", words.lower().encode("ascii", "ignore").decode()).strip("_")
    if not plain:
        raise CreateError("the name needs letters or numbers from a to z")
    if plain[0].isdigit():
        raise CreateError("the name must start with a letter")
    if keyword.iskeyword(plain) or plain in ("run", "workflow", "golem"):
        raise CreateError(f"{plain} is a word Python keeps for itself; pick another name")
    shown = words if " " in words or words != words.lower() else plain.replace("_", " ")
    return Named(plain, shown[:1].upper() + shown[1:])


def suggest_free(name: str, taken: Iterable[str]) -> str:
    """``name`` with the first number after it that is free: ``name_2``, ``name_3``..."""
    used = set(taken)
    number = 2
    while f"{name}_{number}" in used:
        number += 1
    return f"{name}_{number}"


def skeleton(named: Named) -> str:
    """A two-step workflow: gather something, then say the result."""
    title = named.title.replace("\\", "\\\\").replace('"', '\\"')
    return f'''from golem.workflow import Run, workflow


def gather() -> list[str]:
    """Replace this with what the workflow works on."""
    return ["one", "two", "three"]


def summarise(found: list[str]) -> str:
    """Replace this with what the workflow makes of it."""
    return f"{{len(found)}} found: " + ", ".join(found)


@workflow(title="{title}", description="Say here what this workflow is for.")
async def {named.file}(run: Run) -> str:
    found = await run.step("Gather what it works on", gather)
    result = await run.step("Make the result", summarise, found)
    await run.output(result, title="Result")
    return result
'''


def create_file(
    named: Named,
    code: str,
    folder: Path | None,
    *,
    user_dir: Path,
    trusted: Callable[[Path], bool],
    check: Callable[[str], list[Problem]],
    taken: Callable[[Path, str], Iterable[str]],
) -> Path:
    """Write ``code`` as the new workflow ``named`` and return its path.

    ``folder`` is a trusted project (the file goes in its ``workflows`` folder) or None for the
    user's folder. ``taken(directory, name)`` lists the workflow names the registry already has
    in that place. Refused: an untrusted folder, code with an error problem, code with no
    workflow, a file that exists, and a function name that is used already.
    """
    if folder is None:
        target_dir = user_dir
    else:
        if not trusted(folder):
            raise CreateError(
                f"{folder} is not trusted; add it to trusted_projects in config.toml first"
            )
        target_dir = folder / PROJECT_DIR
    target = target_dir / f"{named.file}.py"
    if target.exists():
        free = suggest_free(named.file, _stems(target_dir))
        raise CreateError(f"{target} exists already; it was not changed. Try {free}")
    errors = [p for p in check(code) if p.severity == "error"]
    if errors:
        first = errors[0]
        more = f" (and {len(errors) - 1} more)" if len(errors) > 1 else ""
        raise CreateError(f"not created: line {first.line}: {first.message}{more}")
    try:
        found = [one.name for one in outline(code)]
    except OutlineError as exc:
        raise CreateError(f"not created: the code cannot be read: {exc}") from exc
    if not found:
        raise CreateError("not created: the code has no @workflow function")
    used = set(taken(target_dir, named.file))
    clash = next((name for name in found if name in used), None)
    if clash is not None:
        free = suggest_free(clash, used | set(_stems(target_dir)))
        raise CreateError(f"a workflow called {clash} exists already here. Try {free}")
    try:
        target_dir.mkdir(parents=True, exist_ok=True)
        temp = target.with_name(f".{target.name}.{os.getpid()}.tmp")
        try:
            temp.write_bytes(code.encode("utf-8"))
            os.link(temp, target)  # fails when the file appeared meanwhile; never overwrites
        finally:
            temp.unlink(missing_ok=True)
    except FileExistsError as exc:
        raise CreateError(f"{target} exists already; it was not changed") from exc
    except OSError as exc:
        raise CreateError(f"the file cannot be written: {exc}") from exc
    return target


def _stems(directory: Path) -> list[str]:
    try:
        return [p.stem for p in directory.glob("*.py")]
    except OSError:
        return []
