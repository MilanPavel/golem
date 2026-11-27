# ADR-063: SQL over your files runs in DuckDB in a worker process, read-only by construction, with its extensions installed once

**Date**: 2026-11-26
**Status**: proposed
**Deciders**: Milan Pavel

## Context

golem is going to answer questions about data the user already has: a folder of CSV or Parquet files, a SQLite file, a DuckDB file. The model writes SQL and golem runs it. That puts a query written by a model next to the user's files, so three things have to hold:

- A query reads and never writes, and it reads only the source the user named.
- A bad query (a cross join of two big tables, a 10 GB result) cannot take the daemon down or fill the Mac's memory.
- Nothing is downloaded while a query runs.

The data engine is the part that does this. It has no RPC handler and no tool yet; those come on top of it.

## Decision

**DuckDB, in a worker process.** `golem.data.worker` (`python -m golem.data.worker`) is a child of the daemon. It reads one JSON object per line on stdin and answers one per line on stdout, the way `StdioTransport` talks to an MCP server (own process group, stderr kept in a ring, close = stdin close, SIGTERM, SIGKILL). `golem.data.client.DataWorker` starts it on the first request, cuts a query at `[data] query_timeout_seconds` by sending `cancel` (the worker calls `interrupt()` on that query's cursor) and kills the worker when it has not answered 2 seconds later. A worker that exits starts again on the next request, after a wait that doubles from 0.5 s to 30 s, and opens its sources again. The daemon never imports `duckdb`: a native library with its own memory and its own crashes stays out of the process that holds every session.

**Read-only by construction.** A source is one in-memory DuckDB database. It is filled first, then closed in this order:

1. `allowed_paths` names only the source's own files (the matched files, or the one database file). The folder is not allowed: DuckDB writes the replacement of an existing file next to it, and that write is refused only because the folder is not on the list.
2. `enable_external_access = false`.
3. `lock_configuration = true`, so a query cannot turn either back on or raise `memory_limit`.

Views and attached databases made before the lock keep working. Checked on DuckDB 1.5.5: after the three, `read_csv` of a file outside the source, `COPY ... TO` (new file or over an existing one), `ATTACH`, `INSTALL`, `LOAD` of a path, `SET enable_external_access = true`, `SET memory_limit` and `SET allowed_paths` all fail, and so does a symlink inside the folder that points outside it. Such a link is also left out of the source when it is opened. The tests in `tests/test_data_engine.py` keep this true.

Before DuckDB sees a query, `golem.data.guard` checks it: exactly one statement (`duckdb.extract_statements`, because `json_serialize_sql` accepts `select 1; select 2`) and `json_serialize_sql` must accept it, which it does for `SELECT`, `WITH`, `DESCRIBE` and `SUMMARIZE`, and refuses for `DELETE`, `INSERT`, `COPY`, `ATTACH`, `INSTALL`, `SET`, `PRAGMA`, `CREATE`, `PIVOT` and the rest. The guard gives the model a sentence it can act on ("Only one statement per query."). The settings are the wall: the guard is not what keeps a file safe.

**Limits.** Each source connection has `memory_limit` and `threads` from `[data] worker_memory = "2GB"` and `threads = 4`. A query returns at most `max_rows = 10000` rows: the worker fetches `limit + 1` and says `truncated`. Spill files go to `~/.golem/data/tmp`, not to the folder the daemon was started in.

**Extensions.** DuckDB's wheel has `core_functions`, `icu`, `json` and `parquet`. It does not have `sqlite_scanner`, `excel`, `postgres_scanner`, `mysql_scanner` or `httpfs`, which DuckDB downloads from `extensions.duckdb.org` the first time a query needs one. golem sets `extension_directory` to `~/.golem/data/extensions/` and `autoinstall_known_extensions = false`, so a query never downloads. `DataWorker.ensure_extension(name)` installs one there, once, with the network, and answers with a plain sentence when it cannot. Opening a SQLite file without it says the same. `httpfs` is not on the list: a source never reads a URL.

**Packaging.** A PyInstaller binary has no `-m`, so `golem-daemon data-worker` (a subcommand with no help line) is the frozen worker and `worker_argv()` picks it when `sys.frozen` is set. `golem-daemon.spec` collects `duckdb` and its metadata; `pyinstaller-hooks-contrib` already has a `duckdb` hook for the native module.

**Kept results.** A query's rows are also kept as a Parquet file in `~/.golem/data/results/<result_id>.parquet`, so the user can page through all of them while the model reads only the first rows. The sources stay locked, and `COPY ... TO` stays refused on them. The worker writes the file from a second, throwaway in-memory database that holds no source: it receives the rows of the finished query as plain values, its `allowed_paths` names only the temporary file it writes (renamed when whole), and it is locked like a source (`enable_external_access = false`, `lock_configuration = true`). A page is read the same way, by a locked database that may read only that one result file. The source, the SQL and the time go into the file's own key-value metadata. No new path leads into a source's folder, and the escape tests still hold. A file older than 30 days goes, then the oldest until all of them take at most 1 GB, at start and once a day. A result a chat made is also an artifact of the kind `table`, so closing the session removes its file.

**Databases.** A Postgres or MySQL source is one more kind of source, opened by the same worker and locked the same way. `ATTACH` happens before the lock, with `(TYPE postgres, READ_ONLY)` or `(TYPE mysql, READ_ONLY)`. The address is `url = "postgres://user@host:port/db"` in `config.toml` and never holds a password (a config with one in the address is refused, and its text is not repeated in the error). The password is `password = "keychain:data/<name>"`. The daemon reads it from the Keychain when it opens the source and sends it to the worker in the `attach` request, over the pipe, and nowhere else: not in `argv`, not in the environment, not in a log. `SourceSpec` leaves it out of `repr`, and the worker hides every password it has opened a source with (and any `password=...` pair) in every error it answers, because DuckDB's own connection errors repeat the whole connection string.

The server is asked to read only and to cut slow queries, on top of DuckDB's `READ_ONLY`. Postgres gets `options='-c default_transaction_read_only=on -c statement_timeout=<ms> -c idle_in_transaction_session_timeout=<ms>'` in the connection string and `connect_timeout` of at most 10 s. MySQL gets neither: the source is attached `READ_ONLY`, and DuckDB refuses `mysql_execute` on a read-only attach, so no session setting can be sent (and `mysql_query` cannot run a `SET`, which has no result types). For MySQL, DuckDB's `READ_ONLY` and the guard keep writes out, and golem's own timeout cuts a slow query. `[data.<name>] timeout_s` (15 by default) sets the Postgres limits. The daemon's own `query_timeout_seconds` cut still applies on top, so a server that ignores its timeout does not hold a query for longer.

Before the lock the worker also asks the server three things, each optional (a failed question leaves its answer unknown and the source still opens): its version, the row estimates of its tables (`pg_class.reltuples`, MySQL `table_rows`), and whether the login can write (`has_table_privilege` for INSERT, UPDATE and DELETE on any table, or a superuser; for MySQL, the privilege types in `information_schema.user_privileges`, `schema_privileges` and `table_privileges` for the current user and database, because `SHOW GRANTS` has no result types and cannot run through `mysql_query`). A login that can write gets a sentence with a way to make a read-only role. It is a warning and never a block. Table names are `<schema>.<table>`, with the `public` schema bare (MySQL: the database). Describe reads the catalog only, so it never runs `summarize` or `count(*)` on a live table; row counts are the estimates. A server's rows are not cached: every query goes to the server, and its result is kept as a Parquet file like any other.

**The guard knows the scanner functions.** `json_serialize_sql` accepts `select * from postgres_query('db', 'delete from t')`, because it is a `SELECT`. `golem.data.guard` therefore looks through the serialized statement for a function that sends raw SQL to a server or opens a connection of its own, and refuses it with a sentence. The rule is structural: any function whose name starts with `postgres_`, `mysql_`, `sqlite_`, `read_postgres_`, `read_mysql_` or `read_sqlite_` (plus `pg_clear_cache`), in a table or a scalar position. A test loads each installed scanner extension, lists every function it adds, and fails if one is not refused, so a new function in a later DuckDB cannot slip through. `ATTACH`, `DETACH`, `USE`, `SET`, `RESET` and `PRAGMA` get their own sentence instead of the general one.

**Probe (DuckDB 1.5.5, arm64, scanner extensions from extensions.duckdb.org, 29.5 MB each).** Run against a locked connection with no server (none was available to the probe; a closed port stands in):

| Question | Answer |
|---|---|
| Can `ATTACH ... (TYPE postgres)` or `(TYPE mysql)` run after the lock? | No: "Attaching Postgres databases is disabled through configuration". So it must come before the lock, as the files and SQLite attach do. |
| Does a connect before the lock work with `enable_external_access` still on? | Yes: the attach went as far as the connection (refused). |
| After the lock, can a query still open a connection of its own? | **Yes.** `postgres_scan('host=... port=...', 'public', 't')` and `postgres_attach('host=...')` both tried to connect after the lock. The lock does not stop them, so a model's SQL could reach any server it can name. The guard refuses them by name. |
| `postgres_query` / `mysql_query` with a name that was never attached | Binder error: "Failed to find attached database". With an attached name they pass `json_serialize_sql` (they are a `SELECT`), so the guard refuses them by name. |
| `postgres_execute` / `mysql_execute` | `CALL` is refused by `json_serialize_sql`; `select postgres_execute(...)` is not, so the guard refuses the name. They write, so they are the ones that matter most. |
| `DETACH`, `USE`, `SET`, `PRAGMA` after the lock | Refused by the guard first; `SET statement_timeout`, `SET enable_external_access` and the rest fail with "the configuration has been locked" if they get past it. |

Checked against a live MySQL (2026-11-27): the scanner takes `key="value"` pairs with backslash escapes, and reads a single-quoted value literally (`port='3306'` fails with "stoi: no conversion"), so MySQL values are double-quoted; tables of an attached MySQL keep answering queries after the lock; one connection serves every query; a `DELETE` on the attached database is refused by DuckDB; `SHOW GRANTS` does not come back through `mysql_query`, but a `SELECT` on information_schema does; the database is the schema name. Not checked, because there was no Postgres server: that tables of an attached server keep answering queries after `enable_external_access = false` (the attached SQLite and DuckDB files do, and the scanners are expected to, but this is unproven); that the scanner opens further pool connections after the lock with the same session settings; the MySQL scanner's connection-string keys (`database`, `password`, `ssl_mode`) and its schema naming (`main` or the database name; the code accepts both as the bare schema); and that `SHOW GRANTS` comes back through `mysql_query`. `tests/test_data_databases.py` runs these live when `GOLEM_TEST_PG_URL` or `GOLEM_TEST_MYSQL_URL` is set and the extension is installed, and skips them otherwise: attach, a query, a write refused by the server, `postgres_execute` refused by the guard, and a `pg_sleep(30)` cut by `statement_timeout`.

## Measured

On a MacBook (arm64, 14 cores, 36 GB, macOS 26.7), DuckDB 1.5.5, Python 3.12, through `DataWorker` with the defaults (2GB, 4 threads). The file is 14 million rows and 6 columns: an id, a customer, a region, an amount, a date and a 64-character note, 1.47 GB of CSV (a generated file, not golem's).

| What | Number |
|---|---|
| Native module `_duckdb` on disk | 45 MB |
| The arm64 wheel in the lock, the universal2 wheel | 15.5 MB, 32.8 MB (PyPI's sizes) |
| Worker cold start: spawn, `import duckdb`, first answer | 0.115 s (files in the disk cache; the first start after a boot is slower) |
| `attach` of the 1.47 GB CSV (a view, no read) | 0.084 s |
| `select count(*)` | 557 ms |
| `group by region` with `count` and `sum` (97 groups) | 600 ms |
| `group by customer`, top 5 by `sum` (50,000 groups) | 672 ms |
| Peak memory of the worker for all of the above | 422 MB |

The answers come after the first scan, so the three queries read the file from the disk cache. Parquet is faster and smaller; CSV is the slow case.

## Alternatives Considered

### Alternative 1: DuckDB inside the daemon

- **Pros**: no process to manage, no JSON on a pipe.
- **Cons**: a runaway query or a crash in a native library takes the daemon and every session with it. `interrupt()` and the memory limit protect less than a process the daemon can kill.
- **Why not**: killing a process is the one cancel that always works.

### Alternative 2: SQLite or Python's `csv` module

- **Pros**: nothing new to ship.
- **Cons**: SQLite does not read Parquet or JSON lines, has no `SUMMARIZE`, and loads a CSV before it can answer. A 1.5 GB file needs an import step.
- **Why not**: the question "what is in this folder" must work without a step before it.

### Alternative 3: Allow the source's folder, not its files

- **Pros**: new files that match the glob later would be visible without opening the source again.
- **Cons**: `COPY ... TO` into the folder succeeds, and so does replacing a file.
- **Why not**: a data source must not be writable by a query, even one that got past the guard.

## Consequences

### Positive

- A query can only read the files of the source it was asked about, and the daemon survives any query.
- Cancel is real: `interrupt()` first, a kill when that fails.
- The first answer needs no download after the one-time install.

### Negative

- A new file that appears in a folder after the source was opened is not in it until the source is opened again.
- The wheel adds a 45 MB native module to the app.
- Every row crosses a pipe as JSON, which is why a result stops at 10,000 rows.

### Risks

- DuckDB's file permission settings are the wall, and they are DuckDB's to keep. The statement guard stops the common case, and the escape tests run in CI on the locked DuckDB version, so an upgrade that opens a hole fails there.
- A password goes over the pipe and never into argv or the environment, which another user's `ps` can read. It does sit in the worker's memory and in the `ATTACH` text DuckDB parses while the source is open. Errors are scrubbed of it, but a new DuckDB message that quotes the connection string in another shape would need the scrub taught about it; the test with a fake failing connection keeps the known shapes honest.
- A Postgres behind a pooler that rejects `options` (pgbouncer in transaction mode) refuses the connection. The error says so, and the fix is the pooler's `ignore_startup_parameters`.
