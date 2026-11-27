"""Kept query results as Parquet files, written and read inside the worker.

The sources are locked: ``COPY ... TO`` is refused on them, and it stays refused. A result
is written by a second, throwaway DuckDB database that holds no source: it gets the rows of
one finished query as plain values, and its ``allowed_paths`` names the one file it writes
(a temporary name next to the result, renamed when it is whole). It is locked the same way
a source is, so even a statement that got this far could write nowhere else. A page is read
by a database of the same kind, which may read only the one result file. An export is written
the same way: a database that may read only the result file and write only ``<target>.part``,
renamed to the target when it is whole, and never over a file that is there.
"""

from __future__ import annotations

import json
import os
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

import duckdb

from golem.data.engine import extension_installed, json_value, unique_names
from golem.data.types import DataError, NeedsExtension


def _quote(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def _text(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    return json.dumps(json_value(value), ensure_ascii=False)


def _filled(
    columns: list[str], kinds: list[str], rows: list[Any], *, as_text: bool
) -> duckdb.DuckDBPyConnection:
    """A database with the rows in a table called ``result``. Raises ``duckdb.Error``."""
    con = duckdb.connect(":memory:")
    try:
        cells = ", ".join(f"{_quote(c)} {k}" for c, k in zip(columns, kinds, strict=True))
        con.execute(f"create table result ({cells})")
        marks = ", ".join("?" for _ in columns)
        data = [[_text(v) for v in row] for row in rows] if as_text else rows
        con.executemany(f"insert into result values ({marks})", data)
    except duckdb.Error:
        con.close()
        raise
    return con


def _metadata(meta: Mapping[str, str]) -> str:
    """``meta`` as a DuckDB struct literal. Keys are ours (letters only), values are escaped."""
    pairs = ", ".join(
        f"{key}: '{value[:4000].replace(chr(39), chr(39) * 2)}'" for key, value in meta.items()
    )
    return "{" + pairs + "}"


def write(
    path: Path,
    names: Sequence[str],
    types: Sequence[str],
    rows: Sequence[Any],
    meta: Mapping[str, str],
) -> None:
    """Write ``rows`` (python values, as DuckDB returned them) to ``path``, whole or not at all.

    ``meta`` (the source and the SQL) goes into the file's own key-value metadata, so a result
    file says where it came from without a record beside it.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + ".part")
    columns = unique_names(names)
    try:
        try:
            con = _filled(columns, list(types), list(rows), as_text=False)
        except duckdb.Error:
            # A type or a value that does not round-trip: keep every cell as text.
            con = _filled(columns, ["VARCHAR"] * len(columns), list(rows), as_text=True)
        try:
            con.execute("set allowed_paths = ?", [[str(temp)]])
            con.execute("set enable_external_access = false")
            con.execute("set lock_configuration = true")
            con.execute(
                f"copy result to ? (format parquet, kv_metadata {_metadata(meta)})", [str(temp)]
            )
        finally:
            con.close()
        os.replace(temp, path)
    except (duckdb.Error, OSError) as exc:
        raise DataError(f"Could not keep the result: {str(exc).splitlines()[0]}") from exc
    finally:
        temp.unlink(missing_ok=True)


def _literal(text: str) -> str:
    return "'" + text.replace("'", "''") + "'"


def _copy_options(fmt: str, target: Path) -> str:
    if fmt == "csv":
        return "format csv, header true"
    if fmt == "parquet":
        return "format parquet"
    if fmt == "xlsx":
        return "format xlsx, header true"
    lines = target.suffix.lower() in (".jsonl", ".ndjson")
    return f"format json, array {'false' if lines else 'true'}"


def export(
    source: Path, target: Path, fmt: str, extension_dir: Path | None = None
) -> dict[str, Any]:
    """Write all rows of the kept result ``source`` to the new file ``target``.

    Whole or not at all: the rows go to ``<target>.part`` first. Raises :class:`DataError` for
    a target that is there, a result that is gone, or a write that failed. Returns ``rows``.
    """
    if not source.is_file():
        raise DataError("That result is gone. Run the query again.")
    if os.path.lexists(target):
        raise DataError(f"{target} already exists. golem does not overwrite a file.")
    temp = target.with_name(target.name + ".part")
    con = duckdb.connect(":memory:")
    try:
        if fmt == "xlsx":
            if extension_dir is None or not extension_installed(extension_dir, "excel"):
                raise NeedsExtension("excel")
            con.execute("set autoinstall_known_extensions = false")
            con.execute("set extension_directory = ?", [str(extension_dir)])
            con.execute("load excel")
        con.execute("set allowed_paths = ?", [[str(source), str(temp)]])
        con.execute("set enable_external_access = false")
        con.execute("set lock_configuration = true")
        counted = con.execute("select count(*) from read_parquet(?)", [str(source)]).fetchone()
        rows = int(counted[0]) if counted else 0
        con.execute(
            f"copy (select * from read_parquet({_literal(str(source))})) "
            f"to {_literal(str(temp))} ({_copy_options(fmt, target)})"
        )
        _place(temp, target)
    except duckdb.Error as exc:
        raise DataError(f"Could not write {target}: {str(exc).splitlines()[0]}") from exc
    except OSError as exc:
        raise DataError(f"Could not write {target}: {exc.strerror or exc}") from exc
    finally:
        con.close()
        temp.unlink(missing_ok=True)
    return {"rows": rows}


def _place(temp: Path, target: Path) -> None:
    """Give ``temp`` the name ``target`` unless a file has it by now."""
    try:
        os.link(temp, target)
    except FileExistsError:
        raise DataError(f"{target} already exists. golem does not overwrite a file.") from None
    except OSError:
        if os.path.lexists(target):
            raise DataError(f"{target} already exists. golem does not overwrite a file.") from None
        os.replace(temp, target)


def page(
    path: Path, offset: int, limit: int, sort_column: str | None, sort_desc: bool
) -> dict[str, Any]:
    """``limit`` rows from ``offset`` of the kept result at ``path``, sorted when asked."""
    if not path.is_file():
        raise DataError("That result is gone. Run the query again.")
    con = duckdb.connect(":memory:")
    try:
        con.execute("set allowed_paths = ?", [[str(path)]])
        con.execute("set enable_external_access = false")
        con.execute("set lock_configuration = true")
        described = con.execute("describe select * from read_parquet(?)", [str(path)])
        columns = [{"name": str(r[0]), "type": str(r[1])} for r in described.fetchall()]
        counted = con.execute("select count(*) from read_parquet(?)", [str(path)]).fetchone()
        total = int(counted[0]) if counted else 0
        found = con.execute("select key, value from parquet_kv_metadata(?)", [str(path)])
        meta = {bytes(k).decode(): bytes(v).decode() for k, v in found.fetchall()}
        order = ""
        if sort_column is not None:
            if sort_column not in {c["name"] for c in columns}:
                raise DataError(f"There is no column called {sort_column} in this result.")
            order = f" order by {_quote(sort_column)} {'desc' if sort_desc else 'asc'}"
        cursor = con.execute(
            f"select * from read_parquet(?){order} limit ? offset ?", [str(path), limit, offset]
        )
        rows = [[json_value(v) for v in row] for row in cursor.fetchall()]
    except duckdb.Error as exc:
        raise DataError(f"Could not read the result: {str(exc).splitlines()[0]}") from exc
    finally:
        con.close()
    return {"columns": columns, "rows": rows, "total_rows": total, "meta": meta}


__all__ = ["export", "page", "write"]
