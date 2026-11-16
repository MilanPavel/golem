"""Errors from reaching a model, shared by the router and the local server."""

from __future__ import annotations

from typing import Literal

UnreachableCode = Literal[
    "model_unreachable", "not_installed", "budget_spent", "rate_limited", "no_credit", "auth_failed"
]

BUDGET_HINT = "raise it in Settings \u203a Routing, or switch the model"


class ModelUnreachable(Exception):
    """The model's server did not answer. ``hint`` says how to fix it.

    ``code`` is ``not_installed`` when the server is local and its program is
    missing, so a client can offer to install it. It is ``budget_spent`` for :class:`BudgetSpent`.
    ``rate_limited``, ``no_credit`` and ``auth_failed`` are a hosted provider that answered
    with an error (see :func:`provider_error`).
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


class BudgetSpent(ModelUnreachable):
    """A paid call was not made because a cap in ``[budget]`` is spent.

    It ends a run with ``run.failed`` and the code ``budget_spent``. ``hint`` says how to go on.
    """

    def __init__(self, message: str, *, hint: str) -> None:
        super().__init__(message, provider=None, hint=hint, code="budget_spent")


Failure = Literal["unreachable", "rate_limited", "server_error", "auth", "no_credit", "other"]
"""How a call to a provider failed, as :func:`failure_of` reads it."""

RETRY_WAIT = 2.0
"""Seconds before the one retry of a rate-limited or failing call."""

RETRY_MAX = 10.0
"""The most a ``retry-after`` header may ask for."""

_CONNECT_NAMES = frozenset(
    {
        "ConnectError",
        "ConnectTimeout",
        "ReadTimeout",
        "WriteTimeout",
        "PoolTimeout",
        "TimeoutException",
        "APIConnectionError",
        "APITimeoutError",
        "ConnectionError",
        "ConnectionRefusedError",
        "TimeoutError",
    }
)
_CREDIT_WORDS = ("quota", "credit", "billing")


def _chain(exc: BaseException) -> list[BaseException]:
    seen: list[BaseException] = []
    current: BaseException | None = exc
    while current is not None and all(current is not other for other in seen):
        seen.append(current)
        nxt = current.__cause__
        if nxt is None and not current.__suppress_context__:
            nxt = current.__context__
        current = nxt
    return seen


def _status(exc: BaseException) -> int | None:
    found = getattr(exc, "status_code", None)
    if not isinstance(found, int):
        found = getattr(getattr(exc, "response", None), "status_code", None)
    return found if isinstance(found, int) and not isinstance(found, bool) else None


def _body(exc: BaseException) -> str:
    return f"{exc} {getattr(exc, 'body', '')}".lower()


def failure_of(exc: BaseException) -> Failure:
    """How a call failed. By ``status_code`` when ``exc`` has one, else by type.

    No provider SDK is imported: the classes are read by attribute and by name.
    """
    status = _status(exc)
    if status is not None:
        if status == 402:
            return "no_credit"
        if 400 <= status < 500 and any(word in _body(exc) for word in _CREDIT_WORDS):
            return "no_credit"
        if status == 429:
            return "rate_limited"
        if 500 <= status <= 599:
            return "server_error"
        if status in (401, 403):
            return "auth"
        return "other"
    for link in _chain(exc):
        if any(kind.__name__ in _CONNECT_NAMES for kind in type(link).__mro__):
            return "unreachable"
    return "other"


def retry_delay(exc: BaseException) -> float:
    """Seconds to wait before the retry: ``retry-after`` up to :data:`RETRY_MAX`, else 2."""
    headers = getattr(getattr(exc, "response", None), "headers", None)
    try:
        asked = None if headers is None else headers.get("retry-after")
        wait = float(asked) if asked is not None else RETRY_WAIT
    except (TypeError, ValueError, AttributeError):
        return RETRY_WAIT
    return min(max(wait, 0.0), RETRY_MAX)


def provider_error(provider: str, failure: Failure) -> ModelUnreachable:
    """The run's error for a provider that failed in the way ``failure`` says."""
    if failure == "rate_limited":
        return ModelUnreachable(
            f"{provider} is rate-limited",
            provider=provider,
            hint="wait a minute and try again",
            code="rate_limited",
        )
    if failure == "no_credit":
        return ModelUnreachable(
            f"{provider} has no credit left",
            provider=provider,
            hint=f"add credit at {provider}",
            code="no_credit",
        )
    if failure == "auth":
        return ModelUnreachable(
            f"{provider} did not accept the key",
            provider=provider,
            hint=f"/login {provider}",
            code="auth_failed",
        )
    if failure == "server_error":
        return ModelUnreachable(
            f"{provider} had a server error",
            provider=provider,
            hint="wait a minute and try again",
        )
    return ModelUnreachable(
        f"{provider} is not answering", provider=provider, hint="check your network connection"
    )


def failure_note(provider: str, failure: Failure) -> str:
    """What the ``model.routed`` note says when a run leaves ``provider``."""
    return {
        "rate_limited": f"{provider} is rate-limited",
        "server_error": f"{provider} had a server error",
        "auth": f"{provider} did not accept the key",
        "no_credit": f"{provider} has no credit left",
    }.get(failure, f"{provider} is not answering")
