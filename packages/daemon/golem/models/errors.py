"""Errors from reaching a model, shared by the router and the local server."""

from __future__ import annotations


class ModelUnreachable(Exception):
    """The model's server did not answer. ``hint`` says how to fix it."""

    def __init__(self, message: str, *, provider: str | None, hint: str) -> None:
        super().__init__(message)
        self.message = message
        self.provider = provider
        self.hint = hint
