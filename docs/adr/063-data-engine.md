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
- Credentials for a database that needs one (a later source) must go over the pipe and never into argv or the environment, which another user's `ps` can read. Nothing sends one yet.
