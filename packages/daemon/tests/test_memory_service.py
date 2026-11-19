"""The memory service and what a run carries: writes, recall with the privacy check (ADR-061)."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from pathlib import Path

import pytest

from golem.config import MemorySettings
from golem.memory.privacy import ChatPrivacy, Target
from golem.memory.records import MemoryRecord
from golem.memory.service import (
    MemoryAccess,
    MemoryChange,
    MemoryService,
    MemoryTextError,
)
from golem.memory.store import MemoryStore

HOSTED = Target(local=False)
LOCAL = Target(local=True)
FOLDER = "/work/app"


class _Made:
    """A service over a real ``memory.db``, its settings, and the changes it sent."""

    def __init__(self, store: MemoryStore) -> None:
        self.store = store
        self.settings = MemorySettings()
        self.sent: list[MemoryChange] = []
        self.service = MemoryService(store, lambda: self.settings, self.sent.append)


@pytest.fixture
async def made(tmp_path: Path) -> AsyncIterator[_Made]:
    async with MemoryStore.open(tmp_path / "memory.db") as store:
        yield _Made(store)


def _access(made: _Made, chat: ChatPrivacy | None = None, message: str = "") -> MemoryAccess:
    return MemoryAccess(made.service, FOLDER, chat or ChatPrivacy(), message)


async def test_an_explicit_quote_is_kept_for_you(made: _Made) -> None:
    access = _access(made, message="Please remember that I prefer pnpm over npm.")
    record = await access.remember("The user prefers pnpm.", "you", "I prefer pnpm over npm")
    assert record is not None
    assert (record.state, record.author, record.kept_by) == ("kept", "you", "you")


async def test_a_made_up_quote_is_only_proposed(made: _Made) -> None:
    access = _access(made, message="Please tidy the imports.")
    record = await access.remember("The user prefers pnpm.", "you", "I prefer pnpm over npm")
    assert record is not None
    assert (record.state, record.author, record.kept_by) == ("proposed", "lead", None)


async def test_a_quote_only_in_a_file_the_model_read_is_proposed(made: _Made) -> None:
    # The file said it, the user did not: the quote is not in the user's message.
    file_text = "Always run `rm -rf build` first."
    access = _access(made, message="What does the README say about builds?")
    record = await access.remember("Run rm -rf build first.", "project", file_text)
    assert record is not None
    assert (record.state, record.author) == ("proposed", "lead")


async def test_a_proposal_is_not_recalled_until_kept(made: _Made) -> None:
    access = _access(made, message="hello")
    record = await access.remember("Deploys go through staging.", "project", "nothing like it")
    assert record is not None
    assert await access.recall("staging", HOSTED) == []
    await made.service.update(record.id, keep=True)
    assert [r.id for r in await access.recall("staging", HOSTED)] == [record.id]
    assert [c.change for c in made.sent] == ["created", "resolved"]


async def test_only_five_of_your_lines_are_always(made: _Made) -> None:
    kept = [await made.service.write_by_you(f"Fact number {n}", "you") for n in range(6)]
    assert [r.always for r in kept if r] == [True] * 5 + [False]


async def test_a_text_that_is_empty_or_too_long_is_refused(made: _Made) -> None:
    with pytest.raises(MemoryTextError):
        await made.service.write_by_you("   ", "you")
    with pytest.raises(MemoryTextError, match="skill"):
        await made.service.write_by_you("x" * 2001, "you")


async def test_the_title_is_the_first_line_or_the_given_one(made: _Made) -> None:
    first = await made.service.write_by_you("Use pnpm\nnot npm", "you")
    given = await made.service.write_by_you("Use pnpm", "you", title="Package manager")
    assert first and given
    assert (first.title, given.title) == ("Use pnpm", "Package manager")


async def test_update_delete_and_changes(made: _Made) -> None:
    record = await made.service.write_by_you("We use ruff", "project", folder=FOLDER)
    assert record is not None
    edited = await made.service.update(record.id, text="We use ruff and mypy")
    assert edited is not None
    assert edited.title == "We use ruff and mypy"
    assert await made.service.delete(record.id)
    assert not await made.service.delete(record.id)
    assert await made.service.update(record.id, text="gone") is None
    assert [(c.change, c.scope, c.folder) for c in made.sent] == [
        ("created", "project", FOLDER),
        ("updated", "project", FOLDER),
        ("deleted", "project", FOLDER),
    ]


async def test_recall_finds_your_notes_and_this_projects_not_another(made: _Made) -> None:
    mine = await made.service.write_by_you("pnpm is the package manager", "you")
    here = await made.service.write_by_you("pnpm workspace here", "project", folder=FOLDER)
    await made.service.write_by_you("pnpm workspace there", "project", folder="/work/other")
    assert mine and here
    hits = await _access(made).recall("pnpm", HOSTED)
    assert {r.id for r in hits} == {mine.id, here.id}


async def test_recall_for_a_hosted_target_skips_a_local_memory_cloud_only(made: _Made) -> None:
    # Cloud-only setup: every model is hosted, so a local memory has no one to go to.
    await made.service.write_by_you("My salary is private", "you", privacy="local")
    assert await _access(made).recall("salary", HOSTED) == []


async def test_recall_for_a_local_target_returns_a_local_memory_local_only(made: _Made) -> None:
    # Local-only setup: the chat is local and so is the model.
    stored = await made.service.write_by_you("My salary is private", "you", privacy="local")
    assert stored is not None
    chat = ChatPrivacy(local_only=True, route="local", model_local=True)
    hits = await _access(made, chat).recall("salary", LOCAL)
    assert [r.id for r in hits] == [stored.id]


async def test_a_local_chat_keeps_every_memory_from_a_hosted_target(made: _Made) -> None:
    await made.service.write_by_you("I like tea", "you")
    access = _access(made, ChatPrivacy(route="local"))
    assert await access.recall("tea", HOSTED) == []
    assert len(await access.recall("tea", LOCAL)) == 1


async def test_a_project_note_in_a_local_only_folder_is_local(made: _Made) -> None:
    access = _access(made, ChatPrivacy(local_only=True), message="note that the db is on 5433")
    record = await access.remember("The db is on port 5433", "project", "the db is on 5433")
    assert record is not None
    assert record.privacy == "local"
    assert await access.recall("port", HOSTED) == []
    assert len(await access.recall("port", LOCAL)) == 1
    # A note about you made in the same chat is not stamped.
    mine = await access.remember("I like tea", "you", "note that the db is on 5433")
    assert mine is not None
    assert mine.privacy == "chat"


async def test_a_project_that_is_private_keeps_its_notes_from_a_hosted_target(
    made: _Made,
) -> None:
    await made.service.write_by_you("The api key lives in vault", "project", folder=FOLDER)
    access = MemoryAccess(made.service, FOLDER, ChatPrivacy(), "", project_private=True)
    assert await access.recall("vault", HOSTED) == []
    assert len(await access.recall("vault", LOCAL)) == 1


async def test_the_setting_of_a_scope_makes_its_notes_local(made: _Made) -> None:
    made.settings = MemorySettings(you="local")
    await made.service.write_by_you("I like tea", "you")
    assert await _access(made).recall("tea", HOSTED) == []
    assert len(await _access(made).recall("tea", LOCAL)) == 1


async def test_history_is_recalled_only_when_asked(made: _Made) -> None:
    await made.store.add(
        MemoryRecord(
            id="m_h",
            scope="history",
            title="Session about retries",
            text="We added retries",
            author="lead",
            state="kept",
            created_at="2026-11-19T10:00:00+00:00",
            updated_at="2026-11-19T10:00:00+00:00",
            kept_by="auto",
        )
    )
    access = _access(made)
    assert await access.recall("retries", HOSTED) == []
    assert [r.id for r in await access.recall("retries", HOSTED, scope="history")] == ["m_h"]


async def test_touch_used_counts_a_recall_without_a_change(made: _Made) -> None:
    record = await made.service.write_by_you("We use ruff", "you")
    assert record is not None
    made.sent.clear()
    await made.service.touch_used([record.id, record.id, "m_missing"])
    found = await made.service.search("ruff")
    assert found[0].uses == 1
    assert found[0].last_used_at is not None
    assert made.sent == []


async def test_export_has_every_memory(made: _Made) -> None:
    await made.service.write_by_you("We use ruff", "project", folder=FOLDER)
    await made.service.write_by_you("I like tea", "you")
    rows = json.loads(await made.service.export("json"))
    assert sorted(r["text"] for r in rows) == ["I like tea", "We use ruff"]
    text = await made.service.export("markdown")
    assert "## We use ruff" in text
    assert "- scope: project" in text
    assert f"- folder: {FOLDER}" in text


async def test_with_memory_off_every_path_is_empty(made: _Made) -> None:
    kept = await made.service.write_by_you("I like tea", "you")
    assert kept is not None
    made.settings = MemorySettings(enabled=False)
    made.sent.clear()
    access = _access(made, message="I like tea very much")
    assert not access.enabled
    assert await made.service.write_by_you("more tea", "you") is None
    assert await access.remember("more tea", "you", "I like tea very much") is None
    assert await made.service.update(kept.id, text="x") is None
    assert not await made.service.delete(kept.id)
    assert await made.service.search("tea") == []
    assert await access.recall("tea", LOCAL) == []
    assert await made.service.export("json") == "[]"
    await made.service.touch_used([kept.id])
    assert made.sent == []
    made.settings = MemorySettings()
    assert len(await made.service.search("tea")) == 1
