"""Hugging Face: search GGUF models, list a repo's sizes, and say which fit this Mac.

Only the search words and the repo name leave the machine. Ollama pulls a chosen size
by the name ``hf.co/<user>/<repo>:<quant>``, so nothing is downloaded here.
"""

from __future__ import annotations

import asyncio
import re
from collections import defaultdict
from typing import Any, cast

import httpx

from golem.models import hardware
from golem.net_tls import tls_context

BASE_URL = "https://huggingface.co"
TIMEOUT_SECONDS = 10.0
PREFERRED_QUANT = "Q4_K_M"

SLOW = "Hugging Face didn't answer. Try again in a moment."
MISSING_FILE = (
    "Hugging Face is missing a file for this size, so the download can't finish right now."
)
# How long the check for a missing file may take in all. A size it did not reach stays unmarked.
CHECK_SECONDS = 3.0
_MANIFEST_TYPES = (
    "application/vnd.docker.distribution.manifest.v2+json, "
    "application/vnd.oci.image.manifest.v1+json"
)

_QUANT = re.compile(
    r"(?<![A-Za-z0-9])(IQ\d(?:_[A-Z0-9]+)*|Q\d(?:_[A-Z0-9]+)*|BF16|F16|F32)(?![A-Za-z0-9])",
    re.IGNORECASE,
)
_SPLIT = re.compile(r"-\d{5}-of-\d{5}", re.IGNORECASE)
_LINK = re.compile(
    r"^(?:https?://)?(?:www\.)?(?:huggingface\.co|hf\.co)/(?P<repo>[\w.-]+/[\w.-]+)(?:[/?#:].*)?$",
    re.IGNORECASE,
)


class HuggingFaceError(Exception):
    """Hugging Face could not answer. The message says what to do."""


