"""The data worker: ``python -m golem.data.worker`` (``golem-daemon data-worker`` when frozen).

It reads one JSON object per line on stdin, ``{"id", "op", "args"}``, and writes one per
answer on stdout, ``{"id", "ok": true, "result"}`` or ``{"id", "ok": false, "error"}``.
Each request runs in a thread of its own, so a slow query does not hold up the next
request, and ``cancel`` (``args.id``) can interrupt it. A request that fails answers with
its error and the worker stays up. The worker ends when stdin closes.

Ops: ``ping``, ``attach``, ``detach``, ``tables``, ``describe``, ``query``,
``install_extension``, ``cancel``.
"""

from __future__ import annotations

import contextlib
import json
import sys
import threading
from pathlib import Path
from typing import IO, Any, cast

import duckdb

from golem.data.engine import Limits, Source, install_extension
from golem.data.types import DataError, SourceSpec


class Worker:
    def __init__(self, out: IO[str]) -> None:
        self._out = out
        self._write_lock = threading.Lock()
        self._sources: dict[str, Source] = {}
        self._running: dict[int, Any] = {}
        self._cancelled: set[int] = set()
        self._lock = threading.Lock()

    def serve(self, lines: IO[str]) -> None:
        for line in lines:
            if not line.strip():
                continue
            try:
                request: dict[str, Any] = json.loads(line)
                ident: Any = request["id"]
                op = str(request["op"])
                args: Any = request.get("args") or {}
                if not isinstance(ident, int) or not isinstance(args, dict):
                    raise ValueError("bad request")
            except (ValueError, KeyError, TypeError):
                self._answer(None, error="That is not a request.")
                continue
            if op == "cancel":
                self._cancel(cast("dict[str, Any]", args).get("id"))
                continue
            threading.Thread(
                target=self._handle, args=(ident, op, cast("dict[str, Any]", args)), daemon=True
            ).start()

    def _handle(self, ident: int, op: str, args: dict[str, Any]) -> None:
        try:
            result = self._run(ident, op, args)
        except DataError as exc:
            self._answer(ident, error=str(exc))
        except Exception as exc:  # one request's crash is that request's answer
            self._answer(ident, error=f"The data worker failed: {type(exc).__name__}: {exc}")
        else:
            self._answer(ident, result=result)

    def _run(self, ident: int, op: str, args: dict[str, Any]) -> Any:
        if op == "ping":
            return {"duckdb": duckdb.__version__}
        if op == "attach":
            return self._attach(args)
        if op == "detach":
            with self._lock:
                source = self._sources.pop(str(args.get("name")), None)
            if source is not None:
                source.close()
            return {}
        if op == "install_extension":
            install_extension(Path(str(args["extension_dir"])), str(args["name"]))
            return {}
        source = self._source(args)
        if op == "tables":
            return {"tables": source.tables()}
        if op == "describe":
            return source.describe(str(args.get("table", "")))
        if op == "query":
            return self._query(ident, source, args)
        raise DataError(f"The data worker has no op called {op}.")

    def _attach(self, args: dict[str, Any]) -> dict[str, Any]:
        spec = SourceSpec.from_json(args.get("spec") or {})
        limits = Limits(
            memory=str(args.get("memory", "2GB")),
            threads=int(args.get("threads", 4)),
            extension_dir=_path(args.get("extension_dir")),
            temp_dir=_path(args.get("temp_dir")),
        )
        source = Source(spec, limits)
        with self._lock:
            old = self._sources.get(spec.name)
            self._sources[spec.name] = source
        if old is not None:
            old.close()
        return {"tables": source.tables()}

    def _source(self, args: dict[str, Any]) -> Source:
        name = str(args.get("source", ""))
        with self._lock:
            source = self._sources.get(name)
        if source is None:
            raise DataError(f"The source {name} is not attached.")
        return source

    def _query(self, ident: int, source: Source, args: dict[str, Any]) -> dict[str, Any]:
        cursor = source.cursor()
        with self._lock:
            if ident in self._cancelled:
                self._cancelled.discard(ident)
                cursor.close()
                raise DataError("The query was cancelled.")
            self._running[ident] = cursor
        try:
            return source.query(str(args.get("sql", "")), int(args.get("limit", 1000)), cursor)
        finally:
            with self._lock:
                self._running.pop(ident, None)
            cursor.close()

    def _cancel(self, ident: object) -> None:
        if not isinstance(ident, int):
            return
        with self._lock:
            cursor = self._running.get(ident)
            if cursor is None:
                self._cancelled.add(ident)
                if len(self._cancelled) > 1000:
                    self._cancelled.clear()
                return
        with contextlib.suppress(duckdb.Error):
            cursor.interrupt()

    def _answer(self, ident: int | None, *, result: Any = None, error: str | None = None) -> None:
        message: dict[str, Any] = {"id": ident}
        if error is None:
            message.update(ok=True, result=result)
        else:
            message.update(ok=False, error=error)
        text = json.dumps(message, ensure_ascii=False, default=str)
        with self._write_lock:
            try:
                self._out.write(text + "\n")
                self._out.flush()
            except (BrokenPipeError, ValueError):
                pass  # the daemon went away; stdin closing ends the worker


def _path(value: object) -> Path | None:
    return Path(str(value)) if value else None


def main() -> int:
    out = sys.stdout
    sys.stdout = sys.stderr  # a stray print must not become an answer
    Worker(out).serve(sys.stdin)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
