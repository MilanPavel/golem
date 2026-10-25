"""The skill registry: which folders are read, in what order, and which skill each name means."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from golem.config import SkillSettings
from golem.skills.registry import SkillRegistry

REPO = Path(__file__).resolve().parents[3]


@dataclass
class _Layout:
    home: Path
    golem_skills: Path
    project: Path

    def registry(
        self, settings: SkillSettings | None = None, *, bundled: Path | None = None
    ) -> SkillRegistry:
        return SkillRegistry(
            settings or SkillSettings(),
            golem_skills=self.golem_skills,
            user_home=self.home,
            bundled=bundled,
        )


def _layout(tmp_path: Path) -> _Layout:
    home = tmp_path / "home"
    project = tmp_path / "project"
    home.mkdir()
    project.mkdir()
    return _Layout(home=home, golem_skills=home / ".golem" / "skills", project=project)


def _skill(parent: Path, name: str, description: str = "Does a thing.") -> Path:
    folder = parent / name
    folder.mkdir(parents=True)
    (folder / "SKILL.md").write_text(f"---\nname: {name}\ndescription: {description}\n---\nBody\n")
    return folder


def test_sources_are_project_then_user_then_bundled(tmp_path: Path) -> None:
    layout = _layout(tmp_path)
    settings = SkillSettings(extra_dirs=["~/team-skills", "/opt/skills"])
    registry = layout.registry(settings, bundled=tmp_path / "bundled")

    sources = [(s.origin, s.path) for s in registry.sources(layout.project)]

    assert sources == [
        ("project", layout.project / ".golem/skills"),
        ("project", layout.project / ".agents/skills"),
        ("project", layout.project / ".claude/skills"),
        ("user", layout.golem_skills),
        ("user", layout.home / ".agents/skills"),
        ("user", layout.home / ".claude/skills"),
        ("user", layout.home / "team-skills"),
        ("user", Path("/opt/skills")),
        ("bundled", tmp_path / "bundled"),
    ]


def test_without_a_folder_only_user_skills_are_read(tmp_path: Path) -> None:
    layout = _layout(tmp_path)

    assert {s.origin for s in layout.registry().sources(None)} == {"user"}


def test_claude_dirs_off_skips_both_claude_folders(tmp_path: Path) -> None:
    layout = _layout(tmp_path)
    _skill(layout.home / ".claude/skills", "mine")
    _skill(layout.project / ".claude/skills", "theirs")
    registry = layout.registry(SkillSettings(claude_dirs=False))

    assert ".claude" not in str(registry.sources(layout.project))
    assert registry.view(layout.project).listed == ()


def test_no_folders_no_skills(tmp_path: Path) -> None:
    layout = _layout(tmp_path)

    assert layout.registry().view(layout.project).listed == ()


def test_a_project_skill_shadows_a_user_skill_and_both_are_listed(tmp_path: Path) -> None:
    layout = _layout(tmp_path)
    mine = _skill(layout.golem_skills, "pdf", "Mine.")
    theirs = _skill(layout.project / ".agents/skills", "pdf", "The project's.")

    view = layout.registry().view(layout.project)

    assert [(e.skill.path, e.origin, e.shadowed_by) for e in view.listed] == [
        (theirs, "project", None),
        (mine, "user", theirs),
    ]
    found = view.get("pdf")
    assert found is not None
    assert found.description == "The project's."


def test_another_folder_sees_only_its_own_project_skills(tmp_path: Path) -> None:
    layout = _layout(tmp_path)
    _skill(layout.project / ".agents/skills", "pdf")
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    registry = layout.registry()

    assert registry.view(layout.project).get("pdf") is not None
    assert registry.view(elsewhere).get("pdf") is None


def test_this_repos_claude_skills_link_does_not_list_skills_twice() -> None:
    registry = SkillRegistry(
        SkillSettings(), golem_skills=REPO / "missing", user_home=REPO / "missing"
    )

    view = registry.view(REPO)

    names = [entry.skill.name for entry in view.listed]
    assert sorted(names) == ["setup", "ship"]
    assert all(entry.skill.path.parent == REPO / ".agents/skills" for entry in view.listed)


def test_a_symlinked_skill_is_found_and_counted_once(tmp_path: Path) -> None:
    layout = _layout(tmp_path)
    target = _skill(tmp_path / "elsewhere", "notes")
    for folder in (".agents/skills", ".claude/skills"):
        (layout.home / folder).mkdir(parents=True)
        (layout.home / folder / "notes").symlink_to(target)

    view = layout.registry().view(None)

    assert len(view.listed) == 1
    entry = view.listed[0]
    assert entry.skill.path == layout.home / ".agents/skills/notes"
    assert entry.skill.real_path == target.resolve()
    assert entry.shadowed_by is None


def test_a_disabled_skill_is_listed_but_not_usable(tmp_path: Path) -> None:
    layout = _layout(tmp_path)
    _skill(layout.golem_skills, "pdf")
    _skill(layout.golem_skills, "notes")

    view = layout.registry(SkillSettings(disabled=["pdf"])).view(None)

    assert [(e.skill.name, e.disabled) for e in view.listed] == [("notes", False), ("pdf", True)]
    assert view.get("pdf") is None
    assert [skill.name for skill in view.usable()] == ["notes"]


def test_a_broken_skill_does_not_hide_a_working_one(tmp_path: Path) -> None:
    layout = _layout(tmp_path)
    broken = layout.project / ".agents/skills/pdf"
    broken.mkdir(parents=True)
    (broken / "SKILL.md").write_text("---\ndescription: [unclosed\n---\n")
    working = _skill(layout.golem_skills, "pdf", "Works.")

    view = layout.registry().view(layout.project)

    found = view.get("pdf")
    assert found is not None
    assert found.path == working
    first = view.listed[0]
    assert first.skill.path == broken
    assert first.skill.errors
    assert first.shadowed_by == working


def test_folders_that_are_not_skills_are_skipped(tmp_path: Path) -> None:
    layout = _layout(tmp_path)
    _skill(layout.golem_skills, "pdf")
    _skill(layout.golem_skills, "_proposed")
    _skill(layout.golem_skills, ".hidden")
    (layout.golem_skills / "no-skill-file").mkdir()
    (layout.golem_skills / "README.md").write_text("not a skill")

    view = layout.registry().view(None)

    assert [entry.skill.name for entry in view.listed] == ["pdf"]


def test_bundled_skills_come_last(tmp_path: Path) -> None:
    layout = _layout(tmp_path)
    bundled = tmp_path / "bundled"
    _skill(bundled, "pdf", "Bundled.")
    _skill(bundled, "authoring", "Bundled too.")
    _skill(layout.golem_skills, "pdf", "Mine.")

    view = layout.registry(bundled=bundled).view(None)

    assert [(e.skill.name, e.origin, e.shadowed_by is None) for e in view.listed] == [
        ("pdf", "user", True),
        ("authoring", "bundled", True),
        ("pdf", "bundled", False),
    ]
