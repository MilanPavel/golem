"""The memory privacy check, the project key, and the project's ``[memory] private`` flag."""

from __future__ import annotations

from pathlib import Path

import pytest

from golem.config import MemoryPrivacyLevel, MemoryScope, RouteMode, load_settings
from golem.memory.privacy import (
    ChatPrivacy,
    MemoryPrivacy,
    Reason,
    Target,
    effective_privacy,
    may_use,
)
from golem.memory.project import project_key
from golem.memory.project_privacy import project_memory_private


def _memory(
    privacy: MemoryPrivacyLevel = "chat",
    setting: MemoryPrivacyLevel = "chat",
    folder_local_only: bool = False,
    project_private: bool = False,
    scope: MemoryScope = "project",
) -> MemoryPrivacy:
    return MemoryPrivacy(scope, privacy, setting, folder_local_only, project_private)


def _chat(
    local_only: bool = False, route: RouteMode = "pinned", model_local: bool = False
) -> ChatPrivacy:
    return ChatPrivacy(local_only, route, model_local)


HOSTED = Target(local=False)
LOCAL = Target(local=True)

# name, memory, chat, target, allowed, reason
CASES: list[tuple[str, MemoryPrivacy, ChatPrivacy, Target, bool, Reason | None]] = [
    # Mixed: local and hosted models both exist.
    ("local record to hosted", _memory(privacy="local"), _chat(), HOSTED, False, "memory_local"),
    (
        "local scope setting to hosted",
        _memory(setting="local"),
        _chat(),
        HOSTED,
        False,
        "memory_local",
    ),
    (
        "local folder to hosted",
        _memory(folder_local_only=True),
        _chat(),
        HOSTED,
        False,
        "memory_local",
    ),
    (
        "private project to hosted",
        _memory(project_private=True),
        _chat(),
        HOSTED,
        False,
        "memory_local",
    ),
    (
        "chat memory, local-only folder chat, hosted",
        _memory(),
        _chat(local_only=True),
        HOSTED,
        False,
        "chat_local",
    ),
    (
        "chat memory, route local, hosted",
        _memory(),
        _chat(route="local"),
        HOSTED,
        False,
        "chat_local",
    ),
    (
        "chat memory, local lead, hosted",
        _memory(),
        _chat(model_local=True),
        HOSTED,
        False,
        "chat_local",
    ),
    (
        "you memory, local chat, hosted",
        _memory(scope="you"),
        _chat(local_only=True),
        HOSTED,
        False,
        "chat_local",
    ),
    (
        "both local, hosted",
        _memory(privacy="local"),
        _chat(local_only=True),
        HOSTED,
        False,
        "memory_local",
    ),
    ("hosted chat, chat memory, hosted", _memory(), _chat(), HOSTED, True, None),
    ("route auto, chat memory, hosted", _memory(), _chat(route="auto"), HOSTED, True, None),
    ("any memory to local", _memory(privacy="local"), _chat(local_only=True), LOCAL, True, None),
    ("chat memory to local", _memory(), _chat(), LOCAL, True, None),
    (
        "local folder memory to local",
        _memory(folder_local_only=True),
        _chat(route="local"),
        LOCAL,
        True,
        None,
    ),
    # Local only: every case with a local target is allowed (see the test below).
    (
        "local setup, local memory",
        _memory(privacy="local"),
        _chat(model_local=True),
        LOCAL,
        True,
        None,
    ),
    ("local setup, chat memory", _memory(), _chat(model_local=True), LOCAL, True, None),
    # Cloud only: the lead is hosted and there is no local target.
    ("cloud only, local record", _memory(privacy="local"), _chat(), HOSTED, False, "memory_local"),
    ("cloud only, local setting", _memory(setting="local"), _chat(), HOSTED, False, "memory_local"),
    (
        "cloud only, local folder",
        _memory(folder_local_only=True),
        _chat(),
        HOSTED,
        False,
        "memory_local",
    ),
    ("cloud only, chat memory", _memory(), _chat(), HOSTED, True, None),
    ("cloud only, you memory", _memory(scope="you"), _chat(route="auto"), HOSTED, True, None),
]


@pytest.mark.parametrize(
    ("memory", "chat", "target", "allowed", "reason"),
    [case[1:] for case in CASES],
    ids=[case[0] for case in CASES],
)
def test_may_use(
    memory: MemoryPrivacy, chat: ChatPrivacy, target: Target, allowed: bool, reason: Reason | None
) -> None:
    verdict = may_use(memory, chat, target)
    assert verdict.allowed is allowed
    assert verdict.reason == reason


