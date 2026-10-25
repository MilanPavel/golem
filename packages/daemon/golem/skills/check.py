"""``golem skills check <path>``: validate skills before sharing them, with no daemon.

``path`` is a skill folder, its ``SKILL.md``, or a folder of skill folders
(such as ``.agents/skills``). Errors fail the check; warnings do not.
"""

from __future__ import annotations

from pathlib import Path

from golem.skills.model import SKILL_FILE, Skill
from golem.skills.parse import parse_skill


def check_skills(path: Path) -> tuple[str, bool]:
    """The report to print, and whether every skill found is valid."""
    if path.name == SKILL_FILE and path.is_file():
        path = path.parent
    if not path.is_dir():
        return f"{path}: no such folder", False
    if (path / SKILL_FILE).is_file():
        skills = [parse_skill(path)]
    else:
        skills = [
            parse_skill(child)
            for child in sorted(path.iterdir())
            if child.is_dir() and (child / SKILL_FILE).is_file()
        ]
    if not skills:
        return f"{path}: no {SKILL_FILE} here, and no skill folders inside", False
    lines = [line for skill in skills for line in _report(skill)]
    broken = sum(not skill.valid for skill in skills)
    if len(skills) > 1:
        count = f"{len(skills)} skills"
        lines += ["", f"{count}, {broken} broken" if broken else f"{count}, all valid"]
    return "\n".join(lines), broken == 0


def _report(skill: Skill) -> list[str]:
    mark = "✘" if skill.errors else "!" if skill.warnings else "✔"
    # The folder name, not `name`: a mismatched `name` is the error being reported.
    lines = [f"{mark} {skill.path.name}  {skill.path}"]
    lines += [f"    error: {error}" for error in skill.errors]
    lines += [f"    warning: {warning}" for warning in skill.warnings]
    return lines


__all__ = ["check_skills"]
