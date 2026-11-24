"""A workflow's outline, read from its code by fixed rules (ADR-062).

``outline(source)`` parses a workflow file with ``ast`` and lists what each
``@workflow`` function does as steps: the ``run.*`` calls, the loops and ``if``
statements around them, and a grey ``code`` step for anything else. It never
imports the file, never runs it and never asks a model, so the same file always
gives the same outline.

Rules, in short:

* A call on the first parameter (whatever it is named) with a known method is a
  step of that kind, awaited or not. ``run.parallel(...)`` and
  ``asyncio.gather(...)`` around run calls put them in one group.
* ``for`` loops and comprehensions give ``for_each``; ``if`` gives ``condition``.
* A statement that calls an arbitrary helper, or a ``with``/``try``/``while``/
  ``match`` with no run call inside, is a ``code`` step. Consecutive ones merge.
  Plain assignments of simple expressions are not steps.
* ``getattr(run, x)(...)`` and unknown ``run.foo(...)`` are ``code`` steps titled
  by their source text.
* ``after`` lists the steps whose results this step reads, by following names.
"""

from __future__ import annotations

import ast
import re
from dataclasses import dataclass, field, replace
from typing import Any

STEP_KINDS = ("step", "agent", "review", "notify", "llm", "tool", "skill")
_PURE_BUILTINS = frozenset(
    {
        *("len", "str", "int", "float", "bool", "list", "dict", "set", "tuple", "sorted"),
        *("sum", "min", "max", "any", "all", "enumerate", "zip", "range", "reversed", "repr"),
        *("abs", "round", "isinstance", "frozenset"),
    }
)
_TITLE_MAX = 80


class OutlineError(ValueError):
    """The source cannot be read as a workflow; ``line`` says where."""

    def __init__(self, message: str, line: int | None = None) -> None:
        super().__init__(f"line {line}: {message}" if line else message)
        self.message = message
        self.line = line


@dataclass(frozen=True)
class WorkflowInput:
    name: str
    type: str | None = None
    default: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {"name": self.name, "type": self.type, "default": self.default}


@dataclass(frozen=True)
class OutlineStep:
    id: str
    kind: str
    title: str
    lines: tuple[int, int]
    agent: str | None = None
    group: str | None = None
    for_each: str | None = None
    condition: str | None = None
    key: str | None = None
    gets: str | None = None
    budget: str | None = None
    brief_line: int | None = None
    budget_line: int | None = None
    after: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "kind": self.kind,
            "title": self.title,
            "agent": self.agent,
            "lines": list(self.lines),
            "group": self.group,
            "for_each": self.for_each,
            "condition": self.condition,
            "key": self.key,
            "gets": self.gets,
            "budget": self.budget,
            "brief_line": self.brief_line,
            "budget_line": self.budget_line,
            "after": list(self.after),
        }


@dataclass(frozen=True)
class WorkflowOutline:
    name: str
    lines: tuple[int, int]
    inputs: tuple[WorkflowInput, ...] = ()
    trigger: str | None = None
    docstring: str | None = None
    steps: tuple[OutlineStep, ...] = field(default=())

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "lines": list(self.lines),
            "inputs": [i.to_dict() for i in self.inputs],
            "trigger": self.trigger,
            "docstring": self.docstring,
            "steps": [s.to_dict() for s in self.steps],
        }


def _seg(source: str, node: ast.expr) -> str:
    """The source text of ``node`` (one line), else its normalised unparse."""
    seg = ast.get_source_segment(source, node)
    return seg if seg and "\n" not in seg else ast.unparse(node)


def outline(source: str) -> list[WorkflowOutline]:
    """One outline per ``@workflow`` function in ``source``."""
    try:
        tree = ast.parse(source)
    except SyntaxError as e:
        raise OutlineError(e.msg, e.lineno) from e
    except ValueError as e:  # null bytes
        raise OutlineError(str(e)) from e
    return [
        _Builder(node, source).build()
        for node in tree.body
        if isinstance(node, ast.AsyncFunctionDef | ast.FunctionDef) and _workflow_deco(node)
    ]


