"""golem skills check: one skill, its SKILL.md, or a folder of skills, with no daemon."""

from __future__ import annotations

from pathlib import Path

import pytest

from golem.cli import main
from golem.skills.check import check_skills

REPO_SKILLS = Path(__file__).resolve().parents[3] / ".agents" / "skills"


def _skill(parent: Path, name: str, frontmatter: str) -> Path:
    folder = parent / name
    folder.mkdir(parents=True)
    (folder / "SKILL.md").write_text(f"---\n{frontmatter}---\nBody\n", encoding="utf-8")
    return folder


def test_this_repos_skills_pass() -> None:
    report, ok = check_skills(REPO_SKILLS / "ship")

    assert ok
    assert report == f"✔ ship  {REPO_SKILLS / 'ship'}"


def test_the_skill_file_itself_can_be_named(tmp_path: Path) -> None:
    folder = _skill(tmp_path, "pdf", "description: Fill PDF forms.\n")

    report, ok = check_skills(folder / "SKILL.md")

    assert ok
    assert report == f"✔ pdf  {folder}"


def test_a_folder_of_skills_reports_each_and_fails_on_a_broken_one(tmp_path: Path) -> None:
    good = _skill(tmp_path, "pdf", "description: Fill PDF forms.\n")
    warned = _skill(tmp_path, "notes", "description: Notes.\ncontext: fork\n")
    broken = _skill(tmp_path, "broken", "name: other\ndescription: x\n")
    (tmp_path / "not-a-skill").mkdir()

    report, ok = check_skills(tmp_path)

    assert not ok
    assert report.splitlines() == [
        f"✘ broken  {broken}",
        "    error: `name` is 'other' but the folder is 'broken': they must match",
        f"! notes  {warned}",
        "    warning: `context` is not supported yet, so it is ignored",
        f"✔ pdf  {good}",
        "",
        "3 skills, 1 broken",
    ]


def test_warnings_alone_pass(tmp_path: Path) -> None:
    folder = _skill(tmp_path, "notes", "description: Notes.\nhooks: {}\n")

    assert check_skills(folder)[1]


def test_nothing_to_check_fails(tmp_path: Path) -> None:
    assert check_skills(tmp_path) == (
        f"{tmp_path}: no SKILL.md here, and no skill folders inside",
        False,
    )
    assert check_skills(tmp_path / "missing") == (f"{tmp_path / 'missing'}: no such folder", False)


def test_the_command_exits_one_on_errors(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    broken = _skill(tmp_path, "broken", "description: [unclosed\n")

    assert main(["skills", "check", str(broken)]) == 1
    assert capsys.readouterr().out.startswith(f"✘ broken  {broken}\n    error: the frontmatter")
    assert main(["skills", "check", str(REPO_SKILLS)]) == 0
