"""What the benchmark measured, kept in ``cache/bench.json``.

An entry is the total tokens a second at each count of calls at once, for one engine, one
model, one amount of memory and one engine version. A new engine version or a different
machine is a new key, so an old table is never used for it. The file is a cache: one that is
missing, unreadable or in an old format means "no measurement". Nothing is read or written
until a model is asked about or a result is saved, so with no local model the file is not
touched.
"""

from __future__ import annotations

import json
import logging
import os
from collections.abc import Callable, Mapping
from pathlib import Path
from statistics import fmean
from typing import cast

from golem.models.bench import Result
from golem.models.engine import OLLAMA

log = logging.getLogger(__name__)

FILE = "bench.json"
FORMAT = 1

_Key = tuple[str, str, int | None, str]


class BenchStore:
    """The measured total speed of each local model, by count of calls at once."""

    def __init__(
        self,
        cache_dir: Path | None,
        *,
        ram_gb: float | None,
        version: Callable[[], str | None] = lambda: None,
        engine: str = OLLAMA.id,
    ) -> None:
        self._file = None if cache_dir is None else cache_dir / FILE
        self._memory = None if ram_gb is None else round(ram_gb)
        self._version = version
        self._engine = engine
        self._tables: dict[_Key, dict[int, float]] | None = None

    def measured(self, model: str) -> Mapping[int, float] | None:
        """Total tokens a second at each count for ``model``, or None with no measurement."""
        return self._load().get(self._key(model)) or None

    def save(self, result: Result, model_id: str | None = None) -> None:
        """Keep the table of a finished run. A run with no rows stores nothing.

        The total at a count is the mean of the totals of the shapes measured at it.
        ``result.model`` is a ref (``ollama/qwen3:8b``), while :meth:`measured` is asked by
        model id (``qwen3:8b``), so the caller gives ``model_id``. Without it the table is
        kept under ``result.model`` as it is.
        """
        totals: dict[int, list[float]] = {}
        for row in result.rows:
            if row.total > 0:
                totals.setdefault(row.at_once, []).append(row.total)
        if not totals:
            return
        tables = self._load()
        tables[self._key(model_id or result.model)] = {
            k: fmean(v) for k, v in sorted(totals.items())
        }
        self._write(tables)

    def _key(self, model: str) -> _Key:
        return (self._engine, model, self._memory, self._version() or "")

    def _load(self) -> dict[_Key, dict[int, float]]:
        if self._tables is None:
            self._tables = self._read()
        return self._tables

    def _read(self) -> dict[_Key, dict[int, float]]:
        if self._file is None:
            return {}
        try:
            raw: object = json.loads(self._file.read_text())
        except (OSError, ValueError):
            return {}
        if not isinstance(raw, dict) or raw.get("format") != FORMAT:  # pyright: ignore[reportUnknownMemberType]
            return {}
        entries = cast("object", raw.get("entries"))  # pyright: ignore[reportUnknownMemberType]
        tables: dict[_Key, dict[int, float]] = {}
        for entry in entries if isinstance(entries, list) else []:  # pyright: ignore[reportUnknownVariableType]
            parsed = _parse(entry)  # pyright: ignore[reportUnknownArgumentType]
            if parsed is not None:
                tables[parsed[0]] = parsed[1]
        return tables

    def _write(self, tables: dict[_Key, dict[int, float]]) -> None:
        if self._file is None:
            return
        entries = [
            {
                "engine": engine,
                "model": model,
                "memory_gb": memory,
                "version": version,
                "total": {str(k): v for k, v in table.items()},
            }
            for (engine, model, memory, version), table in sorted(
                tables.items(), key=lambda item: (item[0][0], item[0][1], item[0][3])
            )
        ]
        temp = self._file.with_name(self._file.name + ".tmp")
        try:
            self._file.parent.mkdir(parents=True, exist_ok=True)
            temp.write_text(json.dumps({"format": FORMAT, "entries": entries}))
            os.replace(temp, self._file)
        except OSError as exc:
            log.warning("could not save %s: %s", self._file, exc)


def _parse(entry: object) -> tuple[_Key, dict[int, float]] | None:
    if not isinstance(entry, dict):
        return None
    engine, model = entry.get("engine"), entry.get("model")  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]
    memory, version = entry.get("memory_gb"), entry.get("version")  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]
    total = cast("object", entry.get("total"))  # pyright: ignore[reportUnknownMemberType]
    if not isinstance(engine, str) or not isinstance(model, str) or not isinstance(version, str):
        return None
    if memory is not None and (not isinstance(memory, int) or isinstance(memory, bool)):
        return None
    if not isinstance(total, dict):
        return None
    table: dict[int, float] = {}
    for count, speed in total.items():  # pyright: ignore[reportUnknownVariableType]
        try:
            slots = int(count)  # pyright: ignore[reportUnknownArgumentType]
        except ValueError:
            return None
        if isinstance(speed, bool) or not isinstance(speed, (int, float)) or speed <= 0:
            return None
        if slots < 1:
            return None
        table[slots] = float(speed)
    return ((engine, model, memory, version), table) if table else None


__all__ = ["FILE", "BenchStore"]
