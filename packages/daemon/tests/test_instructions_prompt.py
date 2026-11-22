"""The ``instructions`` section: the user's ``[chat]`` lines, read on each call."""

from __future__ import annotations

from pathlib import Path

from fakes import ToolCallingChatModel

from golem.config import load_settings
from golem.graphs.instructions_prompt import instructions_section
from golem.graphs.prompt import PromptContext, Section, SystemPrompt
from golem.models.router import ModelRouter


def _router(home: Path) -> ModelRouter:
    return ModelRouter(
        load_settings(home=home, project_dir=home),
        model=ToolCallingChatModel(replies=[]),
        home=home,
    )


def _write(home: Path, text: str) -> None:
    (home / "config.toml").write_text(text, "utf-8")


def test_no_lines_means_no_section_and_no_system_message(tmp_path: Path) -> None:
    prompt = SystemPrompt(sections=(instructions_section(_router(tmp_path)),))
    context = PromptContext(state={})
    assert prompt.parts(context) == []
    assert prompt.message(context) is None


def test_two_lines_give_the_exact_text(tmp_path: Path) -> None:
    _write(tmp_path, '[chat]\ninstructions = ["Keep it short.", "Use plain words."]\n')
    section = instructions_section(_router(tmp_path))
    assert section.name == "instructions"
    assert section(PromptContext(state={})) == (
        "How the user wants you to answer. Follow these unless the user asks otherwise "
        "in the chat:\n- Keep it short.\n- Use plain words."
    )


def test_it_comes_before_the_pinned_skills_and_the_rest(tmp_path: Path) -> None:
    _write(tmp_path, '[chat]\ninstructions = ["Keep it short."]\n')
    prompt = SystemPrompt(
        sections=(
            instructions_section(_router(tmp_path)),
            Section("pinned_skills", lambda _context: "pinned"),
        )
    )
    names = [name for name, _ in prompt.parts(PromptContext(state={}))]
    assert names == ["instructions", "pinned_skills"]


def test_a_config_edit_shows_on_the_next_call(tmp_path: Path) -> None:
    section = instructions_section(_router(tmp_path))
    context = PromptContext(state={})
    assert section(context) is None
    _write(tmp_path, '[chat]\ninstructions = ["First."]\n')
    first = section(context)
    assert first is not None and first.endswith("- First.")
    _write(tmp_path, '[chat]\ninstructions = ["Second line, longer."]\n')
    second = section(context)
    assert second is not None and second.endswith("- Second line, longer.")
    _write(tmp_path, "[chat]\ninstructions = []\n")
    assert section(context) is None
