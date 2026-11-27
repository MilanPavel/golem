"""Ask golem: one model call that proposes a change to a workflow file (3.11.4, #1881).

``propose`` makes **one** call through the same path as ``run.llm`` (so the chat's routing, the
dispatcher ``job`` slot, the budget caps and the usage table all apply, and a local-only folder
only ever gets a local model). The model gets the ``golem.workflow`` API, the agents the folder
knows, the current file and the ask, and gives back the whole new file and a short note. The
file goes through :func:`~golem.workflows.check.check`; its problems come back with it. Nothing
is written: the editor shows the proposal and the person accepts it.
"""

from __future__ import annotations

import inspect
import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any, Literal

from golem.workflow import Run, WorkflowError
from golem.workflows.check import Problem
from golem.workflows.edit import DECORATOR, EditError, remove_argument, set_workflow_model
from golem.workflows.llm import Llm, parse_object
from golem.workflows.outline import OutlineError, outline

__all__ = [
    "Proposal",
    "ProposeError",
    "api_reference",
    "build_draft_prompt",
    "draft",
    "numbered_outline",
    "propose",
]

_FENCE = re.compile(r"^```[a-zA-Z]*\s*\n(.*?)\n```\s*$", re.DOTALL)
MAX_ASK = 4000
MAX_NOTE = 1000
MAX_ANSWER = 4000

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "kind": {
            "type": "string",
            "enum": ["answer", "change"],
            "description": "answer for a question, change for a new file.",
        },
        "answer": {
            "type": "string",
            "description": "For an answer: the reply in plain words. Leave out for a change.",
        },
        "code": {"type": "string", "description": "The whole new text of the workflow file."},
        "note": {
            "type": "string",
            "description": "One or two sentences: what changed and why.",
        },
    },
    "required": ["kind"],
}


class ProposeError(Exception):
    """No proposal could be made; the text says why."""


@dataclass(frozen=True, slots=True)
class Proposal:
    """A ``change`` (the whole new file and a note) or an ``answer`` (text, the file untouched)."""

    code: str
    note: str
    problems: list[Problem]
    model: str
    kind: Literal["answer", "change"] = "change"
    answer: str = ""


def api_reference() -> str:
    """The public ``run.*`` methods: signature and the first paragraph of the docstring."""
    lines: list[str] = []
    for name, fn in inspect.getmembers(Run, inspect.isfunction):
        if name.startswith("_"):
            continue
        params = list(inspect.signature(fn).parameters.values())[1:]
        doc = inspect.getdoc(fn) or ""
        first = doc.split("\n\n", 1)[0].replace("\n", " ").strip()
        shown = ", ".join(p.name for p in params)
        lines.append(f"run.{name}({shown}): {first}" if first else f"run.{name}({shown})")
    return "\n".join(lines)


def numbered_outline(code: str, name: str) -> str:
    """The steps of workflow ``name`` as ``1. kind: title`` lines, or "" when none can be read."""
    try:
        found = outline(code)
    except OutlineError:
        return ""
    for one in found:
        if one.name == name:
            return "\n".join(f"{n}. {s.kind}: {s.title}" for n, s in enumerate(one.steps, 1))
    return ""


def _agents_text(agents: Mapping[str, str]) -> str:
    if not agents:
        return "No agents are known in this folder: do not use run.agent."
    return "\n".join(f"- {name} (model wish: {wish})" for name, wish in sorted(agents.items()))


def build_prompt(
    code: str,
    ask: str,
    agents: Mapping[str, str],
    previous: tuple[str, str] | None,
    steps: str = "",
) -> str:
    parts = [
        "You answer questions about a golem workflow file and change it. The file is Python that"
        " uses `golem.workflow`: `@workflow()` async functions that take `run: Run` and call"
        " `run.*` steps.",
        "The step API:\n" + api_reference(),
        "Agents known in this folder (only these may be named in run.agent):\n"
        + _agents_text(agents),
        "Rules: keep what the ask does not touch. model= is a wish (cheapest, same, stronger,"
        " local ...), never a model name. Do not invent run.* methods or keyword arguments."
        " If the ask is a question (such as an explanation), do not change the file: answer it.",
        f"The current file:\n```python\n{code}\n```",
    ]
    if steps:
        parts.append(
            "The steps of the workflow, numbered as the person sees them (when you refer to a"
            ' step in an answer, write "step 3" with its number, never its line):\n' + steps
        )
    if previous is not None:
        prev_code, prev_note = previous
        parts.append(
            "You already proposed this change to that file"
            + (f" ({prev_note})" if prev_note else "")
            + f":\n```python\n{prev_code}\n```\nThe person wants one more change on top of that"
            " proposal. Answer with the whole file with both changes."
        )
    parts.append(f"The ask:\n{ask}")
    parts.append(
        "Decide what the ask is, and answer with one JSON object. A question: "
        '{"kind": "answer", "answer": <the reply in plain words, short, with "step N" for steps>}.'
        ' A request to change the file: {"kind": "change", "code": <the whole new file>, "note":'
        " <one or two sentences on what changed and why>}."
    )
    return "\n\n".join(parts)


def _unfence(text: str) -> str:
    fenced = _FENCE.match(text.strip())
    return fenced.group(1) if fenced else text


