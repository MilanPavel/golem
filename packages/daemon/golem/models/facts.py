"""Every fact the routing rules read about a model, in one record. Facts only, no policy."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Protocol

from golem.config import ModelPrice
from golem.models.discovery import ListedModel
from golem.models.keys import KeyStoreError
from golem.models.router import KeyStatus, ModelRouter
from golem.models.tiers import Tier, blended, tier_of
from golem.models.window import ContextWindow, WindowOf

log = logging.getLogger(__name__)

_WHY_NOT_READY = {
    "needs_key": "needs a key",
    "server_down": "server is down",
    "not_installed": "not installed",
    "pulling": "being downloaded",
}


class Speed(Protocol):
    """Measured tokens per second of a model. The speed book of #874 gives these."""

    @property
    def prompt_tps(self) -> float | None: ...

    @property
    def reply_tps(self) -> float | None: ...


@dataclass(frozen=True, slots=True)
class ModelFacts:
    ref: str  # provider/model
    profile: str  # the name to route to: a profile that points at the ref, else the ref
    tier: Tier
    ready: bool  # status == "ready"
    why_not_ready: str | None  # "needs a key" | "server is down" | "not installed" | None
    window: int | None  # tokens one call may hold; None when unknown
    window_exact: bool
    tools: bool | None  # None when unknown
    vision: bool
    price: ModelPrice | None
    blended: float | None
    prompt_tps: float | None
    reply_tps: float | None
    tool_score: float | None  # filled by 9.4.5; None until then


def facts_of(
    listed: ListedModel,
    *,
    window: ContextWindow | None,
    speed: Speed | None,
    tool_score: float | None = None,
    ollama: bool | None = None,
) -> ModelFacts:
    """The facts of one listed model.

    ``ollama`` says the provider's kind is ``ollama``. It defaults to the provider's name
    being ``ollama``. An ollama model is local and has the window a call would run with
    (``window``), never the listed maximum. A hosted model has the listed ctx, exact.
    """
    local = listed.provider == "ollama" if ollama is None else ollama
    if local:
        size = None if window is None else window.window
        exact = window is not None and size is not None and not window.estimated
    else:
        size = listed.ctx
        exact = size is not None
    return ModelFacts(
        ref=listed.ref,
        profile=listed.profiles[0] if listed.profiles else listed.ref,
        tier="local" if local else listed.tier,
        ready=listed.status == "ready",
        why_not_ready=_WHY_NOT_READY.get(listed.status),
        window=size,
        window_exact=exact,
        tools=listed.tools,
        vision="vision" in listed.categories,
        price=listed.price,
        blended=None if listed.price is None else blended(listed.price),
        prompt_tps=None if speed is None else speed.prompt_tps,
        reply_tps=None if speed is None else speed.reply_tps,
        tool_score=tool_score,
    )


class FactsSource(Protocol):
    async def facts(
        self, refs: Sequence[str], *, overrides: Mapping[str, float | str] | None = None
    ) -> list[ModelFacts]: ...


class FactsDiscovery(Protocol):
    """What ``ListedFacts`` reads of the model listing."""

    def cached(self) -> Sequence[ListedModel]: ...

    def price_of(self, ref: str) -> ModelPrice | None: ...

    async def list(self, *, refresh: bool = False, show_all: bool = False) -> object: ...


SpeedOf = Callable[[str], Speed | None]
"""The speed of a ref. The place to plug the speed book of #874 in."""


class ListedFacts:
    """Facts from the cached listing. Makes no network call itself.

    Before the first listing it starts one in the background and answers from the router
    alone: the provider's kind, and for a hosted model whether a key is set.
    """

    def __init__(
        self,
        discovery: FactsDiscovery,
        router: ModelRouter,
        window_of: WindowOf,
        speed_of: SpeedOf | None = None,
    ) -> None:
        self._discovery = discovery
        self._router = router
        self._window_of = window_of
        self._speed_of = speed_of
        self._listing: asyncio.Task[object] | None = None

    async def facts(
        self, refs: Sequence[str], *, overrides: Mapping[str, float | str] | None = None
    ) -> list[ModelFacts]:
        cached = {listed.ref: listed for listed in self._discovery.cached()}
        if not cached:
            self._start_listing()
        keys = None if cached else self._keys()
        found: list[ModelFacts] = []
        for ref in refs:
            listed = cached.get(ref)
            if listed is None:
                found.append(self._unlisted(ref, keys, listing=bool(cached)))
                continue
            ollama = self._is_ollama(listed.provider)
            profile = listed.profiles[0] if listed.profiles else ref
            window = self._window_of(profile, overrides) if ollama else None
            speed = None if self._speed_of is None else self._speed_of(ref)
            found.append(facts_of(listed, window=window, speed=speed, ollama=ollama))
        return found

    def _is_ollama(self, provider: str) -> bool:
        configured = self._router.provider(provider)
        if configured is None:
            return provider == "ollama"
        return configured.kind == "ollama"

    def _start_listing(self) -> None:
        if self._listing is not None and not self._listing.done():
            return
        task = asyncio.ensure_future(self._discovery.list())
        task.add_done_callback(_listed)
        self._listing = task

    def _keys(self) -> dict[str, KeyStatus] | None:
        try:
            return {status.provider: status for status in self._router.key_statuses()}
        except KeyStoreError:
            return None

    def _unlisted(
        self, ref: str, keys: Mapping[str, KeyStatus] | None, *, listing: bool
    ) -> ModelFacts:
        """A ref the listing does not have, or one asked for before the first listing."""
        provider = ref.partition("/")[0]
        price = self._discovery.price_of(ref)
        ready = False
        why: str | None = "unknown model" if listing else "not checked yet"
        if not listing and keys is not None:
            status = keys.get(provider)
            if status is not None and status.takes_key:
                ready = status.source is not None or not status.needs_key
                why = None if ready else "needs a key"
        ollama = self._is_ollama(provider)
        return ModelFacts(
            ref=ref,
            profile=ref,
            tier=tier_of(
                "ollama" if ollama else provider,
                price,
                budget_max_price=self._router.budget_max_price(),
            ),
            ready=ready,
            why_not_ready=why,
            window=None,
            window_exact=False,
            tools=None,
            vision=False,
            price=price,
            blended=None if price is None else blended(price),
            prompt_tps=None,
            reply_tps=None,
            tool_score=None,
        )


def _listed(task: asyncio.Task[object]) -> None:
    if not task.cancelled() and task.exception() is not None:
        log.warning("model listing for facts failed: %s", task.exception())
