"""Which models you can use, what they cost, and which ones fit on this machine.

Sources, merged by ref:

- Installed local models, from Ollama's ``/api/tags`` (``/api/show`` fills in
  context size and capabilities when an older Ollama leaves them out).
- Local models to download, from the bundled ``local-catalog.toml``.
- Hosted models, from each provider's model list once it has a key:
  Anthropic and OpenAI ``/v1/models``, and ``<base_url>/models`` for an
  OpenAI-compatible provider such as OpenRouter, Groq, or Together.
- Profiles and ``default_model``, so a configured model always shows up.

Prices and context sizes come from the profile, then from the provider's own
list (Ollama, OpenRouter), then from LiteLLM. Hosted lists are cached for a
day under ``~/.golem/cache/``. A listing waits at most ``budget`` seconds for
the network. A slower fetch keeps running, and its result is used next time.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import re
import time
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any, Literal, cast

import httpx

from golem.config import ModelPrice, ModelSettings
from golem.models import hardware, prices
from golem.models.catalog import CatalogEntry, load_local_catalog
from golem.models.errors import ModelUnreachable
from golem.models.keys import KeyStoreError
from golem.models.ollama import LocalServers
from golem.models.router import OLLAMA_BASE_URL, ModelConfigError, ModelRouter, Provider

log = logging.getLogger(__name__)

Source = Literal["installed", "catalog", "remote", "profile"]
Status = Literal["ready", "needs_key", "not_installed", "server_down", "pulling"]
ProviderStatus = Literal["ready", "needs_key", "server_down", "unlisted"]

REMOTE_MAX_AGE_SECONDS = 24 * 3600
_OLLAMA_TIMEOUT = 1.5
_REMOTE_TIMEOUT = 10.0
_ANTHROPIC_URL = "https://api.anthropic.com/v1"
_OPENAI_URL = "https://api.openai.com/v1"
_FREE = ModelPrice(input=0.0, output=0.0)
_OPENAI_CHAT = re.compile(r"^(gpt-|o\d|chatgpt-)")
_NOT_CHAT = (
    "audio",
    "realtime",
    "transcribe",
    "tts",
    "image",
    "search",
    "embedding",
    "moderation",
    "instruct",
    "whisper",
    "dall-e",
    "rerank",
)
_SOURCE_ORDER: dict[Source, int] = {"installed": 0, "catalog": 1, "remote": 2, "profile": 3}


@dataclass(frozen=True, slots=True)
class ListedModel:
    ref: str
    label: str
    provider: str
    source: Source
    status: Status
    progress: float | None = None
    profiles: tuple[str, ...] = ()
    ctx: int | None = None
    tools: bool | None = None
    price: ModelPrice | None = None
    size_gb: float | None = None
    fit: hardware.Fit | None = None
    stale: bool = False


@dataclass(frozen=True, slots=True)
class ListedProvider:
    provider: str
    status: ProviderStatus
    stale: bool = False


@dataclass(frozen=True, slots=True)
class ModelListing:
    default: str
    ram_gb: float | None
    models: list[ListedModel]
    providers: list[ListedProvider]


@dataclass(frozen=True, slots=True)
class _Found:
    """One model as a provider reported it."""

    model_id: str
    label: str | None = None
    ctx: int | None = None
    tools: bool | None = None
    price: ModelPrice | None = None
    size_gb: float | None = None


@dataclass(slots=True)
class _Remote:
    fetched_at: float
    models: list[_Found]


@dataclass(slots=True)
class _ProviderResult:
    found: list[_Found] = field(default_factory=lambda: [])
    up: bool = True
    stale: bool = False


class ModelDiscovery:
    """Builds :class:`ModelListing` for ``model.list``.

    ``transport`` replaces the network in tests. ``ram_gb`` defaults to this
    machine's memory.
    """

    def __init__(
        self,
        router: ModelRouter,
        cache_dir: Path | None,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        ram_gb: float | None = None,
        detect_ram: bool = True,
        budget: float = 2.0,
        clock: Callable[[], float] = time.time,
        catalog: list[CatalogEntry] | None = None,
        price_book: prices.PriceBook | None = None,
        fetch_prices: bool = True,
        pulling: Callable[[], dict[str, float | None]] | None = None,
    ) -> None:
        self._fetch_prices_enabled = fetch_prices
        self.pulling: Callable[[], dict[str, float | None]] = pulling or dict
        # Starts a local Ollama that does not answer before listing its models.
        self.local: LocalServers | None = None
        self._router = router
        self._cache_dir = cache_dir
        self._transport = transport
        self._client: httpx.AsyncClient | None = None
        self._ram_gb = ram_gb if ram_gb is not None or not detect_ram else hardware.total_ram_gb()
        self._budget = budget
        self._clock = clock
        self._catalog = load_local_catalog() if catalog is None else catalog
        self._prices = prices.PriceBook.load(cache_dir) if price_book is None else price_book
        self._remote: dict[str, _Remote] = {}
        self._fetching: dict[str, asyncio.Task[_Remote]] = {}
        self._price_task: asyncio.Task[None] | None = None
        self._shown: dict[str, tuple[int | None, bool | None]] = {}

    @property
    def ram_gb(self) -> float | None:
        return self._ram_gb

    async def aclose(self) -> None:
        tasks: list[asyncio.Task[Any]] = [*self._fetching.values()]
        if self._price_task is not None:
            tasks.append(self._price_task)
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def list(self, *, refresh: bool = False) -> ModelListing:
        """Every model golem knows of right now. Never waits on the network past ``budget``."""
        router = self._router
        providers = router.providers()
        profiles = router.profiles()
        default = router.profile_name
        keys: dict[str, str | None]
        try:
            keys = await asyncio.to_thread(_keys, router, providers)
        except KeyStoreError as exc:
            log.warning("model list without stored keys: %s", exc)
            keys = dict.fromkeys(providers)
        self._refresh_prices(refresh)
        referenced = _referenced_providers(router, profiles, default)
        probes: dict[str, asyncio.Task[_ProviderResult]] = {}
        states: dict[str, ListedProvider] = {}
        for name, provider in sorted(providers.items()):
            if provider.kind == "ollama":
                if name == "ollama" or name in referenced:
                    probes[name] = asyncio.create_task(self._ollama(name, provider))
                else:
                    states[name] = ListedProvider(name, "unlisted")
            elif keys.get(name) is not None or (
                provider.api_key_env is None and name in referenced
            ):
                probes[name] = asyncio.create_task(
                    self._remote_models(name, provider, keys.get(name), refresh)
                )
            elif provider.api_key_env is not None:
                states[name] = ListedProvider(name, "needs_key")
            else:
                states[name] = ListedProvider(name, "unlisted")
        results: dict[str, _ProviderResult] = {}
        for name, task in probes.items():
            result = await task
            results[name] = result
            states[name] = ListedProvider(
                name, "ready" if result.up else "server_down", stale=result.stale
            )
        models = _with_pulls(
            self._merge(providers, profiles, default, keys, results, states), self.pulling()
        )
        return ModelListing(
            default=default,
            ram_gb=None if self._ram_gb is None else round(self._ram_gb, 1),
            models=models,
            providers=[states[name] for name in sorted(states)],
        )

    def _merge(
        self,
        providers: dict[str, Provider],
        profiles: dict[str, ModelSettings],
        default: str,
        keys: dict[str, str | None],
        results: dict[str, _ProviderResult],
        states: dict[str, ListedProvider],
    ) -> list[ListedModel]:
        by_ref: dict[str, ListedModel] = {}
        labels = {entry.ref: entry.label for entry in self._catalog}
        for name, result in results.items():
            kind = providers[name].kind
            for found in result.found:
                ref = f"{name}/{found.model_id}"
                by_ref[ref] = self._listed(
                    ref,
                    name,
                    found,
                    source="installed" if kind == "ollama" else "remote",
                    label=labels.get(ref) or found.label or found.model_id,
                    stale=result.stale,
                )
        for entry in self._catalog:
            if entry.ref in by_ref:
                continue
            name, _, model_id = entry.ref.partition("/")
            if name not in providers:
                continue
            up = name in results and results[name].up
            by_ref[entry.ref] = self._listed(
                entry.ref,
                name,
                _Found(model_id=model_id, size_gb=entry.size_gb, tools=True),
                source="catalog",
                label=entry.label,
                status="not_installed" if up else "server_down",
            )
        aliases: dict[str, list[str]] = {}
        ctx_overrides: dict[str, int] = {}
        price_overrides: dict[str, ModelPrice] = {}
        for alias, profile in sorted(profiles.items()):
            aliases.setdefault(profile.model, []).append(alias)
            if profile.ctx is not None:
                ctx_overrides.setdefault(profile.model, profile.ctx)
            if profile.price is not None:
                price_overrides.setdefault(profile.model, profile.price)
        named = set(aliases)
        if default not in profiles and "/" in default:
            named.add(default)
        for ref in sorted(named):
            name, _, model_id = ref.partition("/")
            if ref not in by_ref and name in providers:
                status = _unlisted_status(providers[name], keys.get(name), states.get(name))
                by_ref[ref] = self._listed(
                    ref, name, _Found(model_id=model_id), source="profile", status=status
                )
            if ref in by_ref:
                listed = replace(by_ref[ref], profiles=tuple(aliases.get(ref, ())))
                ctx = ctx_overrides.get(ref)
                if ctx is not None:
                    listed = replace(listed, ctx=ctx, fit=self._fit(listed.size_gb, ctx))
                price = price_overrides.get(ref)
                if price is not None:
                    listed = replace(listed, price=price)
                by_ref[ref] = listed
        return sorted(by_ref.values(), key=_order)

    def _listed(
        self,
        ref: str,
        provider: str,
        found: _Found,
        *,
        source: Source,
        label: str | None = None,
        status: Status = "ready",
        stale: bool = False,
    ) -> ListedModel:
        local = source in ("installed", "catalog") or ref.startswith("ollama/")
        info = None if local else self._prices.lookup(provider, found.model_id)
        price = _FREE if local else found.price or (info.price if info else None)
        ctx = found.ctx or (info.ctx if info else None)
        tools = found.tools if found.tools is not None else (info.tools if info else None)
        return ListedModel(
            ref=ref,
            label=label or found.label or found.model_id,
            provider=provider,
            source=source,
            status=status,
            ctx=ctx,
            tools=tools,
            price=price,
            size_gb=found.size_gb,
            # A model's maximum context is not what Ollama allocates. A profile's ctx is.
            fit=self._fit(found.size_gb, None),
            stale=stale,
        )

    def _fit(self, size_gb: float | None, ctx: int | None) -> hardware.Fit | None:
        if size_gb is None or self._ram_gb is None:
            return None
        return hardware.fit(size_gb, self._ram_gb, ctx)

    def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(transport=self._transport, follow_redirects=True)
        return self._client

    async def _ollama(self, name: str, provider: Provider) -> _ProviderResult:
        base = (provider.base_url or OLLAMA_BASE_URL).rstrip("/").removesuffix("/v1")
        server = None if self.local is None else self.local.get(name, base)
        if server is not None:
            try:
                await server.ensure_running()
            except ModelUnreachable as exc:
                log.info("ollama at %s did not start: %s", base, exc)
                return _ProviderResult(up=False)
        client = self._http()
        try:
            response = await client.get(f"{base}/api/tags", timeout=_OLLAMA_TIMEOUT)
            response.raise_for_status()
            items = _list(_dict(response.json()).get("models"))
        except (httpx.HTTPError, ValueError) as exc:
            log.debug("ollama at %s is not answering: %s", base, exc)
            return _ProviderResult(up=False)
        found = await asyncio.gather(*(self._ollama_model(client, base, item) for item in items))
        return _ProviderResult(found=[model for model in found if model is not None])

    async def _ollama_model(
        self, client: httpx.AsyncClient, base: str, item: dict[str, Any]
    ) -> _Found | None:
        name = item.get("name") or item.get("model")
        if not isinstance(name, str) or name == "":
            return None
        details = _dict(item.get("details"))
        ctx = _positive_int(details.get("context_length"))
        capabilities = item.get("capabilities")
        tools = "tools" in capabilities if isinstance(capabilities, list) else None
        if ctx is None or tools is None:
            ctx, tools = await self._ollama_show(client, base, name, item.get("digest"), ctx, tools)
        size = item.get("size")
        return _Found(
            model_id=name,
            ctx=ctx,
            tools=tools,
            size_gb=round(size / 1e9, 1) if isinstance(size, int) else None,
        )

    async def _ollama_show(
        self,
        client: httpx.AsyncClient,
        base: str,
        name: str,
        digest: object,
        ctx: int | None,
        tools: bool | None,
    ) -> tuple[int | None, bool | None]:
        key = digest if isinstance(digest, str) else name
        if key in self._shown:
            return self._shown[key]
        try:
            response = await client.post(
                f"{base}/api/show", json={"model": name}, timeout=_OLLAMA_TIMEOUT
            )
            response.raise_for_status()
            shown = _dict(response.json())
        except (httpx.HTTPError, ValueError):
            return ctx, tools
        info = _dict(shown.get("model_info"))
        for field_name, value in info.items():
            if ctx is None and field_name.endswith(".context_length"):
                ctx = _positive_int(value)
        capabilities = shown.get("capabilities")
        if tools is None and isinstance(capabilities, list):
            tools = "tools" in capabilities
        self._shown[key] = (ctx, tools)
        return ctx, tools

    async def _remote_models(
        self, name: str, provider: Provider, key: str | None, refresh: bool
    ) -> _ProviderResult:
        cached = self._remote.get(name) or self._read_cache(name)
        now = self._clock()
        if cached is not None and not refresh and now - cached.fetched_at < REMOTE_MAX_AGE_SECONDS:
            return _ProviderResult(found=cached.models)
        task = self._fetching.get(name)
        if task is None:
            task = asyncio.create_task(self._fetch_remote(name, provider, key))
            self._fetching[name] = task
            task.add_done_callback(lambda done: self._fetched(name, done))
        try:
            fresh = await asyncio.wait_for(asyncio.shield(task), timeout=self._budget)
        except TimeoutError:
            if cached is None:
                return _ProviderResult(up=True, stale=True)
            return _ProviderResult(found=cached.models, stale=True)
        except (httpx.HTTPError, ValueError) as exc:
            log.info("model list from %s failed: %s", name, exc)
            if cached is None:
                return _ProviderResult(up=False)
            return _ProviderResult(found=cached.models, stale=True)
        return _ProviderResult(found=fresh.models)

    def _fetched(self, name: str, task: asyncio.Task[_Remote]) -> None:
        if self._fetching.get(name) is task:
            del self._fetching[name]
        if task.cancelled() or task.exception() is not None:
            return
        self._remote[name] = task.result()

    async def _fetch_remote(self, name: str, provider: Provider, key: str | None) -> _Remote:
        client = self._http()
        if provider.kind == "anthropic":
            found = await _anthropic_models(client, provider, key)
        elif provider.kind == "openai":
            found = await _openai_models(client, provider, key, self._prices)
        else:
            found = await _compatible_models(client, provider, key)
        remote = _Remote(fetched_at=self._clock(), models=found)
        self._write_cache(name, remote)
        log.info("listed models provider=%s count=%d", name, len(found))
        return remote

    def _refresh_prices(self, refresh: bool) -> None:
        if self._cache_dir is None or not self._fetch_prices_enabled:
            return
        if not refresh and self._prices.is_fresh(self._clock()):
            return
        if self._price_task is not None and not self._price_task.done():
            return
        self._price_task = asyncio.create_task(self._fetch_prices())

    async def _fetch_prices(self) -> None:
        assert self._cache_dir is not None
        try:
            self._prices = await prices.fetch(self._http(), self._cache_dir, self._clock())
        except (httpx.HTTPError, ValueError, OSError) as exc:
            log.info("LiteLLM prices not refreshed: %s", exc)

    def _cache_file(self, name: str) -> Path | None:
        if self._cache_dir is None:
            return None
        safe = re.sub(r"[^A-Za-z0-9_.-]", "_", name)
        return self._cache_dir / f"models-{safe}.json"

    def _read_cache(self, name: str) -> _Remote | None:
        path = self._cache_file(name)
        if path is None:
            return None
        try:
            raw = json.loads(path.read_text("utf-8"))
            models = [_found_from_json(item) for item in raw["models"]]
            remote = _Remote(fetched_at=float(raw["fetched_at"]), models=models)
        except (OSError, ValueError, KeyError, TypeError):
            return None
        self._remote[name] = remote
        return remote

    def _write_cache(self, name: str, remote: _Remote) -> None:
        path = self._cache_file(name)
        if path is None:
            return
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            payload = {
                "fetched_at": remote.fetched_at,
                "models": [_found_to_json(found) for found in remote.models],
            }
            temp = path.with_suffix(".tmp")
            temp.write_text(json.dumps(payload), "utf-8")
            temp.replace(path)
        except OSError as exc:
            log.warning("could not cache the %s model list: %s", name, exc)


async def _anthropic_models(
    client: httpx.AsyncClient, provider: Provider, key: str | None
) -> list[_Found]:
    base = (provider.base_url or _ANTHROPIC_URL).rstrip("/")
    response = await client.get(
        f"{base}/models",
        params={"limit": 1000},
        headers={"x-api-key": key or "", "anthropic-version": "2023-06-01"},
        timeout=_REMOTE_TIMEOUT,
    )
    response.raise_for_status()
    found: list[_Found] = []
    for item in _list(_dict(response.json()).get("data")):
        model_id = item.get("id")
        if isinstance(model_id, str) and model_id:
            label = item.get("display_name")
            found.append(_Found(model_id=model_id, label=label if isinstance(label, str) else None))
    return found


async def _openai_models(
    client: httpx.AsyncClient, provider: Provider, key: str | None, book: prices.PriceBook
) -> list[_Found]:
    base = (provider.base_url or _OPENAI_URL).rstrip("/")
    response = await client.get(
        f"{base}/models", headers={"authorization": f"Bearer {key}"}, timeout=_REMOTE_TIMEOUT
    )
    response.raise_for_status()
    found: list[_Found] = []
    for item in _list(_dict(response.json()).get("data")):
        model_id = item.get("id")
        if isinstance(model_id, str) and openai_chat_model(model_id, book):
            found.append(_Found(model_id=model_id))
    return found


def openai_chat_model(model_id: str, book: prices.PriceBook) -> bool:
    """A chat model by LiteLLM's word, or by its name when LiteLLM does not know it."""
    info = book.lookup("openai", model_id)
    if info is not None and info.mode is not None:
        return info.mode == "chat"
    return _OPENAI_CHAT.match(model_id) is not None and not any(
        word in model_id for word in _NOT_CHAT
    )