class HuggingFace:
    """``transport`` replaces the network in tests. ``ram_gb`` is this Mac's memory."""

    def __init__(
        self, *, transport: httpx.AsyncBaseTransport | None = None, ram_gb: float | None = None
    ) -> None:
        self._transport = transport
        self.ram_gb = ram_gb
        self._client: httpx.AsyncClient | None = None

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                transport=self._transport,
                verify=tls_context(),
                timeout=TIMEOUT_SECONDS,
                trust_env=False,
            )
        return self._client

    async def _get(self, path: str, params: dict[str, str | int] | None = None) -> Any:
        try:
            response = await self._http().get(f"{BASE_URL}{path}", params=params)
        except httpx.HTTPError as exc:
            raise HuggingFaceError(SLOW) from exc
        if response.status_code in (401, 403):
            raise HuggingFaceError("This repo needs a Hugging Face token. Tokens come later.")
        if response.status_code == 404:
            raise HuggingFaceError("Hugging Face has no repo with that name.")
        if response.status_code >= 400:
            raise HuggingFaceError(SLOW)
        try:
            return response.json()
        except ValueError as exc:
            raise HuggingFaceError(SLOW) from exc

    async def search(self, query: str, limit: int = 20) -> list[dict[str, Any]]:
        """Repos as dicts of ``id``, ``downloads``, ``likes``, ``updated``, ``gated``.

        An empty query lists the most downloaded GGUF repos. A pasted link is read as its repo id.
        """
        params: dict[str, str | int] = {"filter": "gguf", "sort": "downloads", "limit": limit}
        words = repo_of(query)
        if words:
            params["search"] = words
        body = await self._get("/api/models", params)
        if not isinstance(body, list):
            raise HuggingFaceError(SLOW)
        repos: list[dict[str, Any]] = []
        for item in cast(list[Any], body):
            if not isinstance(item, dict):
                continue
            entry = cast(dict[str, Any], item)
            name = entry.get("id") or entry.get("modelId")
            if not isinstance(name, str) or not name:
                continue
            updated = entry.get("lastModified") or entry.get("createdAt")
            repos.append(
                {
                    "id": name,
                    "downloads": _count(entry.get("downloads")),
                    "likes": _count(entry.get("likes")),
                    "updated": updated if isinstance(updated, str) else None,
                    # Gated repos say "auto" or "manual"; an open one says false.
                    "gated": entry.get("gated") not in (None, False),
                }
            )
        return repos

    async def sizes(self, repo: str) -> list[dict[str, Any]]:
        """Sizes of one repo by quantization, smallest first, with fit and a recommended one."""
        body = await self._get(f"/api/models/{repo}/tree/main", {"recursive": "true"})
        if not isinstance(body, list):
            raise HuggingFaceError(SLOW)
        total: dict[str, int] = defaultdict(int)
        parts: dict[str, int] = defaultdict(int)
        for item in cast(list[Any], body):
            if not isinstance(item, dict):
                continue
            entry = cast(dict[str, Any], item)
            path = entry.get("path")
            if entry.get("type") != "file" or not isinstance(path, str):
                continue
            quant = quant_of(path)
            if quant is None:
                continue
            lfs = entry.get("lfs")
            lfs_size = cast(dict[str, Any], lfs).get("size") if isinstance(lfs, dict) else None
            total[quant] += _count(lfs_size if lfs_size is not None else entry.get("size"))
            parts[quant] += 1
        rows: list[dict[str, Any]] = []
        for quant, size in sorted(total.items(), key=lambda pair: (pair[1], pair[0])):
            size_gb = size / 1e9
            fit = hardware.fit(size_gb, self.ram_gb) if self.ram_gb else None
            rows.append(
                {
                    "quant": quant,
                    "size_gb": round(size_gb, 2),
                    "files": parts[quant],
                    "fit": fit,
                    "recommended": False,
                    "problem": None,
                }
            )
        _recommend(rows)
        await self._mark_missing(repo, rows)
        return rows

    async def _mark_missing(self, repo: str, rows: list[dict[str, Any]]) -> None:
        """Set ``problem`` on a size whose config file Hugging Face definitely does not have.

        Ollama asks the repo for the config file named in each size's manifest after it has
        fetched every layer, and a 404 there fails a download of many gigabytes. Only that 404
        marks a size: a slow answer, an error, or any other status leaves it unmarked.
        """
        if not rows:
            return
        tasks = [asyncio.create_task(self._config_missing(repo, row["quant"])) for row in rows]
        try:
            await asyncio.wait(tasks, timeout=CHECK_SECONDS)
        finally:
            for task in tasks:
                if not task.done():
                    task.cancel()
        for row, task in zip(rows, tasks, strict=True):
            if task.done() and not task.cancelled() and task.exception() is None and task.result():
                row["problem"] = MISSING_FILE

    async def _config_missing(self, repo: str, quant: str) -> bool:
        """True only when the config file of this size's manifest answers 404."""
        client = self._http()
        try:
            response = await client.get(
                f"{BASE_URL}/v2/{repo}/manifests/{quant}",
                headers={"Accept": _MANIFEST_TYPES},
                follow_redirects=True,
            )
            if response.status_code != 200:
                return False
            body = response.json()
            config = cast(dict[str, Any], body).get("config") if isinstance(body, dict) else None
            digest = (
                cast(dict[str, Any], config).get("digest") if isinstance(config, dict) else None
            )
            if not isinstance(digest, str) or not digest:
                return False
            async with client.stream(
                "GET", f"{BASE_URL}/v2/{repo}/blobs/{digest}", follow_redirects=True
            ) as blob:
                return blob.status_code == 404
        except (httpx.HTTPError, ValueError, AttributeError):
            return False


def repo_of(query: str) -> str:
    """``user/repo`` from a pasted ``https://huggingface.co/user/repo`` or ``hf.co/user/repo`` link.

    Any other text comes back trimmed.
    """
    text = query.strip()
    found = _LINK.match(text)
    return found["repo"] if found else text


def quant_of(path: str) -> str | None:
    """``Q4_K_M`` from ``dir/Model-8B-Q4_K_M-00001-of-00003.gguf``; None for other files."""
    folder, _, base = path.rpartition("/")
    if not base.lower().endswith(".gguf") or "mmproj" in base.lower():
        return None
    stem = _SPLIT.sub("", base[: -len(".gguf")])
    found = _QUANT.findall(stem) or _QUANT.findall(folder)
    return found[-1].upper() if found else None


def _recommend(rows: list[dict[str, Any]]) -> None:
    """Mark ``Q4_K_M`` when it fits, else the largest size that fits. Rows are smallest first."""
    fitting = [row for row in rows if row["fit"] == "fits"]
    if not fitting:
        return
    preferred = [row for row in fitting if row["quant"] == PREFERRED_QUANT]
    (preferred or fitting[-1:])[0]["recommended"] = True


def _count(value: object) -> int:
    return int(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else 0
