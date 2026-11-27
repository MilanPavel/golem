"""Schema for ``golem.db``, one tuple of statements per ``user_version``.

Append a migration. Never edit one that has shipped.

``schema_version`` (6) is read by every later daemon, including one that is
too old for the file, so its columns never change.
"""

from __future__ import annotations

_EMPTY_WORKFLOW = (
    "SELECT s.session_id FROM sessions s WHERE s.origin LIKE 'workflow:%'"
    " AND s.parent_session_id IS NULL"
    " AND NOT EXISTS (SELECT 1 FROM events e WHERE e.session_id = s.session_id"
    " AND e.type LIKE 'message.%')"
    " AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.session_id = s.session_id)"
    " AND NOT EXISTS (SELECT 1 FROM sessions c WHERE c.parent_session_id = s.session_id)"
    " AND NOT EXISTS (SELECT 1 FROM artifacts a WHERE a.session_id = s.session_id)"
    " AND NOT EXISTS (SELECT 1 FROM file_changes f WHERE f.session_id = s.session_id)"
)
"""The sessions the migration after ``routine_runs.workflow_run_id`` removes."""

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
    (
        """
        CREATE TABLE devices (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            public_key BLOB,
            paired_at TEXT NOT NULL,
            last_seen TEXT,
            apns_token TEXT,
            apns_env TEXT,
            revoked_at TEXT
        )
        """,
        """
        CREATE TABLE device_state (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            seq INTEGER NOT NULL
        )
        """,
        "INSERT INTO device_state (id, seq) VALUES (1, 0)",
        """
        CREATE TABLE rule_origins (
            origin_id INTEGER PRIMARY KEY AUTOINCREMENT,
            rule TEXT NOT NULL,
            device_id TEXT NOT NULL REFERENCES devices (id),
            device_name TEXT NOT NULL,
            at TEXT NOT NULL
        )
        """,
        "CREATE INDEX rule_origins_rule ON rule_origins (rule)",
    ),
    ("ALTER TABLE sessions ADD COLUMN trimmed_at TEXT",),
    (
        """
        CREATE TABLE chat_suggestions (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            made_at TEXT NOT NULL,
            data TEXT NOT NULL
        )
        """,
        """
        CREATE TABLE dismissed_suggestions (
            line TEXT PRIMARY KEY,
            at TEXT NOT NULL
        )
        """,
    ),
    (
        """
        CREATE TABLE workflow_runs (
            workflow_run_id TEXT PRIMARY KEY,
            workflow_id TEXT NOT NULL,
            name TEXT NOT NULL,
            path TEXT NOT NULL,
            project TEXT,
            session_id TEXT,
            status TEXT NOT NULL DEFAULT 'pending' CHECK (
                status IN ('pending', 'running', 'waiting', 'done', 'failed', 'cancelled')
            ),
            inputs_json TEXT,
            trigger TEXT NOT NULL DEFAULT 'manual' CHECK (
                trigger IN ('manual', 'schedule', 'file', 'chat', 'try')
            ),
            error TEXT,
            created_at TEXT NOT NULL,
            started_at TEXT,
            finished_at TEXT,
            source_hash TEXT
        )
        """,
        "CREATE INDEX workflow_runs_status ON workflow_runs (status)",
        "CREATE INDEX workflow_runs_workflow ON workflow_runs (workflow_id, created_at DESC)",
        """
        CREATE TABLE workflow_steps (
            workflow_run_id TEXT NOT NULL REFERENCES workflow_runs (workflow_run_id)
                ON DELETE CASCADE,
            step_key TEXT NOT NULL,
            kind TEXT NOT NULL CHECK (
                kind IN ('step', 'agent', 'review', 'notify', 'llm', 'tool', 'skill')
            ),
            title TEXT,
            group_key TEXT,
            status TEXT NOT NULL DEFAULT 'pending' CHECK (
                status IN ('pending', 'running', 'waiting', 'done', 'failed', 'skipped', 'in_doubt')
            ),
            attempts INTEGER NOT NULL DEFAULT 0,
            result_json TEXT,
            error TEXT,
            child_session_id TEXT,
            cost_usd REAL,
            started_at TEXT,
            finished_at TEXT,
            seq INTEGER NOT NULL,
            PRIMARY KEY (workflow_run_id, step_key)
        )
        """,
        """
        CREATE TABLE workflow_reviews (
            workflow_run_id TEXT NOT NULL REFERENCES workflow_runs (workflow_run_id)
                ON DELETE CASCADE,
            step_key TEXT NOT NULL,
            pending_json TEXT NOT NULL,
            answer_json TEXT,
            created_at TEXT NOT NULL,
            answered_at TEXT,
            PRIMARY KEY (workflow_run_id, step_key)
        )
        """,
        "CREATE INDEX workflow_reviews_open ON workflow_reviews (created_at)"
        " WHERE answered_at IS NULL",
    ),
    ("ALTER TABLE workflow_steps ADD COLUMN model TEXT",),
    (
        "ALTER TABLE sessions ADD COLUMN copy_path TEXT",
        "ALTER TABLE sessions ADD COLUMN copy_baseline TEXT",
    ),
    (
        # A routine starts a workflow: ``workflow_runs.trigger`` is ``routine:<name>``, which
        # the old CHECK refuses. SQLite cannot drop a CHECK, and dropping a parent table with
        # foreign keys on would cascade away its steps, so the three tables are saved, rebuilt
        # and refilled. ``routine_runs`` gets the id of the workflow run it started.
        "CREATE TABLE workflow_runs_save AS SELECT * FROM workflow_runs",
        "CREATE TABLE workflow_steps_save AS SELECT * FROM workflow_steps",
        "CREATE TABLE workflow_reviews_save AS SELECT * FROM workflow_reviews",
        "DROP TABLE workflow_reviews",
        "DROP TABLE workflow_steps",
        "DROP TABLE workflow_runs",
        """
        CREATE TABLE workflow_runs (
            workflow_run_id TEXT PRIMARY KEY,
            workflow_id TEXT NOT NULL,
            name TEXT NOT NULL,
            path TEXT NOT NULL,
            project TEXT,
            session_id TEXT,
            status TEXT NOT NULL DEFAULT 'pending' CHECK (
                status IN ('pending', 'running', 'waiting', 'done', 'failed', 'cancelled')
            ),
            inputs_json TEXT,
            trigger TEXT NOT NULL DEFAULT 'manual',
            error TEXT,
            created_at TEXT NOT NULL,
            started_at TEXT,
            finished_at TEXT,
            source_hash TEXT
        )
        """,
        "CREATE INDEX workflow_runs_status ON workflow_runs (status)",
        "CREATE INDEX workflow_runs_workflow ON workflow_runs (workflow_id, created_at DESC)",
        """
        CREATE TABLE workflow_steps (
            workflow_run_id TEXT NOT NULL REFERENCES workflow_runs (workflow_run_id)
                ON DELETE CASCADE,
            step_key TEXT NOT NULL,
            kind TEXT NOT NULL CHECK (
                kind IN ('step', 'agent', 'review', 'notify', 'llm', 'tool', 'skill')
            ),
            title TEXT,
            group_key TEXT,
            status TEXT NOT NULL DEFAULT 'pending' CHECK (
                status IN ('pending', 'running', 'waiting', 'done', 'failed', 'skipped', 'in_doubt')
            ),
            attempts INTEGER NOT NULL DEFAULT 0,
            result_json TEXT,
            error TEXT,
            child_session_id TEXT,
            cost_usd REAL,
            started_at TEXT,
            finished_at TEXT,
            seq INTEGER NOT NULL,
            model TEXT,
            PRIMARY KEY (workflow_run_id, step_key)
        )
        """,
        """
        CREATE TABLE workflow_reviews (
            workflow_run_id TEXT NOT NULL REFERENCES workflow_runs (workflow_run_id)
                ON DELETE CASCADE,
            step_key TEXT NOT NULL,
            pending_json TEXT NOT NULL,
            answer_json TEXT,
            created_at TEXT NOT NULL,
            answered_at TEXT,
            PRIMARY KEY (workflow_run_id, step_key)
        )
        """,
        "CREATE INDEX workflow_reviews_open ON workflow_reviews (created_at)"
        " WHERE answered_at IS NULL",
        "INSERT INTO workflow_runs (workflow_run_id, workflow_id, name, path, project, session_id,"
        " status, inputs_json, trigger, error, created_at, started_at, finished_at, source_hash)"
        " SELECT workflow_run_id, workflow_id, name, path, project, session_id, status,"
        " inputs_json, trigger, error, created_at, started_at, finished_at, source_hash"
        " FROM workflow_runs_save",
        "INSERT INTO workflow_steps (workflow_run_id, step_key, kind, title, group_key, status,"
        " attempts, result_json, error, child_session_id, cost_usd, started_at, finished_at, seq,"
        " model) SELECT workflow_run_id, step_key, kind, title, group_key, status, attempts,"
        " result_json, error, child_session_id, cost_usd, started_at, finished_at, seq, model"
        " FROM workflow_steps_save",
        "INSERT INTO workflow_reviews (workflow_run_id, step_key, pending_json, answer_json,"
        " created_at, answered_at) SELECT workflow_run_id, step_key, pending_json, answer_json,"
        " created_at, answered_at FROM workflow_reviews_save",
        "DROP TABLE workflow_reviews_save",
        "DROP TABLE workflow_steps_save",
        "DROP TABLE workflow_runs_save",
        "ALTER TABLE routine_runs ADD COLUMN workflow_run_id TEXT",
        "CREATE INDEX routine_runs_workflow ON routine_runs (workflow_run_id)",
    ),
    (
        # A step may carry the part that changes in a loop, and the title of its parallel group.
        "ALTER TABLE workflow_steps ADD COLUMN item TEXT",
        "ALTER TABLE workflow_steps ADD COLUMN group_title TEXT",
    ),
    (
        # A workflow run gets a session only when a step needs one. The empty sessions the old
        # code made for every run (no message, no run, no helper, no artifact, no file change)
        # are removed, and their workflow runs lose the id.
        f"UPDATE workflow_runs SET session_id = NULL WHERE session_id IN ({_EMPTY_WORKFLOW})",
        f"UPDATE routine_runs SET session_id = NULL WHERE session_id IN ({_EMPTY_WORKFLOW})",
        f"DELETE FROM events WHERE session_id IN ({_EMPTY_WORKFLOW})",
        f"DELETE FROM sessions WHERE session_id IN ({_EMPTY_WORKFLOW})",
    ),
    (
        # A run keeps what its function returned, and what it marked with ``run.output``.
        "ALTER TABLE workflow_runs ADD COLUMN result_json TEXT",
        """
        CREATE TABLE workflow_outputs (
            workflow_run_id TEXT NOT NULL REFERENCES workflow_runs (workflow_run_id)
                ON DELETE CASCADE,
            position INTEGER NOT NULL,
            title TEXT,
            value_json TEXT NOT NULL,
            summary TEXT,
            PRIMARY KEY (workflow_run_id, position)
        )
        """,
    ),
    (
        # One run's choice of model (``workflow.start {model}``); it beats the file's.
        "ALTER TABLE workflow_runs ADD COLUMN model TEXT",
    ),
    (
        # What a query routine leaves in the Inbox: its first rows, or its error, until done.
        """
        CREATE TABLE inbox_posts (
            post_id TEXT PRIMARY KEY,
            routine TEXT NOT NULL,
            scope TEXT NOT NULL,
            source TEXT NOT NULL,
            saved TEXT NOT NULL,
            row_count INTEGER NOT NULL,
            columns_json TEXT NOT NULL,
            rows_json TEXT NOT NULL,
            error TEXT,
            at TEXT NOT NULL,
            done_at TEXT
        )
        """,
        "CREATE INDEX inbox_posts_open ON inbox_posts (at) WHERE done_at IS NULL",
    ),
)
