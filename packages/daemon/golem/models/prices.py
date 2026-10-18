"""Prices and context sizes from LiteLLM's model list.

LiteLLM keeps ``model_prices_and_context_window.json`` up to date for
hundreds of hosted models (MIT licensed). Golem bundles a trimmed copy for
offline use and a first start, and the daemon fetches a fresh one once a day
into ``~/.golem/cache/``. ``python -m golem.models.prices`` rewrites the
bundled copy.
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from importlib import resources
from pathlib import Path
from typing import Any, cast

import httpx

from golem.config import ModelPrice

log = logging.getLogger(__name__)

LITELLM_URL = (
    "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json"
)
CACHE_NAME = "litellm-prices.json"
MAX_AGE_SECONDS = 24 * 3600

# LiteLLM provider names golem has a provider for. Golem's together is LiteLLM's together_ai.
_KEPT_PROVIDERS = frozenset({"anthropic", "openai", "groq", "together_ai", "openrouter"})
_PREFIXES = {"together": "together_ai"}
_KEPT_FIELDS = (
    "input_cost_per_token",
    "output_cost_per_token",
    "cache_read_input_token_cost",
    "max_input_tokens",
    "mode",
    "supports_function_calling",
    "litellm_provider",
)
_PER_MILLION = 1_000_000


@dataclass(frozen=True, slots=True)
class PriceInfo:
    """What LiteLLM knows about one model."""

    price: ModelPrice | None
    ctx: int | None
    tools: bool | None
    mode: str | None


def trim(raw: object) -> dict[str, dict[str, object]]:
    """Keep the providers and fields golem reads. The full file is several megabytes."""
    if not isinstance(raw, dict):
        return {}
    kept: dict[str, dict[str, object]] = {}
    for key, value in cast(dict[str, object], raw).items():
        if not isinstance(value, dict):
            continue
        entry = cast(dict[str, object], value)
        if entry.get("litellm_provider") not in _KEPT_PROVIDERS:
            continue
        kept[key] = {field: entry[field] for field in _KEPT_FIELDS if entry.get(field) is not None}
    return dict(sorted(kept.items()))


class PriceBook:
    """Looks a golem ref up in LiteLLM's names."""

    def __init__(self, entries: dict[str, dict[str, object]], fetched_at: float | None = None):
        self._entries = entries
        self.fetched_at = fetched_at

    @classmethod
    def bundled(cls) -> PriceBook:
        text = resources.files("golem.models").joinpath("data/litellm-prices.json").read_text()
        return cls(cast(dict[str, dict[str, object]], json.loads(text)))

    @classmethod
    def load(cls, cache_dir: Path | None) -> PriceBook:
        """The cached copy when there is a readable one, else the bundled one."""
        if cache_dir is not None:
            path = cache_dir / CACHE_NAME
            try:
                stored = json.loads(path.read_text("utf-8"))
                entries = cast(dict[str, dict[str, object]], stored["entries"])
                return cls(entries, float(stored["fetched_at"]))
            except (OSError, ValueError, KeyError, TypeError):
                pass
        return cls.bundled()

    def is_fresh(self, now: float) -> bool:
        return self.fetched_at is not None and now - self.fetched_at < MAX_AGE_SECONDS

    def lookup(self, provider: str, model_id: str) -> PriceInfo | None:
        """``<provider>/<id>`` first, then the bare id when LiteLLM files it under that provider."""
        litellm_provider = _PREFIXES.get(provider, provider)
        entry = self._entries.get(f"{litellm_provider}/{model_id}")
        if entry is None:
            bare = self._entries.get(model_id)
            if bare is not None and bare.get("litellm_provider") == litellm_provider:
                entry = bare
        if entry is None:
            return None
        mode = entry.get("mode")
        return PriceInfo(
            price=_price(entry),
            ctx=_int(entry.get("max_input_tokens")),
            tools=_bool(entry.get("supports_function_calling")),
            mode=mode if isinstance(mode, str) else None,
        )


async def fetch(client: httpx.AsyncClient, cache_dir: Path, now: float | None = None) -> PriceBook:
    """Download, trim, and cache LiteLLM's list. Raises on a network or format error."""
    response = await client.get(LITELLM_URL, timeout=30.0)
    response.raise_for_status()
    entries = trim(response.json())
    if not entries:
        raise ValueError("LiteLLM's model list had no entries golem reads")
    fetched_at = time.time() if now is None else now
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / CACHE_NAME
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps({"fetched_at": fetched_at, "entries": entries}), "utf-8")
    temp.replace(path)
    log.info("fetched LiteLLM prices entries=%d", len(entries))
    return PriceBook(entries, fetched_at)


def _price(entry: dict[str, Any]) -> ModelPrice | None:
    given = entry.get("input_cost_per_token")
    taken = entry.get("output_cost_per_token")
    if not isinstance(given, int | float) or not isinstance(taken, int | float):
        return None
    cached = entry.get("cache_read_input_token_cost")
    return ModelPrice(
        input=given * _PER_MILLION,
        output=taken * _PER_MILLION,
        cached_input=cached * _PER_MILLION if isinstance(cached, int | float) else None,
    )


def _int(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) and value > 0 else None


def _bool(value: object) -> bool | None:
    return value if isinstance(value, bool) else None


def _write_bundled() -> None:
    target = Path(__file__).resolve().parent / "data" / "litellm-prices.json"
    raw = httpx.get(LITELLM_URL, timeout=30.0).raise_for_status().json()
    entries = trim(raw)
    target.write_text(json.dumps(entries, indent=0, sort_keys=True) + "\n", "utf-8")
    print(f"wrote {len(entries)} entries to {target}")


if __name__ == "__main__":
    _write_bundled()