async def _compatible_models(
    client: httpx.AsyncClient, provider: Provider, key: str | None
) -> list[_Found]:
    if provider.base_url is None:
        raise ValueError("an OpenAI-compatible provider needs base_url")
    headers = {"authorization": f"Bearer {key}"} if key else {}
    response = await client.get(
        f"{provider.base_url.rstrip('/')}/models", headers=headers, timeout=_REMOTE_TIMEOUT
    )
    response.raise_for_status()
    body: object = response.json()
    items = _list(body) or _list(_dict(body).get("data"))
    found: list[_Found] = []
    for item in items:
        model_id = item.get("id")
        kind = item.get("type")
        if not isinstance(model_id, str) or model_id == "":
            continue
        if isinstance(kind, str) and kind not in ("chat", "language", "model"):
            continue
        label = item.get("name") or item.get("display_name")
        params = item.get("supported_parameters")
        found.append(
            _Found(
                model_id=model_id,
                label=label if isinstance(label, str) else None,
                ctx=_positive_int(item.get("context_length"))
                or _positive_int(item.get("context_window")),
                tools="tools" in params if isinstance(params, list) else None,
                price=_per_token_price(item.get("pricing")),
            )
        )
    return found


def _per_token_price(raw: object) -> ModelPrice | None:
    """OpenRouter's ``pricing``: USD per token, as strings."""
    pricing = _dict(raw)
    given = _number(pricing.get("prompt"))
    taken = _number(pricing.get("completion"))
    if given is None or taken is None or given < 0 or taken < 0:
        return None
    cached = _number(pricing.get("input_cache_read"))
    return ModelPrice(
        input=given * 1_000_000,
        output=taken * 1_000_000,
        cached_input=cached * 1_000_000 if cached is not None and cached >= 0 else None,
    )


