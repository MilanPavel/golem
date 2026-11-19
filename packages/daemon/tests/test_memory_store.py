"""``memory.db``: records, word search, the fallback, and the upgrade rules (ADR-061)."""

from __future__ import annotations

import sqlite3
from dataclasses import replace
from pathlib import Path
from typing import Any, cast

import pytest

from golem.memory.migrations import MIGRATIONS, migrations
from golem.memory.records import MemoryRecord, Scope, SourceRow
from golem.memory.store import MemoryStore
from golem.store.database import Database, DatabaseTooNewError

_NOW = "2026-11-19T10:00:00+00:00"


def _memory(
    memory_id: str,
    text: str,
    *,
    title: str | None = None,
    scope: Scope = "you",
    folder: str | None = None,
    created: int = 0,
    sources: tuple[SourceRow, ...] = (),
) -> MemoryRecord:
    stamp = f"2026-11-19T10:00:{created:02d}+00:00"
    return MemoryRecord(
        id=memory_id,
        scope=scope,
        folder=folder,
        title=title or text.splitlines()[0][:120],
        text=text,
        author="you",
        state="kept",
        kept_by="you",
        created_at=stamp,
        updated_at=stamp,
        sources=sources,
    )


def _rows(path: Path, sql: str) -> list[tuple[object, ...]]:
    with sqlite3.connect(path) as raw:
        return raw.execute(sql).fetchall()


async def test_a_memory_reads_back_with_its_sources(tmp_path: Path) -> None:
    source = SourceRow("app/client.py", "ab" * 32, 120, 1_700_000_000, _NOW)
    record = replace(
        _memory("m_1", "Requests go through app/client.py", scope="project", folder="/repo"),
        session_id="s_1",
        agent="explore",
        call_id="c_1",
        privacy="local",
        always=True,
        uses=2,
        last_used_at=_NOW,
        sources=(source,),
    )
    async with MemoryStore.open(tmp_path / "memory.db") as store:
        await store.add(record)
        assert await store.get("m_1") == record
        assert await store.get("m_nothing") is None


async def test_add_edit_search_and_delete_keep_the_search_entry_in_step(tmp_path: Path) -> None:
    path = tmp_path / "memory.db"
    async with MemoryStore.open(path) as store:
        assert store.search_kind == "fts"
        record = _memory("m_1", "The client will retry a failed request")
        await store.add(record)
        await store.add(_memory("m_2", "I prefer pnpm", created=1))

        # The porter stemmer makes "retries" and "retry" the same word.
        assert [hit.id for hit in await store.search("retries")] == ["m_1"]

        await store.update(replace(record, text="Use exponential backoff", title="Backoff"))
        assert await store.search("retries") == []
        assert [hit.id for hit in await store.search("backoff")] == ["m_1"]
        assert _rows(path, "SELECT count(*) FROM memory_fts WHERE id = 'm_1'") == [(1,)]

        assert await store.delete_many(["m_1", "m_1", "m_missing"]) == 1
        assert await store.get("m_1") is None
        assert await store.search("backoff") == []
        assert _rows(path, "SELECT id FROM memory_fts") == [("m_2",)]


async def test_a_title_hit_ranks_above_a_text_hit(tmp_path: Path) -> None:
    async with MemoryStore.open(tmp_path / "memory.db") as store:
        # Same length of text, so only the weight of the column tells them apart.
        await store.add(_memory("m_text", "the build", title="Notes", created=2))
        await store.add(_memory("m_title", "Notes", title="the build", created=0))
        assert [hit.id for hit in await store.search("build")] == ["m_title", "m_text"]


async def test_search_joins_words_with_or_and_filters(tmp_path: Path) -> None:
    async with MemoryStore.open(tmp_path / "memory.db") as store:
        await store.add(_memory("m_1", "I prefer pnpm", created=0))
        await store.add(_memory("m_2", "Tests use pytest", scope="project", folder="/a", created=1))
        await store.add(_memory("m_3", "Tests use vitest", scope="project", folder="/b", created=2))
        assert {hit.id for hit in await store.search("pnpm pytest")} == {"m_1", "m_2"}
        found = await store.search("tests", scope="project", folder="/b")
        assert [hit.id for hit in found] == ["m_3"]
        assert len(await store.search("tests", limit=1)) == 1