# ---- decorator and header ----


def _dotted(node: ast.expr) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return f"{_dotted(node.value)}.{node.attr}"
    return ""


def _workflow_deco(fn: ast.AsyncFunctionDef | ast.FunctionDef) -> ast.expr | None:
    """The ``@workflow`` / ``@workflow(...)`` / ``@golem.workflow.workflow`` decorator."""
    for d in fn.decorator_list:
        target = d.func if isinstance(d, ast.Call) else d
        if _dotted(target).rsplit(".", 1)[-1] == "workflow":
            return d
    return None


def _literalish(node: ast.expr) -> bool:
    """A literal, or a call/tuple/list of literals such as ``schedule("mon 06:00")``."""
    if isinstance(node, ast.Call):
        return bool(_dotted(node.func)) and all(
            _literalish(a) for a in [*node.args, *(k.value for k in node.keywords)]
        )
    if isinstance(node, ast.Tuple | ast.List):
        return all(_literalish(e) for e in node.elts)
    try:
        ast.literal_eval(node)
    except (ValueError, TypeError, SyntaxError, MemoryError, RecursionError):
        return False
    return True


def _text(node: ast.expr) -> str:
    """Plain words for an expression: a string's value, an f-string's template, else source."""
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.JoinedStr):
        out: list[str] = []
        for part in node.values:
            if isinstance(part, ast.Constant):
                out.append(str(part.value))
            elif isinstance(part, ast.FormattedValue):
                out.append("{" + ast.unparse(part.value) + "}")
        return "".join(out)
    return ast.unparse(node)


def _first_line(text: str) -> str:
    line = next((ln.strip() for ln in text.splitlines() if ln.strip()), "")
    return line if len(line) <= _TITLE_MAX else line[: _TITLE_MAX - 1].rstrip() + "…"


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:40]


# ---- walking the body ----


@dataclass(frozen=True)
class _Ctx:
    group: str | None = None
    for_each: tuple[str, ...] = ()
    conditions: tuple[str, ...] = ()
    deps: frozenset[str] = frozenset()
    start: int | None = None  # outermost enclosing `for` line
    fixed: tuple[int, int] | None = None  # whole statement, inside a comprehension


