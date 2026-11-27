"""Check a workflow file before it runs (ADR-062).

``check(source, folder, env)`` reads the text with ``ast``, like :mod:`golem.workflows.outline`:
it never imports the file and never asks a model. Each finding is a :class:`Problem` with the
line, the outline step it belongs to and, when there is one, a short fix.

What it checks, and nothing more:

* the file parses and the outline reads;
* ``run.*`` calls: the method exists, its keyword arguments exist, ``budget=`` is money text,
  ``model=`` is a model name or an old wish word (a name that is not set up here is a note,
  never an error);
* the agent a ``run.agent`` names exists for the folder;
* a wish resolves in this setup, and a wish that would use a paid model in a local-only folder
  is a warning (a run would stop at that step);
* ``schedule(...)`` and ``on_file(...)`` triggers are valid, with the routines' parser;
* ``trigger=`` is not used: a warning on its line says a routine starts a workflow.
"""

from __future__ import annotations

import ast
import difflib
import inspect
import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from functools import cache
from typing import Literal

from golem.agents.model import WISHES
from golem.routines import ScheduleError, parse_schedule
from golem.workflow import Run
from golem.workflows.outline import OutlineError, OutlineStep, outline

Severity = Literal["error", "warning"]

_TRIGGERS = ("schedule", "on_file", "manual", "Schedule", "OnFile", "Manual")
TRIGGER_UNUSED = "trigger= is not used. A routine starts a workflow: add one in Routines."
_DEFAULT_BUDGET = '"$0.50"'


@dataclass(frozen=True, slots=True)
class Problem:
    severity: Severity
    line: int
    step_id: str | None
    message: str
    fix: str | None = None
    """A short replacement text, or the name of an action."""


@dataclass(frozen=True, slots=True)
class CheckEnv:
    """What the check needs to know about this setup. All of it is optional."""

    agents: Callable[[str | None], Mapping[str, str]] | None = None
    """The usable agents of a folder, name to wish. None skips the agent checks."""
    local_only: Callable[[str | None], bool] = field(default=lambda folder: False)
    tier_of_wish: Callable[[str, bool], str | None] | None = None
    """The tier (``local``, ``cheap``, ...) a wish gets in a folder, ``local_only`` as the
    second argument. May raise when the wish does not resolve. None skips the check."""
    model_problem: Callable[[str], str | None] | None = None
    """Why a model name is not set up on this machine, or None when it is. None skips the note."""
    default_model: Callable[[], str | None] | None = None
    """The name of golem's default model, which the check suggests instead of a wish word."""


@cache
def _signatures() -> dict[str, tuple[frozenset[str], bool]]:
    """Each public ``Run`` method: its parameter names, and whether it takes ``**kwargs``."""
    found: dict[str, tuple[frozenset[str], bool]] = {}
    for name, fn in inspect.getmembers(Run, inspect.isfunction):
        if name.startswith("_"):
            continue
        params = list(inspect.signature(fn).parameters.values())[1:]
        names = frozenset(p.name for p in params if p.kind is not p.VAR_KEYWORD)
        found[name] = (names, any(p.kind is p.VAR_KEYWORD for p in params))
    return found


def _str(node: ast.expr | None) -> str | None:
    return node.value if isinstance(node, ast.Constant) and isinstance(node.value, str) else None


def _budget_problem(node: ast.expr) -> str | None:
    if not isinstance(node, ast.Constant) or node.value is None:
        return None
    value: object = node.value
    bad = f'budget= is money text such as "$0.50"; got {ast.unparse(node)}'
    if isinstance(value, bool):
        return bad
    try:
        if isinstance(value, str):
            usd = float(value.strip().removeprefix("$"))
        elif isinstance(value, int | float):
            usd = float(value)
        else:
            return bad
    except ValueError:
        return bad
    if not 0 < usd < float("inf"):
        return f"budget= must be more than $0; got {ast.unparse(node)}"
    return None