def _keys(router: ModelRouter, providers: dict[str, Provider]) -> dict[str, str | None]:
    return {name: router.api_key(name) for name in providers}


def _referenced_providers(
    router: ModelRouter, profiles: dict[str, ModelSettings], default: str
) -> set[str]:
    refs: list[str] = [profile.model for profile in profiles.values()]
    if "/" in default:
        refs.append(default)
    names = {ref.partition("/")[0] for ref in refs}
    with contextlib.suppress(ModelConfigError):
        names.add(router.resolve(default).provider_name)
    return names


def _with_pulls(models: list[ListedModel], pulling: dict[str, float | None]) -> list[ListedModel]:
    """Mark downloads in progress. A pull of a model nobody listed gets its own entry."""
    if not pulling:
        return models
    shown = {model.ref for model in models}
    marked = [
        replace(model, status="pulling", progress=pulling[model.ref])
        if model.ref in pulling
        else model
        for model in models
    ]
    for ref, progress in sorted(pulling.items()):
        if ref not in shown:
            provider, _, model_id = ref.partition("/")
            marked.append(
                ListedModel(
                    ref=ref,
                    label=model_id,
                    provider=provider,
                    source="catalog",
                    status="pulling",
                    progress=progress,
                    price=_FREE,
                )
            )
    return sorted(marked, key=_order)


