"""The context window of a model call: what the model can take in, and the ``num_ctx`` sent.

Worked out when the call is made, because the profile, the model listing, and
the price book change later. It does no I/O and never raises.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Protocol

from golem.models.router import ModelConfigError, ModelRouter


@dataclass(frozen=True, slots=True)
class ContextWindow:
    """``window`` is the tokens the model can take in, ``num_ctx`` the Ollama option sent.

    Each is None when unknown or not sent. Never 0. ``estimated`` is true when golem
    did not send the window itself and read it from Ollama.
    """

    window: int | None = None
    num_ctx: int | None = None
    estimated: bool = False


WindowOf = Callable[[str, Mapping[str, float | str] | None], ContextWindow]
"""The context window for a profile name or ``provider/model`` ref, and the session's overrides."""


class ListedContext(Protocol):
    """What the model listing knows about a model's window."""

    def known_ctx(self, ref: str) -> int | None: ...

    def modelfile_num_ctx(self, ref: str) -> int | None: ...

    def loaded_ctx(self, ref: str) -> int | None: ...


def resolve_window(
    router: ModelRouter,
    profile: str,
    listed: ListedContext | None,
    *,
    overrides: Mapping[str, float | str] | None = None,
) -> ContextWindow:
    """The window of ``profile``.

    An Ollama model has what golem sends (``overrides``, the saved option, the profile's
    ``ctx``), then what Ollama loaded, then the Modelfile's ``num_ctx``, which is
    estimated. The model's maximum is never used for it. Another provider has the
    profile's ``ctx``, then the listed model's, then the price book's.
    """
    try:
        resolved = router.resolve(profile)
    except ModelConfigError:
        return ContextWindow()
    if resolved.provider.kind != "ollama":
        if resolved.ctx is not None:
            return ContextWindow(resolved.ctx, None)
        return ContextWindow(None if listed is None else listed.known_ctx(resolved.ref), None)
    # The same order as chat_model: the profile's ctx, overwritten by the saved option
    # and then the session override.
    sent = router.ollama_options(resolved.model_id, overrides).get("num_ctx")
    if isinstance(sent, int | float) and sent > 0:
        return ContextWindow(int(sent), int(sent))
    if resolved.ctx is not None:
        return ContextWindow(resolved.ctx, resolved.ctx)
    # golem sends no num_ctx, so Ollama runs with its own default context, not the
    # model's maximum from the listing.
    if listed is None:
        return ContextWindow()
    loaded = listed.loaded_ctx(resolved.ref)
    if loaded:
        return ContextWindow(loaded, None)
    modelfile = listed.modelfile_num_ctx(resolved.ref)
    if modelfile:
        return ContextWindow(modelfile, None, estimated=True)
    return ContextWindow()
