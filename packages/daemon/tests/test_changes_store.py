"""The file-change store, the net change of a file, and the diff of two texts."""

from __future__ import annotations

from pathlib import Path

import pytest

from golem.coding.changes import (
    ChangeStore,
    FileChange,
    before_run,
    net_files,
    status_of,
)
from golem.store.blobs import BlobStore
from golem.store.database import Database
from golem.tools.write import (
    Change,
    EditFileArgs,
    WriteFileArgs,
    diff_text,
    plan_edit,
    plan_write,
    unified_diff,
)

SESSION = "s_one"


@pytest.fixture
async def store(database: Database) -> ChangeStore:
    async with database.transaction() as tx:
        for session_id in (SESSION, "s_two"):
            await tx.execute(
                "INSERT INTO sessions (session_id, model_profile, created_at, updated_at)"
                " VALUES (?, 'p', 't', 't')",
                (session_id,),
            )
    return ChangeStore(database, BlobStore(database))


async def _record(
    store: ChangeStore,
    path: str,
    before: str | None,
    after: str | None,
    run_id: str | None = "r1",
    session_id: str = SESSION,
) -> FileChange:
    return await store.record(
        session_id=session_id,
        run_id=run_id,
        call_id="call",
        path=path,
        before=before,
        after=after,
        source="tool",
    )


async def test_record_then_list_gives_counts_and_texts(store: ChangeStore) -> None:
    change = await _record(store, "a.py", "x = 1\ny = 2\n", "x = 1\ny = 3\nz = 4\n")
    assert (change.added, change.removed) == (2, 1)
    assert await store.list(SESSION) == [change]
    assert await store.get(SESSION, change.change_id) == change
    assert await store.get("s_two", change.change_id) is None
    assert await store.text(change.before_sha) == "x = 1\ny = 2\n"
    assert await store.text(change.after_sha) == "x = 1\ny = 3\nz = 4\n"
    assert await store.text(None) is None


async def test_a_new_file_and_a_deleted_file(store: ChangeStore) -> None:
    created = await _record(store, "new.txt", None, "a\nb\n")
    deleted = await _record(store, "old.txt", "a\n", None)
    assert created.before_sha is None and (created.added, created.removed) == (2, 0)
    assert deleted.after_sha is None and (deleted.added, deleted.removed) == (0, 1)
    assert await store.text(created.after_sha) == "a\nb\n"
    assert await store.text(deleted.before_sha) == "a\n"


async def test_seq_counts_per_session_and_an_equal_text_records_nothing(
    store: ChangeStore,
) -> None:
    one = await _record(store, "a", None, "1")
    other = await _record(store, "a", None, "1", session_id="s_two")
    two = await _record(store, "a", "1", "2")
    assert [c.change_id for c in await store.list(SESSION)] == [one.change_id, two.change_id]
    assert [c.change_id for c in await store.list("s_two")] == [other.change_id]
    with pytest.raises(ValueError):
        await _record(store, "a", "2", "2")
    assert len(await store.list(SESSION)) == 2


async def test_the_same_text_is_one_blob(store: ChangeStore, database: Database) -> None:
    first = await _record(store, "a", None, "same\n")
    second = await _record(store, "b", None, "same\n")
    assert first.after_sha == second.after_sha
    row = await database.fetch_one("SELECT COUNT(*) AS n FROM blobs WHERE kind = 'file'")
    assert row is not None and row["n"] == 1


def _change(
    n: int, path: str, before: str | None, after: str | None, run_id: str | None = "r1"
) -> FileChange:
    return FileChange(f"c{n}", SESSION, run_id, None, path, before, after, 0, 0, "tool", None, "t")


def test_net_files_of_one_change_and_of_three() -> None:
    assert net_files([_change(1, "a", None, "h1")])[0].status == "created"
    files = net_files(
        [_change(1, "a", "h0", "h1"), _change(2, "a", "h1", "h2"), _change(3, "a", "h2", "h3")]
    )
    assert len(files) == 1
    only = files[0]
    assert (only.path, only.status, only.before_sha, only.after_sha) == (
        "a",
        "modified",
        "h0",
        "h3",
    )
    assert only.change_ids == ("c1", "c2", "c3")


def test_net_files_leaves_out_files_that_end_where_they_began() -> None:
    created_then_deleted = [_change(1, "a", None, "h1"), _change(2, "a", "h1", None)]
    changed_back = [_change(3, "b", "h0", "h1"), _change(4, "b", "h1", "h0")]
    assert net_files(created_then_deleted + changed_back) == []


def test_net_files_keeps_the_order_of_first_change() -> None:
    files = net_files(
        [
            _change(1, "b", "h0", "h1"),
            _change(2, "a", "h0", None),
            _change(3, "b", "h1", "h2"),
            _change(4, "c", None, "h9"),
        ]
    )
    assert [(f.path, f.status) for f in files] == [
        ("b", "modified"),
        ("a", "deleted"),
        ("c", "created"),
    ]


def test_status_of() -> None:
    assert status_of(None, "x") == "created"
    assert status_of("x", None) == "deleted"
    assert status_of("x", "y") == "modified"


def test_before_run_with_two_runs_on_overlapping_files() -> None:
    changes = [
        _change(1, "a", None, "a1", "r1"),
        _change(2, "b", "b0", "b1", "r1"),
        _change(3, "a", "a1", "a2", "r2"),
        _change(4, "c", "c0", "c1", "r2"),
        _change(5, "b", "b1", "b2", "r2"),
    ]
    assert before_run(changes, "r1") == {"a": None, "b": "b0", "c": "c0"}
    assert before_run(changes, "r2") == {"a": "a1", "c": "c0", "b": "b1"}
    assert before_run(changes, "r3") == {}


def test_diff_text_matches_unified_diff(tmp_path: Path) -> None:
    root = tmp_path / "p"
    root.mkdir()
    (root / "a.py").write_text("x = 1\ny = 2\nx = 1\n", encoding="utf-8")
    changes: list[Change] = [
        plan_edit(root, EditFileArgs(path="a.py", old_string="y = 2", new_string="y = 3")),
        plan_write(root, WriteFileArgs(path="a.py", content="x = 1")),
        plan_write(root, WriteFileArgs(path="new.txt", content="hello\n")),
        plan_write(root, WriteFileArgs(path="empty.txt", content="")),
    ]
    for change in changes:
        assert diff_text(change.shown, change.before, change.after) == unified_diff(change)


def test_diff_text_of_a_deleted_file_has_no_file_to_the_right() -> None:
    diff = diff_text("a.txt", "one\n", None)
    assert diff.splitlines()[:3] == ["--- a/a.txt", "+++ /dev/null", "@@ -1 +0,0 @@"]
    assert diff_text("a.txt", None, "one\n").startswith("--- /dev/null\n+++ b/a.txt\n")
