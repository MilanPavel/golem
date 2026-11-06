"""The checks on a whole ``config.toml`` text: syntax, settings, protected parts, secrets."""

from __future__ import annotations

from golem.config import (
    BROWSER_SETTINGS,
    PROTECTED_SETTINGS,
    GolemSettings,
    McpServerSettings,
)
from golem.config_raw import check_text
from golem_protocol.commands import McpServerConfig

SERVER = '[mcp.github]\nurl = "https://api.example.test/mcp"\n'


def test_a_syntax_error_has_its_line_and_column() -> None:
    checked = check_text('log_level = "INFO"\nsession_titles = = true\n', "")
    [issue] = checked.issues
    assert (issue.line, issue.column) == (2, 18)
    assert "at line" not in issue.message


def test_a_setting_that_does_not_validate_names_its_path_and_line() -> None:
    text = f'{SERVER}headers = {{ Authorization = "Bearer abc" }}\n'
    [issue] = check_text(text, "").issues
    assert issue.path == "mcp.github"
    assert issue.line == 1
    assert "Authorization looks like a secret" in issue.message

    [unknown] = check_text("[mcp.github]\nurl = 'http://x.test'\ncolour = 1\n", "").issues
    assert (unknown.path, unknown.line) == ("mcp.github.colour", 3)


def test_a_literal_secret_in_a_header_or_env_is_refused() -> None:
    text = '[mcp.x]\ncommand = "uvx"\nenv = { API_KEY = "sk-abc" }\n'
    [issue] = check_text(text, "").issues
    assert "API_KEY looks like a secret" in issue.message


def test_the_browser_cannot_change_a_protected_section() -> None:
    old = 'trusted_projects = ["/a"]\n[shell]\nnetwork = false\n'
    new = 'trusted_projects = ["/a", "/evil"]\n[shell]\nnetwork = true\n'
    issues = check_text(new, old).issues
    assert {issue.path for issue in issues} == {"trusted_projects", "shell"}
    assert all("terminal" in issue.message for issue in issues)
    assert check_text(new, old, protected=False).issues == []
    # Leaving a protected part as it is, or editing other parts, is fine.
    assert check_text("session_titles = false\n" + old, old).issues == []


def test_a_new_provider_and_the_skill_folders_are_protected() -> None:
    new = '[providers.mine]\nbase_url = "http://evil.test/v1"\n[skills]\nextra_dirs = ["/x"]\n'
    assert {issue.path for issue in check_text(new, "").issues} == {
        "providers",
        "skills.extra_dirs",
    }
    assert check_text("[skills]\ndisabled = ['a']\n", "").issues == []


def test_a_server_may_name_only_its_own_secrets() -> None:
    text = SERVER + 'headers = { Authorization = "Bearer keychain:mcp/other" }\n'
    [issue] = check_text(text, "").issues
    assert "only its own secrets" in issue.message
    own = SERVER + 'headers = { Authorization = "Bearer keychain:mcp/github-work" }\n'
    assert check_text(own, "").issues == []


def test_moving_a_server_with_a_stored_secret_needs_the_form() -> None:
    old = SERVER + 'headers = { Authorization = "Bearer keychain:mcp/github" }\n'
    moved = old.replace("api.example.test", "evil.test")
    [issue] = check_text(moved, old, stored=lambda ref: ref == "mcp/github").issues
    assert "send the secret again" in issue.message
    assert check_text(moved, old, stored=lambda _ref: False).issues == []
    renamed_header = old.replace("Authorization", "X-Auth")
    assert check_text(renamed_header, old, stored=lambda _ref: True).issues == []


def test_sections_read_only_at_start_are_listed() -> None:
    checked = check_text("log_level = 'DEBUG'\n[ollama]\nstart = false\n", "", protected=False)
    assert checked.issues == []
    assert checked.restart_needed == ["log_level", "ollama"]


def test_a_project_file_holds_only_mcp_tables() -> None:
    checked = check_text('log_level = "DEBUG"\n' + SERVER, "", project=True)
    [issue] = checked.issues
    assert issue.path == "log_level" and "only [mcp.*]" in issue.message
    assert check_text(SERVER, "", project=True).issues == []


def test_every_setting_is_decided_for_the_browser() -> None:
    fields = set(GolemSettings.model_fields)
    assert fields == PROTECTED_SETTINGS | BROWSER_SETTINGS
    assert not PROTECTED_SETTINGS & BROWSER_SETTINGS


def test_the_wire_config_has_every_field_of_the_settings() -> None:
    assert set(McpServerConfig.model_fields) == set(McpServerSettings.model_fields)
    for name, field in McpServerSettings.model_fields.items():
        assert McpServerConfig.model_fields[name].default == field.default or (
            field.default_factory is not None
        ), name
