"""Reading one agent file: fields, defaults, and every way it can be wrong."""

from __future__ import annotations

from pathlib import Path

from golem.agents.bundled import bundled_agents_dir
from golem.agents.model import AgentLimits
from golem.agents.parse import MAX_FILE_BYTES, builtin_tool_names, parse_agent
from golem.config import ExplorerSettings
from golem.graphs.child import ChildLimits

TOOLS = frozenset({"read_file", "grep", "shell"})

EXPLORER_TOOLS = frozenset(
    {"read_file", "list_dir", "glob", "grep", "git_log", "git_diff", "git_status", "read_artifact"}
)
EXPLORER_PROMPT = (
    "You are a helper. Answer the brief. Read only what you need. End with a short answer: "
    "findings first, then the paths that matter. Do not ask questions."
)
"""What the explorer was before it came from a file: the file keeps it word for word."""


def _write(tmp_path: Path, name: str, text: str) -> Path:
    path = tmp_path / name
    path.write_text(text, encoding="utf-8")
    return path


def test_a_full_file_is_read(tmp_path: Path) -> None:
    path = _write(
        tmp_path,
        "checker.md",
        "---\nname: checker\ndescription: Checks a thing.\nmodel: stronger\n"
        "tools: read_file, grep\nmax-calls: 7\nmax-seconds: 90\nmax-cost-usd: 0.5\n"
        "max-answer-chars: 2000\nasks: true\nowner: me\n---\nCheck it.\n",
    )

    agent = parse_agent(path, known_tools=TOOLS)

    assert agent.errors == ()
    assert (agent.name, agent.description, agent.wish) == ("checker", "Checks a thing.", "stronger")
    assert agent.tools == ("read_file", "grep")
    assert agent.limits == AgentLimits(7, 90, 0.5, 2000)
    assert agent.asks is True
    assert agent.body == "Check it."
    assert agent.extras == {"owner": "me"}
    assert len(agent.hash) == 64


def test_defaults_are_the_lead_model_no_tools_no_limits_and_no_questions(tmp_path: Path) -> None:
    path = _write(tmp_path, "plain.md", "---\ndescription: Plain.\n---\nDo it.\n")

    agent = parse_agent(path, known_tools=TOOLS)

    assert agent.valid
    assert agent.name == "plain"
    assert (agent.wish, agent.tools, agent.limits, agent.asks) == (
        "same",
        (),
        AgentLimits(),
        False,
    )


def test_a_model_name_is_a_wish_and_is_not_resolved(tmp_path: Path) -> None:
    path = _write(tmp_path, "pinned.md", "---\ndescription: D.\nmodel: qwen3:8b\n---\nGo.\n")

    assert parse_agent(path, known_tools=TOOLS).wish == "qwen3:8b"


def test_a_model_wish_with_spaces_is_an_error(tmp_path: Path) -> None:
    path = _write(tmp_path, "bad.md", "---\ndescription: D.\nmodel: two words\n---\nGo.\n")

    assert any("`model`" in e for e in parse_agent(path, known_tools=TOOLS).errors)


def test_tools_may_be_a_list(tmp_path: Path) -> None:
    path = _write(
        tmp_path, "list.md", "---\ndescription: D.\ntools:\n  - read_file\n  - grep\n---\nGo.\n"
    )

    assert parse_agent(path, known_tools=TOOLS).tools == ("read_file", "grep")


def test_a_tool_that_does_not_exist_is_an_error_not_a_crash(tmp_path: Path) -> None:
    path = _write(
        tmp_path, "ghost.md", "---\ndescription: D.\ntools: read_file, teleport\n---\nGo.\n"
    )

    agent = parse_agent(path, known_tools=TOOLS)

    assert not agent.valid
    assert any("teleport" in e and "does not have" in e for e in agent.errors)


def test_tool_names_default_to_golems_own_tools(tmp_path: Path) -> None:
    path = _write(tmp_path, "own.md", "---\ndescription: D.\ntools: read_file, shell\n---\nGo.\n")
    ghost = _write(tmp_path, "ghost.md", "---\ndescription: D.\ntools: nope\n---\nGo.\n")

    assert {"read_file", "shell", "write_file", "grep"} <= builtin_tool_names()
    assert parse_agent(path).valid
    assert not parse_agent(ghost).valid


