"""The skills that ship with golem: where they are found, and that they are valid."""

from __future__ import annotations

from pathlib import Path

from golem.config import SkillSettings
from golem.skills.bundled import bundled_skills_dir
from golem.skills.check import check_skills
from golem.skills.registry import SkillRegistry

REPO = Path(__file__).resolve().parents[3]


def test_a_checkout_uses_the_repo_skills_folder() -> None:
    assert bundled_skills_dir(frozen=False) == REPO / "skills"


def test_a_release_build_uses_the_folder_next_to_the_daemon(tmp_path: Path) -> None:
    daemon = tmp_path / "golem-daemon"
    daemon.touch()
    assert bundled_skills_dir(frozen=True, executable=daemon) is None
    (tmp_path / "skills").mkdir()
    assert bundled_skills_dir(frozen=True, executable=daemon) == tmp_path.resolve() / "skills"


def test_every_bundled_skill_passes_the_check() -> None:
    report, ok = check_skills(REPO / "skills")
    assert ok, report


def test_a_user_skill_hides_the_bundled_one_of_the_same_name(tmp_path: Path) -> None:
    bundled = REPO / "skills"
    name = sorted(path.name for path in bundled.iterdir() if (path / "SKILL.md").is_file())[0]
    home = tmp_path / "home"
    user = home / ".golem" / "skills" / name
    user.mkdir(parents=True)
    (user / "SKILL.md").write_text(f"---\nname: {name}\ndescription: Mine.\n---\nMine\n")
    registry = SkillRegistry(
        SkillSettings(), golem_skills=home / ".golem" / "skills", user_home=home, bundled=bundled
    )

    view = registry.view(tmp_path)

    skill = view.get(name)
    assert skill is not None
    assert skill.description == "Mine."
    shadowed = [
        entry for entry in view.listed if entry.origin == "bundled" and entry.skill.name == name
    ]
    assert [entry.shadowed_by for entry in shadowed] == [user.resolve()]
