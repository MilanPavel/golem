"""The skill index in the system prompt: which skills it lists, in what order, and the budget."""

from __future__ import annotations

from pathlib import Path

from golem.config import SkillSettings
from golem.graphs.prompt import PromptContext, SystemPrompt
from golem.skills.index import INDEX_INTRO, MAX_DESCRIPTION, build_index, index_section
from golem.skills.pinned import pinned_section
from golem.skills.registry import SkillRegistry, listed_skill


def _skill(parent: Path, name: str, description: str, frontmatter: str = "") -> None:
    folder = parent / name
    folder.mkdir(parents=True)
    (folder / "SKILL.md").write_text(
        f"---\nname: {name}\ndescription: {description}\n{frontmatter}---\nBody of {name}\n",
        "utf-8",
    )


def _registry(tmp_path: Path, settings: SkillSettings | None = None) -> SkillRegistry:
    return SkillRegistry(
        settings or SkillSettings(),
        golem_skills=tmp_path / "home" / ".golem" / "skills",
        user_home=tmp_path / "home",
        bundled=tmp_path / "bundled",
    )


def _world(tmp_path: Path) -> Path:
    project = tmp_path / "project"
    project.mkdir()
    _skill(project / ".golem" / "skills", "zebra", "Project zebra.")
    _skill(project / ".golem" / "skills", "alpha", "Project alpha.")
    _skill(tmp_path / "home" / ".golem" / "skills", "mid", "User mid.")
    _skill(tmp_path / "home" / ".golem" / "skills", "alpha", "User alpha, shadowed.")
    _skill(tmp_path / "bundled", "basics", "Bundled basics.")
    return project


def _prompt(registry: SkillRegistry, cwd: Path, pinned: tuple[str, ...] = ()) -> str:
    prompt = SystemPrompt(sections=(pinned_section(registry), index_section(registry)))
    return prompt.text(PromptContext(state={}, cwd=str(cwd), pinned=pinned))


def test_index_snapshot_orders_project_user_bundled_then_by_name(tmp_path: Path) -> None:
    project = _world(tmp_path)

    assert _prompt(_registry(tmp_path), project) == (
        f"{INDEX_INTRO}\n"
        "- alpha: Project alpha.\n"
        "- zebra: Project zebra.\n"
        "- mid: User mid.\n"
        "- basics: Bundled basics."
    )


def test_index_follows_the_pinned_bodies(tmp_path: Path) -> None:
    project = _world(tmp_path)

    text = _prompt(_registry(tmp_path), project, pinned=("mid",))

    assert text.index('<skill name="mid">') < text.index(INDEX_INTRO)


def test_a_skill_the_model_may_not_load_is_absent(tmp_path: Path) -> None:
    project = tmp_path / "project"
    project.mkdir()
    _skill(project / ".golem" / "skills", "ship", "Ship it.", "disable-model-invocation: true\n")
    _skill(project / ".golem" / "skills", "notes", "Write notes.")

    text = _prompt(_registry(tmp_path), project)

    assert "- notes: Write notes." in text
    assert "ship" not in text


def test_disabled_broken_and_shadowed_skills_are_absent(tmp_path: Path) -> None:
    project = _world(tmp_path)
    (project / ".golem" / "skills" / "bad").mkdir()
    (project / ".golem" / "skills" / "bad" / "SKILL.md").write_text("---\nname: Bad\n---\nx\n")

    text = _prompt(_registry(tmp_path, SkillSettings(disabled=["mid"])), project)

    assert "mid" not in text
    assert "shadowed" not in text
    assert "bad" not in text.lower().replace("basics", "")


def test_no_skills_means_no_index(tmp_path: Path) -> None:
    empty = tmp_path / "project"
    empty.mkdir()

    assert _prompt(_registry(tmp_path), empty) == ""


def test_the_index_is_read_again_for_each_call(tmp_path: Path) -> None:
    project = _world(tmp_path)
    registry = _registry(tmp_path)
    assert "- late:" not in _prompt(registry, project)

    _skill(project / ".golem" / "skills", "late", "Added later.")

    assert "- late: Added later." in _prompt(registry, project)


def test_a_long_description_is_cut_and_stays_on_one_line(tmp_path: Path) -> None:
    project = tmp_path / "project"
    project.mkdir()
    _skill(project / ".golem" / "skills", "wordy", "word " * 200)

    line = _prompt(_registry(tmp_path), project).splitlines()[1]

    assert line.startswith("- wordy: word word")
    assert line.endswith("…")
    assert len(line) == len("- wordy: ") + MAX_DESCRIPTION


def test_skills_over_the_budget_are_dropped_in_order_and_flagged(tmp_path: Path) -> None:
    project = _world(tmp_path)
    # "- alpha: Project alpha.\n" is 24 characters and "- zebra: Project zebra.\n" is 24.
    registry = _registry(tmp_path, SkillSettings(index_budget=60))

    index = build_index(registry.view(project), registry.index_budget)

    assert [entry.skill.name for entry in index.entries] == ["alpha", "zebra"]
    assert [entry.skill.name for entry in index.dropped] == ["mid", "basics"]
    assert "mid" not in _prompt(registry, project)
    flagged = {
        (entry.skill.name, entry.origin): listed_skill(
            entry, indexed=entry in index.entries
        ).indexed
        for entry in registry.view(project).listed
    }
    assert flagged[("alpha", "project")] is True
    assert flagged[("mid", "user")] is False
    assert flagged[("alpha", "user")] is False