async def propose(
    *,
    llm: Llm | None,
    folder: str | None,
    code: str,
    ask: str,
    check: Callable[[str], list[Problem]],
    agents: Mapping[str, str] | None = None,
    previous: tuple[str, str] | None = None,
    steps: str = "",
) -> Proposal:
    """One model call, then a check of the answer. Raises :class:`ProposeError`."""
    if llm is None:
        raise ProposeError("no model is available to write a proposal")
    wish = ask.strip()
    if not wish:
        raise ProposeError("say what to change")
    if len(wish) > MAX_ASK:
        raise ProposeError(f"the ask is too long (at most {MAX_ASK} characters)")
    prompt = build_prompt(code, wish, agents or {}, previous, steps)
    try:
        answer = await llm(prompt, SCHEMA, "same", folder)
    except WorkflowError as exc:
        raise ProposeError(str(exc)) from exc
    except Exception as exc:
        raise ProposeError(f"no model could write a proposal: {exc}") from exc
    try:
        found = parse_object(answer.text)
    except WorkflowError as exc:
        raise ProposeError("the model did not answer with a proposal; try again") from exc
    kind = found.get("kind")
    if kind is None and "code" in found:
        kind = "change"  # An older style reply: the file and a note.
    if kind == "answer":
        said_answer = found.get("answer")
        if not isinstance(said_answer, str) or not said_answer.strip():
            raise ProposeError("the model gave no answer; try again")
        return Proposal(code, "", [], answer.model, "answer", said_answer.strip()[:MAX_ANSWER])
    if kind != "change":
        raise ProposeError("the model did not answer with a proposal; try again")
    new = found.get("code")
    note = found.get("note")
    if not isinstance(new, str) or not new.strip():
        raise ProposeError("the model gave no file; try again")
    text = _unfence(new)
    if not text.endswith("\n"):
        text += "\n"
    said = note.strip() if isinstance(note, str) else ""
    return Proposal(text, said[:MAX_NOTE], check(text), answer.model)


def build_draft_prompt(
    ask: str, function: str, title: str, agents: Mapping[str, str], model: str | None
) -> str:
    """The prompt for a new workflow file: the API, the agents, the rules and the ask."""
    model_rule = (
        f'Write @workflow(..., model="{model}") with exactly that model name.'
        if model
        else "Do not write model= on @workflow or on a step: the person did not pick a model."
    )
    parts = [
        "You write a new golem workflow file. It is Python that uses `golem.workflow`: one"
        " `@workflow(...)` async function that takes `run: Run` and calls `run.*` steps.",
        "The step API:\n" + api_reference(),
        "Agents known in this folder (only these may be named in run.agent):\n"
        + _agents_text(agents),
        "Rules:\n"
        f'- Name the function `{function}` and write `title="{title}"` in @workflow(...), and a'
        " short description= in plain words.\n"
        "- Every step has a title= in plain words that says what it does, such as"
        ' "Read the new files". Put each step on its own call.\n'
        "- A step that repeats over a list gets item= (what this one is: a file name, an"
        " address) and runs inside run.parallel with a title= for the group.\n"
        "- Leave the result with `await run.output(value, title=...)` and return it.\n"
        "- Do not write trigger=: a routine starts a workflow. Do not write wish words"
        " (cheapest, same, stronger, local) anywhere.\n"
        f"- {model_rule}\n"
        "- Anything that sends, deletes or posts something goes through `run.review` first.\n"
        "- Do not invent run.* methods or keyword arguments. Keep it short: only the steps"
        " the ask needs.",
        f"The ask:\n{ask}",
        'Answer with one JSON object: {"kind": "change", "code": <the whole file>, "note":'
        " <one or two sentences on what the steps do>}.",
    ]
    return "\n\n".join(parts)


def _rename_function(code: str, function: str) -> str:
    """The only ``@workflow`` function of ``code``, called ``function`` (its def line only)."""
    try:
        found = outline(code)
    except OutlineError:
        return code
    if len(found) != 1 or found[0].name == function:
        return code
    old = re.escape(found[0].name)
    return re.sub(rf"(def\s+){old}\b", rf"\g<1>{function}", code, count=1)


def _with_model(code: str, function: str, model: str | None) -> str:
    """``code`` with ``@workflow(model=)`` as the person picked: that name, or none at all."""
    try:
        if model:
            return set_workflow_model(code, model, function)
        return remove_argument(code, DECORATOR, "model", function)
    except EditError:
        return code


async def draft(
    *,
    llm: Llm | None,
    folder: str | None,
    ask: str,
    function: str,
    title: str,
    check: Callable[[str], list[Problem]],
    agents: Mapping[str, str] | None = None,
    model: str | None = None,
) -> Proposal:
    """One model call that writes a whole new file from a few sentences, then a check.

    ``model`` is the model the person picked: it writes the file, and it is the workflow's
    ``model=``. Without one golem's default model writes it and the file names no model.
    Nothing is written to disk. Raises :class:`ProposeError`.
    """
    if llm is None:
        raise ProposeError("no model is available to write a proposal")
    wish = ask.strip()
    if not wish:
        raise ProposeError("say what the workflow should do")
    if len(wish) > MAX_ASK:
        raise ProposeError(f"the ask is too long (at most {MAX_ASK} characters)")
    prompt = build_draft_prompt(wish, function, title, agents or {}, model)
    try:
        answer = await llm(prompt, SCHEMA, model, folder)
    except WorkflowError as exc:
        raise ProposeError(str(exc)) from exc
    except Exception as exc:
        raise ProposeError(f"no model could write a proposal: {exc}") from exc
    try:
        found = parse_object(answer.text)
    except WorkflowError as exc:
        raise ProposeError("the model did not answer with a workflow; try again") from exc
    new = found.get("code")
    note = found.get("note")
    if found.get("kind", "change") != "change" or not isinstance(new, str) or not new.strip():
        raise ProposeError("the model did not write a workflow; try again")
    text = _unfence(new)
    if not text.endswith("\n"):
        text += "\n"
    text = _with_model(_rename_function(text, function), function, model)
    said = note.strip() if isinstance(note, str) else ""
    return Proposal(text, said[:MAX_NOTE], check(text), answer.model)
