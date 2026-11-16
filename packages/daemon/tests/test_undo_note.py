"""After an undo, the model's next turn starts with a note that names the files."""

from __future__ import annotations

from pathlib import Path

import pytest
from fakes import ToolCallingChatModel
from langchain_core.messages import BaseMessage
from langgraph.checkpoint.memory import InMemorySaver

from golem.coding.changes import ChangeStore
from golem.graphs.adapter import Fact, plain_messages, translate
from golem.graphs.chat import ChatRuntime, open_chat
from golem.graphs.notes import is_note
from golem.models.router import ModelRouter
from golem.store.blobs import BlobStore
from golem.store.database import Database

SESSION = "s_test"
NOTE = (
    "[golem] Since your last reply the user undid your changes to: a.py, b.py. "
    "These files are back to their earlier text. Read a file again before you edit it."
)


@pytest.fixture
async def store(database: Database) -> ChangeStore:
    async with database.transaction() as tx:
        await tx.execute(
            "INSERT INTO sessions (session_id, model_profile, created_at, updated_at)"
            " VALUES (?, 'p', 't', 't')",
            (SESSION,),
        )
    return ChangeStore(database, BlobStore(database))


def _runtime(model: ToolCallingChatModel, store: ChangeStore) -> ChatRuntime:
    runtime = open_chat(ModelRouter(model=model), InMemorySaver())
    runtime.changes = store
    return runtime


async def _turn(runtime: ChatRuntime, tmp_path: Path, n: int) -> None:
    async for _ in runtime.stream(
        session_id=SESSION,
        text=f"go {n}",
        model_profile="remote",
        schema_version=1,
        user_message_id=f"m_user{n}",
        assistant_message_id=f"m_reply{n}",
        cwd=str(tmp_path),
    ):
        pass


async def _undo(store: ChangeStore, *paths: str) -> None:
    for path in paths:
        await store.record(
            session_id=SESSION,
            run_id=None,
            call_id=None,
            path=path,
            before="new",
            after="old",
            source="revert",
        )


def _notes(history: list[BaseMessage]) -> list[str]:
    return [str(m.content) for m in history if is_note(m)]


async def test_the_next_turn_after_an_undo_has_the_note_once(
    tmp_path: Path, store: ChangeStore
) -> None:
    model = ToolCallingChatModel(replies=["one", "two", "three"])
    runtime = _runtime(model, store)
    await _turn(runtime, tmp_path, 1)
    assert _notes(model.seen[0]) == []
    await _undo(store, "a.py", "b.py", "a.py")
    await _turn(runtime, tmp_path, 2)
    first = model.seen[1]
    assert _notes(first) == [NOTE]
    assert is_note(first[-2]) and not is_note(first[-1])
    await _turn(runtime, tmp_path, 3)
    # The note stays in the history, and no second one is added.
    assert _notes(model.seen[2]) == [NOTE]


async def test_the_transcript_leaves_the_note_out_and_inspect_shows_it(
    tmp_path: Path, store: ChangeStore
) -> None:
    model = ToolCallingChatModel(replies=["one", "two"])
    runtime = _runtime(model, store)
    await _turn(runtime, tmp_path, 1)
    await _undo(store, "a.py")
    facts: list[Fact] = []
    async for part in runtime.stream(
        session_id=SESSION,
        text="go 2",
        model_profile="remote",
        schema_version=1,
        user_message_id="m_user2",
        assistant_message_id="m_reply2",
        cwd=str(tmp_path),
    ):
        fact = translate(part)
        if fact is not None:
            facts.append(fact)
    assert facts
    assert not any("undid your changes" in repr(fact) for fact in facts)
    # What the model sees, which /debug model shows, has it.
    shown = [m.text for m in plain_messages(await runtime.values(SESSION))]
    assert any("undid your changes to: a.py" in text for text in shown)


async def test_more_than_twenty_paths_are_cut(tmp_path: Path, store: ChangeStore) -> None:
    model = ToolCallingChatModel(replies=["one", "two"])
    runtime = _runtime(model, store)
    await _turn(runtime, tmp_path, 1)
    await _undo(store, *[f"f{i}.py" for i in range(23)])
    await _turn(runtime, tmp_path, 2)
    (text,) = _notes(model.seen[1])
    assert "f19.py and 3 more." in text
    assert "f20.py" not in text
