"""The agent registry: three sources, who wins a name, trust, and change signals."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from golem.agents.bundled import bundled_agents_dir
from golem.agents.registry import AgentRegistry
from golem.config import AgentSettings


@dataclass
class _Layout:
    home: Path
    project: Path
    trusted: set[Path] = field(default_factory=set[Path])
    changes: list[Path | None] = field(default_factory=list[Path | None])

    @property
    def user_dir(self) -> Path:
        return self.home / ".golem" / "agents"

    def registry(
        self, settings: AgentSettings | None = None, *, bundled: Path | None = None
    ) -> AgentRegistry:
        return AgentRegistry(
            settings or AgentSettings(),
            golem_agents=self.user_dir,
            trusted=lambda root: root in self.trusted,
            user_home=self.home,
            bundled=bundled,
            on_change=self.changes.append,
        )


def _layout(tmp_path: Path, *, trusted: bool = True) -> _Layout:
    home = tmp_path / "home"
    project = tmp_path / "project"
    home.mkdir()
    project.mkdir()
    return _Layout(home=home, project=project, trusted={project} if trusted else set())


def _agent(folder: Path, name: str, description: str = "Does a thing.") -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{name}.md"
    path.write_text(f"---\ndescription: {description}\n---\nPrompt of {description}\n")
    return path


def test_sources_are_project_then_user_then_bundled(tmp_path: Path) -> None:
    layout = _layout(tmp_path)
    registry = layout.registry(
        AgentSettings(extra_dirs=["~/team-agents", "/opt/agents"]), bundled=tmp_path / "bundled"
    )

    sources = [(s.origin, s.path) for s in registry.sources(layout.project)]

    assert sources == [
        ("project", layout.project / ".golem/agents"),
        ("user", layout.user_dir),
        ("user", layout.home / "team-agents"),
        ("user", Path("/opt/agents")),
        ("bundled", tmp_path / "bundled"),
    ]


def test_all_three_sources_are_read(tmp_path: Path) -> None:
    layout = _layout(tmp_path)
    bundled = tmp_path / "bundled"
    _agent(layout.project / ".golem/agents", "from-project")
    _agent(layout.user_dir, "from-user")
    _agent(bundled, "from-bundled")

    view = layout.registry(bundled=bundled).view(layout.project)

    assert [(e.agent.name, e.origin) for e in view.listed] == [
        ("from-project", "project"),
        ("from-user", "user"),
        ("from-bundled", "bundled"),
    ]
    assert [a.name for a in view.usable()] == ["from-project", "from-user", "from-bundled"]


def test_an_extra_dir_is_a_user_source(tmp_path: Path) -> None:
    layout = _layout(tmp_path)
    _agent(layout.home / "team", "teamer")

    view = layout.registry(AgentSettings(extra_dirs=["~/team"])).view(None)

    assert [(e.agent.name, e.origin) for e in view.listed] == [("teamer", "user")]


def test_a_project_agent_shadows_a_user_agent_and_both_are_listed(tmp_path: Path) -> None:
    layout = _layout(tmp_path)
    mine = _agent(layout.project / ".golem/agents", "dup", "Project copy.")
    theirs = _agent(layout.user_dir, "dup", "User copy.")

    view = layout.registry().view(layout.project)

    assert view.get("dup") is not None
    assert view.get("dup").description == "Project copy."  # type: ignore[union-attr]
    project, user = view.listed
    assert project.shadowed_by is None and project.usable
    assert user.shadowed_by == mine and not user.usable
    assert user.agent.path == theirs


def test_a_user_agent_hides_the_bundled_one_of_the_same_name(tmp_path: Path) -> None:
    layout = _layout(tmp_path)
    _agent(layout.user_dir, "explorer", "Mine.")

    view = layout.registry(bundled=bundled_agents_dir()).view(None)

    assert view.get("explorer").description == "Mine."  # type: ignore[union-attr]
    assert sorted(a.name for a in view.usable()) == ["advisor", "explorer", "reviewer", "worker"]
    assert sum(1 for e in view.listed if e.agent.name == "explorer") == 2


def test_a_broken_file_never_wins(tmp_path: Path) -> None:
    layout = _layout(tmp_path)
    broken = layout.project / ".golem/agents"
    broken.mkdir(parents=True)
    (broken / "dup.md").write_text("---\ndescription: Broken.\ntools: teleport\n---\nGo.\n")
    _agent(layout.user_dir, "dup", "Good.")

    view = layout.registry().view(layout.project)

    assert view.get("dup").description == "Good."  # type: ignore[union-attr]
    first, second = view.listed
    assert not first.agent.valid and not first.usable
    assert any("teleport" in e for e in first.agent.errors)
    assert second.usable


def test_a_project_agent_is_returned_only_when_the_folder_is_trusted(tmp_path: Path) -> None:
    layout = _layout(tmp_path, trusted=False)
    _agent(layout.project / ".golem/agents", "local-only")
    _agent(layout.user_dir, "global")
    registry = layout.registry()

    assert [a.name for a in registry.view(layout.project).usable()] == ["global"]

    layout.trusted.add(layout.project)

    assert [a.name for a in registry.view(layout.project).usable()] == ["local-only", "global"]


def test_another_folder_sees_only_its_own_project_agents(tmp_path: Path) -> None:
    layout = _layout(tmp_path)
    other = tmp_path / "other"
    layout.trusted.add(other)
    _agent(layout.project / ".golem/agents", "mine")
    _agent(other / ".golem/agents", "theirs")
    registry = layout.registry()

    assert [a.name for a in registry.view(layout.project).usable()] == ["mine"]
    assert [a.name for a in registry.view(other).usable()] == ["theirs"]


def test_a_symlinked_agent_counts_once(tmp_path: Path) -> None:
    layout = _layout(tmp_path)
    real = _agent(tmp_path / "shared", "linked")
    layout.user_dir.mkdir(parents=True)
    (layout.user_dir / "linked.md").symlink_to(real)
    (layout.user_dir / "alias.md").symlink_to(real)

    names = [e.agent.name for e in layout.registry().view(None).listed]

    assert len(names) == 1


def test_files_that_are_not_agents_are_skipped(tmp_path: Path) -> None:
    layout = _layout(tmp_path)
    _agent(layout.user_dir, "real")
    _agent(layout.user_dir, "_draft")
    _agent(layout.user_dir, ".hidden")
    (layout.user_dir / "notes.txt").write_text("hello")
    (layout.user_dir / "folder.md").mkdir()

    assert [e.agent.name for e in layout.registry().view(None).listed] == ["real"]


def test_no_folders_no_agents(tmp_path: Path) -> None:
    layout = _layout(tmp_path)

    assert layout.registry().view(layout.project).listed == ()


def test_a_changed_file_is_parsed_again(tmp_path: Path) -> None:
    layout = _layout(tmp_path)
    path = _agent(layout.user_dir, "grows", "Before.")
    registry = layout.registry()
    assert registry.view(None).get("grows").description == "Before."  # type: ignore[union-attr]

    path.write_text("---\ndescription: After, and longer.\n---\nGo.\n")

    assert registry.view(None).get("grows").description == "After, and longer."  # type: ignore[union-attr]


def test_check_announces_what_changed(tmp_path: Path) -> None:
    layout = _layout(tmp_path)
    registry = layout.registry()
    registry.view(layout.project)
    assert registry.check() == []

    _agent(layout.project / ".golem/agents", "new-one")
    assert registry.check() == [layout.project]
    _agent(layout.user_dir, "user-one")
    assert registry.check() == [None]
    assert registry.check() == []
    assert layout.changes == [layout.project, None]


def test_check_sees_an_edit_that_keeps_the_size_by_its_mtime(tmp_path: Path) -> None:
    layout = _layout(tmp_path)
    path = _agent(layout.user_dir, "same-size", "Aaaa.")
    registry = layout.registry()
    registry.view(None)

    path.write_text("---\ndescription: Bbbb.\n---\nPrompt of Aaaa.\n")
    stat = path.stat()
    os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns + 1_000_000_000))

    assert registry.check() == [None]


def test_trusting_a_folder_is_announced(tmp_path: Path) -> None:
    layout = _layout(tmp_path, trusted=False)
    _agent(layout.project / ".golem/agents", "waiting")
    registry = layout.registry()
    registry.view(layout.project)
    assert registry.check() == []

    layout.trusted.add(layout.project)

    assert registry.check() == [layout.project]


def test_new_settings_are_announced_and_a_bad_file_keeps_the_old_ones(tmp_path: Path) -> None:
    layout = _layout(tmp_path)
    config = tmp_path / "config.toml"
    config.write_text("one")
    _agent(layout.home / "team", "teamer")
    loads: list[AgentSettings | Exception] = [
        AgentSettings(extra_dirs=["~/team"]),
        ValueError("bad"),
    ]

    def load() -> AgentSettings:
        item = loads.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    registry = AgentRegistry(
        AgentSettings(),
        golem_agents=layout.user_dir,
        trusted=lambda _root: True,
        user_home=layout.home,
        config_file=config,
        load_settings=load,
        on_change=layout.changes.append,
    )
    assert registry.view(None).listed == ()

    config.write_text("two, longer")
    assert registry.check() == [None]
    assert [e.agent.name for e in registry.view(None).listed] == ["teamer"]

    config.write_text("three, longer still")
    assert registry.check() == []
    assert [e.agent.name for e in registry.view(None).listed] == ["teamer"]
