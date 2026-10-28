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
