"""Instruction lines suggested from your chats and memory (``chat.suggestions``).

The job reads your own messages, so it runs on a local model only. It is made at most once a
day, when the page asks: an answer is what is kept, and the job starts in the background.
Nothing is added to ``[chat] instructions`` by itself.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import cast

from golem.config import INSTRUCTION_CHARS_MAX
from golem.memory.service import MemoryService
from golem.sessions.drafts import ModelDrafts, NoLocalModel
from golem.store.suggestions import SuggestionStore, same_line
from golem_protocol.commands import ChatSuggestion, ChatSuggestionsResult

log = logging.getLogger("golem.sessions")

MAX_SUGGESTIONS = 5
MAX_REASON_CHARS = 200
MAX_NOTES = 50
REMAKE_AFTER = timedelta(hours=24)
RETRY_AFTER = timedelta(hours=1)
WINDOW = timedelta(days=14)

_INSTRUCTION = (
    "You read a person's notes about themselves and their own short messages from the last"
    " two weeks. Suggest at most 5 instruction lines that tell an assistant how they like"
    " answers, such as the length, the tone or the layout. Only suggest what the notes or the"
    " messages show: something they keep asking for, or a note about how they like answers."
    " Write each line in plain words as a rule, in the person's language. Reply with a JSON"
    ' list only, each item {"line": "...", "reason": "...", "source": "memory" or "chats"}.'
    " The reason is one short sentence that says where it came from, such as"
    ' You said "shorter" or "tl;dr" in 4 chats this week. or From memory: "Prefers bullet'
    ' points over long paragraphs." Count only what you can see. Say nothing about code unless'
    " the person talks about code. Reply with [] when nothing stands out."
)

_LIST = re.compile(r"\[.*\]", re.DOTALL)


def parse_suggestions(reply: str) -> list[dict[str, str]]:
    """The valid entries of the model's JSON list, at most 5, with no repeated line."""
    match = _LIST.search(reply)
    if match is None:
        return []
    try:
        data = json.loads(match.group())
    except ValueError:
        return []
    found: list[dict[str, str]] = []
    seen: set[str] = set()
    for raw in cast("list[object]", data) if isinstance(data, list) else []:
        if not isinstance(raw, dict):
            continue
        item = cast("dict[str, object]", raw)
        line = " ".join(str(item.get("line", "")).split())[:INSTRUCTION_CHARS_MAX].rstrip()
        reason = " ".join(str(item.get("reason", "")).split())[:MAX_REASON_CHARS].rstrip()
        source = item.get("source")
        if not line or not reason or source not in ("memory", "chats") or same_line(line) in seen:
            continue
        seen.add(same_line(line))
        found.append({"line": line, "reason": reason, "source": str(source)})
    return found[:MAX_SUGGESTIONS]


class ChatSuggestions:
    """Keeps the suggestions, and remakes them at most once a day."""

    def __init__(
        self,
        drafts: ModelDrafts,
        store: SuggestionStore,
        instructions: Callable[[], Awaitable[list[str]]],
        memory: Callable[[], MemoryService | None] = lambda: None,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self._drafts = drafts
        self._store = store
        self._instructions = instructions
        self._memory = memory
        self._clock = clock
        self._task: asyncio.Task[None] | None = None
        self._failed_at: datetime | None = None

    async def get(self) -> ChatSuggestionsResult:
        """What is kept, without the lines you have or dismissed. Never waits for the model."""
        saved = await self._store.load()
        updated = None if saved is None else saved[0]
        if self._drafts.local_profile() is None:
            return ChatSuggestionsResult(suggestions=[], updated=updated, needs_local_model=True)
        if self._due(updated):
            self._task = asyncio.create_task(self._make())
        if saved is None:
            return ChatSuggestionsResult(suggestions=[], updated=None, needs_local_model=False)
        have = {same_line(line) for line in await self._instructions()}
        have |= await self._store.dismissed()
        kept = [
            ChatSuggestion.model_validate(entry)
            for entry in saved[1]
            if same_line(entry["line"]) not in have
        ]
        return ChatSuggestionsResult(suggestions=kept, updated=updated, needs_local_model=False)

    async def dismiss(self, line: str) -> None:
        await self._store.dismiss(line, self._clock().isoformat())

    async def idle(self) -> None:
        """Wait for the job that is running, if any."""
        if self._task is not None:
            await self._task

    async def aclose(self) -> None:
        """Stop the job that is running, if any."""
        task = self._task
        if task is not None and not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    def _due(self, updated: str | None) -> bool:
        if self._task is not None and not self._task.done():
            return False
        now = self._clock()
        if self._failed_at is not None and now - self._failed_at < RETRY_AFTER:
            return False
        if updated is None:
            return True
        try:
            return now - datetime.fromisoformat(updated) >= REMAKE_AFTER
        except ValueError:
            return True

    async def _make(self) -> None:
        now = self._clock()
        try:
            entries = await self._ask(now)
        except NoLocalModel:
            return
        except Exception:
            log.warning("making instruction suggestions failed", exc_info=True)
            self._failed_at = now
            return
        self._failed_at = None
        await self._store.save(now.isoformat(), entries)

    async def _ask(self, now: datetime) -> list[dict[str, str]]:
        notes: list[str] = []
        service = self._memory()
        if service is not None and service.enabled:
            records = await service.store.list(scope="you", state="kept", limit=MAX_NOTES)
            notes = [" ".join(record.text.split()) for record in records]
        messages = await self._store.your_messages((now - WINDOW).isoformat())
        if not notes and not messages:
            return []
        reply = await self._drafts.ask_local(
            _INSTRUCTION, _input(notes, messages), "instruction suggestions"
        )
        return parse_suggestions(reply)


def _input(notes: list[str], messages: list[str]) -> str:
    parts: list[str] = []
    if notes:
        parts.append("Notes about the person:\n" + "\n".join(f"- {note}" for note in notes))
    if messages:
        parts.append("Their messages, newest first:\n" + "\n".join(f"- {m}" for m in messages))
    return "\n\n".join(parts)


__all__ = ["ChatSuggestions", "parse_suggestions"]
