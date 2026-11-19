"""The export of memories as JSON and Markdown (ADR-061)."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from pathlib import Path

import pytest

from golem.memory.export import render
from golem.memory.records import MemoryRecord, SourceRow
from golem.memory.store import MemoryStore


def _records() -> list[MemoryRecord]:
    source = SourceRow("app/client.py", "ab" * 32, 12, 99, "2026-01-02T00:00:00+00:00")
    return [
        MemoryRecord(
            id="m_2",
            scope="project",
            title="Client is thin",
            text="The client only forwards calls.",
            author="lead",
            state="stale",
            created_at="2026-01-02T00:00:00+00:00",
            updated_at="2026-01-03T00:00:00+00:00",
            folder="/work/app",
            session_id="s_1",
            agent="reader",
            call_id="c_1",
            kept_by="you",
            privacy="local",
            always=True,
            uses=3,
            last_used_at="2026-01-04T00:00:00+00:00",
            sources=(source,),
        ),
        MemoryRecord(
            id="m_1",
            scope="you",
            title="pnpm",
            text="Use pnpm, not npm. Naïve ✓",
            author="you",
            state="kept",
            created_at="2026-01-01T00:00:00+00:00",
            updated_at="2026-01-01T00:00:00+00:00",
            kept_by="you",
        ),
    ]


@pytest.fixture
async def store(tmp_path: Path) -> AsyncIterator[MemoryStore]:
    async with MemoryStore.open(tmp_path / "memory.db") as opened:
        yield opened


async def _all(store: MemoryStore) -> list[MemoryRecord]:
    return await store.list(limit=200)


def test_json_has_every_field_of_every_row() -> None:
    rows = json.loads(render(_records(), "json"))
    assert [row["id"] for row in rows] == ["m_2", "m_1"]
    assert set(rows[0]) == {
        "id", "scope", "title", "text", "author", "state", "created_at", "updated_at",
        "folder", "session_id", "agent", "call_id", "kept_by", "privacy", "always", "uses",
        "last_used_at", "sources",
    }  # fmt: skip
    assert rows[0]["sources"] == [
        {
            "path": "app/client.py",
            "sha256": "ab" * 32,
            "size": 12,
            "mtime_ns": 99,
            "checked_at": "2026-01-02T00:00:00+00:00",
        }
    ]
    assert "Naïve ✓" in render(_records(), "json")


def test_markdown_has_a_section_for_each_memory_with_scope_author_state_and_sources() -> None:
    text = render(_records(), "markdown")
    first, second = text.split("\n\n## ")
    assert first.startswith("## Client is thin")
    for line in (
        "- scope: project",
        "- author: lead",
        "- state: stale",
        "- folder: /work/app",
        "- sources: app/client.py",
        "The client only forwards calls.",
    ):
        assert line in first
    assert second.startswith("pnpm") and "- scope: you" in second and "sources" not in second


def test_no_rows_is_an_empty_array_or_an_empty_text() -> None:
    assert render([], "json") == "[]"
    assert render([], "markdown") == ""


async def test_json_in_json_out_gives_the_same_rows(store: MemoryStore, tmp_path: Path) -> None:
    for record in _records():
        await store.add(record)
    exported = render(await _all(store), "json")
    async with MemoryStore.open(tmp_path / "again.db") as fresh:
        for row in json.loads(exported):
            row["sources"] = tuple(SourceRow(**source) for source in row["sources"])
            await fresh.add(MemoryRecord(**row))
        assert await _all(fresh) == await _all(store)
        assert render(await _all(fresh), "json") == exported
