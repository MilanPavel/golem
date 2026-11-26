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
from typing import Any

from golem.workflow import Run, WorkflowError
from golem.workflows.check import Problem
from golem.workflows.llm import Llm, parse_object

__all__ = ["Proposal", "ProposeError", "api_reference", "propose"]

_FENCE = re.compile(r"^```[a-zA-Z]*\s*\n(.*?)\n```\s*$", re.DOTALL)
MAX_ASK = 4000
MAX_NOTE = 1000

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "code": {"type": "string", "description": "The whole new text of the workflow file."},
        "note": {
            "type": "string",
            "description": "One or two sentences: what changed and why.",
        },
    },
    "required": ["code", "note"],
}


class ProposeError(Exception):
    """No proposal could be made; the text says why."""


@dataclass(frozen=True, slots=True)
class Proposal:
    code: str
    note: str
    problems: list[Problem]
    model: str


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


def _agents_text(agents: Mapping[str, str]) -> str:
    if not agents:
        return "No agents are known in this folder: do not use run.agent."
    return "\n".join(f"- {name} (model wish: {wish})" for name, wish in sorted(agents.items()))


def build_prompt(
    code: str,
    ask: str,
    agents: Mapping[str, str],
    previous: tuple[str, str] | None,
) -> str:
    parts = [
        "You change a golem workflow file. The file is Python that uses `golem.workflow`:"
        " `@workflow()` async functions that take `run: Run` and call `run.*` steps.",
        "The step API:\n" + api_reference(),
        "Agents known in this folder (only these may be named in run.agent):\n"
        + _agents_text(agents),
        "Rules: keep what the ask does not touch. model= is a wish (cheapest, same, stronger,"
        " local ...), never a model name. Do not invent run.* methods or keyword arguments."
        " If the ask is a question (such as an explanation), give the file back unchanged and"
        " answer in the note.",
        f"The current file:\n```python\n{code}\n```",
    ]
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
        'Answer with one JSON object: {"code": <the whole new file>, "note": <one or two'
        " sentences on what changed and why>}."
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
) -> Proposal:
    """One model call, then a check of the answer. Raises :class:`ProposeError`."""
    if llm is None:
        raise ProposeError("no model is available to write a proposal")
    wish = ask.strip()
    if not wish:
        raise ProposeError("say what to change")
    if len(wish) > MAX_ASK:
        raise ProposeError(f"the ask is too long (at most {MAX_ASK} characters)")
    prompt = build_prompt(code, wish, agents or {}, previous)
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
    new = found.get("code")
    note = found.get("note")
    if not isinstance(new, str) or not new.strip():
        raise ProposeError("the model gave no file; try again")
    text = _unfence(new)
    if not text.endswith("\n"):
        text += "\n"
    said = note.strip() if isinstance(note, str) else ""
    return Proposal(text, said[:MAX_NOTE], check(text), answer.model)