@pytest.mark.parametrize("query", ["", "   ", "!!! ---", '"', "*", "AND OR NOT", 'a" OR "b', "(x"])
async def test_a_query_never_breaks_the_search(tmp_path: Path, query: str) -> None:
    async with MemoryStore.open(tmp_path / "memory.db") as store:
        await store.add(_memory("m_1", "and or not"))
        hits = await store.search(query)
        if not any(character.isalnum() for character in query):
            assert hits == []


async def test_without_fts5_the_store_searches_with_like(tmp_path: Path) -> None:
    path = tmp_path / "memory.db"
    async with MemoryStore.open(path, fts=False) as store:
        assert store.search_kind == "like"
        await store.add(_memory("m_1", "I prefer pnpm", created=0))
        await store.add(_memory("m_2", "Tests run with pytest", created=1))
        await store.add(_memory("m_3", "Both pnpm and pytest", scope="project", created=2))
        assert [hit.id for hit in await store.search("pnpm")] == ["m_3", "m_1"]  # unranked
        assert {hit.id for hit in await store.search("pnpm pytest")} == {"m_1", "m_2", "m_3"}
        assert [hit.id for hit in await store.search("pnpm", scope="project")] == ["m_3"]
        assert await store.search("") == []
        # `%` and `_` are text, not wildcards.
        await store.add(_memory("m_4", "100% done", created=3))
        assert await store.search("%") == []
        assert [hit.id for hit in await store.search("100")] == ["m_4"]
        await store.delete_many(["m_1"])
        assert [hit.id for hit in await store.search("pnpm")] == ["m_3"]
    assert _rows(path, "SELECT name FROM sqlite_master WHERE name LIKE 'memory_fts%'") == []
    assert _rows(path, "PRAGMA user_version") == [(len(MIGRATIONS),)]


async def test_the_fallback_finds_what_fts_finds_for_a_whole_word(tmp_path: Path) -> None:
    async def hits(path: Path, *, fts: bool) -> set[str]:
        async with MemoryStore.open(path, fts=fts) as store:
            await store.add(_memory("m_1", "I prefer pnpm", created=0))
            await store.add(_memory("m_2", "Tests run with pytest", created=1))
            return {hit.id for hit in await store.search("pnpm pytest")}

    assert await hits(tmp_path / "a.db", fts=True) == await hits(tmp_path / "b.db", fts=False)


async def test_a_file_made_without_fts5_keeps_searching_with_like(tmp_path: Path) -> None:
    path = tmp_path / "memory.db"
    async with MemoryStore.open(path, fts=False) as store:
        await store.add(_memory("m_1", "I prefer pnpm"))
    async with MemoryStore.open(path, fts=True) as store:
        assert store.search_kind == "like"
        assert [hit.id for hit in await store.search("pnpm")] == ["m_1"]


async def test_list_filters_pages_and_counts(tmp_path: Path) -> None:
    async with MemoryStore.open(tmp_path / "memory.db") as store:
        for number in range(5):
            await store.add(_memory(f"m_{number}", f"you {number}", created=number))
        await store.add(_memory("m_p1", "note", scope="project", folder="/a", created=10))
        proposed = replace(
            _memory("m_p2", "idea", scope="project", folder="/a", created=11),
            state="proposed",
            kept_by=None,
        )
        await store.add(proposed)
        await store.add(_memory("m_h", "summary", scope="history", created=12))

        first = await store.list(scope="you", limit=2)
        assert [r.id for r in first] == ["m_4", "m_3"]
        second = await store.list(scope="you", limit=2, after=first[-1].id)
        assert [r.id for r in second] == ["m_2", "m_1"]
        assert await store.list(scope="you", after="m_0") == []
        assert [r.id for r in await store.list(folder="/a", state="proposed")] == ["m_p2"]
        assert len(await store.list()) == 8

        assert await store.counts() == {"you": 5, "project": 2, "history": 1}
        assert await store.counts(folder="/a") == {"you": 0, "project": 2, "history": 0}
        assert await store.counts(state="proposed") == {"you": 0, "project": 1, "history": 0}


