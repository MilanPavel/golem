"""Typed rows of ``memory.db`` (ADR-061, decision 7)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from golem.sessions.ids import new_id

Scope = Literal["you", "project", "history"]
Author = Literal["you", "lead", "helper"]
State = Literal["proposed", "kept", "stale"]
KeptBy = Literal["you", "auto"]
Privacy = Literal["chat", "local"]

SCOPES: tuple[Scope, ...] = ("you", "project", "history")


def new_memory_id() -> str:
    return new_id("m")


@dataclass(frozen=True, slots=True)
class SourceRow:
    """A file a note is about, as it was when the note was made."""

    path: str
    """Relative to the folder when inside it, else absolute."""
    sha256: str
    size: int
    mtime_ns: int
    checked_at: str


@dataclass(frozen=True, slots=True)
class MemoryRecord:
    id: str
    scope: Scope
    title: str
    text: str
    author: Author
    state: State
    created_at: str
    updated_at: str
    folder: str | None = None
    """The project folder for ``project``, else None."""
    session_id: str | None = None
    agent: str | None = None
    call_id: str | None = None
    kept_by: KeptBy | None = None
    """None while ``proposed``."""
    privacy: Privacy = "chat"
    always: bool = False
    uses: int = 0
    last_used_at: str | None = None
    sources: tuple[SourceRow, ...] = ()
