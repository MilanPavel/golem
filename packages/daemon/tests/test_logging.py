import json
import logging
from pathlib import Path

import pytest

from golem.config import load_settings
from golem.logging import configure_logging
from golem.paths import resolve_paths


def _flush() -> None:
    for handler in logging.getLogger("golem").handlers:
        handler.flush()


def test_json_file_and_pretty_stderr(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    home = tmp_path / "home"
    paths = resolve_paths(home)
    configure_logging(load_settings(home=home, project_dir=tmp_path), paths)
    logging.getLogger("golem").info("hello")
    _flush()

    payload = json.loads(paths.log_file.read_text(encoding="utf-8"))
    assert payload["level"] == "INFO"
    assert payload["logger"] == "golem"
    assert payload["message"] == "hello"
    assert "T" in payload["ts"]

    err = capsys.readouterr().err
    assert "hello" in err
    assert "INFO" in err
    assert not err.lstrip().startswith("{")


def test_child_logger_is_captured(tmp_path: Path) -> None:
    home = tmp_path / "home"
    paths = resolve_paths(home)
    configure_logging(load_settings(home=home, project_dir=tmp_path), paths)
    logging.getLogger("golem.server").warning("booted")
    _flush()
    payload = json.loads(paths.log_file.read_text(encoding="utf-8"))
    assert payload["logger"] == "golem.server"
    assert payload["message"] == "booted"


def test_reconfigure_replaces_handlers(tmp_path: Path) -> None:
    home = tmp_path / "home"
    paths = resolve_paths(home)
    settings = load_settings(home=home, project_dir=tmp_path)
    configure_logging(settings, paths)
    configure_logging(settings, paths)
    logging.getLogger("golem").info("once")
    _flush()
    lines = [line for line in paths.log_file.read_text(encoding="utf-8").splitlines() if line]
    assert len(lines) == 1
