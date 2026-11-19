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
    (
        "ALTER TABLE model_calls ADD COLUMN tool_calls INTEGER",
        "ALTER TABLE model_calls ADD COLUMN bad_tool_calls INTEGER",
        "ALTER TABLE model_calls ADD COLUMN recovered_text_calls INTEGER",
        """
        CREATE TABLE model_outcomes (
            run_id TEXT,
            provider TEXT,
            model TEXT,
            outcome TEXT NOT NULL,
            at TEXT NOT NULL
        )
        """,
        "CREATE INDEX model_outcomes_model ON model_outcomes (provider, model)",
        """
        CREATE TABLE model_score_resets (
            ref TEXT PRIMARY KEY,
            reset_at TEXT NOT NULL
        )
        """,
    ),
    (
        """
        CREATE TABLE model_check_seeds (
            ref TEXT PRIMARY KEY,
            working INTEGER NOT NULL,
            total INTEGER NOT NULL,
            at TEXT NOT NULL
        )
        """,
    ),
    (
        """
        CREATE TABLE routine_runs (
            routine_run_id TEXT PRIMARY KEY,
            routine TEXT NOT NULL,
            scope TEXT NOT NULL,
            session_id TEXT,
            trigger TEXT NOT NULL,
            due_at TEXT,
            started_at TEXT,
            ended_at TEXT,
            status TEXT NOT NULL,
            reason TEXT,
            summary TEXT
        )
        """,
        "CREATE INDEX routine_runs_routine ON routine_runs (scope, routine, started_at)",
        "CREATE INDEX routine_runs_session ON routine_runs (session_id)",
    ),
    (
        "ALTER TABLE routine_runs ADD COLUMN watch_path TEXT",
        "ALTER TABLE routine_runs ADD COLUMN watch_size INTEGER",
        "ALTER TABLE routine_runs ADD COLUMN watch_mtime_ns INTEGER",
        "CREATE INDEX routine_runs_watch ON routine_runs (scope, routine, watch_path)",
    ),
    (
        "ALTER TABLE sessions ADD COLUMN parent_session_id TEXT",
        "ALTER TABLE sessions ADD COLUMN root_session_id TEXT",
        "ALTER TABLE sessions ADD COLUMN parent_call_id TEXT",
        "ALTER TABLE sessions ADD COLUMN helper_index INTEGER",
        "ALTER TABLE sessions ADD COLUMN agent TEXT",
        "ALTER TABLE runs ADD COLUMN wait_reason TEXT",
        "CREATE UNIQUE INDEX sessions_helper ON sessions"
        " (parent_session_id, parent_call_id, helper_index)",
        "CREATE INDEX sessions_root ON sessions (root_session_id)",
    ),
)
