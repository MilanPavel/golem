import json
import socket
from dataclasses import dataclass, field
from pathlib import Path

import pytest

from golem.cli import main
from golem.doctor import (
    MIN_FREE_BYTES,
    Check,
    config_check,
    disk_check,
    mcp_checks,
    model_checks,
    run_checks,
    service_check,
    socket_check,
)
from golem.models.keys import KeyStoreError, MemoryKeyStore
from golem.paths import GolemPaths, resolve_paths
from golem.secrets import MemorySecrets, SecretStoreError

THIS = ["/opt/homebrew/opt/golem/libexec/golem-daemon/golem-daemon", "serve"]


@dataclass
class FakePlatform:
    installed: list[str] | None = field(default_factory=lambda: list(THIS))
    loaded: bool = True
    free: int = 50_000_000_000
    ollama: list[str] | None = field(default_factory=lambda: ["qwen3:8b"])
    commands: set[str] = field(default_factory=lambda: {"ollama"})
    asked: list[str] = field(default_factory=list[str])

    def installed_program(self) -> list[str] | None:
        return self.installed

    def service_loaded(self) -> bool:
        return self.loaded

    def this_program(self) -> list[str]:
        return list(THIS)

    def free_bytes(self, path: Path) -> int:
        return self.free

    def ollama_models(self, base_url: str) -> list[str] | None:
        self.asked.append(base_url)
        return self.ollama

    def has_command(self, name: str) -> bool:
        return name in self.commands

    def mcp_command(self, command: str) -> str | None:
        return f"/opt/homebrew/bin/{command}" if command in self.commands else None


class BrokenKeys(MemoryKeyStore):
    def get(self, provider: str) -> str | None:
        raise KeyStoreError("keychain is unavailable: locked")


def _home(tmp_path: Path, config: str | None = None) -> GolemPaths:
    paths = resolve_paths(tmp_path / "home")
    paths.ensure_layout()
    if config is not None:
        paths.config_file.write_text(config, encoding="utf-8")
    return paths


def _models(
    tmp_path: Path, config: str, platform: FakePlatform, keys: MemoryKeyStore | None = None
) -> list[Check]:
    settings, check = config_check(_home(tmp_path, config))
    assert settings is not None, check
    return model_checks(settings, platform, keys or MemoryKeyStore())


def test_the_service_runs_this_daemon() -> None:
    assert service_check(FakePlatform()) == Check("service", "ok", f"launchd runs {THIS[0]}")


@pytest.mark.parametrize(
    ("platform", "expected"),
    [
        (
            FakePlatform(installed=None),
            Check("service", "fail", "launchd has no golem job", "golem daemon install"),
        ),
        (
            FakePlatform(installed=["/Users/me/golem/.venv/bin/python", "-m", "golem", "serve"]),
            Check(
                "service",
                "fail",
                "launchd runs /Users/me/golem/.venv/bin/python, not this golem",
                "golem daemon install",
            ),
        ),
        (
            FakePlatform(installed=[]),
            Check(
                "service", "fail", "launchd runs nothing, not this golem", "golem daemon install"
            ),
        ),
        (
            FakePlatform(loaded=False),
            Check("service", "fail", "installed, but stopped", "golem daemon start"),
        ),
    ],
)
def test_a_service_that_is_missing_elsewhere_or_stopped_says_how_to_fix_it(
    platform: FakePlatform, expected: Check
) -> None:
    assert service_check(platform) == expected


def test_a_socket_only_you_can_open_is_ok(short_home: Path) -> None:
    paths = _home(short_home)
    assert socket_check(paths) is None
    with socket.socket(socket.AF_UNIX) as listener:
        listener.bind(str(paths.socket_path))
        paths.socket_path.chmod(0o600)
        assert socket_check(paths) == Check("socket", "ok", "only you can open it (0600)")
        paths.socket_path.chmod(0o666)
        assert socket_check(paths) == Check(
            "socket", "fail", "others can open it (0666)", "golem daemon restart"
        )


def test_a_file_where_the_socket_belongs_fails(tmp_path: Path) -> None:
    paths = _home(tmp_path)
    paths.socket_path.write_text("", encoding="utf-8")
    check = socket_check(paths)
    assert check is not None
    assert (check.status, check.fix) == ("fail", "golem daemon restart")


