"""Does an Ollama that golem did not start run two calls at once?

golem cannot set ``OLLAMA_NUM_PARALLEL`` on such a server, so it asks the server:
two tiny calls go out together. When both start to answer before either has
finished, the server runs more than one. When one waits for the other, it runs
one, and the line has one slot.

Importing this module opens no connection. A probe runs only when something calls
:func:`probe_overlap`.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Callable
from dataclasses import dataclass

import httpx

from golem.net_tls import tls_context

log = logging.getLogger(__name__)

# A probe may have to load the model first, which can take a while.
_TIMEOUT = 120.0
_PROMPT = "Reply with the word ok."


@dataclass(frozen=True, slots=True)
class OverlapResult:
    """What a probe found.

    ``slots`` is 1 when the calls did not overlap, else None (the setting applies).
    ``setup_line`` is the line to run to start the server with several slots, or None
    when it already runs them.
    """

    overlaps: bool
    slots: int | None
    setup_line: str | None


def setup_line(parallel: int) -> str:
    """The line that starts an Ollama with ``parallel`` slots (at least 2)."""
    return f"OLLAMA_NUM_PARALLEL={max(parallel, 2)} ollama serve"


async def probe_overlap(
    base_url: str,
    model: str,
    *,
    parallel: int,
    transport: httpx.AsyncBaseTransport | None = None,
    clock: Callable[[], float] = time.monotonic,
    timeout: float = _TIMEOUT,
) -> OverlapResult | None:
    """Send two tiny calls at once to ``model`` at ``base_url``.

    None when a call fails or times out: that says nothing about slots, so the
    caller may probe again. Never raises.
    """
    base = base_url.rstrip("/").removesuffix("/v1")
    try:
        async with httpx.AsyncClient(transport=transport, verify=tls_context()) as client:
            async with asyncio.timeout(timeout):
                first, second = await asyncio.gather(
                    _one_call(client, base, model, clock), _one_call(client, base, model, clock)
                )
    except Exception as exc:
        log.debug("ollama overlap probe at %s failed: %s", base, exc)
        return None
    if max(first[0], second[0]) < min(first[1], second[1]):
        return OverlapResult(True, None, None)
    return OverlapResult(False, 1, setup_line(parallel))


async def _one_call(
    client: httpx.AsyncClient, base: str, model: str, clock: Callable[[], float]
) -> tuple[float, float]:
    """When the first chunk arrived and when the answer ended."""
    body = {"model": model, "prompt": _PROMPT, "stream": True, "options": {"num_predict": 8}}
    first: float | None = None
    async with client.stream("POST", f"{base}/api/generate", json=body) as response:
        response.raise_for_status()
        async for _chunk in response.aiter_bytes():
            if first is None:
                first = clock()
    end = clock()
    if first is None:
        raise httpx.ReadError("the server sent nothing")
    return first, end
