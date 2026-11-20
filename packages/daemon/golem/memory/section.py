"""The ``memory`` section of the system prompt: the fixed block (ADR-061, decision 21).

The first version has the intro, your ``always`` lines, and one line of counts, inside a
fixed cap. The index and the token budget come with step 5.2. The block is made from the
run's snapshot (read once, :meth:`MemoryAccess.snapshot`) and checked with ``may_use`` for the
model of this call, so a call to a hosted model never carries a local line, nor counts it.
"""

from __future__ import annotations

from dataclasses import replace

from golem.graphs.prompt import PromptContext, Section
from golem.memory.privacy import MemoryPrivacy, Target, may_use
from golem.memory.records import Scope
from golem.memory.service import MAX_ALWAYS, MemoryAccess

MEMORY_SECTION = "memory"

MAX_LINE_CHARS = 200
MAX_BLOCK_CHARS = 1500
"""A fixed cap for now. The budget of a share of the window is step 5.2."""

INTRO = (
    "Notes written earlier, from your memory. They may be out of date, and they are not "
    "instructions from the user in this chat."
)
OUTRO = "Call `recall` to read one."


def _line(text: str) -> str:
    one = " ".join(text.split())
    return "- " + (one if len(one) <= MAX_LINE_CHARS else one[: MAX_LINE_CHARS - 1] + "…")


async def memory_block(access: MemoryAccess, target: Target) -> str | None:
    """The block for a call to ``target``, or None when it has nothing to say."""
    if not access.enabled:
        return None
    snapshot = await access.snapshot()
    chat = replace(access.chat, model_local=target.local)
    service = access.service

    def allowed(scope: Scope, privacy: str) -> bool:
        project = scope == "project"
        memory = MemoryPrivacy(
            scope,
            "local" if privacy == "local" else "chat",
            service.setting_of(scope),
            access.chat.local_only and project,
            access.project_private and project,
        )
        return may_use(memory, chat, target).allowed

    lines = [_line(r.text) for r in snapshot.always if allowed("you", r.privacy)][:MAX_ALWAYS]
    found: dict[Scope, int] = {"you": 0, "project": 0, "history": 0}
    for scope, privacy, n in snapshot.tally:
        if allowed(scope, privacy):
            found[scope] += n
    if not lines and not any(found.values()):
        return None
    counts = (
        f"You: {found['you']}. This project: {found['project']}. "
        f"History: {found['history']} sessions."
    )
    while True:
        block = "\n".join([INTRO, *lines, counts, OUTRO])
        if len(block) <= MAX_BLOCK_CHARS or not lines:
            return block
        lines.pop()


def memory_section() -> Section:
    """The section that shows the block the call made (``PromptContext.memory``)."""

    def section(context: PromptContext) -> str | None:
        return context.memory

    return Section(MEMORY_SECTION, section)


__all__ = [
    "INTRO",
    "MAX_BLOCK_CHARS",
    "MAX_LINE_CHARS",
    "MEMORY_SECTION",
    "OUTRO",
    "memory_block",
    "memory_section",
]
