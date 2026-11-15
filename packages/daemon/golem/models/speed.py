"""How fast each local model loads, reads a prompt and writes a reply.

The numbers are the model server's own, from ``model.call.completed``. The book keeps the
last few samples of each ref and answers with their median.
"""

from __future__ import annotations

import json
import logging
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from statistics import median
from typing import cast

log = logging.getLogger(__name__)

KEEP = 20
MIN_PROMPT_TOKENS = 200
MIN_PROMPT_MS = 50
MIN_REPLY_TOKENS = 20
MIN_LOAD_MS = 500
SAVE_EVERY_SECONDS = 30.0
_FILE = "speed.json"
_KEYS = ("prompt_tps", "reply_tps", "load_ms")


@dataclass(frozen=True, slots=True)
class Speed:
    prompt_tps: float | None  # prompt tokens read per second
    reply_tps: float | None  # reply tokens written per second
    load_ms: int | None  # a typical cold load
    samples: int


class SpeedBook:
    """The typical speed of each model ref, kept in ``cache/speed.json``."""

    def __init__(
        self, cache_dir: Path | None, *, clock: Callable[[], float] = time.monotonic
    ) -> None:
        self._path = None if cache_dir is None else cache_dir / _FILE
        self._clock = clock
        self._samples: dict[str, dict[str, list[float]]] = {}
        self._saved_at: float | None = None
        self._dirty = False
        self._load()

    def note(
        self,
        ref: str,
        *,
        prompt_tokens: int | None = None,
        prompt_ms: int | None = None,
        reply_tokens: int | None = None,
        reply_ms: int | None = None,
        load_ms: int | None = None,
    ) -> Speed | None:
        """Add one call's numbers. Returns the new speed of ``ref``, or None with no samples."""
        found: dict[str, float] = {}
        if (
            prompt_tokens is not None
            and prompt_ms is not None
            and prompt_tokens >= MIN_PROMPT_TOKENS
            and prompt_ms >= MIN_PROMPT_MS
        ):
            found["prompt_tps"] = prompt_tokens / prompt_ms * 1000
        if (
            reply_tokens is not None
            and reply_ms is not None
            and reply_tokens >= MIN_REPLY_TOKENS
            and reply_ms > 0
        ):
            found["reply_tps"] = reply_tokens / reply_ms * 1000
        if load_ms is not None and load_ms > MIN_LOAD_MS:
            found["load_ms"] = float(load_ms)
        if found:
            book = self._samples.setdefault(ref, {})
            for key, value in found.items():
                book[key] = [*book.get(key, []), value][-KEEP:]
            self._dirty = True
            self._save_if_due()
        return self.speed(ref)

    def speed(self, ref: str) -> Speed | None:
        book = self._samples.get(ref)
        if not book:
            return None
        prompt, reply, load = (book.get(key, []) for key in _KEYS)
        return Speed(
            prompt_tps=median(prompt) if prompt else None,
            reply_tps=median(reply) if reply else None,
            load_ms=round(median(load)) if load else None,
            samples=max(len(prompt), len(reply), len(load)),
        )

    def first_token_ms(self, ref: str, prompt_tokens: int, *, cold: bool = False) -> int | None:
        """The worst-case wait for the first token: nothing of the prompt is cached."""
        found = self.speed(ref)
        if found is None or found.prompt_tps is None or found.prompt_tps <= 0:
            return None
        wait = prompt_tokens / found.prompt_tps * 1000
        if cold and found.load_ms is not None:
            wait += found.load_ms
        return round(wait)

    def save(self) -> None:
        """Write the book now, if anything changed. Called on shutdown."""
        if self._path is None or not self._dirty:
            return
        try:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self._path.with_name(self._path.name + ".tmp")
            tmp.write_text(json.dumps(self._samples, sort_keys=True), encoding="utf-8")
            tmp.replace(self._path)
        except OSError as exc:
            log.warning("could not save the speed book: %s", exc)
            return
        self._dirty = False
        self._saved_at = self._clock()

    def _save_if_due(self) -> None:
        if self._saved_at is None or self._clock() - self._saved_at >= SAVE_EVERY_SECONDS:
            self.save()

    def _load(self) -> None:
        if self._path is None:
            return
        try:
            raw = json.loads(self._path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return
        if not isinstance(raw, dict):
            return
        for ref, book in cast(dict[object, object], raw).items():
            if not isinstance(ref, str) or not isinstance(book, dict):
                continue
            book = cast(dict[str, object], book)
            kept: dict[str, list[float]] = {}
            for key in _KEYS:
                values = book.get(key)
                if isinstance(values, list):
                    numbers = [
                        float(v)
                        for v in cast(list[object], values)
                        if isinstance(v, int | float) and not isinstance(v, bool) and v > 0
                    ]
                    if numbers:
                        kept[key] = numbers[-KEEP:]
            if kept:
                self._samples[ref] = kept
