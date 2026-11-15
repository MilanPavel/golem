"""Errors from reaching a model, shared by the router and the local server."""

from __future__ import annotations

from typing import Literal

UnreachableCode = Literal["model_unreachable", "not_installed"]


class ModelUnreachable(Exception):
    """The model's server did not answer. ``hint`` says how to fix it.

    ``code`` is ``not_installed`` when the server is local and its program is
    missing, so a client can offer to install it.
    """

    def __init__(
        self,
        message: str,
        *,
        provider: str | None,
        hint: str,
        code: UnreachableCode = "model_unreachable",
    ) -> None:
        super().__init__(message)
        self.message = message
        self.provider = provider
        self.hint = hint
        self.code: UnreachableCode = code


class ContextFull(Exception):
    """The prompt does not fit the model's window, even after clearing and summarising.

    ``need`` is the estimated tokens of the prompt and the reply reserve, ``window`` the
    window. Raised before anything is sent. A router that can step up to a larger window
    catches it; otherwise it ends the run as ``run.failed`` with the code ``context_full``.
    """

    code: Literal["context_full"] = "context_full"

    def __init__(self, need: int, window: int, model: str = "") -> None:
        name = f"{model}'s " if model else "the model's "
        self.message = (
            f"This does not fit {name}{window} window, even after clearing and summarising."
        )
        self.hint = (
            "Use a model with a larger window, raise the window in /tune, or start a new session."
        )
        super().__init__(self.message)
        self.need = need
        self.window = window
        self.model = model
