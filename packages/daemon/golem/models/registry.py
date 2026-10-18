"""Ollama's model registry: does a name exist, and how big is its download.

``registry.ollama.ai`` speaks the container registry API. A manifest lists
the layers of one tag, and their sizes add up to the download. The API is not
documented by Ollama, so every caller treats a failure as "unknown".
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, cast

import httpx

log = logging.getLogger(__name__)

REGISTRY = "https://registry.ollama.ai"
_ACCEPT = "application/vnd.docker.distribution.manifest.v2+json"
_TIMEOUT = 8.0


@dataclass(frozen=True, slots=True)
class OllamaName:
    """``qwen3:8b`` is ``library/qwen3`` at tag ``8b``. A name with a host is not ours to ask."""

    repository: str
    tag: str

    @property
    def name(self) -> str:
        short = self.repository.removeprefix("library/")
        return f"{short}:{self.tag}"


def parse_name(name: str) -> OllamaName | None:
    """``qwen3:8b``, ``qwen3`` (tag ``latest``), or ``user/model:tag``. None for ``hf.co/...``."""
    text = name.strip().removeprefix("ollama/")
    if text == "" or any(char.isspace() for char in text):
        return None
    path, _, tag = text.partition(":")
    host_like = "/" in path and "." in path.split("/", 1)[0]
    if path.count("/") > 1 or host_like:
        return None
    repository = path if "/" in path else f"library/{path}"
    return OllamaName(repository=repository, tag=tag or "latest")


async def manifest_size_gb(
    client: httpx.AsyncClient, name: OllamaName
) -> tuple[bool | None, float | None]:
    """``(exists, size_gb)``.

    ``(False, None)`` for an unknown name, ``(None, None)`` when unsure.
    """
    url = f"{REGISTRY}/v2/{name.repository}/manifests/{name.tag}"
    try:
        response = await client.get(url, headers={"accept": _ACCEPT}, timeout=_TIMEOUT)
    except httpx.HTTPError as exc:
        log.debug("registry did not answer for %s: %s", name.name, exc)
        return None, None
    if response.status_code == 404:
        return False, None
    if response.status_code != 200:
        return None, None
    try:
        body = cast(dict[str, Any], response.json())
        layers = cast(list[dict[str, Any]], body["layers"])
        size = sum(int(layer["size"]) for layer in layers)
    except (ValueError, KeyError, TypeError):
        return None, None
    return True, round(size / 1e9, 1)