def _unlisted_status(provider: Provider, key: str | None, state: ListedProvider | None) -> Status:
    if provider.kind == "ollama":
        return "not_installed" if state is not None and state.status == "ready" else "server_down"
    if provider.api_key_env is not None and key is None:
        return "needs_key"
    if state is not None and state.status == "server_down":
        return "server_down"
    return "ready"


def _order(model: ListedModel) -> tuple[int, str, int, float, str]:
    return (
        0 if model.provider == "ollama" else 1,
        model.provider,
        _SOURCE_ORDER[model.source],
        model.size_gb if model.size_gb is not None else 0.0,
        model.ref,
    )


def _found_to_json(found: _Found) -> dict[str, object]:
    return {
        "model_id": found.model_id,
        "label": found.label,
        "ctx": found.ctx,
        "tools": found.tools,
        "price": None if found.price is None else found.price.model_dump(),
    }


def _found_from_json(raw: object) -> _Found:
    item = _dict(raw)
    price = item.get("price")
    return _Found(
        model_id=str(item["model_id"]),
        label=item.get("label") if isinstance(item.get("label"), str) else None,
        ctx=_positive_int(item.get("ctx")),
        tools=item.get("tools") if isinstance(item.get("tools"), bool) else None,
        price=ModelPrice.model_validate(price) if isinstance(price, dict) else None,
    )


def _dict(value: object) -> dict[str, Any]:
    return cast(dict[str, Any], value) if isinstance(value, dict) else {}


def _list(value: object) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    items: Iterable[object] = cast(list[object], value)
    return [cast(dict[str, Any], item) for item in items if isinstance(item, dict)]


def _positive_int(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) and value > 0 else None


def _number(value: object) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int | float):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None
