from pathlib import Path

import pytest
from pydantic import ValidationError

from golem.config import load_settings


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def test_defaults_when_files_are_missing(tmp_path: Path) -> None:
    settings = load_settings(home=tmp_path / "home", project_dir=tmp_path / "project")
    assert settings.log_level == "INFO"


def test_user_config_sets_log_level(tmp_path: Path) -> None:
    home = tmp_path / "home"
    _write(home / "config.toml", 'log_level = "ERROR"\n')
    settings = load_settings(home=home, project_dir=tmp_path / "project")
    assert settings.log_level == "ERROR"


def test_project_config_overrides_user_config(tmp_path: Path) -> None:
    home = tmp_path / "home"
    project = tmp_path / "project"
    _write(home / "config.toml", 'log_level = "ERROR"\n')
    _write(project / ".golem" / "config.toml", 'log_level = "debug"\n')
    settings = load_settings(home=home, project_dir=project)
    assert settings.log_level == "DEBUG"


def test_cwd_is_the_default_project_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(tmp_path)
    _write(tmp_path / ".golem" / "config.toml", 'log_level = "DEBUG"\n')
    settings = load_settings(home=tmp_path / "home")
    assert settings.log_level == "DEBUG"


def test_env_overrides_files(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    home = tmp_path / "home"
    project = tmp_path / "project"
    _write(home / "config.toml", 'log_level = "ERROR"\n')
    _write(project / ".golem" / "config.toml", 'log_level = "DEBUG"\n')
    monkeypatch.setenv("GOLEM_LOG_LEVEL", "warning")
    settings = load_settings(home=home, project_dir=project)
    assert settings.log_level == "WARNING"


def test_empty_env_does_not_override_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    home = tmp_path / "home"
    _write(home / "config.toml", 'log_level = "ERROR"\n')
    monkeypatch.setenv("GOLEM_LOG_LEVEL", "")
    settings = load_settings(home=home, project_dir=tmp_path / "project")
    assert settings.log_level == "ERROR"


def test_session_override_wins(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GOLEM_LOG_LEVEL", "DEBUG")
    settings = load_settings(
        home=tmp_path / "home",
        project_dir=tmp_path / "project",
        log_level="ERROR",
    )
    assert settings.log_level == "ERROR"


def test_unknown_log_level_is_rejected(tmp_path: Path) -> None:
    home = tmp_path / "home"
    _write(home / "config.toml", 'log_level = "LOUD"\n')
    with pytest.raises(ValidationError):
        load_settings(home=home, project_dir=tmp_path / "project")


def test_model_settings_load_from_toml_and_env(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    home = tmp_path / "home"
    _write(home / "config.toml", 'model_provider = "openai"\nmodel_name = "gpt-test"\n')
    settings = load_settings(home=home, project_dir=tmp_path / "project")
    assert settings.model_provider == "openai"
    assert settings.model_name == "gpt-test"
    assert settings.model_profile == "remote"
    monkeypatch.setenv("GOLEM_MODEL_NAME", "from-env")
    overridden = load_settings(home=home, project_dir=tmp_path / "project")
    assert overridden.model_name == "from-env"


def test_openai_compat_loads_from_toml_and_env(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    home = tmp_path / "home"
    _write(
        home / "config.toml",
        'model_provider = "openai_compat"\n'
        'model_name = "qwen3.5:4b"\n'
        'model_base_url = "http://127.0.0.1:9/v1"\n',
    )
    settings = load_settings(home=home, project_dir=tmp_path / "project")
    assert settings.model_provider == "openai_compat"
    assert settings.model_name == "qwen3.5:4b"
    assert settings.model_base_url == "http://127.0.0.1:9/v1"
    monkeypatch.setenv("GOLEM_MODEL_BASE_URL", "http://127.0.0.1:11434/v1")
    overridden = load_settings(home=home, project_dir=tmp_path / "project")
    assert overridden.model_base_url == "http://127.0.0.1:11434/v1"


def test_unknown_model_provider_is_rejected(tmp_path: Path) -> None:
    home = tmp_path / "home"
    _write(home / "config.toml", 'model_provider = "local"\n')
    with pytest.raises(ValidationError):
        load_settings(home=home, project_dir=tmp_path / "project")


def test_unknown_key_is_rejected(tmp_path: Path) -> None:
    home = tmp_path / "home"
    _write(home / "config.toml", 'nickname = "clay"\n')
    with pytest.raises(ValidationError):
        load_settings(home=home, project_dir=tmp_path / "project")
