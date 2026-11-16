"""Schema for ``golem.db``, one tuple of statements per ``user_version``.

Append a migration. Never edit one that has shipped.

``schema_version`` (6) is read by every later daemon, including one that is
too old for the file, so its columns never change.
"""

from __future__ import annotations

MIGRATIONS: tuple[tuple[str, ...], ...] = (
    (
        """
        CREATE TABLE sessions (
            session_id TEXT PRIMARY KEY,
            model_profile TEXT NOT NULL,
            title TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            forked_from_session_id TEXT,
            forked_from_message_id TEXT
        )
        """,
        """
        CREATE TABLE runs (
            run_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL REFERENCES sessions (session_id),
            status TEXT NOT NULL,
            started_at TEXT NOT NULL,
            ended_at TEXT,
            error TEXT
        )
        """,
        "CREATE INDEX runs_status ON runs (status)",
        """
        CREATE TABLE events (
            session_id TEXT NOT NULL REFERENCES sessions (session_id),
            seq INTEGER NOT NULL,
            ts TEXT NOT NULL,
            type TEXT NOT NULL,
            run_id TEXT,
            message_id TEXT,
            data TEXT NOT NULL,
            PRIMARY KEY (session_id, seq)
        ) WITHOUT ROWID
        """,
        """
        CREATE INDEX events_message ON events (session_id, message_id)
        WHERE message_id IS NOT NULL
        """,
        "CREATE INDEX events_run ON events (run_id) WHERE run_id IS NOT NULL",
    ),
    ("ALTER TABLE sessions ADD COLUMN closed_at TEXT",),
    ("ALTER TABLE sessions ADD COLUMN cwd TEXT",),
    ("ALTER TABLE sessions ADD COLUMN allowed_tools TEXT",),
    (
        """
        CREATE TABLE artifacts (
            artifact_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL REFERENCES sessions (session_id),
            call_id TEXT,
            kind TEXT NOT NULL,
            size INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            data TEXT NOT NULL
        )
        """,
        "CREATE INDEX artifacts_session ON artifacts (session_id)",
    ),
    (
        """
        CREATE TABLE schema_version (
            version INTEGER PRIMARY KEY,
            golem_version TEXT NOT NULL,
            applied_at TEXT NOT NULL
        )
        """,
        """
        CREATE TABLE library_versions (
            name TEXT PRIMARY KEY,
            version TEXT NOT NULL,
            recorded_at TEXT NOT NULL
        )
        """,
    ),
    ("ALTER TABLE sessions ADD COLUMN mcp_servers TEXT",),
    ("ALTER TABLE sessions ADD COLUMN skills TEXT",),
    (
        """
        CREATE TABLE blobs (
            sha256 TEXT PRIMARY KEY,
            kind TEXT NOT NULL,
            size INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            text TEXT NOT NULL
        )
        """,
    ),
    ("ALTER TABLE sessions ADD COLUMN options TEXT",),
    ("ALTER TABLE sessions ADD COLUMN permission_mode TEXT",),
    ("ALTER TABLE sessions ADD COLUMN origin TEXT",),
    (
        """
        CREATE TABLE file_changes (
            change_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL REFERENCES sessions (session_id),
            seq INTEGER NOT NULL,
            run_id TEXT,
            call_id TEXT,
            path TEXT NOT NULL,
            before_sha TEXT,
            after_sha TEXT,
            added INTEGER NOT NULL,
            removed INTEGER NOT NULL,
            source TEXT NOT NULL,
            reverts TEXT,
            ts TEXT NOT NULL
        )
        """,
        "CREATE INDEX file_changes_session ON file_changes (session_id, seq)",
    ),
    (
        """
        CREATE TABLE model_calls (
            call_id TEXT PRIMARY KEY,
            session_id TEXT,
            run_id TEXT,
            role TEXT NOT NULL DEFAULT 'chat',
            provider TEXT,
            model TEXT,
            tier TEXT,
            started_at TEXT NOT NULL,
            day TEXT NOT NULL,
            input INTEGER,
            output INTEGER,
            cache_read INTEGER,
            cache_write INTEGER,
            cost_usd REAL,
            failed INTEGER NOT NULL DEFAULT 0
        )
        """,
        "CREATE INDEX model_calls_day ON model_calls (day)",
        "CREATE INDEX model_calls_session ON model_calls (session_id)",
    ),
    ("ALTER TABLE sessions ADD COLUMN checks INTEGER",),
    ("ALTER TABLE sessions ADD COLUMN route TEXT NOT NULL DEFAULT 'pinned'",),
    ("ALTER TABLE sessions ADD COLUMN plan_first INTEGER",),
    ("ALTER TABLE sessions ADD COLUMN paid_ok INTEGER NOT NULL DEFAULT 0",),
)
