"""The memory service: who may write, what a recall returns, and what a run carries (ADR-061).

The store holds rows. This layer owns the rules on top of it: the state and author of a
write, the privacy check on a recall, and the ``memory.changed`` signal. ``[memory]
enabled = false`` turns every method off: writes return None, reads return nothing.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from typing import Literal

from golem.config import MemoryPrivacyLevel, MemorySettings
from golem.memory.export import ExportFormat, render
from golem.memory.privacy import ChatPrivacy, MemoryPrivacy, Target, may_use
from golem.memory.quote import quote_matches
from golem.memory.records import MemoryRecord, Privacy, Scope, SourceRow, new_memory_id
from golem.memory.store import MemoryStore

MAX_TEXT_CHARS = 2000
MAX_TITLE_CHARS = 120
MAX_ALWAYS = 5
"""How many lines of your own words may be in the fixed block of every chat."""
MAX_HITS = 8
_FETCH = 50
"""How many rows a search reads per scope before the privacy check drops some."""

Change = Literal["created", "updated", "deleted", "stale", "resolved"]


class MemoryTextError(ValueError):
    """The text of a memory is empty or too long."""


@dataclass(frozen=True, slots=True)
class MemoryChange:
    """What ``memory.changed`` says: one memory changed."""

    id: str
    change: Change
    scope: Scope
    folder: str | None


def title_of(text: str, title: str | None = None) -> str:
    """The given title, else the first line of ``text``, cut to 120 characters."""
    given = (title or "").strip()
    lines = text.strip().splitlines()
    return (given or (lines[0] if lines else ""))[:MAX_TITLE_CHARS]


def _checked(text: str) -> str:
    text = text.strip()
    if text == "":
        raise MemoryTextError("a memory needs some text")
    if len(text) > MAX_TEXT_CHARS:
        raise MemoryTextError(
            f"a memory is at most {MAX_TEXT_CHARS} characters; write a skill for a longer text"
        )
    return text


def _now() -> str:
    return datetime.now(UTC).isoformat()


class MemoryService:
    """Rules over a :class:`MemoryStore`. ``changed`` is called once for each change."""

    def __init__(
        self,
        store: MemoryStore,
        settings: Callable[[], MemorySettings],
        changed: Callable[[MemoryChange], None] = lambda _change: None,
        clock: Callable[[], str] = _now,
    ) -> None:
        self._store = store
        self._settings = settings
        self._changed = changed
        self._clock = clock

    @property
    def enabled(self) -> bool:
        return self._settings().enabled

    @property
    def store(self) -> MemoryStore:
        """The rows, for the browser's list, count and export. Writes go through the service."""
        return self._store

    def use_settings(self, settings: MemorySettings) -> None:
        """Take ``settings`` from now on, after the user's file changed."""
        self._settings = lambda: settings

    async def write_by_you(
        self,
        text: str,
        scope: Scope,
        *,
        folder: str | None = None,
        title: str | None = None,
        privacy: Privacy = "chat",
        session_id: str | None = None,
        always: bool | None = None,
        sources: tuple[SourceRow, ...] = (),
    ) -> MemoryRecord | None:
        """A note you wrote: ``kept``, author ``you``. None when memory is off.

        A note about you is ``always`` (in the fixed block of every chat) while fewer than 5
        such lines exist, unless ``always`` says otherwise. Raises :class:`MemoryTextError`
        for an empty or too long text.
        """
        if not self.enabled:
            return None
        return await self._add_kept(
            text, scope, folder, title, privacy, session_id, always, sources
        )

    async def remember(
        self,
        text: str,
        scope: Scope,
        quote: str,
        user_message: str,
        *,
        folder: str | None = None,
        privacy: Privacy = "chat",
        session_id: str | None = None,
    ) -> MemoryRecord | None:
        """A note the model asks to keep.

        ``kept`` for you when ``quote`` is in ``user_message``. Anything else, such as a
        sentence from a file the model read, is a proposal by ``lead`` that you decide.
        """
        if not self.enabled:
            return None
        if quote_matches(quote, user_message):
            return await self._add_kept(text, scope, folder, None, privacy, session_id)
        text = _checked(text)
        now = self._clock()
        record = MemoryRecord(
            id=new_memory_id(),
            scope=_noted(scope),
            title=title_of(text),
            text=text,
            author="lead",
            state="proposed",
            created_at=now,
            updated_at=now,
            folder=_folder(scope, folder),
            session_id=session_id,
            privacy=privacy,
        )
        await self._store.add(record)
        self._send(record, "created")
        return record

    async def update(
        self,
        memory_id: str,
        *,
        text: str | None = None,
        title: str | None = None,
        privacy: Privacy | None = None,
        keep: bool = False,
        always: bool | None = None,
        folder: str | None = None,
        sources: tuple[SourceRow, ...] | None = None,
    ) -> MemoryRecord | None:
        """Edit a memory. ``keep`` decides a proposal: ``kept`` by you.

        ``sources`` are the files hashed again: they replace the old ones and a ``stale`` memory
        is ``kept`` again. ``always`` is yours: a memory a model wrote and you have not kept
        cannot have it. ``folder`` is only for a project memory. Raises ``ValueError`` for
        a change a memory cannot take. None when memory is off or there is no such memory.
        """
        if not self.enabled:
            return None
        found = await self._store.get(memory_id)
        if found is None:
            return None
        record = replace(found, updated_at=self._clock())
        if text is not None:
            record = replace(record, text=_checked(text), title=title_of(_checked(text), title))
        elif title is not None:
            record = replace(record, title=title_of(record.text, title))
        if privacy is not None:
            record = replace(record, privacy=privacy)
        if folder is not None:
            if record.scope != "project":
                raise ValueError("only a project memory has a folder")
            record = replace(record, folder=folder)
        resolved = keep and record.state == "proposed"
        if keep:
            record = replace(record, state="kept", kept_by="you")
        if sources is not None:
            record = replace(record, sources=sources)
            if record.state == "stale":
                record = replace(record, state="kept")
        if always is not None:
            if always and "you" not in (record.author, record.kept_by):
                raise ValueError("only a memory you wrote or kept can be always")
            record = replace(record, always=always)
        if not await self._store.update(record):
            return None
        self._send(record, "resolved" if resolved else "updated")
        return record

    async def delete(self, memory_id: str) -> bool:
        if not self.enabled:
            return False
        found = await self._store.get(memory_id)
        if found is None or not await self._store.delete_many([memory_id]):
            return False
        self._send(found, "deleted")
        return True

    async def search(
        self,
        query: str,
        scope: Scope | None = None,
        folder: str | None = None,
        limit: int = MAX_HITS,
    ) -> list[MemoryRecord]:
        """Matches with no privacy check: for the browser, which is you looking."""
        if not self.enabled:
            return []
        return await self._store.search(query, scope, folder, limit)

    async def recall(
        self,
        query: str,
        chat: ChatPrivacy,
        target: Target,
        *,
        folder: str | None = None,
        scope: Scope | None = None,
        limit: int = MAX_HITS,
        folder_local_only: bool = False,
        project_private: bool = False,
    ) -> list[MemoryRecord]:
        """What a model may read for ``query``, at most 8, best first.

        Without ``scope`` it looks in your notes and the project's (``folder``), and in
        ``history`` only when asked. A proposal is not a memory yet and is left out. Every
        hit goes through :func:`may_use`, so a hosted ``target`` gets no local memory and
        no memory of a local chat.
        """
        if not self.enabled:
            return []
        limit = max(1, min(limit, MAX_HITS))
        scopes: tuple[Scope, ...] = (scope,) if scope else ("you", "project")
        settings = self._settings()
        found: list[MemoryRecord] = []
        for each in scopes:
            if each == "project" and folder is None:
                continue
            where = folder if each == "project" else None
            for record in await self._store.search(query, each, where, _FETCH):
                if record.state == "proposed":
                    continue
                project = record.scope == "project"
                memory = MemoryPrivacy(
                    record.scope,
                    record.privacy,
                    _setting(settings, record.scope),
                    folder_local_only and project,
                    project_private and project,
                )
                if may_use(memory, chat, target).allowed:
                    found.append(record)
        return found[:limit]

    async def allowed(
        self,
        ids: Iterable[str],
        chat: ChatPrivacy,
        target: Target,
        *,
        folder_local_only: bool = False,
        project_private: bool = False,
    ) -> set[str]:
        """The ids among ``ids`` whose memory ``target`` may read now.

        A memory that is gone, or a service that is off, is not allowed: what cannot be
        checked is not sent.
        """
        if not self.enabled:
            return set()
        settings = self._settings()
        found: set[str] = set()
        for memory_id in ids:
            record = await self._store.get(memory_id)
            if record is None:
                continue
            project = record.scope == "project"
            memory = MemoryPrivacy(
                record.scope,
                record.privacy,
                _setting(settings, record.scope),
                folder_local_only and project,
                project_private and project,
            )
            if may_use(memory, chat, target).allowed:
                found.add(memory_id)
        return found

    async def export(self, fmt: ExportFormat = "json") -> str:
        """Every memory, newest first: JSON with every field, or Markdown for reading."""
        if not self.enabled:
            return render([], fmt)
        records: list[MemoryRecord] = []
        after: str | None = None
        while page := await self._store.list(limit=200, after=after):
            records.extend(page)
            after = page[-1].id
        return render(records, fmt)

    async def touch_used(self, ids: Iterable[str]) -> None:
        """Count a recall that returned these memories. It is not a change."""
        if not self.enabled:
            return
        now = self._clock()
        for memory_id in dict.fromkeys(ids):
            found = await self._store.get(memory_id)
            if found is not None:
                await self._store.update(replace(found, uses=found.uses + 1, last_used_at=now))

    async def _add_kept(
        self,
        text: str,
        scope: Scope,
        folder: str | None,
        title: str | None,
        privacy: Privacy,
        session_id: str | None,
        always: bool | None = None,
        sources: tuple[SourceRow, ...] = (),
    ) -> MemoryRecord:
        text = _checked(text)
        now = self._clock()
        record = MemoryRecord(
            id=new_memory_id(),
            scope=_noted(scope),
            title=title_of(text, title),
            text=text,
            author="you",
            state="kept",
            created_at=now,
            updated_at=now,
            folder=_folder(scope, folder),
            session_id=session_id,
            kept_by="you",
            privacy=privacy,
            always=(scope == "you" and await self._always_room()) if always is None else always,
            sources=sources,
        )
        await self._store.add(record)
        self._send(record, "created")
        return record

    async def _always_room(self) -> bool:
        """Whether fewer than 5 of your own lines are in the fixed block already."""
        held = 0
        after: str | None = None
        while page := await self._store.list(scope="you", state="kept", limit=200, after=after):
            held += sum(1 for r in page if r.always and r.author == "you")
            after = page[-1].id
        return held < MAX_ALWAYS

    def _send(self, record: MemoryRecord, change: Change) -> None:
        self._changed(MemoryChange(record.id, change, record.scope, record.folder))


