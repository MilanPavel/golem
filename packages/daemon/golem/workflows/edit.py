"""Change one argument of one step in a workflow's source, and nothing else (#1882).

``set_argument`` finds the ``run.*`` call of a step with the same ``ast`` the outline uses and
splices its source text: the exact span of the argument is replaced, or ``name=value`` is added
before the call's closing parenthesis. Comments, blank lines and formatting outside that span
stay byte for byte. No new dependency, no import of the file, no model.
"""

from __future__ import annotations

import ast
import io
import json
import re
import tokenize

from golem.agents.model import WISHES
from golem.workflows.outline import (
    KEYWORD_ONLY,
    PARAMS,
    Builder,
    OutlineError,
    OutlineStep,
    builders,
)

_MONEY = re.compile(r"^\$?\s*(\d+(\.\d*)?|\.\d+)$")
_NO_EMPTY = frozenset({"type", "brief", "key", "name", "ask", "prompt", "text"})

Pos = tuple[int, int]


class EditError(ValueError):
    """The argument cannot be changed this way; the message says why, in plain words."""


def _literal(name: str, value: str | float | bool) -> str:
    """The source text of ``value`` as the literal of argument ``name``, or raise."""
    if name == "budget":
        if isinstance(value, bool):
            raise EditError('budget is money text such as "$0.50"')
        shown = value.strip() if isinstance(value, str) else f"{value:g}"
        if isinstance(value, str) and not _MONEY.match(shown):
            raise EditError(f'budget is money text such as "$0.50"; got {value!r}')
        if float(shown.removeprefix("$").strip()) <= 0:
            raise EditError("budget must be more than $0")
        return json.dumps(shown, ensure_ascii=False) if isinstance(value, str) else shown
    if not isinstance(value, str):
        raise EditError(f"{name} is text")
    if name == "model" and value not in WISHES:
        raise EditError(f"model is a wish, one of {', '.join(WISHES)}; got {value!r}")
    if name in _NO_EMPTY and not value.strip():
        raise EditError(f"{name} cannot be empty")
    if "\x00" in value:
        raise EditError(f"{name} cannot hold a null character")
    return json.dumps(value, ensure_ascii=False)


def _find(
    code: str, step_id: str, workflow: str | None
) -> tuple[Builder, OutlineStep, ast.Call | None]:
    try:
        found = builders(code)
    except OutlineError as exc:
        raise EditError(f"the code cannot be read: {exc}") from exc
    for b in found:
        if workflow is not None and b.fn.name != workflow:
            continue
        for step in b.build().steps:
            if step.id == step_id:
                return b, step, b.nodes.get(step_id)
    raise EditError(f"no step {step_id}")


def set_argument(
    code: str,
    step_id: str,
    name: str,
    value: str | float | bool,
    workflow: str | None = None,
) -> str:
    """``code`` with argument ``name`` of step ``step_id`` set to ``value``.

    ``workflow`` names the ``@workflow`` function when a file has several. Raises
    :class:`EditError` for an unknown step, a code step, a name the step does not take, an
    argument the code computes ("set in code") and a value that is not valid for it.
    """
    builder, step, call = _find(code, step_id, workflow)
    if call is None or step.kind == "code":
        raise EditError("a code step has no fields; its function opens in the code pane")
    present = {a.name: a for a in step.args}
    if (
        name not in (*PARAMS.get(step.kind, ()), *KEYWORD_ONLY.get(step.kind, ()))
        and name not in present
    ):
        raise EditError(f"a {step.kind} step has no argument {name}")
    text = _literal(name, value)
    lines = builder.raw
    arg = present.get(name)
    if arg is not None:
        if not arg.literal:
            raise EditError(f"{name} is computed ({arg.source}); set in code")
        return _splice(lines, (arg.line, arg.col), (arg.end_line, arg.end_col), text)
    at, trailing = _closing(code, builder, call)
    if not call.args and not call.keywords:
        return _splice(lines, at, at, f"{name}={text}")
    return _splice(lines, at, at, f" {name}={text}," if trailing else f", {name}={text}")


def _splice(lines: list[str], start: Pos, end: Pos, text: str) -> str:
    head = "".join(lines[: start[0] - 1]) + lines[start[0] - 1][: start[1]]
    tail = lines[end[0] - 1][end[1] :] + "".join(lines[end[0] :])
    return head + text + tail


def _closing(code: str, builder: Builder, call: ast.Call) -> tuple[Pos, bool]:
    """Where a new argument goes in ``call``: just after the last token before its closing
    parenthesis (comments and line breaks skipped), and whether that token is a comma."""
    end_line = call.end_lineno or call.lineno
    close = (end_line, builder.char_col(end_line, (call.end_col_offset or 1) - 1))
    prev: tokenize.TokenInfo | None = None
    try:
        for tok in tokenize.generate_tokens(io.StringIO(code, newline="").readline):
            if tok.start >= close:
                break
            if tok.type not in (tokenize.NL, tokenize.COMMENT, tokenize.NEWLINE, tokenize.INDENT):
                prev = tok
    except (tokenize.TokenError, IndentationError, SyntaxError) as exc:
        raise EditError("the call cannot be edited") from exc
    if prev is None:
        raise EditError("the call cannot be edited")
    return prev.end, prev.string == ","
