"""How many calls a local model runs at once, and the window each of them gets.

``[ollama] parallel`` is a number or ``"auto"``. The count is never so high that the planned
window drops below 32K when one slot would give 32K or more. A measurement of the total speed
at each count, when there is one, picks among the counts that keep that window. This is a pure
rule: it reads no file, opens no connection, and asks the plan only for a model it is called for.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal

from golem.models.hardware import fit, kv_gb

AUTO_MAX = 4
"""The most slots ``"auto"`` asks for."""

Reason = Literal["one", "fit", "measured"]


@dataclass(frozen=True, slots=True)
class AtOnce:
    """The slots of one model, the window each slot gets, and the memory each slot holds.

    ``window`` and ``memory_gb`` are None when golem plans no window. ``reason`` is ``one``
    (no window is planned, or the setting allows one slot), ``fit`` (the most the window
    rule allows) or ``measured`` (the best total speed among the counts the window rule allows).
    """

    slots: int
    window: int | None
    memory_gb: float | None
    reason: Reason


def resolve(
    setting: int | Literal["auto"],
    *,
    window: int | None,
    size_gb: float | None,
    ram_gb: float | None,
    max_slots: int,
    measured: Mapping[int, float] | None = None,
) -> AtOnce:
    """The count for a model whose planned window is ``window`` (planned with one slot).

    A number is used as it is, up to ``max_slots``. ``"auto"`` is the largest count up to
    ``AUTO_MAX`` and ``max_slots`` for which ``fit(size, ram, window, slots=k)`` says
    ``fits``, and 1 when none does. The window never shrinks with the count. ``measured`` maps
    a count to the total tokens a second seen at that count.
    """
    memory = None if window is None else kv_gb(window)
    if setting != "auto":
        return AtOnce(
            max(min(setting, max_slots), 1), window, memory, "one" if setting == 1 else "fit"
        )
    if window is None or size_gb is None or ram_gb is None:
        return AtOnce(1, window, memory, "one")
    allowed = [
        k
        for k in range(1, max(min(AUTO_MAX, max_slots), 1) + 1)
        if fit(size_gb, ram_gb, window, k) == "fits"
    ] or [1]
    speeds = {k: v for k, v in (measured or {}).items() if k in allowed}
    if speeds:
        best = min(speeds, key=lambda k: (-speeds[k], k))
        return AtOnce(best, window, memory, "measured")
    return AtOnce(allowed[-1], window, memory, "one" if allowed == [1] else "fit")
