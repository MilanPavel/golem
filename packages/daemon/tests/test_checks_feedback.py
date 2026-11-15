"""A failed check goes back to the model as a note, up to ``fix_rounds`` times."""

from __future__ import annotations

from pathlib import Path
from typing import cast

import pytest
from fakes import Calls, ToolCallingChatModel
from langchain_core.messages import BaseMessage
from langgraph.checkpoint.memory import InMemorySaver

from golem.graphs.adapter import CheckCompleted, Fact, plain_messages, translate
from golem.graphs.chat import open_chat
from golem.graphs.notes import PREFIX, is_note, note
from golem.models.router import ModelRouter
from golem.permissions.policy import Policy
from golem.tools import sandbox

needs_sandbox = pytest.mark.skipif(not sandbox.available(), reason="needs the shell sandbox")

WRITE: Calls = [("write_file", {"path": "a.txt", "content": "x"})]
FIX: Calls = [("write_file", {"path": "a.txt", "content": "fixed"})]
# Fails until a.txt says "fixed".
CHECK = (
    '[[coding.check]]\nname = "lint"\n'
    "command = \"grep -q fixed a.txt || { echo 'a.txt is not fixed'; exit 1; }\"\n"
)


async def _run(
    tmp_path: Path, replies: list[str | Calls], rounds: int
) -> tuple[list[Fact], list[list[BaseMessage]], list[BaseMessage]]:
    home = tmp_path / "h"
    project = tmp_path / "p"
    home.mkdir()
    project.mkdir()
    file = home / "config.toml"
    file.write_text(f"[coding]\nfix_rounds = {rounds}\n" + CHECK, encoding="utf-8")
    model = ToolCallingChatModel(replies=replies)
    runtime = open_chat(ModelRouter(model=model), InMemorySaver(), policy=Policy(file, home=home))
    facts: list[Fact] = []
    async for part in runtime.stream(
        session_id="s_test",
        text="go",
        model_profile="remote",
        schema_version=1,
        user_message_id="m_user1",
        assistant_message_id="m_reply1",
        cwd=str(project),
        permission_mode="autopilot",
    ):
        fact = translate(part)
        if fact is not None:
            facts.append(fact)
    values = await runtime.values("s_test")
    messages = cast("list[BaseMessage]", values["messages"])
    return facts, model.seen, messages


def _done(facts: list[Fact]) -> list[tuple[str, int]]:
    return [(f.status, f.round) for f in facts if isinstance(f, CheckCompleted)]


def test_a_note_is_marked_and_starts_with_golem() -> None:
    n = note("hello")
    assert is_note(n)
    assert n.content == PREFIX + "hello"
    assert str(n.id).startswith("n_")


@needs_sandbox
async def test_a_failed_check_is_fixed_in_the_same_turn(tmp_path: Path) -> None:
    facts, seen, messages = await _run(tmp_path, [WRITE, "one", FIX, "two"], 2)
    assert _done(facts) == [("failed", 0), ("passed", 1)]
    notes = [m for m in messages if is_note(m)]
    assert len(notes) == 1
    text = str(notes[0].content)
    assert text.startswith("[golem] Checks failed after your changes.")
    assert "lint (exit 1):\na.txt is not fixed" in text
    assert text.endswith("Round 1 of 2.")
    assert any(m.id == notes[0].id for m in seen[2])
    assert len(seen) == 4


@needs_sandbox
async def test_still_failing_ends_after_fix_rounds_notes(tmp_path: Path) -> None:
    replies: list[str | Calls] = [WRITE, "one", WRITE, "two", WRITE, "three"]
    facts, _, messages = await _run(tmp_path, replies, 2)
    assert _done(facts) == [("failed", 0), ("failed", 1), ("failed", 2)]
    assert sum(is_note(m) for m in messages) == 2


@needs_sandbox
async def test_no_fix_rounds_sends_no_note(tmp_path: Path) -> None:
    facts, _, messages = await _run(tmp_path, [WRITE, "one"], 0)
    assert _done(facts) == [("failed", 0)]
    assert not any(is_note(m) for m in messages)


@needs_sandbox
async def test_a_round_without_an_edit_runs_the_checks_again(tmp_path: Path) -> None:
    facts, _, _ = await _run(tmp_path, [WRITE, "one", "no edit this time"], 1)
    assert _done(facts) == [("failed", 0), ("failed", 1)]


@needs_sandbox
async def test_a_note_is_no_user_message_in_the_stream_but_inspect_shows_it(
    tmp_path: Path,
) -> None:
    facts, _, messages = await _run(tmp_path, [WRITE, "one", FIX, "two"], 2)
    assert not any(type(f).__name__ == "MessageCompleted" for f in facts)
    users = [m.text for m in plain_messages({"messages": messages}) if m.role == "user"]
    assert users[0] == "go"
    assert users[1].startswith("[golem] ")
