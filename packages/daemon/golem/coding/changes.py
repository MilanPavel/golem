"""A record of each change to a file, kept in ``golem.db``'s ``file_changes`` table.

The texts are blobs of kind ``file``. The pure functions below work on the
records alone: the net change of each file, and the state a run started from.
"""

from __future__ import annotations

import difflib
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

from golem.sessions.ids import new_id
from golem.store.blobs import BlobStore
from golem.store.database import Database
from golem.tools.write import DIFF_CONTEXT, diff_counts, diff_text, split_lines

Source = Literal["tool", "shell", "revert"]
Status = Literal["created", "modified", "deleted"]

_COLUMNS = (
    "change_id, session_id, run_id, call_id, path, before_sha, after_sha,"
    " added, removed, source, reverts, ts"
)


@dataclass(frozen=True, slots=True)
class FileChange:
    change_id: str  # new_id("c")
    session_id: str
    run_id: str | None  # None for an undo made between runs
    call_id: str | None  # the tool call; None for a shell change or an undo
    path: str  # relative to the session folder, with "/"
    before_sha: str | None  # blob of the text before; None: the file did not exist
    after_sha: str | None  # blob of the text after; None: the file was deleted
    added: int
    removed: int
    source: Source
    reverts: str | None  # the change_id an undo took back
    ts: str  # ISO time, UTC


@dataclass(frozen=True, slots=True)
class NetFile:
    path: str
    status: Status
    before_sha: str | None
    after_sha: str | None
    change_ids: tuple[str, ...]  # in order


class ChangeStore:
    def __init__(self, database: Database, blobs: BlobStore) -> None:
        self._database = database
        self._blobs = blobs

    async def record(
        self,
        *,
        session_id: str,
        run_id: str | None,
        call_id: str | None,
        path: str,
        before: str | None,
        after: str | None,
        source: Source,
        reverts: str | None = None,
    ) -> FileChange:
        """Store both texts and add a change to the end of the session's list."""
        if before == after:
            raise ValueError(f"{path} would not change")
        before_sha = None if before is None else await self._blobs.put("file", before)
        after_sha = None if after is None else await self._blobs.put("file", after)
        added, removed = diff_counts(diff_text(path, before, after))
        change_id = new_id("c")
        ts = datetime.now(UTC).isoformat()
        async with self._database.transaction() as tx:
            rows = await tx.fetch_all(
                "SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM file_changes WHERE session_id = ?",
                (session_id,),
            )
            await tx.execute(
                "INSERT INTO file_changes (change_id, session_id, seq, run_id, call_id, path,"
                " before_sha, after_sha, added, removed, source, reverts, ts)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    change_id,
                    session_id,
                    int(rows[0]["next"]),
                    run_id,
                    call_id,
                    path,
                    before_sha,
                    after_sha,
                    added,
                    removed,
                    source,
                    reverts,
                    ts,
                ),
            )
        return FileChange(
            change_id,
            session_id,
            run_id,
            call_id,
            path,
            before_sha,
            after_sha,
            added,
            removed,
            source,
            reverts,
            ts,
        )

    async def list(self, session_id: str) -> list[FileChange]:
        """The session's changes, oldest first."""
        rows = await self._database.fetch_all(
            f"SELECT {_COLUMNS} FROM file_changes WHERE session_id = ? ORDER BY seq",
            (session_id,),
        )
        return [FileChange(*tuple(row)) for row in rows]

    async def get(self, session_id: str, change_id: str) -> FileChange | None:
        row = await self._database.fetch_one(
            f"SELECT {_COLUMNS} FROM file_changes WHERE session_id = ? AND change_id = ?",
            (session_id, change_id),
        )
        return None if row is None else FileChange(*tuple(row))

    async def text(self, sha: str | None) -> str | None:
        """The text with this hash. None in, None out."""
        if sha is None:
            return None
        blob = await self._blobs.get(sha)
        return None if blob is None else blob[1]


def status_of(before_sha: str | None, after_sha: str | None) -> Status:
    if before_sha is None and after_sha is not None:
        return "created"
    if before_sha is not None and after_sha is None:
        return "deleted"
    return "modified"


def net_files(changes: Sequence[FileChange]) -> list[NetFile]:
    """One entry per path: first before against last after. Equal ends are left out.

    In order of first change.
    """
    by_path: dict[str, list[FileChange]] = {}
    for change in changes:
        by_path.setdefault(change.path, []).append(change)
    files: list[NetFile] = []
    for path, group in by_path.items():
        before_sha, after_sha = group[0].before_sha, group[-1].after_sha
        if before_sha == after_sha:
            continue
        files.append(
            NetFile(
                path=path,
                status=status_of(before_sha, after_sha),
                before_sha=before_sha,
                after_sha=after_sha,
                change_ids=tuple(change.change_id for change in group),
            )
        )
    return files


def before_run(changes: Sequence[FileChange], run_id: str) -> dict[str, str | None]:
    """For each path changed in ``run_id`` or in a later change: the sha it had just before
    the first change of ``run_id``.

    ``changes`` are in the order of ``seq``, as ``ChangeStore.list`` returns them.
    """
    start = next((i for i, change in enumerate(changes) if change.run_id == run_id), None)
    if start is None:
        return {}
    shas: dict[str, str | None] = {}
    for change in changes[start:]:
        shas.setdefault(change.path, change.before_sha)
    return shas


def revert_hunk(before: str, after: str, index: int) -> str:
    """``after`` with hunk ``index`` of the diff before to after put back to its ``before`` lines.

    Hunks count from 0, in the diff with :data:`~golem.tools.write.DIFF_CONTEXT` lines of
    context. Raises ``IndexError`` for a hunk that does not exist.
    """
    old, new = split_lines(before), split_lines(after)
    groups = list(difflib.SequenceMatcher(None, old, new).get_grouped_opcodes(DIFF_CONTEXT))
    if not 0 <= index < len(groups):
        raise IndexError(f"hunk {index} does not exist, the diff has {len(groups)}")
    out: list[str] = []
    at = 0
    for tag, i1, i2, j1, j2 in groups[index]:
        if tag == "equal":
            continue
        out += new[at:j1] + old[i1:i2]
        at = j2
    out += new[at:]
    return "".join(out)


__all__ = [
    "ChangeStore",
    "FileChange",
    "NetFile",
    "Source",
    "before_run",
    "net_files",
    "revert_hunk",
    "status_of",
]