@pytest.mark.parametrize("privacy", ["chat", "local"])
@pytest.mark.parametrize("setting", ["chat", "local"])
@pytest.mark.parametrize("folder", [False, True])
@pytest.mark.parametrize("project", [False, True])
@pytest.mark.parametrize("local_only", [False, True])
@pytest.mark.parametrize("route", ["pinned", "local", "auto"])
@pytest.mark.parametrize("model_local", [False, True])
def test_local_only_setup_every_case_with_a_local_target_is_allowed(
    privacy: MemoryPrivacyLevel,
    setting: MemoryPrivacyLevel,
    folder: bool,
    project: bool,
    local_only: bool,
    route: RouteMode,
    model_local: bool,
) -> None:
    verdict = may_use(
        _memory(privacy, setting, folder, project), _chat(local_only, route, model_local), LOCAL
    )
    assert verdict.allowed and verdict.reason is None


@pytest.mark.parametrize("privacy", ["chat", "local"])
@pytest.mark.parametrize("setting", ["chat", "local"])
@pytest.mark.parametrize("folder", [False, True])
@pytest.mark.parametrize("project", [False, True])
@pytest.mark.parametrize("scope", ["you", "project", "history"])
def test_cloud_only_setup_a_local_memory_is_refused_and_a_chat_memory_is_allowed(
    privacy: MemoryPrivacyLevel,
    setting: MemoryPrivacyLevel,
    folder: bool,
    project: bool,
    scope: MemoryScope,
) -> None:
    # A hosted chat with a hosted target: nothing local anywhere.
    verdict = may_use(_memory(privacy, setting, folder, project, scope), _chat(), HOSTED)
    if "local" in (privacy, setting) or folder or project:
        assert verdict.allowed is False and verdict.reason == "memory_local"
    else:
        assert verdict.allowed is True and verdict.reason is None


@pytest.mark.parametrize(
    ("record", "setting", "folder", "project", "expected"),
    [
        ("chat", "chat", False, False, "chat"),
        ("local", "chat", False, False, "local"),
        ("chat", "local", False, False, "local"),
        ("chat", "chat", True, False, "local"),
        ("chat", "chat", False, True, "local"),
        ("local", "local", True, True, "local"),
    ],
)
def test_effective_privacy_is_the_most_private_of_the_four(
    record: MemoryPrivacyLevel,
    setting: MemoryPrivacyLevel,
    folder: bool,
    project: bool,
    expected: MemoryPrivacyLevel,
) -> None:
    assert effective_privacy(record, setting, folder, project) == expected


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def test_project_key_is_the_nearest_folder_with_git_or_golem(tmp_path: Path) -> None:
    root = tmp_path / "repo"
    (root / ".git").mkdir(parents=True)
    deep = root / "a" / "b"
    deep.mkdir(parents=True)
    assert project_key(str(deep)) == str(root.resolve())
    assert project_key(str(root)) == str(root.resolve())
    inner = root / "a"
    (inner / ".golem").mkdir()
    assert project_key(str(deep)) == str(inner.resolve())


def test_project_key_counts_a_git_file_like_a_worktree(tmp_path: Path) -> None:
    root = tmp_path / "wt"
    _write(root / ".git", "gitdir: /elsewhere\n")
    (root / "src").mkdir()
    assert project_key(str(root / "src")) == str(root.resolve())


def test_project_key_without_a_marker_is_the_session_folder(tmp_path: Path) -> None:
    here = tmp_path / "plain" / "x"
    here.mkdir(parents=True)
    # Nothing above tmp_path is expected to hold a marker for this check to mean anything.
    key = project_key(str(here))
    assert key is not None
    assert Path(key) == here.resolve() or Path(key) in here.resolve().parents


def test_project_key_does_not_take_golems_own_folder_as_a_marker(tmp_path: Path) -> None:
    home = tmp_path / "home"
    (home / ".golem").mkdir(parents=True)
    plain = home / "notes"
    plain.mkdir()
    repo = home / "code" / "app"
    (repo / ".git").mkdir(parents=True)
    own = home / ".golem"
    assert project_key(str(plain), own) == str(plain.resolve())
    assert project_key(str(repo), own) == str(repo.resolve())
    # Without naming golem's folder, the home folder would win.
    assert project_key(str(plain)) == str(home.resolve())


