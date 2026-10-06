from pathlib import Path

import pytest

from golem.paths import resolve_paths


def test_default_home_is_dot_golem() -> None:
    assert resolve_paths().home == Path.home() / ".golem"


def test_env_home_overrides_default(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("GOLEM_HOME", str(tmp_path / "from-env"))
    assert resolve_paths().home == (tmp_path / "from-env").resolve()


def test_empty_env_home_falls_through(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GOLEM_HOME", "  ")
    assert resolve_paths().home == Path.home() / ".golem"


def test_explicit_home_wins_over_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("GOLEM_HOME", str(tmp_path / "from-env"))
    explicit = tmp_path / "explicit"
    assert resolve_paths(explicit).home == explicit.resolve()


def test_tilde_is_expanded() -> None:
    paths = resolve_paths(Path("~/golem-explicit"))
    assert paths.home == (Path.home() / "golem-explicit").resolve()


def test_layout(tmp_path: Path) -> None:
    home = tmp_path.resolve()
    paths = resolve_paths(tmp_path)
    assert paths.home == home
    assert paths.config_file == home / "config.toml"
    assert paths.database_file == home / "golem.db"
    assert paths.checkpoints_file == home / "checkpoints.db"
    assert paths.memory_file == home / "memory.db"
    assert paths.skills_dir == home / "skills"
    assert paths.flows_dir == home / "flows"
    assert paths.log_file == home / "logs" / "golem.jsonl"
    assert paths.socket_path == home / "run" / "golem.sock"


def test_ensure_layout_creates_directories(tmp_path: Path) -> None:
    paths = resolve_paths(tmp_path)
    paths.ensure_layout()
    assert paths.skills_dir.is_dir()
    assert paths.flows_dir.is_dir()
    assert paths.logs_dir.is_dir()
    assert paths.run_dir.is_dir()