def test_the_description_is_required(tmp_path: Path) -> None:
    path = _write(tmp_path, "mute.md", "---\nmodel: same\n---\nGo.\n")

    assert any("`description`" in e for e in parse_agent(path, known_tools=TOOLS).errors)


def test_an_empty_prompt_is_an_error(tmp_path: Path) -> None:
    path = _write(tmp_path, "empty.md", "---\ndescription: D.\n---\n\n")

    assert any("prompt is empty" in e for e in parse_agent(path, known_tools=TOOLS).errors)


def test_the_name_must_match_the_file(tmp_path: Path) -> None:
    path = _write(tmp_path, "one.md", "---\nname: other\ndescription: D.\n---\nGo.\n")

    assert any("must match" in e for e in parse_agent(path, known_tools=TOOLS).errors)


def test_a_bad_file_name_is_an_error(tmp_path: Path) -> None:
    path = _write(tmp_path, "Bad_Name.md", "---\ndescription: D.\n---\nGo.\n")

    assert any("file name" in e for e in parse_agent(path, known_tools=TOOLS).errors)


def test_limits_must_be_positive_numbers(tmp_path: Path) -> None:
    path = _write(
        tmp_path,
        "limits.md",
        "---\ndescription: D.\nmax-calls: 0\nmax-seconds: soon\nmax-cost-usd: -1\n"
        "max-answer-chars: true\nasks: maybe\n---\nGo.\n",
    )

    agent = parse_agent(path, known_tools=TOOLS)

    assert agent.limits == AgentLimits()
    assert len(agent.errors) == 5


def test_broken_yaml_and_a_missing_closing_line_are_errors(tmp_path: Path) -> None:
    yaml = _write(tmp_path, "yaml.md", "---\ndescription: [oops\n---\nGo.\n")
    open_ = _write(tmp_path, "open.md", "---\ndescription: D.\nGo.\n")

    assert any("not valid YAML" in e for e in parse_agent(yaml, known_tools=TOOLS).errors)
    assert any("no closing" in e for e in parse_agent(open_, known_tools=TOOLS).errors)


def test_a_file_that_is_not_there_or_too_big_or_not_utf8_is_an_error(tmp_path: Path) -> None:
    missing = parse_agent(tmp_path / "gone.md", known_tools=TOOLS)
    big = _write(tmp_path, "big.md", "---\ndescription: D.\n---\n" + "x" * MAX_FILE_BYTES)
    binary = tmp_path / "binary.md"
    binary.write_bytes(b"---\ndescription: D.\n---\n\xff\xfe\n")

    assert any("cannot read" in e for e in missing.errors)
    assert any("limit" in e for e in parse_agent(big, known_tools=TOOLS).errors)
    assert any("UTF-8" in e for e in parse_agent(binary, known_tools=TOOLS).errors)


def test_the_bundled_explorer_is_todays_explorer() -> None:
    explorer = parse_agent(bundled_agents_dir() / "explorer.md")
    today = ExplorerSettings()

    assert explorer.valid
    assert explorer.body == EXPLORER_PROMPT
    assert set(explorer.tools) == EXPLORER_TOOLS
    assert explorer.wish == "cheapest"
    assert explorer.asks is False
    assert explorer.limits.max_calls == today.max_calls == ChildLimits().max_calls
    assert explorer.limits.max_seconds == today.timeout_seconds
    assert explorer.limits.answer_chars == today.answer_chars


def test_the_four_bundled_files_are_valid_and_match_the_adr_table() -> None:
    folder = bundled_agents_dir()
    agents = {path.stem: parse_agent(path) for path in sorted(folder.glob("*.md"))}

    assert sorted(agents) == ["advisor", "explorer", "reviewer", "worker"]
    for agent in agents.values():
        assert agent.valid, agent.errors
    assert {name: agent.wish for name, agent in agents.items()} == {
        "explorer": "cheapest",
        "worker": "cheapest",
        "reviewer": "stronger",
        "advisor": "stronger",
    }
    assert {name for name, agent in agents.items() if agent.asks} == {"worker"}
    assert agents["advisor"].tools == ()
    assert set(agents["reviewer"].tools) == EXPLORER_TOOLS - {"read_artifact"}
    assert {"write_file", "edit_file", "shell"} <= set(agents["worker"].tools)