class _Builder:
    def __init__(self, fn: ast.AsyncFunctionDef | ast.FunctionDef, source: str) -> None:
        self.fn = fn
        self.source = source
        self.src = source.splitlines()
        params = [a.arg for a in [*fn.args.posonlyargs, *fn.args.args]]
        self.run = params[0] if params else "run"
        self.steps: list[OutlineStep] = []
        self.env: dict[str, frozenset[str]] = {}
        self.used: set[str] = set()
        self.counts: dict[str, int] = {}
        self.groups = 0
        self.stmt: ast.stmt = fn

    def seg(self, node: ast.expr) -> str:
        return _seg(self.source, node)

    # -- header
    def build(self) -> WorkflowOutline:
        fn = self.fn
        deco = _workflow_deco(fn)
        trigger: str | None = None
        declared: dict[str, str | None] = {}
        if isinstance(deco, ast.Call):
            for kw in deco.keywords:
                if kw.arg == "trigger" and _literalish(kw.value):
                    trigger = self.seg(kw.value)
                elif kw.arg == "inputs" and isinstance(kw.value, ast.Dict):
                    for k, v in zip(kw.value.keys, kw.value.values, strict=True):
                        if isinstance(k, ast.Constant) and isinstance(k.value, str):
                            declared[k.value] = self.seg(v)
        args = [*fn.args.posonlyargs, *fn.args.args]
        defaults: list[ast.expr | None] = [None] * (len(args) - len(fn.args.defaults))
        defaults += fn.args.defaults
        inputs = [
            WorkflowInput(
                a.arg,
                self.seg(a.annotation) if a.annotation else declared.get(a.arg),
                self.seg(d) if d else None,
            )
            for a, d in list(zip(args, defaults, strict=True))[1:]
        ]
        for kwa, kd in zip(fn.args.kwonlyargs, fn.args.kw_defaults, strict=True):
            inputs.append(
                WorkflowInput(
                    kwa.arg,
                    self.seg(kwa.annotation) if kwa.annotation else declared.get(kwa.arg),
                    self.seg(kd) if kd else None,
                )
            )
        have = {i.name for i in inputs}
        inputs += [WorkflowInput(n, t) for n, t in declared.items() if n not in have]
        body = fn.body
        doc = ast.get_docstring(fn)
        if doc is not None:
            body = body[1:]
        self.body(body, _Ctx())
        first = min([fn.lineno, *(d.lineno for d in fn.decorator_list)])
        return WorkflowOutline(
            name=fn.name,
            lines=(first, fn.end_lineno or fn.lineno),
            inputs=tuple(inputs),
            trigger=trigger,
            docstring=doc,
            steps=tuple(self.steps),
        )

    # -- statements
    def body(self, stmts: list[ast.stmt], ctx: _Ctx) -> None:
        pending: tuple[int, int] | None = None
        for st in stmts:
            if self.is_code(st):
                span = (st.lineno, st.end_lineno or st.lineno)
                pending = (pending[0], span[1]) if pending else span
                continue
            if pending:
                self.add_code(pending, ctx)
                pending = None
            self.statement(st, ctx)
        if pending:
            self.add_code(pending, ctx)

    def add_code(self, span: tuple[int, int], ctx: _Ctx) -> None:
        title = _first_line(self.src[span[0] - 1]) if span[0] <= len(self.src) else "code"
        self.emit("code", title, span, ctx, slug=None)

    def has_run_call(self, node: ast.AST) -> bool:
        return any(
            isinstance(n, ast.Call) and self.run_method(n) is not None for n in ast.walk(node)
        )

    def is_code(self, st: ast.stmt) -> bool:
        if self.has_run_call(st):
            return False
        if isinstance(st, ast.With | ast.AsyncWith | ast.Try | ast.While | ast.Match):
            return True
        if isinstance(st, ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef):
            return False
        return any(
            isinstance(n, ast.Call)
            and not (isinstance(n.func, ast.Name) and n.func.id in _PURE_BUILTINS)
            for n in ast.walk(st)
        )

    def statement(self, st: ast.stmt, ctx: _Ctx) -> None:
        self.stmt = st
        if isinstance(st, ast.If):
            ids = self.expr(st.test, ctx)
            cond = self.seg(st.test)
            inner = replace(ctx, deps=ctx.deps | ids | self.names_deps(st.test))
            self.body(st.body, replace(inner, conditions=(*ctx.conditions, cond)))
            if st.orelse:
                self.body(st.orelse, replace(inner, conditions=(*ctx.conditions, f"not ({cond})")))
        elif isinstance(st, ast.For | ast.AsyncFor):
            ids = self.expr(st.iter, ctx)
            deps = ctx.deps | ids | self.names_deps(st.iter)
            label = f"for each {self.seg(st.target)} in {self.seg(st.iter)}"
            self.bind(st.target, deps)
            inner = replace(
                ctx, for_each=(*ctx.for_each, label), deps=deps, start=ctx.start or st.lineno
            )
            self.body(st.body, inner)
            self.body(st.orelse, ctx)
        elif isinstance(st, ast.With | ast.AsyncWith):
            for item in st.items:
                self.expr(item.context_expr, ctx)
            self.body(st.body, ctx)
        elif isinstance(st, ast.Try):
            self.body(st.body, ctx)
            for h in st.handlers:
                self.body(h.body, ctx)
            self.body(st.orelse, ctx)
            self.body(st.finalbody, ctx)
        elif isinstance(st, ast.While):
            self.expr(st.test, ctx)
            label = f"while {self.seg(st.test)}"
            self.body(st.body, replace(ctx, for_each=(*ctx.for_each, label)))
        elif isinstance(st, ast.Match):
            for case in st.cases:
                self.body(case.body, ctx)
        elif isinstance(st, ast.Assign | ast.AnnAssign | ast.AugAssign):
            value = st.value
            if value is None:
                return
            ids = self.expr(value, ctx)
            targets = st.targets if isinstance(st, ast.Assign) else [st.target]
            deps = ids or self.names_deps(value)
            ordered = [s.id for s in self.steps if s.id in ids]
            for t in targets:
                self.bind(t, deps, positional=ordered)
        elif isinstance(st, ast.Expr | ast.Return) and st.value is not None:
            self.expr(st.value, ctx)

    def bind(
        self, target: ast.expr, deps: frozenset[str], positional: list[str] | None = None
    ) -> None:
        if isinstance(target, ast.Name):
            self.env[target.id] = deps
        elif isinstance(target, ast.Tuple | ast.List):
            if positional and len(positional) == len(target.elts):
                for t, one in zip(target.elts, positional, strict=True):
                    self.bind(t, frozenset({one}))
            else:
                for t in target.elts:
                    self.bind(t, deps)
        elif isinstance(target, ast.Starred):
            self.bind(target.value, deps)

    def names_deps(self, node: ast.AST) -> frozenset[str]:
        out: set[str] = set()
        for n in ast.walk(node):
            if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load):
                out |= self.env.get(n.id, frozenset())
        return frozenset(out)

    # -- expressions: return the ids of the steps produced, in order
    def run_method(self, call: ast.Call) -> str | None:
        f = call.func
        if (
            isinstance(f, ast.Attribute)
            and isinstance(f.value, ast.Name)
            and f.value.id == self.run
        ):
            return f.attr
        if (
            isinstance(f, ast.Call)
            and isinstance(f.func, ast.Name)
            and f.func.id == "getattr"
            and f.args
            and isinstance(f.args[0], ast.Name)
            and f.args[0].id == self.run
        ):
            return "?"
        return None

    def expr(self, node: ast.AST, ctx: _Ctx) -> frozenset[str]:
        return frozenset(self.visit(node, ctx))

    def visit(self, node: ast.AST, ctx: _Ctx) -> list[str]:
        if isinstance(node, ast.Lambda):
            return []
        if isinstance(node, ast.Call):
            method = self.run_method(node)
            if method == "parallel" or (method is None and self.is_gather(node)):
                self.groups += 1
                return self.visit_children(node, replace(ctx, group=f"parallel-{self.groups}"))
            if method is not None:
                return self.visit_step(node, method, ctx)
        if isinstance(node, ast.ListComp | ast.SetComp | ast.GeneratorExp | ast.DictComp):
            return self.visit_comp(node, ctx)
        return self.visit_children(node, ctx)

    def visit_children(self, node: ast.AST, ctx: _Ctx) -> list[str]:
        out: list[str] = []
        for child in ast.iter_child_nodes(node):
            out += self.visit(child, ctx)
        return out

    def is_gather(self, call: ast.Call) -> bool:
        return _dotted(call.func).rsplit(".", 1)[-1] == "gather" and self.has_run_call(call)

    def visit_comp(
        self, node: ast.ListComp | ast.SetComp | ast.GeneratorExp | ast.DictComp, ctx: _Ctx
    ) -> list[str]:
        saved = dict(self.env)
        out: list[str] = []
        inner = replace(ctx, fixed=(self.stmt.lineno, self.stmt.end_lineno or self.stmt.lineno))
        for gen in node.generators:
            out += self.visit(gen.iter, inner)
            deps = inner.deps | self.names_deps(gen.iter)
            self.bind(gen.target, deps)
            label = f"for each {self.seg(gen.target)} in {self.seg(gen.iter)}"
            inner = replace(inner, for_each=(*inner.for_each, label), deps=deps)
            for cond in gen.ifs:
                inner = replace(inner, conditions=(*inner.conditions, self.seg(cond)))
        elts = [node.key, node.value] if isinstance(node, ast.DictComp) else [node.elt]
        for e in elts:
            out += self.visit(e, inner)
        self.env = saved
        return out

    def visit_step(self, call: ast.Call, method: str, ctx: _Ctx) -> list[str]:
        nested: list[str] = []
        for child in [*call.args, *(k.value for k in call.keywords)]:
            nested += self.visit(child, ctx)
        deps = frozenset(nested)
        span = self.span(call, ctx)
        if method not in STEP_KINDS:  # unknown or dynamic: still a step, titled by its source
            title = _first_line(self.seg(call))
            return [self.emit("code", title, span, ctx, slug=None, extra_deps=deps, node=call)]
        kind = method
        kw = {k.arg: k.value for k in call.keywords if k.arg}
        first = call.args[0] if call.args else kw.get("type")
        key_node = kw.get("key")
        key_literal = (
            key_node.value
            if isinstance(key_node, ast.Constant) and isinstance(key_node.value, str)
            else None
        )
        brief = kw.get("brief")
        agent: str | None = None
        slug: str | None = None
        if kind == "agent":
            agent = (_text(first) if first is not None else "") or None
            brief_text = _first_line(_text(brief)) if brief is not None else ""
            title = f"{agent or 'agent'}: {brief_text}" if brief_text else (agent or "agent")
            slug = _slug(agent) if agent else None
        elif kind == "review":
            ask = kw.get("ask")
            title = _first_line(_text(ask)) if ask is not None else "Ask you"
        else:
            fallback = {
                "step": "step",
                "notify": "Tell you",
                "llm": "Ask a model",
                "tool": "tool",
                "skill": "skill",
            }
            title = _first_line(_text(first)) if first is not None else fallback[kind]
            if kind != "notify" and isinstance(first, ast.Constant):
                slug = _slug(title)
        budget_node = kw.get("budget")
        budget = (
            str(budget_node.value)
            if isinstance(budget_node, ast.Constant) and budget_node.value is not None
            else None
        )
        sid = self.emit(
            kind,
            title,
            span,
            ctx,
            slug=slug,
            key=None if key_node is None else _text(key_node),
            key_literal=key_literal,
            agent=agent,
            gets=self.seg(kw["gets"]) if "gets" in kw else None,
            budget=budget,
            brief_line=brief.lineno if brief is not None else None,
            budget_line=budget_node.lineno if budget_node is not None else None,
            extra_deps=deps,
            node=call,
        )
        return [sid]

    @staticmethod
    def span(call: ast.Call, ctx: _Ctx) -> tuple[int, int]:
        if ctx.fixed:
            return ctx.fixed
        return (ctx.start or call.lineno, call.end_lineno or call.lineno)

    def emit(
        self,
        kind: str,
        title: str,
        span: tuple[int, int],
        ctx: _Ctx,
        *,
        slug: str | None,
        key: str | None = None,
        key_literal: str | None = None,
        agent: str | None = None,
        gets: str | None = None,
        budget: str | None = None,
        brief_line: int | None = None,
        budget_line: int | None = None,
        extra_deps: frozenset[str] = frozenset(),
        node: ast.AST | None = None,
    ) -> str:
        sid = self.make_id(kind, key_literal, slug)
        reads: frozenset[str] = ctx.deps | extra_deps
        if node is not None:
            reads |= self.names_deps(node)
        after = tuple(s.id for s in self.steps if s.id in reads and s.id != sid)
        self.steps.append(
            OutlineStep(
                id=sid,
                kind=kind,
                title=title,
                lines=span,
                agent=agent,
                group=ctx.group,
                for_each="; ".join(ctx.for_each) or None,
                condition=" and ".join(ctx.conditions) or None,
                key=key,
                gets=gets,
                budget=budget,
                brief_line=brief_line,
                budget_line=budget_line,
                after=after,
            )
        )
        return sid

    def make_id(self, kind: str, key: str | None, slug: str | None) -> str:
        if key:
            base = key
        elif slug:
            base = f"{kind}:{slug}"
        else:
            self.counts[kind] = self.counts.get(kind, 0) + 1
            base = f"{kind}-{self.counts[kind]}"
        sid, n = base, 2
        while sid in self.used:
            sid = f"{base}~{n}"
            n += 1
        self.used.add(sid)
        return sid
