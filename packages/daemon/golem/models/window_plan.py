"""Which context window golem should ask Ollama for.

A pure rule over the model's size, its maximum context, and this Mac's
memory. Prefer a window that leaves half the memory free; accept a tighter
fit only to reach 32K, which an agent needs.
"""

from __future__ import annotations

from golem.models.hardware import fit

STEPS: tuple[int, ...] = (8192, 16384, 32768, 65536)
CEILING = 65536
TIGHT_CEILING = 32768
GROW_STEPS: tuple[int, ...] = (*STEPS, 131072)

_SPILL_SHARE = 0.98
GROW_AT = 0.8
GROW_CLEARS = 2
GROW_SUMMARIES = 1


def plan_window(
    *,
    model_max: int | None,
    size_gb: float | None,
    ram_gb: float | None,
    lowered_to: int | None = None,
    slots: int = 1,
) -> int | None:
    """The window to ask for, or None when golem should send nothing.

    The KV cache is the window times ``slots``.
    """
    if size_gb is None or ram_gb is None:
        return None
    limit = min(model_max or CEILING, CEILING)
    if lowered_to is not None:
        limit = min(limit, lowered_to)
    candidates = [s for s in STEPS if s <= limit]
    fits = [s for s in candidates if fit(size_gb, ram_gb, s, slots) == "fits"]
    a = fits[-1] if fits else None
    if a is not None and a >= TIGHT_CEILING:
        return a
    roomy = [
        s for s in candidates if s <= TIGHT_CEILING and fit(size_gb, ram_gb, s, slots) != "too_big"
    ]
    if roomy:
        return roomy[-1]
    return a


def next_step(
    current: int,
    *,
    model_max: int | None,
    size_gb: float | None,
    ram_gb: float | None,
    lowered_to: int | None = None,
) -> int | None:
    """The next window above ``current`` that the model and the memory allow."""
    if size_gb is None or ram_gb is None:
        return None
    for step in GROW_STEPS:
        if step <= current:
            continue
        if model_max is not None and step > model_max:
            return None
        if lowered_to is not None and step > lowered_to:
            return None
        if fit(size_gb, ram_gb, step) != "too_big":
            return step
        return None
    return None


def should_grow(
    *,
    used: int,
    window: int,
    reserve: int,
    clears_this_session: int,
    summaries_this_session: int,
) -> bool:
    """True when the last call filled the room and the cheap means were already used.

    The room is the window less the reply reserve. Clearing twice or summarising once
    has run in this session, and the context is full again.
    """
    room = window - reserve
    if room <= 0 or used < GROW_AT * room:
        return False
    return clears_this_session >= GROW_CLEARS or summaries_this_session >= GROW_SUMMARIES


def step_down(current: int) -> int | None:
    """The largest step below ``current``, or None at 8192 and below."""
    lower = [s for s in STEPS if s < current]
    return lower[-1] if lower else None


def spilled(size: int | None, size_vram: int | None) -> bool:
    """True when Ollama says part of the model runs on the CPU."""
    if not size or size_vram is None:
        return False
    return size_vram < size * _SPILL_SHARE
