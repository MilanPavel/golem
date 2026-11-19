"""How a local engine runs calls at once, and a way to read what it has loaded.

A profile is data: the dispatcher and the window plan read it, so no code
outside this module needs to know which engine it is talking to. Ollama is the
only instance. :func:`engine_for` picks it from a provider's kind and returns
None for a hosted kind, so a cloud-only setup never meets an engine.

Importing this module starts no process and opens no connection. The state
reader runs only when something calls it.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Literal, cast

import httpx

from golem.net_tls import tls_context

log = logging.getLogger(__name__)

AtOnce = Literal["slots", "serial", "batch"]
Capacity = Literal["slots_x_window", "pool_tokens", "memory"]
Window = Literal["fixed_at_load", "dynamic"]
Queue = Literal["golem", "engine"]
PrefixCache = Literal["per_slot", "shared", "file", "none"]
Reload = Literal["window", "slots"]
Tools = Literal["native", "parsed", "none"]

_STATE_TIMEOUT = 1.5


@dataclass(frozen=True, slots=True)
class LoadedModel:
    """One model an engine has in memory. A size is None when the engine did not say."""

    name: str
    size: int | None = None
    size_vram: int | None = None
    context_length: int | None = None


@dataclass(frozen=True, slots=True)
class EngineState:
    """What an engine has loaded right now."""

    loaded: tuple[LoadedModel, ...] = ()


@dataclass(frozen=True, slots=True)
class EngineProfile:
    """How one engine runs calls at once and what a context costs there.

    ``at_once`` is how it takes several calls: ``slots`` (a fixed number),
    ``serial`` (one) or ``batch`` (as many as fit). ``max_slots`` is the most
    slots golem asks for and ``max_loaded`` the most models it keeps loaded
    at once. ``window`` says whether the context size is fixed when a model
    loads, and ``reload_on`` which changes make the engine load it again.
    ``queue`` says who keeps the line, golem or the engine. ``owns_server`` is
    true when golem may start and stop the server itself.
    """

    id: str
    at_once: AtOnce
    max_slots: int
    max_loaded: int
    capacity: Capacity
    window: Window
    queue: Queue
    prefix_cache: PrefixCache
    reload_on: frozenset[Reload]
    tools: Tools
    structured: bool
    owns_server: bool

    async def read_state(
        self, base_url: str, *, transport: httpx.AsyncBaseTransport | None = None
    ) -> EngineState | None:
        """What the engine at ``base_url`` has loaded, or None. Never raises.

        None when the engine does not answer, answers something unreadable, or
        has no reader here. It does not start a server and never waits longer
        than a second and a half, so a call can use it without risk.
        """
        if self.id == OLLAMA.id:
            return await _read_ollama(base_url, transport)
        return None


# ``max_loaded`` stays 1 until step 18.9 lets a second model load beside the first.
OLLAMA = EngineProfile(
    id="ollama",
    at_once="slots",
    max_slots=8,
    max_loaded=1,
    capacity="slots_x_window",
    window="fixed_at_load",
    queue="golem",
    prefix_cache="per_slot",
    reload_on=frozenset({"window", "slots"}),
    tools="native",
    structured=True,
    owns_server=True,
)

_BY_KIND = {"ollama": OLLAMA}


def engine_for(kind: str) -> EngineProfile | None:
    """The profile for a provider's ``kind``, or None for a hosted kind."""
    return _BY_KIND.get(kind)


async def _read_ollama(
    base_url: str, transport: httpx.AsyncBaseTransport | None
) -> EngineState | None:
    base = base_url.rstrip("/").removesuffix("/v1")
    try:
        async with httpx.AsyncClient(transport=transport, verify=tls_context()) as client:
            response = await client.get(f"{base}/api/ps", timeout=_STATE_TIMEOUT)
            response.raise_for_status()
            return _parse_ollama(response.json())
    except Exception as exc:
        log.debug("ollama /api/ps at %s failed: %s", base, exc)
        return None


def _parse_ollama(body: object) -> EngineState | None:
    models = _dict(body).get("models")
    if not isinstance(models, list):
        return None
    loaded: list[LoadedModel] = []
    for item in cast("list[object]", models):
        entry = _dict(item)
        name = entry.get("name") or entry.get("model")
        if isinstance(name, str) and name:
            loaded.append(
                LoadedModel(
                    name,
                    _count(entry.get("size")),
                    _count(entry.get("size_vram")),
                    _count(entry.get("context_length")),
                )
            )
    return EngineState(tuple(loaded))


def _dict(value: object) -> dict[str, Any]:
    return cast("dict[str, Any]", value) if isinstance(value, dict) else {}


def _count(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None