def test_no_config_file_means_the_defaults(tmp_path: Path) -> None:
    settings, check = config_check(_home(tmp_path))
    assert settings is not None
    assert check == Check("config", "ok", "no config.toml, using the defaults")


@pytest.mark.parametrize(
    ("config", "detail"),
    [
        (
            "log_level = 'LOUD'\n",
            "log_level: Input should be 'DEBUG', 'INFO', 'WARNING' or 'ERROR'",
        ),
        ("[shell]\ntimeout = 3\n", "shell.timeout: Extra inputs are not permitted"),
        ("default_model = \n", "Invalid value (at line 1, column 17)"),
    ],
)
def test_an_invalid_config_names_the_setting_and_the_file(
    tmp_path: Path, config: str, detail: str
) -> None:
    paths = _home(tmp_path, config)
    settings, check = config_check(paths)
    assert settings is None
    assert check == Check("config", "fail", detail, f"edit {paths.config_file}")


def test_an_invalid_config_skips_the_model_checks(tmp_path: Path) -> None:
    checks = run_checks(_home(tmp_path, "log_level = 'LOUD'\n"), FakePlatform(), MemoryKeyStore())
    assert [check.name for check in checks] == ["service", "config", "disk"]


def test_no_model_chosen_yet_is_a_warning(tmp_path: Path) -> None:
    checks = _models(tmp_path, "", FakePlatform())
    assert checks == [
        Check("model", "warn", "no model chosen yet", "open golem and pick one with /model")
    ]


def test_a_default_that_does_not_resolve_fails(tmp_path: Path) -> None:
    checks = _models(tmp_path, "default_model = 'nowhere/x'\n", FakePlatform())
    assert checks == [
        Check(
            "model",
            "fail",
            "unknown model provider: nowhere",
            "pick another with /model, or fix config.toml",
        )
    ]


def test_a_running_ollama_with_the_model_is_ok(tmp_path: Path) -> None:
    platform = FakePlatform()
    checks = _models(tmp_path, "default_model = 'ollama/qwen3:8b'\n", platform)
    assert checks == [
        Check("model", "ok", "new chats start on ollama/qwen3:8b"),
        Check("ollama", "ok", "running at http://127.0.0.1:11434, 1 model downloaded"),
    ]
    assert platform.asked == ["http://127.0.0.1:11434"]


def test_a_stopped_ollama_is_one_failed_line_with_a_fix(tmp_path: Path) -> None:
    config = (
        "default_model = 'local'\n"
        "[models.local]\nmodel = 'ollama/qwen3:8b'\n"
        "[models.big]\nmodel = 'ollama/qwen3:32b'\n"
    )
    checks = _models(tmp_path, config, FakePlatform(ollama=None))
    assert [check for check in checks if check.status != "ok"] == [
        Check(
            "ollama",
            "fail",
            "not answering at http://127.0.0.1:11434",
            "brew services start ollama, or open the Ollama app",
        )
    ]


def test_without_ollama_installed_the_fix_installs_it(tmp_path: Path) -> None:
    checks = _models(
        tmp_path, "default_model = 'ollama/qwen3:8b'\n", FakePlatform(ollama=None, commands=set())
    )
    assert checks[-1].fix == "brew install ollama && brew services start ollama"


def test_a_model_ollama_has_not_downloaded_fails(tmp_path: Path) -> None:
    config = "default_model = 'ollama/qwen3:8b'\n[models.small]\nmodel = 'ollama/gemma3'\n"
    checks = _models(
        tmp_path, config, FakePlatform(ollama=["qwen3:8b", "gemma3:latest", "llama3.2:3b"])
    )
    assert [check.status for check in checks] == ["ok", "ok"]
    checks = _models(tmp_path, config, FakePlatform(ollama=["qwen3:8b"]))
    assert checks[-1] == Check(
        "model gemma3", "fail", "not downloaded", "ollama pull gemma3, or pick it in /model"
    )


