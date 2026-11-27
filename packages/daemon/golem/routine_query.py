"""What a query routine needs from the data engine: run a saved query, and say if it is there.

This is the one place a routine touches the saved-query API, so the scheduler, the server and
the tests see only :class:`QueryRoutines`.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any, Protocol

from golem.data.types import DataError

if TYPE_CHECKING:
    from golem.data.sources import DataSources

__all__ = ["POST_ROWS", "DataQueryRoutines", "QueryAnswer", "QueryRoutines"]

POST_ROWS = 10
"""How many rows an Inbox post carries."""


@dataclass(frozen=True, slots=True)
class QueryAnswer:
    """The result of a routine's query: every row counted, the first few kept."""

    columns: list[str]
    row_count: int
    rows: list[list[Any]]


class QueryRoutines(Protocol):
    async def run(self, source: str, saved: str, folder: Path | None) -> QueryAnswer:
        """Run the saved query with the engine's usual limits. Raises with a plain sentence."""
        ...

    async def problem(self, source: str, saved: str, folder: Path | None) -> str | None:
        """Why the source or the saved query is not there, or None."""
        ...


class DataQueryRoutines:
    """:class:`QueryRoutines` over the daemon's data sources."""

    def __init__(self, data: DataSources) -> None:
        self._data = data

    async def run(self, source: str, saved: str, folder: Path | None) -> QueryAnswer:
        result = await self._data.query_saved(folder, source, saved)
        columns = [str(column["name"]) for column in result.columns]
        rows = [list(row) for row in result.rows[:POST_ROWS]]
        return QueryAnswer(columns, len(result.rows), rows)

    async def problem(self, source: str, saved: str, folder: Path | None) -> str | None:
        try:
            found = await self._data.list_queries(folder, source)
        except DataError as exc:
            return str(exc)
        if any(query.name == saved for query in found):
            return None
        return f"{source} has no saved query called {saved}"