class _Checker:
    def __init__(self, folder: str | None, env: CheckEnv) -> None:
        self.env = env
        self.local_only = env.local_only(folder)
        self.agents = None if env.agents is None else dict(env.agents(folder))
        self.problems: list[Problem] = []

    def add(
        self,
        severity: Severity,
        line: int,
        step: str | None,
        message: str,
        fix: str | None = None,
    ) -> None:
        self.problems.append(Problem(severity, line, step, message, fix))

    def trigger(self, deco: ast.expr) -> None:
        if not isinstance(deco, ast.Call):
            return
        for kw in deco.keywords:
            node = kw.value
            if kw.arg != "trigger":
                continue
            self.add("warning", node.lineno, None, TRIGGER_UNUSED)
            if not isinstance(node, ast.Call):
                continue
            name = ""
            if isinstance(node.func, ast.Attribute):
                name = node.func.attr
            elif isinstance(node.func, ast.Name):
                name = node.func.id
            first = _str(node.args[0]) if node.args else None
            if name not in _TRIGGERS:
                self.add(
                    "error",
                    node.lineno,
                    None,
                    f"{name or 'this'} is not a trigger: use schedule(...), on_file(...) or"
                    " Manual()",
                    "on_file" if name == "watch" else "schedule",
                )
            elif name in ("schedule", "Schedule") and first is not None:
                try:
                    parse_schedule(first)
                except ScheduleError as exc:
                    self.add("error", node.lineno, None, str(exc))
            elif name in ("on_file", "OnFile") and first is not None and not first.strip():
                self.add("error", node.lineno, None, "on_file needs a file or a glob")

    def workflow_model(self, deco: ast.expr) -> None:
        """The same notes for ``@workflow(model=...)``."""
        if not isinstance(deco, ast.Call):
            return
        for kw in deco.keywords:
            name = _str(kw.value) if kw.arg == "model" else None
            if name is not None:
                self.model(name, kw.value.lineno, None)
                self.resolve(name, kw.value.lineno, None)

    def call(self, node: ast.Call, method: str, steps: list[OutlineStep]) -> None:
        line = node.lineno
        step = self.step_of(line, steps)
        signature = _signatures().get(method)
        if signature is None:
            known = ", ".join(sorted(_signatures()))
            self.add("error", line, step, f"run has no {method}; the methods are {known}")
            return
        names, open_ended = signature
        if not open_ended:
            for kw in node.keywords:
                if kw.arg is not None and kw.arg not in names:
                    close = difflib.get_close_matches(kw.arg, names, n=1)
                    self.add(
                        "error",
                        kw.value.lineno,
                        step,
                        f"run.{method} has no argument {kw.arg}=; its arguments are"
                        f" {', '.join(sorted(names))}",
                        close[0] + "=" if close else None,
                    )
        keywords = {k.arg: k.value for k in node.keywords if k.arg}
        if method == "agent" and "budget" in keywords:
            bad = _budget_problem(keywords["budget"])
            if bad:
                self.add(
                    "error", keywords["budget"].lineno, step, f"run.agent {bad}", _DEFAULT_BUDGET
                )
        wish = _str(keywords.get("model"))
        if method in ("agent", "llm", "skill") and wish is not None:
            self.model(wish, keywords["model"].lineno, step)
        if method == "agent":
            self.agent(node, keywords, step, wish)
        elif method in ("llm", "skill") and wish is not None:
            self.resolve(wish, keywords["model"].lineno, step)

    def model(self, name: str, line: int, step: str | None) -> None:
        """A note beside a model name that is not set up, or beside an old wish word."""
        if name in WISHES:
            suggest = None if self.env.default_model is None else self.env.default_model()
            if suggest is not None:
                self.add(
                    "warning",
                    line,
                    step,
                    f"{name!r} still works, but a model name says which model runs; for example"
                    f" {suggest!r}",
                    json.dumps(suggest),
                )
            return
        if self.env.model_problem is None:
            return
        bad = self.env.model_problem(name)
        if bad is not None:
            self.add(
                "warning",
                line,
                step,
                f"{bad}; the step would stop with that reason. The run is not refused up front",
            )

    def agent(
        self, node: ast.Call, keywords: dict[str, ast.expr], step: str | None, wish: str | None
    ) -> None:
        first = node.args[0] if node.args else keywords.get("type")
        name = _str(first)
        if name is not None and self.agents is not None:
            if name not in self.agents:
                close = difflib.get_close_matches(name, self.agents, n=1)
                known = ", ".join(self.agents) or "none"
                self.add(
                    "error",
                    first.lineno if first is not None else node.lineno,
                    step,
                    f"unknown agent {name!r}; the agents here are {known}",
                    close[0] if close else None,
                )
                return
            if "model" not in keywords:
                own = self.agents[name]
                if own in WISHES:
                    self.resolve(own, node.lineno, step)
                return
        if wish is not None:
            self.resolve(wish, keywords["model"].lineno, step)

    def resolve(self, wish: str, line: int, step: str | None) -> None:
        if self.env.tier_of_wish is None:
            return
        if (
            wish not in WISHES
            and self.env.model_problem is not None
            and self.env.model_problem(wish) is not None
        ):
            return  # already noted as not set up
        try:
            tier = self.env.tier_of_wish(wish, self.local_only)
        except Exception as exc:
            self.add("warning", line, step, f"the model {wish!r} does not resolve here: {exc}")
            return
        if self.local_only and tier not in (None, "local"):
            self.add(
                "warning",
                line,
                step,
                f"{wish!r} would use a hosted model, and this folder is local-only:"
                " a run would stop at this step",
                "local" if wish in WISHES else None,
            )

    @staticmethod
    def step_of(line: int, steps: list[OutlineStep]) -> str | None:
        """The innermost outline step whose lines hold ``line``."""
        inside = [s for s in steps if s.lines[0] <= line <= s.lines[1]]
        if not inside:
            return None
        return min(inside, key=lambda s: s.lines[1] - s.lines[0]).id


def _is_workflow(deco: ast.expr) -> bool:
    target = deco.func if isinstance(deco, ast.Call) else deco
    return ast.unparse(target).rsplit(".", 1)[-1] == "workflow"


def check(source: str, folder: str | None = None, env: CheckEnv | None = None) -> list[Problem]:
    """The problems of ``source``, errors and warnings, in line order."""
    checker = _Checker(folder, env or CheckEnv())
    try:
        tree = ast.parse(source)
        outlines = outline(source)
    except SyntaxError as exc:
        return [Problem("error", exc.lineno or 1, None, exc.msg)]
    except OutlineError as exc:
        return [Problem("error", exc.line or 1, None, exc.message)]
    except ValueError as exc:  # null bytes
        return [Problem("error", 1, None, str(exc))]
    by_name = {o.name: o for o in outlines}
    for fn in tree.body:
        if not isinstance(fn, ast.AsyncFunctionDef | ast.FunctionDef):
            continue
        found = by_name.get(fn.name)
        deco = next((d for d in fn.decorator_list if _is_workflow(d)), None)
        params = [*fn.args.posonlyargs, *fn.args.args]
        if found is None or deco is None or not params:
            continue
        checker.trigger(deco)
        checker.workflow_model(deco)
        run = params[0].arg
        steps = list(found.steps)
        for node in ast.walk(fn):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and isinstance(node.func.value, ast.Name)
                and node.func.value.id == run
            ):
                checker.call(node, node.func.attr, steps)
    return sorted(checker.problems, key=lambda p: (p.line, p.severity != "error"))


__all__ = ["CheckEnv", "Problem", "check"]