async def test_update_replaces_sources_and_reports_a_missing_memory(tmp_path: Path) -> None:
    old = SourceRow("a.py", "00" * 32, 1, 1, _NOW)
    new = SourceRow("b.py", "11" * 32, 2, 2, _NOW)
    async with MemoryStore.open(tmp_path / "memory.db") as store:
        record = _memory("m_1", "note", scope="project", folder="/a", sources=(old,))
        await store.add(record)
        stale = replace(record, state="stale", sources=(new,), updated_at=_NOW)
        assert await store.update(stale)
        assert await store.get("m_1") == stale
        assert not await store.update(replace(record, id="m_missing"))


async def test_deleting_a_memory_deletes_its_sources(tmp_path: Path) -> None:
    path = tmp_path / "memory.db"
    source = SourceRow("a.py", "00" * 32, 1, 1, _NOW)
    async with MemoryStore.open(path) as store:
        await store.add(_memory("m_1", "note", scope="project", folder="/a", sources=(source,)))
        await store.delete_many(["m_1"])
    assert _rows(path, "SELECT count(*) FROM memory_sources") == [(0,)]


@pytest.mark.parametrize(
    "change",
    [
        {"scope": "everyone"},
        {"state": "deleted"},
        {"privacy": "secret"},
        {"author": "robot"},
        {"kept_by": "robot"},
    ],
)
async def test_the_database_refuses_a_value_outside_the_vocabulary(
    tmp_path: Path, change: dict[str, str]
) -> None:
    bad = replace(_memory("m_1", "note"), **cast(dict[str, Any], change))
    async with MemoryStore.open(tmp_path / "memory.db") as store:
        with pytest.raises(sqlite3.IntegrityError):
            await store.add(bad)
        assert await store.get("m_1") is None


async def test_a_newer_file_is_refused_and_names_the_golem_and_the_copy(tmp_path: Path) -> None:
    path = tmp_path / "memory.db"
    async with MemoryStore.open(path):
        pass
    newer = len(MIGRATIONS) + 1
    with sqlite3.connect(path) as raw:
        raw.execute(
            "INSERT INTO schema_version (version, golem_version, applied_at) VALUES (?, ?, ?)",
            (newer, "0.9.0", _NOW),
        )
        raw.execute(f"PRAGMA user_version = {newer}")
    (tmp_path / f"memory.db.bak-{len(MIGRATIONS)}").write_bytes(b"")

    with pytest.raises(DatabaseTooNewError) as caught:
        async with MemoryStore.open(path):
            pass
    error = caught.value
    assert (error.found, error.supported, error.needs) == (newer, len(MIGRATIONS), "0.9.0")
    message = str(error)
    assert message.startswith("memory.db is at schema")
    assert "needs golem 0.9.0 or newer" in message
    assert f"memory.db.bak-{len(MIGRATIONS)}" in message
    assert _rows(path, "PRAGMA user_version") == [(newer,)]


async def test_an_older_file_is_copied_before_it_is_upgraded(tmp_path: Path) -> None:
    path = tmp_path / "memory.db"
    # A file as the first schema left it: the tables, and no search table yet.
    async with Database.open(path, migrations(fts=True)[:1]):
        pass
    with sqlite3.connect(path) as raw:
        raw.execute(
            "INSERT INTO memories (id, scope, title, text, author, state, privacy, created_at,"
            " updated_at) VALUES ('m_old', 'you', 'Old', 'I like retries', 'you', 'kept', 'chat',"
            " ?, ?)",
            (_NOW, _NOW),
        )
    assert _rows(path, "PRAGMA user_version") == [(1,)]

    async with MemoryStore.open(path, fts=True) as store:
        assert [hit.id for hit in await store.search("retry")] == ["m_old"]

    backup = tmp_path / "memory.db.bak-1"
    assert _rows(backup, "PRAGMA user_version") == [(1,)]
    assert _rows(backup, "SELECT id FROM memories") == [("m_old",)]
    assert _rows(path, "PRAGMA user_version") == [(len(MIGRATIONS),)]
    assert not (tmp_path / "memory.db.bak-1.partial").exists()


async def test_a_new_or_current_file_is_not_copied(tmp_path: Path) -> None:
    path = tmp_path / "memory.db"
    async with MemoryStore.open(path):
        pass
    async with MemoryStore.open(path):
        pass
    assert sorted(item.name for item in tmp_path.iterdir() if ".bak-" in item.name) == []
    assert _rows(path, "SELECT version FROM schema_version") == [(1,), (2,)]
