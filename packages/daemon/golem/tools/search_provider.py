"""What a search provider gives and is: a list of results from one ``search`` call."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True, slots=True)
class Result:
    """One hit: the page's title, the address of the page itself, and a short excerpt."""

    title: str
    url: str
    snippet: str


class SearchProvider(Protocol):
    """Where a search goes. Raises ``ToolError`` when the provider refuses or fails."""

    async def search(self, query: str, n: int) -> list[Result]: ...


__all__ = ["Result", "SearchProvider"]
