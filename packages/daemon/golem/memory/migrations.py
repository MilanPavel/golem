"""Schema for ``memory.db``, one tuple of statements per ``user_version`` (ADR-061).

Append a migration. Never edit one that has shipped. ``schema_version`` has the
same columns as in ``golem.db``, so a daemon too old for the file can say which
golem it needs.

The search table is its own migration, so a Python without FTS5 can still open
the file: :func:`migrations` leaves that one empty and the store searches with
``LIKE`` instead.
"""

from __future__ import annotations

import sqlite3
from contextlib import closing

from golem.store.database import Migrations

_TOKENIZER = "porter unicode61 remove_diacritics 2"

_SCHEMA: tuple[str, ...] = (
    """
    CREATE TABLE schema_version (
        version INTEGER PRIMARY KEY,
        golem_version TEXT NOT NULL,
        applied_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL CHECK (scope IN ('you', 'project', 'history')),
        folder TEXT,
        session_id TEXT,
        title TEXT NOT NULL,
        text TEXT NOT NULL,
        author TEXT NOT NULL CHECK (author IN ('you', 'lead', 'helper')),
        agent TEXT,
        call_id TEXT,
        state TEXT NOT NULL CHECK (state IN ('proposed', 'kept', 'stale')),
        kept_by TEXT CHECK (kept_by IS NULL OR kept_by IN ('you', 'auto')),
        privacy TEXT NOT NULL CHECK (privacy IN ('chat', 'local')),
        always INTEGER NOT NULL DEFAULT 0 CHECK (always IN (0, 1)),
        uses INTEGER NOT NULL DEFAULT 0,
        last_used_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
    """,
    "CREATE INDEX memories_scope ON memories (scope, folder, state, created_at)",
    """
    CREATE TABLE memory_sources (
        memory_id TEXT NOT NULL REFERENCES memories (id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        size INTEGER NOT NULL,
        mtime_ns INTEGER NOT NULL,
        checked_at TEXT NOT NULL,
        PRIMARY KEY (memory_id, path)
    )
    """,
)

# A table of its own, with the id beside the words, so a VACUUM that renumbers
# ``memories`` rows cannot leave it pointing at the wrong memory.
_SEARCH: tuple[str, ...] = (
    "CREATE VIRTUAL TABLE memory_fts USING fts5("
    f"id UNINDEXED, title, text, tokenize = '{_TOKENIZER}')",
    """
    CREATE TRIGGER memories_fts_insert AFTER INSERT ON memories BEGIN
        INSERT INTO memory_fts (id, title, text) VALUES (new.id, new.title, new.text);
    END
    """,
    """
    CREATE TRIGGER memories_fts_update AFTER UPDATE OF title, text ON memories BEGIN
        DELETE FROM memory_fts WHERE id = old.id;
        INSERT INTO memory_fts (id, title, text) VALUES (new.id, new.title, new.text);
    END
    """,
    """
    CREATE TRIGGER memories_fts_delete AFTER DELETE ON memories BEGIN
        DELETE FROM memory_fts WHERE id = old.id;
    END
    """,
    # Rows written before this migration ran, as in a file made without FTS5 and opened later.
    "INSERT INTO memory_fts (id, title, text) SELECT id, title, text FROM memories",
)

MIGRATIONS: Migrations = (_SCHEMA, _SEARCH)


def has_fts5() -> bool:
    """Whether this SQLite can make the search table, tried in memory."""
    try:
        with closing(sqlite3.connect(":memory:")) as probe:
            probe.execute(f"CREATE VIRTUAL TABLE probe USING fts5(x, tokenize = '{_TOKENIZER}')")
    except sqlite3.Error:
        return False
    return True


def migrations(*, fts: bool) -> Migrations:
    """``MIGRATIONS``, with the search table left out when ``fts`` is false."""
    return MIGRATIONS if fts else (_SCHEMA, ())
