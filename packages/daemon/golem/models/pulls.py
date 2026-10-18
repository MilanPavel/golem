"""Downloading and removing local models through Ollama.

A pull runs as a daemon task, so it keeps going after the TUI that asked for
it closes. Its progress goes to every connection as ``model.pull.progress``
(a few per second at most) and its end as ``model.pull.done``. Neither is
stored: a download is not a fact about any session. ``model.list`` shows a
running pull as ``pulling`` with its progress, so a client that attaches
later still sees it.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, cast
from urllib.parse import urlparse

import httpx
from pydantic import BaseModel

from golem.models import hardware, registry
from golem.models.router import OLLAMA_BASE_URL, ModelRouter, Provider
from golem_protocol.commands import ModelPullDone, ModelPullProgress
from golem_protocol.rpc import ModelPullDoneNotification, ModelPullProgressNotification

log = logging.getLogger(__name__)

Broadcast = Callable[[BaseModel], None]

_SEND_EVERY_SECONDS = 0.25
_SPACE_MARGIN = 1.1
_OLLAMA_TIMEOUT = 5.0
_OLLAMA_BINARIES = (
    "/opt/homebrew/bin/ollama",
    "/usr/local/bin/ollama",
    "/Applications/Ollama.app/Contents/Resources/ollama",
)


class PullError(Exception):
    """The download or removal cannot start. The message says what to do."""


@dataclass(frozen=True, slots=True)
class Probe:
    ref: str
    installed: bool
    exists: bool | None
    size_gb: float | None
    fit: hardware.Fit | None
    disk_free_gb: float | None


@dataclass(slots=True)
class _Pull:
    ref: str
    task: asyncio.Task[None] | None = None
    status: str = "starting"
    layers: dict[str, tuple[int, int]] = field(default_factory=lambda: {})
    sent_at: float = 0.0

    @property
    def completed(self) -> int | None:
        return sum(done for done, _ in self.layers.values()) if self.layers else None

    @property
    def total(self) -> int | None:
        return sum(size for _, size in self.layers.values()) if self.layers else None

    @property
    def progress(self) -> float | None:
        total = self.total
        completed = self.completed
        if not total or completed is None:
            return None
        return min(1.0, completed / total)


@dataclass(frozen=True, slots=True)
class _Target:
    provider_name: str
    base_url: str
    model_id: str

    @property
    def ref(self) -> str:
        return f"{self.provider_name}/{self.model_id}"


class PullManager:
    """Starts, follows, and stops downloads. ``transport`` replaces the network in tests."""

    def __init__(
        self,
        router: ModelRouter,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        broadcast: Broadcast | None = None,
        ram_gb: float | None = None,
        models_dir: Path | None = None,
        clock: Callable[[], float] = time.monotonic,
        ollama_installed: Callable[[], bool] | None = None,
    ) -> None:
        self._router = router
        self._transport = transport
        self.broadcast: Broadcast = broadcast or (lambda _model: None)
        self._ram_gb = ram_gb
        self._models_dir = models_dir if models_dir is not None else _ollama_models_dir()
        self._clock = clock
        self._ollama_installed = ollama_installed or _ollama_installed
        self._client: httpx.AsyncClient | None = None
        self._pulls: dict[str, _Pull] = {}

    def pulling(self) -> dict[str, float | None]:
        """Refs being downloaded, with their progress when known."""
        return {ref: pull.progress for ref, pull in self._pulls.items()}

    async def aclose(self) -> None:
        tasks = [pull.task for pull in self._pulls.values() if pull.task is not None]
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def probe(self, name: str) -> Probe:
        """Whether ``name`` is installed, exists in the registry, and how big it is."""
        target = self._target(name)
        installed = await self._installed(target)
        exists: bool | None = None
        size: float | None = None
        parsed = registry.parse_name(target.model_id)
        if parsed is not None:
            exists, size = await registry.manifest_size_gb(self._http(), parsed)
        fit = hardware.fit(size, self._ram_gb) if size is not None and self._ram_gb else None
        return Probe(
            ref=target.ref,
            installed=installed is True,
            exists=exists,
            size_gb=size,
            fit=fit,
            disk_free_gb=self._disk_free_gb(target),
        )

    async def start(self, name: str) -> tuple[str, bool]:
        """Start downloading. Returns ``(ref, started)``; ``started`` is false when already running.

        Raises :class:`PullError` when Ollama is not answering, the registry
        has no such model, or the disk is too full.
        """
        target = self._target(name)
        existing = self._pulls.get(target.ref)
        if existing is not None:
            return target.ref, False
        if await self._installed(target) is None:
            raise PullError(self._down_hint())
        parsed = registry.parse_name(target.model_id)
        if parsed is not None:
            exists, size = await registry.manifest_size_gb(self._http(), parsed)
            if exists is False:
                raise PullError(f"no model named {target.model_id} in the Ollama library")
            free = self._disk_free_gb(target)
            if size is not None and free is not None and free < size * _SPACE_MARGIN:
                raise PullError(f"not enough disk space: {free:.1f} GB free, {size:.1f} GB needed")
        if target.ref in self._pulls:
            return target.ref, False
        pull = _Pull(ref=target.ref)
        self._pulls[target.ref] = pull
        pull.task = asyncio.create_task(self._run(target, pull), name=f"golem-pull-{target.ref}")
        log.info("pull started ref=%s", target.ref)
        return target.ref, True

    async def cancel(self, name: str) -> tuple[str, bool]:
        target = self._target(name)
        pull = self._pulls.get(target.ref)
        if pull is None or pull.task is None:
            return target.ref, False
        pull.task.cancel()
        await asyncio.gather(pull.task, return_exceptions=True)
        return target.ref, True

    async def delete(self, name: str) -> tuple[str, bool]:
        """Remove an installed model. Raises :class:`PullError` while it downloads."""
        target = self._target(name)
        if target.ref in self._pulls:
            raise PullError(f"{target.model_id} is still downloading: stop it first")
        try:
            response = await self._http().request(
                "DELETE",
                f"{target.base_url}/api/delete",
                json={"model": target.model_id},
                timeout=_OLLAMA_TIMEOUT,
            )
        except httpx.HTTPError as exc:
            raise PullError(self._down_hint()) from exc
        if response.status_code == 404:
            return target.ref, False
        if response.status_code >= 400:
            raise PullError(
                f"Ollama refused to remove {target.model_id}: {_ollama_error(response)}"
            )
        log.info("deleted ref=%s", target.ref)
        return target.ref, True

    def _target(self, name: str) -> _Target:
        text = name.strip()
        prefix, _, rest = text.partition("/")
        providers = self._router.providers()
        provider_name = "ollama"
        model_id = text
        if rest and prefix in providers:
            provider_name, model_id = prefix, rest
        provider: Provider | None = providers.get(provider_name)
        if provider is None or provider.kind != "ollama":
            raise PullError(f"only Ollama models can be downloaded, not {provider_name}")
        if model_id == "":
            raise PullError("name a model to download, for example qwen3:8b")
        base = (provider.base_url or OLLAMA_BASE_URL).rstrip("/").removesuffix("/v1")
        return _Target(provider_name=provider_name, base_url=base, model_id=model_id)

    async def _installed(self, target: _Target) -> bool | None:
        """True or False from Ollama's list, None when Ollama does not answer."""
        try:
            response = await self._http().get(
                f"{target.base_url}/api/tags", timeout=_OLLAMA_TIMEOUT
            )
            response.raise_for_status()
            models = cast(list[dict[str, Any]], response.json().get("models", []))
        except (httpx.HTTPError, ValueError, AttributeError):
            return None
        wanted = {target.model_id, f"{target.model_id}:latest"}
        return any(item.get("name") in wanted or item.get("model") in wanted for item in models)

    async def _run(self, target: _Target, pull: _Pull) -> None:
        error: str | None = None
        try:
            async with self._http().stream(
                "POST",
                f"{target.base_url}/api/pull",
                json={"model": target.model_id, "stream": True},
                timeout=httpx.Timeout(None, connect=_OLLAMA_TIMEOUT),
            ) as response:
                if response.status_code >= 400:
                    await response.aread()
                    error = _ollama_error(response)
                else:
                    async for line in response.aiter_lines():
                        error = self._step(pull, line)
                        if error is not None:
                            break
            if error is None and pull.status != "success":
                error = "Ollama ended the download early"
        except asyncio.CancelledError:
            error = "cancelled"
        except httpx.HTTPError as exc:
            error = f"{self._down_hint()} ({exc})"
        finally:
            self._pulls.pop(target.ref, None)
            done = ModelPullDone(ref=target.ref, ok=error is None, error=error)
            self._send(ModelPullDoneNotification(params=done))
            log.info("pull ended ref=%s ok=%s error=%s", target.ref, error is None, error)

    def _step(self, pull: _Pull, line: str) -> str | None:
        if line.strip() == "":
            return None
        try:
            item = cast(dict[str, Any], json.loads(line))
        except ValueError:
            return None
        if isinstance(item.get("error"), str):
            return cast(str, item["error"])
        status = item.get("status")
        changed = isinstance(status, str) and status != pull.status
        if isinstance(status, str):
            pull.status = status
        digest = item.get("digest")
        total = item.get("total")
        if isinstance(digest, str) and isinstance(total, int):
            completed = item.get("completed")
            pull.layers[digest] = (completed if isinstance(completed, int) else 0, total)
        if status == "success":
            # Ollama's last byte counts can stop just short of the total.
            pull.layers = {key: (size, size) for key, (_, size) in pull.layers.items()}
        now = self._clock()
        if changed or now - pull.sent_at >= _SEND_EVERY_SECONDS:
            pull.sent_at = now
            progress = ModelPullProgress(
                ref=pull.ref,
                status=pull.status,
                completed=pull.completed,
                total=pull.total,
                progress=pull.progress,
            )
            self._send(ModelPullProgressNotification(params=progress))
        return None

    def _send(self, notification: BaseModel) -> None:
        try:
            self.broadcast(notification)
        except Exception:
            log.debug("broadcast failed", exc_info=True)

    def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(transport=self._transport)
        return self._client

    def _disk_free_gb(self, target: _Target) -> float | None:
        host = urlparse(target.base_url).hostname
        if host not in ("127.0.0.1", "localhost", "::1"):
            return None
        path = self._models_dir
        while not path.exists() and path != path.parent:
            path = path.parent
        try:
            return round(shutil.disk_usage(path).free / 1e9, 1)
        except OSError:
            return None

    def _down_hint(self) -> str:
        if self._ollama_installed():
            return "Ollama is not running: run ollama serve"
        return "Ollama is not installed: run brew install ollama"


def _ollama_models_dir() -> Path:
    configured = os.environ.get("OLLAMA_MODELS", "").strip()
    return Path(configured).expanduser() if configured else Path.home() / ".ollama" / "models"


def _ollama_installed() -> bool:
    return shutil.which("ollama") is not None or any(
        Path(path).exists() for path in _OLLAMA_BINARIES
    )


def _ollama_error(response: httpx.Response) -> str:
    try:
        body = response.json()
    except ValueError:
        return response.text.strip() or f"HTTP {response.status_code}"
    if isinstance(body, dict) and isinstance(cast(dict[str, Any], body).get("error"), str):
        return cast(str, cast(dict[str, Any], body)["error"])
    return f"HTTP {response.status_code}"