def test_a_hosted_model_needs_its_key_in_the_keychain(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    config = "default_model = 'anthropic/claude-sonnet-4-5'\n"
    assert _models(tmp_path, config, FakePlatform())[-1] == Check(
        "anthropic", "fail", "no API key", "golem auth set anthropic"
    )
    keys = MemoryKeyStore({"anthropic": "sk-ant"})
    assert _models(tmp_path, config, FakePlatform(), keys)[-1] == Check(
        "anthropic", "ok", "API key in the Keychain"
    )


def test_a_key_only_in_the_shell_is_a_warning(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant")
    check = _models(tmp_path, "default_model = 'anthropic/claude-sonnet-4-5'\n", FakePlatform())[-1]
    assert (check.status, check.fix) == ("warn", "golem auth set anthropic")
    assert "$ANTHROPIC_API_KEY" in check.detail


def test_a_locked_keychain_fails(tmp_path: Path) -> None:
    check = _models(tmp_path, "default_model = 'openai/gpt-5'\n", FakePlatform(), BrokenKeys())[-1]
    assert (check.name, check.status, check.detail) == (
        "openai",
        "fail",
        "keychain is unavailable: locked",
    )


def test_a_local_server_without_a_key_is_ok(tmp_path: Path) -> None:
    checks = _models(tmp_path, "default_model = 'lmstudio/qwen3'\n", FakePlatform())
    assert checks[-1] == Check("lmstudio", "ok", "no key needed")


@pytest.mark.parametrize(
    ("free", "status"),
    [(MIN_FREE_BYTES - 1, "fail"), (MIN_FREE_BYTES, "ok")],
)
def test_too_little_disk_space_fails(tmp_path: Path, free: int, status: str) -> None:
    assert disk_check(_home(tmp_path), FakePlatform(free=free)).status == status


def test_disk_space_is_measured_where_golem_home_will_be(tmp_path: Path) -> None:
    check = disk_check(resolve_paths(tmp_path / "not" / "yet"), FakePlatform(free=2_500_000_000))
    assert check == Check("disk", "ok", "2.5 GB free")


def test_golem_doctor_prints_the_checks_as_json(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("GOLEM_HOME", str(tmp_path / "home"))
    monkeypatch.setattr("golem.doctor.MacPlatform", FakePlatform)
    monkeypatch.setattr("golem.secrets.KeychainSecrets", MemorySecrets)
    assert main(["doctor"]) == 0
    printed = json.loads(capsys.readouterr().out)
    assert [check["name"] for check in printed] == ["service", "config", "model", "disk"]
    assert printed[0] == {
        "name": "service",
        "status": "ok",
        "detail": f"launchd runs {THIS[0]}",
        "fix": None,
    }


def test_each_mcp_server_that_may_start_is_found_with_its_secrets(tmp_path: Path) -> None:
    config = (
        '[mcp.git]\ncommand = "uvx"\n'
        '[mcp.missing]\ncommand = "nope"\n'
        '[mcp.off]\ncommand = "nope"\nenabled = false\n'
        '[mcp.github]\nurl = "https://api.example.com/mcp"\n'
        'headers = { Authorization = "Bearer keychain:mcp/github" }\n'
    )
    settings, check = config_check(_home(tmp_path, config))
    assert settings is not None, check
    platform = FakePlatform(commands={"uvx"})
    assert mcp_checks(settings, platform, lambda _name: None) == [
        Check("mcp git", "ok", "runs /opt/homebrew/bin/uvx"),
        Check(
            "mcp github",
            "fail",
            "no secret mcp/github in the Keychain",
            "golem auth set mcp/github",
        ),
        Check(
            "mcp missing",
            "fail",
            "command not found: nope",
            "install it, or set command to its full path in config.toml",
        ),
    ]
    stored = {"mcp/github": "ghp"}
    assert mcp_checks(settings, platform, stored.get)[1] == Check(
        "mcp github", "ok", "reaches https://api.example.com/mcp"
    )


def test_a_locked_keychain_fails_the_servers_that_need_a_secret(tmp_path: Path) -> None:
    config = '[mcp.gh]\ncommand = "uvx"\nenv = { GH_TOKEN = "keychain:mcp/gh" }\n'
    settings, _ = config_check(_home(tmp_path, config))
    assert settings is not None

    def locked(name: str) -> str | None:
        raise SecretStoreError("keychain is unavailable: locked")

    [check] = mcp_checks(settings, FakePlatform(commands={"uvx"}), locked)
    assert (check.status, check.detail) == ("fail", "keychain is unavailable: locked")
