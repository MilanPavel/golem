"""The context window of a model call: what the model can take in, and the ``num_ctx`` sent.

Worked out when the call is made, because the profile, the model listing, and
the price book change later. It does no I/O and never raises.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

from golem.models.router import ModelConfigError, ModelRouter


@dataclass(frozen=True, slots=True)
class ContextWindow:
    """``window`` is the tokens the model can take in, ``num_ctx`` the Ollama option sent.

    Each is None when unknown or not sent. Never 0.
    """

    window: int | None = None
    num_ctx: int | None = None


WindowOf = Callable[[str], ContextWindow]
"""The context window for a profile name or ``provider/model`` ref."""


class ListedContext(Protocol):
    """What the model listing knows about a model's window."""

    def known_ctx(self, ref: str) -> int | None: ...


def resolve_window(
    router: ModelRouter, profile: str, listed: ListedContext | None
) -> ContextWindow:
    """The window of ``profile``: its ``ctx``, then the listed model's, then the price book's."""
    try:
        resolved = router.resolve(profile)
    except ModelConfigError:
        return ContextWindow()
    is_ollama = resolved.provider.kind == "ollama"
    # The same rule as the router: only an Ollama model gets num_ctx, and only from the profile.
    num_ctx = resolved.ctx if is_ollama else None
    if resolved.ctx is not None:
        return ContextWindow(resolved.ctx, num_ctx)
    if is_ollama:
        # golem sends no num_ctx, so Ollama runs with its own default context, not the
        # model's maximum from the listing. A window golem can't know is None.
        return ContextWindow()
    return ContextWindow(None if listed is None else listed.known_ctx(resolved.ref), None)