@dataclass(frozen=True, slots=True)
class MemoryAccess:
    """What one run carries: the service, its project, its chat, and the message it answers.

    Built once per run. The ``target`` of a recall is the model of the call, so the caller
    gives it each time.
    """

    service: MemoryService
    project: str | None
    chat: ChatPrivacy
    user_message: str
    project_private: bool = False
    """The project's own ``[memory] private = true``."""

    @property
    def enabled(self) -> bool:
        return self.service.enabled

    async def remember(
        self, text: str, scope: Scope, quote: str, session_id: str | None = None
    ) -> MemoryRecord | None:
        """Keep or propose a note. A project note made in a local-only folder is stamped local."""
        local = scope == "project" and (self.chat.local_only or self.project_private)
        return await self.service.remember(
            text,
            scope,
            quote,
            self.user_message,
            folder=self.project,
            privacy="local" if local else "chat",
            session_id=session_id,
        )

    async def recall(
        self, query: str, target: Target, scope: Scope | None = None, limit: int = MAX_HITS
    ) -> list[MemoryRecord]:
        return await self.service.recall(
            query,
            self.chat,
            target,
            folder=self.project,
            scope=scope,
            limit=limit,
            folder_local_only=self.chat.local_only,
            project_private=self.project_private,
        )

    async def allowed(self, ids: Iterable[str], target: Target) -> set[str]:
        """The ids among ``ids`` that ``target`` may read, for a history about to be sent.

        ``model_local`` of the chat is the call's own, so it is set from ``target``.
        """
        return await self.service.allowed(
            ids,
            replace(self.chat, model_local=target.local),
            target,
            folder_local_only=self.chat.local_only,
            project_private=self.project_private,
        )


def _noted(scope: Scope) -> Scope:
    """``scope`` when a note can have it: your own or a project's, never ``history``."""
    if scope not in ("you", "project"):
        raise ValueError("a note is for you or for a project")
    return scope


def _folder(scope: Scope, folder: str | None) -> str | None:
    if scope != "project":
        return None
    if folder is None:
        raise ValueError("a project note needs its project folder")
    return folder


def _setting(settings: MemorySettings, scope: Scope) -> MemoryPrivacyLevel:
    if scope == "you":
        return settings.you
    return settings.projects if scope == "project" else settings.history


__all__ = [
    "MAX_ALWAYS",
    "MAX_HITS",
    "MAX_TEXT_CHARS",
    "MemoryAccess",
    "MemoryChange",
    "MemoryService",
    "MemoryTextError",
    "title_of",
]