def test_project_key_is_a_real_path(tmp_path: Path) -> None:
    root = tmp_path / "repo"
    (root / ".git").mkdir(parents=True)
    link = tmp_path / "link"
    link.symlink_to(root)
    assert project_key(str(link)) == str(root.resolve())


@pytest.mark.parametrize("cwd", [None, "", "  ", "relative/dir"])
def test_project_key_has_none_for_no_usable_folder(cwd: str | None) -> None:
    assert project_key(cwd) is None


def test_a_project_file_private_true_makes_the_flag_true(tmp_path: Path) -> None:
    root = tmp_path / "repo"
    _write(root / ".golem" / "config.toml", "[memory]\nprivate = true\n")
    sub = root / "src"
    sub.mkdir()
    assert project_memory_private(str(root))
    assert project_memory_private(str(sub))
    assert not project_memory_private(str(tmp_path))


@pytest.mark.parametrize(
    "text", ["[memory]\nprivate = false\n", '[memory]\nprivate = "true"\n', ""]
)
def test_a_project_file_cannot_make_the_flag_false_or_truthy(tmp_path: Path, text: str) -> None:
    root = tmp_path / "repo"
    _write(root / ".golem" / "config.toml", text)
    assert not project_memory_private(str(root))


def test_a_nearer_false_does_not_undo_a_private_folder_above(tmp_path: Path) -> None:
    _write(tmp_path / ".golem" / "config.toml", "[memory]\nprivate = true\n")
    inner = tmp_path / "inner"
    _write(inner / ".golem" / "config.toml", "[memory]\nprivate = false\n")
    assert project_memory_private(str(inner))


def test_the_flag_does_not_read_the_routing_flag(tmp_path: Path) -> None:
    _write(tmp_path / ".golem" / "config.toml", "[routing]\nlocal_only = true\n")
    assert not project_memory_private(str(tmp_path))


def test_memory_settings_default_and_load_from_the_user_file(tmp_path: Path) -> None:
    home, project = tmp_path / "home", tmp_path / "project"
    memory = load_settings(home=home, project_dir=project).memory
    assert (memory.enabled, memory.share, memory.min_tokens, memory.max_tokens) == (
        True,
        0.02,
        200,
        1500,
    )
    assert memory.helper_share == 0.01
    assert (memory.you, memory.projects, memory.history) == ("chat", "chat", "chat")
    assert memory.auto_keep == []
    _write(
        home / "config.toml",
        '[memory]\nyou = "local"\nshare = 0.05\nauto_keep = ["/work/a"]\n',
    )
    memory = load_settings(home=home, project_dir=project).memory
    assert memory.you == "local" and memory.share == 0.05
    assert memory.auto_keep == ["/work/a"]


def test_a_project_file_memory_table_is_ignored_for_the_settings(tmp_path: Path) -> None:
    home, project = tmp_path / "home", tmp_path / "project"
    _write(home / "config.toml", '[memory]\nauto_keep = ["/work/a"]\nyou = "chat"\n')
    _write(
        project / ".golem" / "config.toml",
        '[memory]\nauto_keep = ["/elsewhere"]\nprivate = true\nyou = "local"\nshare = 0.5\n',
    )
    memory = load_settings(home=home, project_dir=project).memory
    assert memory.auto_keep == ["/work/a"]
    assert memory.you == "chat" and memory.share == 0.02


def test_a_project_file_auto_keep_alone_is_ignored(tmp_path: Path) -> None:
    project = tmp_path / "project"
    _write(project / ".golem" / "config.toml", '[memory]\nauto_keep = ["/elsewhere"]\n')
    assert load_settings(home=tmp_path / "home", project_dir=project).memory.auto_keep == []


def test_memory_settings_reject_bad_values(tmp_path: Path) -> None:
    home, project = tmp_path / "home", tmp_path / "project"
    for text in (
        "[memory]\nmin_tokens = 900\nmax_tokens = 100\n",
        "[memory]\nshare = 0\n",
        '[memory]\nyou = "secret"\n',
        "[memory]\nprivate = true\n",
    ):
        _write(home / "config.toml", text)
        with pytest.raises(ValueError):
            load_settings(home=home, project_dir=project)
