"""Run again from a step: can the saved results before a step still be trusted?

A run started again from step ``k`` takes the saved results of the steps before ``k`` and runs
``k`` and what follows it. That is only honest while the code before ``k`` is the code that made
those results, so the lines of the file above the step are hashed in the old text and in the
file as it is now, and a difference is a refusal with the reason.
"""

from __future__ import annotations

import hashlib

from golem.workflows.outline import OutlineError, OutlineStep, outline

__all__ = ["code_changed_before"]


def _step_start(text: str, name: str, kind: str, title: str) -> int | None:
    """The first line of the step of ``kind`` titled ``title`` in workflow ``name``, or None."""
    try:
        found = outline(text)
    except OutlineError:
        return None
    for one in found:
        if one.name != name:
            continue
        steps: list[OutlineStep] = [s for s in one.steps if s.kind == kind]
        wanted = title.strip().lower()
        for step in steps:
            if step.title.strip().lower() == wanted:
                return step.lines[0]
    return None


def _digest(lines: list[str]) -> str:
    return hashlib.sha256("\n".join(line.rstrip() for line in lines).encode()).hexdigest()


def code_changed_before(
    old_text: str | None, new_text: str, name: str, kind: str, title: str
) -> str | None:
    """Why the saved results before a step cannot be taken over, or None when they can.

    ``old_text`` is the file as the old run ran it (None when it was not kept)."""
    if old_text is None:
        return f"the file changed since that run, and its old text was not kept to compare {title}"
    if old_text == new_text:
        return None
    start = _step_start(old_text, name, kind, title)
    if start is None:
        return f"{title} cannot be found in the file of that run"
    before_old = old_text.splitlines()[: start - 1]
    before_new = new_text.splitlines()[: start - 1]
    if len(before_new) == len(before_old) and _digest(before_old) == _digest(before_new):
        return None
    return f"the code before {title} changed since that run (above line {start})"
