import plistlib
import sys
from pathlib import Path

import pytest

from golem.cli import main
from golem.launchd import LaunchdError, install, plist_payload, render_plist, serve_command
from golem.paths import resolve_paths


def test_plist_payload(tmp_path: Path) -> None:
    paths = resolve_paths(tmp_path)
    program = ["/usr/bin/python3", "-m", "golem", "serve"]
    payload = plist_payload(paths, program)
    assert payload["Label"] == "dev.golem.daemon"
    assert payload["ProgramArguments"] == program
    assert payload["RunAtLoad"] is True
    assert payload["KeepAlive"] is True
    assert payload["ThrottleInterval"] == 2
    assert payload["WorkingDirectory"] == str(Path.home())
    assert payload["EnvironmentVariables"] == {"GOLEM_HOME": str(paths.home)}
    assert payload["ProcessType"] == "Background"
    loaded = plistlib.loads(render_plist(paths, program))
    assert loaded["Label"] == "dev.golem.daemon"
    assert loaded["StandardOutPath"] == str(paths.logs_dir / "launchd.stdout.log")
    assert loaded["StandardErrorPath"] == str(paths.logs_dir / "launchd.stderr.log")


def test_serve_command_is_the_module_until_the_build_is_frozen(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delattr(sys, "frozen", raising=False)
    assert serve_command() == [sys.executable, "-m", "golem", "serve"]
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    assert serve_command() == [sys.executable, "serve"]


def test_version_flag(capsys: pytest.CaptureFixture[str]) -> None:
    from golem import __version__

    with pytest.raises(SystemExit) as exc:
        main(["--version"])
    assert exc.value.code == 0
    assert capsys.readouterr().out.strip() == f"golem-daemon {__version__}"


def test_install_requires_darwin(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sys, "platform", "linux")
    with pytest.raises(LaunchdError, match="macOS-only"):
        install()


def test_cli_install_requires_darwin(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setattr(sys, "platform", "linux")
    assert main(["daemon", "install"]) == 1
    assert "macOS-only" in capsys.readouterr().err


def test_logs_prints_the_last_50_lines(
    short_home: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    paths = resolve_paths(short_home)
    paths.ensure_layout()
    lines = [f"line-{index}" for index in range(60)]
    paths.log_file.write_text("\n".join(lines) + "\n", encoding="utf-8")
    monkeypatch.setenv("GOLEM_HOME", str(short_home))
    assert main(["daemon", "logs", "--no-follow"]) == 0
    assert capsys.readouterr().out.splitlines() == lines[-50:]


def test_logs_without_a_tty_does_not_follow(
    short_home: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    paths = resolve_paths(short_home)
    paths.ensure_layout()
    paths.log_file.write_text("one\n", encoding="utf-8")
    monkeypatch.setenv("GOLEM_HOME", str(short_home))
    monkeypatch.setattr(sys.stdout, "isatty", lambda: False)
    assert main(["daemon", "logs"]) == 0
    assert capsys.readouterr().out.splitlines() == ["one"]


def test_logs_missing_file(
    short_home: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setenv("GOLEM_HOME", str(short_home))
    assert main(["daemon", "logs", "--no-follow"]) == 1
    assert "log file not found" in capsys.readouterr().err
