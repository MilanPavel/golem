"""Read the ``[[routine]]`` tables of a ``config.toml``, and say what is wrong with each.

One bad routine does not hide the others: every table is checked on its own, and
a problem is reported with the file and the line it is on. A project's file is
read only for a folder in ``trusted_projects`` (the caller decides), and its
routines are held to the rules of ADR-050: the folder is the project or inside
it, and an MCP server is one the user or the project already configures.
"""

from __future__ import annotations

import re
import tomllib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, cast

from pydantic import ValidationError

from golem.config import RoutineSettings, load_mcp
from golem.config_raw import line_of

__all__ = [
    "RoutineFile",
    "RoutineProblem",
    "project_config",
    "read_project_routines",
    "read_routines",
]


def project_config(folder: Path) -> Path:
    return folder / ".golem" / "config.toml"


@dataclass(frozen=True, slots=True)
class RoutineProblem:
    """One thing wrong in a config file. ``line`` counts from 1, when known."""

    file: str
    message: str
    line: int | None = None

    def __str__(self) -> str:
        where = self.file if self.line is None else f"{self.file}:{self.line}"
        return f"{where}: {self.message}"


@dataclass(frozen=True, slots=True)
class RoutineFile:
    """The valid routines of a file, in file order, and the problems found."""

    routines: list[RoutineSettings] = field(default_factory=list[RoutineSettings])
    problems: list[RoutineProblem] = field(default_factory=list[RoutineProblem])


def read_routines(
    path: Path, *, project: Path | None = None, known_mcp: frozenset[str] = frozenset()
) -> RoutineFile:
    """The routines in ``path``. A missing file has none.

    With ``project`` (the folder the file belongs to) the project rules apply:
    ``folder`` stays inside it, and ``mcp`` names only servers in ``known_mcp``.
    """
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return RoutineFile()
    except OSError as exc:
        return RoutineFile(problems=[RoutineProblem(str(path), f"could not read it: {exc}")])
    try:
        data = tomllib.loads(text)
    except tomllib.TOMLDecodeError as exc:
        return RoutineFile(problems=[_decode_problem(path, exc)])
    tables = data.get("routine", [])
    if not isinstance(tables, list):
        return RoutineFile(
            problems=[RoutineProblem(str(path), "routine must be a list: use [[routine]]")]
        )
    routines: list[RoutineSettings] = []
    problems: list[RoutineProblem] = []
    names: set[str] = set()
    for index, table in enumerate(cast(list[Any], tables)):
        found = _one(path, text, index, table, project, known_mcp)
        if isinstance(found, RoutineSettings):
            if found.name in names:
                problems.append(
                    RoutineProblem(
                        str(path),
                        f"two routines are called {found.name}",
                        line_of(text, ["routine", str(index), "name"]),
                    )
                )
                continue
            names.add(found.name)
            routines.append(found)
        else:
            problems.extend(found)
    return RoutineFile(routines, problems)


def read_project_routines(user_file: Path, folder: Path, trusted: bool) -> RoutineFile:
    """The routines of a project's file, held to the project rules only when ``trusted``.

    An untrusted folder is read to show what is blocked. Nothing from it is scheduled.
    """
    path = project_config(folder)
    if not trusted:
        return read_routines(path)
    known = frozenset(_mcp_names(user_file) | _mcp_names(path))
    return read_routines(path, project=folder, known_mcp=known)


def _mcp_names(path: Path) -> set[str]:
    try:
        return set(load_mcp(path))
    except ValueError:
        return set()


def _one(
    path: Path,
    text: str,
    index: int,
    table: object,
    project: Path | None,
    known_mcp: frozenset[str],
) -> RoutineSettings | list[RoutineProblem]:
    try:
        routine = RoutineSettings.model_validate(table)
    except ValidationError as exc:
        problems: list[RoutineProblem] = []
        for error in exc.errors():
            loc = ["routine", str(index), *(str(part) for part in error["loc"])]
            message = error["msg"].removeprefix("Value error, ")
            if error["type"] == "extra_forbidden":
                message = "unknown setting"
            problems.append(RoutineProblem(str(path), message, line_of(text, loc)))
        return problems
    if project is None:
        return routine
    return _project_rules(path, text, index, routine, project, known_mcp)


def _project_rules(
    path: Path,
    text: str,
    index: int,
    routine: RoutineSettings,
    project: Path,
    known_mcp: frozenset[str],
) -> RoutineSettings | list[RoutineProblem]:
    problems: list[RoutineProblem] = []
    if routine.folder is not None:
        target = Path(routine.folder).expanduser()
        target = target if target.is_absolute() else project / target
        root = project.resolve()
        resolved = target.resolve()
        if resolved != root and root not in resolved.parents:
            problems.append(
                RoutineProblem(
                    str(path),
                    f"{routine.name}: a project routine runs in the project folder or inside it",
                    line_of(text, ["routine", str(index), "folder"]),
                )
            )
    for server in routine.mcp:
        if server not in known_mcp:
            problems.append(
                RoutineProblem(
                    str(path),
                    f"{routine.name}: the MCP server {server} is not configured for this project",
                    line_of(text, ["routine", str(index), "mcp"]),
                )
            )
    return problems or routine


def _decode_problem(path: Path, exc: tomllib.TOMLDecodeError) -> RoutineProblem:
    found = re.search(r"\(at line (\d+), column \d+\)", str(exc))
    message = re.sub(r"\s*\(at line \d+, column \d+\)", "", str(exc))
    return RoutineProblem(str(path), message, int(found.group(1)) if found else None)
