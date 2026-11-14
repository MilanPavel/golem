"""The skill index: one line per skill the model may load, in the system prompt.

It is the first level of progressive disclosure ([Skills](docs/architecture/skills.md)):
the model reads a name and a description for each skill, and the body only
when it asks for it. The index follows the pinned bodies in the prompt.

A skill is listed when the session can use it and its frontmatter does not say
``disable-model-invocation: true``. The order never changes between calls:
project skills, then user, then bundled, each by name. That keeps the prompt
the same from call to call, so a provider's prompt cache still hits.

``[skills] index_budget`` caps the characters of the lines. The first skill
that does not fit, and every skill after it, is dropped. ``skill.list`` says
which ones with ``indexed: false``.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from golem.graphs.prompt import PromptContext, Section
from golem.skills.registry import Listed, Origin, SkillRegistry, SkillView

INDEX_SECTION = "skill_index"

INDEX_INTRO = (
    "These skills are available. When a task fits one, call load_skill with its name "
    "before you start."
)

MAX_DESCRIPTION = 250
"""A longer description is cut here, so one skill cannot use up the budget."""

_ORIGIN_ORDER: dict[Origin, int] = {"project": 0, "user": 1, "bundled": 2}


@dataclass(frozen=True, slots=True)
class Index:
    """The entries that fit the budget, and the ones dropped for it."""

    entries: tuple[Listed, ...]
    dropped: tuple[Listed, ...]

    @property
    def lines(self) -> list[str]:
        return [index_line(entry) for entry in self.entries]


def index_line(entry: Listed) -> str:
    """``- name: description``, on one line, with the description cut at 250 characters."""
    description = " ".join(entry.skill.description.split())
    if len(description) > MAX_DESCRIPTION:
        description = description[: MAX_DESCRIPTION - 1].rstrip() + "…"
    return f"- {entry.skill.name}: {description}" if description else f"- {entry.skill.name}"


def build_index(view: SkillView, budget: int) -> Index:
    """The skills of ``view`` the model may load, in index order, cut to ``budget`` characters."""
    candidates = sorted(
        (entry for entry in view.listed if entry.usable and entry.skill.model_invocable),
        key=lambda entry: (_ORIGIN_ORDER[entry.origin], entry.skill.name),
    )
    kept: list[Listed] = []
    used = 0
    for position, entry in enumerate(candidates):
        cost = len(index_line(entry)) + 1
        if used + cost > budget:
            return Index(tuple(kept), tuple(candidates[position:]))
        used += cost
        kept.append(entry)
    return Index(tuple(kept), ())


def index_section(registry: SkillRegistry) -> Section:
    """The system prompt part with the skill index, or nothing when no skill is listed."""

    def section(context: PromptContext) -> str | None:
        view = registry.view(None if context.cwd is None else Path(context.cwd))
        lines = build_index(view, registry.index_budget).lines
        if not lines:
            return None
        return "\n".join([INDEX_INTRO, *lines])

    return Section(INDEX_SECTION, section)


__all__ = [
    "INDEX_INTRO",
    "INDEX_SECTION",
    "MAX_DESCRIPTION",
    "Index",
    "build_index",
    "index_line",
    "index_section",
]
