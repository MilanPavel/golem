"""Edits of ``config.toml`` that keep the user's comments: replace, rename, and raw writes."""

from __future__ import annotations

from pathlib import Path

import pytest

from golem.config_edit import (
    McpExistsError,
    McpTableError,
    RawConflictError,
    read_raw,
    replace_mcp_server,
    write_raw,
)

FILE = """# my servers
log_level = "INFO"

# the github one
[mcp.github]  # hosted
url = "https://api.example.test/mcp"
headers = { Authorization = "Bearer keychain:mcp/github" }

[mcp.local]
command = "uvx"
"""


def test_replace_keeps_the_comments_and_the_place(tmp_path: Path) -> None:
    path = tmp_path / "config.toml"
    path.write_text(FILE, encoding="utf-8")
    replace_mcp_server(
        path, "github", {"url": "https://other.test/mcp", "tools": {"exclude": ["delete_*"]}}
    )
    text = path.read_text(encoding="utf-8")
    assert "# my servers" in text and "# the github one" in text and "# hosted" in text
    assert 'url = "https://other.test/mcp"' in text
    assert 'tools = {exclude = ["delete_*"]}' in text
    assert "headers" not in text
    assert text.index("[mcp.github]") < text.index("[mcp.local]")
    assert '[mcp.local]\ncommand = "uvx"' in text


def test_replace_renames_a_server(tmp_path: Path) -> None:
    path = tmp_path / "config.toml"
    path.write_text(FILE, encoding="utf-8")
    replace_mcp_server(path, "local", {"command": "npx"}, new_name="tools")
    text = path.read_text(encoding="utf-8")
    assert "[mcp.local]" not in text
    assert '[mcp.tools]\ncommand = "npx"' in text
    assert "[mcp.github]" in text


def test_replace_refuses_a_missing_table_and_a_taken_name(tmp_path: Path) -> None:
    path = tmp_path / "config.toml"
    path.write_text(FILE, encoding="utf-8")
    with pytest.raises(McpTableError):
        replace_mcp_server(path, "nope", {"command": "x"})
    with pytest.raises(McpExistsError):
        replace_mcp_server(path, "local", {"command": "x"}, new_name="github")
    assert path.read_text(encoding="utf-8") == FILE


def test_raw_write_checks_the_mtime(tmp_path: Path) -> None:
    path = tmp_path / "sub" / "config.toml"
    assert read_raw(path) == ("", None)
    first = write_raw(path, "log_level = 'INFO'\n", None)
    assert read_raw(path) == ("log_level = 'INFO'\n", first)
    with pytest.raises(RawConflictError, match="changed on disk"):
        write_raw(path, "x = 1\n", None)
    with pytest.raises(RawConflictError):
        write_raw(path, "x = 1\n", first - 1)
    second = write_raw(path, "log_level = 'DEBUG'\n", first)
    assert path.read_text(encoding="utf-8") == "log_level = 'DEBUG'\n"
    assert second >= first
