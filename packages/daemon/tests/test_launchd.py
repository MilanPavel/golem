import plistlib
import subprocess
import sys
from pathlib import Path

import pytest

from golem import launchd
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


def _keg(prefix: Path, version: str) -> Path:
    """A Homebrew keg with a daemon, and ``opt/golem`` pointing at it."""
    daemon = prefix / "Cellar" / "golem" / version / "libexec" / "golem-daemon" / "golem-daemon"
    daemon.parent.mkdir(parents=True)
    daemon.write_text("", encoding="utf-8")
    opt = prefix / "opt" / "golem"
    opt.parent.mkdir(exist_ok=True)
    opt.unlink(missing_ok=True)
    opt.symlink_to(Path("..") / "Cellar" / "golem" / version)
    return daemon


def test_a_frozen_daemon_in_a_keg_is_named_by_its_opt_path(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    prefix = tmp_path.resolve() / "homebrew"
    daemon = _keg(prefix, "0.1.0")
    opt_daemon = prefix / "opt" / "golem" / "libexec" / "golem-daemon" / "golem-daemon"
    assert launchd.stable_path(daemon) == opt_daemon
    assert launchd.stable_path(opt_daemon) == opt_daemon
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "executable", str(daemon))
    assert serve_command() == [str(opt_daemon), "serve"]


def test_a_keg_that_opt_no_longer_points_at_keeps_its_own_path(tmp_path: Path) -> None:
    prefix = tmp_path.resolve() / "homebrew"
    old = _keg(prefix, "0.1.0")
    _keg(prefix, "0.2.0")
    assert launchd.stable_path(old) == old


def test_paths_outside_a_keg_are_kept(tmp_path: Path) -> None:
    unlinked = tmp_path / "homebrew" / "Cellar" / "golem" / "0.1.0" / "bin" / "golem-daemon"
    unlinked.parent.mkdir(parents=True)
    unlinked.write_text("", encoding="utf-8")
    elsewhere = tmp_path / "Applications" / "golem" / "libexec" / "golem-daemon" / "golem-daemon"
    assert launchd.stable_path(unlinked) == unlinked
    assert launchd.stable_path(elsewhere) == elsewhere


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


class _Launchctl:
    """Records launchctl calls. ``print`` answers whether the job is loaded."""

    def __init__(self, *, loaded: bool) -> None:
        self.loaded = loaded
        self.calls: list[list[str]] = []

    def __call__(self, args: list[str], **_kwargs: object) -> subprocess.CompletedProcess[str]:
        self.calls.append(args)
        code = 0 if args[1] != "print" or self.loaded else 113
        return subprocess.CompletedProcess(args, code, "", "")

    def verbs(self) -> list[str]:
        return [call[1] for call in self.calls if call[1] != "print"]


@pytest.fixture
def agents(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(sys, "platform", "darwin")
    directory = tmp_path / "LaunchAgents"
    directory.mkdir()
    monkeypatch.setattr(launchd, "launch_agents_dir", lambda: directory)
    return directory


def _launchctl(monkeypatch: pytest.MonkeyPatch, *, loaded: bool) -> _Launchctl:
    fake = _Launchctl(loaded=loaded)
    monkeypatch.setattr(subprocess, "run", fake)
    return fake


def _write_plist(tmp_path: Path, program: list[str]) -> None:
    launchd.plist_path().write_bytes(render_plist(resolve_paths(tmp_path / "home"), program))


def test_restart_kickstarts_the_loaded_job(
    agents: Path,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    _write_plist(tmp_path, serve_command())
    fake = _launchctl(monkeypatch, loaded=True)
    assert main(["daemon", "restart"]) == 0
    assert fake.verbs() == ["kickstart"]
    assert fake.calls[-1][2] == "-k"
    assert capsys.readouterr().err == ""


def test_restart_loads_a_stopped_job_first(
    agents: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _write_plist(tmp_path, serve_command())
    fake = _launchctl(monkeypatch, loaded=False)
    assert main(["daemon", "restart"]) == 0
    assert fake.verbs() == ["bootstrap", "kickstart"]


def test_restart_says_when_the_plist_names_another_daemon(
    agents: Path,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    _write_plist(tmp_path, ["/old/golem-daemon", "serve"])
    _launchctl(monkeypatch, loaded=True)
    assert main(["daemon", "restart"]) == 0
    assert "launchd runs /old/golem-daemon" in capsys.readouterr().err


def test_restart_without_a_plist_asks_for_install(
    agents: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    fake = _launchctl(monkeypatch, loaded=False)
    assert main(["daemon", "restart"]) == 1
    assert "run golem daemon install" in capsys.readouterr().err
    assert fake.calls == []


def test_the_same_program_through_a_link(tmp_path: Path) -> None:
    real = tmp_path / "Cellar" / "golem-daemon"
    real.parent.mkdir()
    real.write_text("", encoding="utf-8")
    link = tmp_path / "opt-golem-daemon"
    link.symlink_to(real)
    assert launchd.same_program([str(link), "serve"], [str(real), "serve"])
    assert not launchd.same_program([str(link), "serve"], [str(real), "other"])


def test_uninstall_unloads_and_deletes_the_plist_and_keeps_data(
    agents: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    home = tmp_path / "home"
    resolve_paths(home).ensure_layout()
    (home / "golem.db").write_bytes(b"history")
    _write_plist(tmp_path, serve_command())
    fake = _launchctl(monkeypatch, loaded=True)
    assert main(["daemon", "uninstall"]) == 0
    assert fake.verbs() == ["bootout"]
    assert not launchd.plist_path().exists()
    assert (home / "golem.db").read_bytes() == b"history"


def test_uninstall_twice_says_it_is_not_installed(
    agents: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    fake = _launchctl(monkeypatch, loaded=False)
    assert main(["daemon", "uninstall"]) == 0
    assert fake.verbs() == []
    assert "not installed" in capsys.readouterr().err
