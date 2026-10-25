"""Skills reload without a restart: stamps, the cache, `[skills]` in config.toml, the notice."""

from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass, field
from pathlib import Path

import pytest
from pydantic import BaseModel

from golem.config import load_settings
from golem.skills import parse
from golem.skills.model import Skill
from golem.skills.registry import SkillRegistry
from golem_protocol.rpc import SkillRegistryChangedNotification


@dataclass
class _Setup:
    home: Path
    golem_home: Path
    project: Path
    sent: list[BaseModel] = field(default_factory=list[BaseModel])

    @property
    def golem_skills(self) -> Path:
        return self.golem_home / "skills"

    @property
    def config(self) -> Path:
        return self.golem_home / "config.toml"

    def registry(self, reload_seconds: float = 2.0) -> SkillRegistry:
        golem_home = self.golem_home
        return SkillRegistry(
            load_settings(home=golem_home, project_dir=golem_home).skills,
            golem_skills=self.golem_skills,
            user_home=self.home,
            config_file=self.config,
            load_settings=lambda: load_settings(home=golem_home, project_dir=golem_home).skills,
            broadcast=self.sent.append,
            reload_seconds=reload_seconds,
        )

    def roots(self) -> list[str | None]:
        return [n.params.root for n in self.sent if isinstance(n, SkillRegistryChangedNotification)]


@pytest.fixture
def setup(tmp_path: Path) -> _Setup:
    home = tmp_path / "home"
    project = tmp_path / "project"
    (home / ".golem").mkdir(parents=True)
    project.mkdir()
    return _Setup(home=home, golem_home=home / ".golem", project=project)


def _write(path: Path, text: str) -> None:
    """Write and move the mtime a second on, so a stamp always changes."""
    path.parent.mkdir(parents=True, exist_ok=True)
    before = path.stat().st_mtime_ns if path.exists() else 0
    path.write_text(text)
    later = max(path.stat().st_mtime_ns, before + 1_000_000_000)
    os.utime(path, ns=(later, later))


def _skill(parent: Path, name: str, description: str = "Does a thing.") -> Path:
    _write(parent / name / "SKILL.md", f"---\ndescription: {description}\n---\nBody\n")
    return parent / name


def test_nothing_changed_sends_nothing(setup: _Setup) -> None:
    _skill(setup.golem_skills, "pdf")
    registry = setup.registry()
    registry.view(setup.project)

    assert registry.check() == []
    assert setup.sent == []


def test_editing_a_user_skill_sends_one_notice_and_the_view_has_the_edit(setup: _Setup) -> None:
    folder = _skill(setup.golem_skills, "pdf", "Old.")
    registry = setup.registry()
    registry.view(None)
    registry.check()

    _skill(setup.golem_skills, "pdf", "New and longer.")

    assert registry.check() == [None]
    assert registry.check() == []
    assert setup.roots() == [None]
    found = registry.view(None).get("pdf")
    assert found is not None
    assert found.description == "New and longer."
    assert found.path == folder


def test_adding_and_deleting_a_skill_each_send_a_notice(setup: _Setup) -> None:
    registry = setup.registry()
    registry.check()

    folder = _skill(setup.golem_skills, "pdf")
    assert registry.check() == [None]
    assert registry.view(None).get("pdf") is not None

    (folder / "SKILL.md").unlink()
    assert registry.check() == [None]
    assert registry.view(None).get("pdf") is None
    assert setup.roots() == [None, None]


def test_a_project_skill_change_names_its_folder(setup: _Setup) -> None:
    registry = setup.registry()
    registry.view(setup.project)

    _skill(setup.project / ".agents/skills", "release")

    assert registry.check() == [setup.project]
    assert setup.roots() == [str(setup.project)]


def test_a_folder_no_session_asked_about_is_not_watched(setup: _Setup) -> None:
    registry = setup.registry()
    registry.check()

    _skill(setup.project / ".agents/skills", "release")

    assert registry.check() == []


def test_other_files_in_a_skill_folder_do_not_count(setup: _Setup) -> None:
    folder = _skill(setup.golem_skills, "pdf")
    registry = setup.registry()
    registry.check()

    _write(folder / "references" / "forms.md", "Notes")

    assert registry.check() == []


def test_an_unchanged_skill_is_not_parsed_again(
    setup: _Setup, monkeypatch: pytest.MonkeyPatch
) -> None:
    _skill(setup.golem_skills, "pdf")
    parsed: list[Path] = []
    real = parse.parse_skill

    def counting(folder: Path) -> Skill:
        parsed.append(folder)
        return real(folder)

    monkeypatch.setattr("golem.skills.registry.parse_skill", counting)
    registry = setup.registry()

    registry.view(None)
    registry.view(None)
    assert len(parsed) == 1

    _skill(setup.golem_skills, "pdf", "Edited.")
    registry.view(None)
    assert len(parsed) == 2


def test_disabling_a_skill_in_config_takes_effect_without_a_restart(setup: _Setup) -> None:
    _skill(setup.golem_skills, "pdf")
    registry = setup.registry()
    assert registry.view(None).get("pdf") is not None

    _write(setup.config, '[skills]\ndisabled = ["pdf"]\n')

    assert registry.check() == [None]
    assert registry.view(None).get("pdf") is None


def test_config_changes_outside_skills_send_nothing(setup: _Setup) -> None:
    registry = setup.registry()

    _write(setup.config, 'log_level = "DEBUG"\n')

    assert registry.check() == []


def test_a_config_that_does_not_validate_keeps_the_last_good_settings(setup: _Setup) -> None:
    _write(setup.config, '[skills]\ndisabled = ["pdf"]\n')
    _skill(setup.golem_skills, "pdf")
    registry = setup.registry()

    _write(setup.config, "[skills]\ndisabled = 3\n")

    assert registry.check() == []
    assert registry.view(None).get("pdf") is None
    assert registry.view(None).listed[0].disabled


def test_turning_off_claude_dirs_drops_those_skills(setup: _Setup) -> None:
    _skill(setup.home / ".claude/skills", "mine")
    registry = setup.registry()
    assert registry.view(None).get("mine") is not None

    _write(setup.config, "[skills]\nclaude_dirs = false\n")

    assert registry.check() == [None]
    assert registry.view(None).listed == ()


async def test_the_watcher_notices_an_edit_on_its_own(setup: _Setup) -> None:
    _skill(setup.golem_skills, "pdf", "Old.")
    registry = setup.registry(reload_seconds=0.05)
    registry.start()
    try:
        _skill(setup.golem_skills, "pdf", "New and longer.")
        async with asyncio.timeout(2):
            while not setup.sent:
                await asyncio.sleep(0.01)
    finally:
        await registry.aclose()

    assert setup.roots() == [None]
