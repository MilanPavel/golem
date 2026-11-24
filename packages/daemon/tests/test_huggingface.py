"""Hugging Face search and sizes through a fake API, and an hf.co pull through a fake Ollama."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any, cast

import httpx
import pytest
from pydantic import BaseModel
from test_pulls import FakeOllama

from golem.config import GolemSettings
from golem.models.huggingface import SLOW, HuggingFace, HuggingFaceError, quant_of, repo_of
from golem.models.pulls import PullManager
from golem.models.router import ModelRouter

SEARCH: list[dict[str, Any]] = [
    {
        "_id": "a1",
        "id": "bartowski/Qwen3-8B-GGUF",
        "downloads": 120000,
        "likes": 310,
        "lastModified": "2026-10-01T08:00:00.000Z",
        "gated": False,
        "tags": ["gguf"],
    },
    {
        "id": "meta/Llama-GGUF",
        "downloads": 9000,
        "likes": 12,
        "createdAt": "2026-09-01T08:00:00.000Z",
        "gated": "manual",
    },
]


def _file(path: str, gb: float) -> dict[str, Any]:
    size = int(gb * 1e9)
    return {
        "type": "file",
        "path": path,
        "size": 135,
        "lfs": {"oid": "abc", "size": size, "pointerSize": 135},
    }


TREE: list[dict[str, Any]] = [
    {"type": "file", "path": "README.md", "size": 900},
    {"type": "directory", "path": "extra"},
    _file("Qwen3-8B-Q4_K_M.gguf", 5.0),
    _file("Qwen3-8B-Q8_0.gguf", 8.7),
    _file("Qwen3-8B-Q2_K.gguf", 3.2),
    _file("Qwen3-8B-f16-00001-of-00003.gguf", 7.0),
    _file("Qwen3-8B-f16-00002-of-00003.gguf", 7.0),
    _file("Qwen3-8B-f16-00003-of-00003.gguf", 2.2),
    _file("mmproj-F16.gguf", 0.6),
    _file("Q6_K/Qwen3-8B-00001-of-00002.gguf", 5.0),
    _file("Q6_K/Qwen3-8B-00002-of-00002.gguf", 1.0),
]


class FakeHub:
    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.timeout = False
        self.status = 200

    async def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.timeout:
            raise httpx.ReadTimeout("slow", request=request)
        if self.status != 200:
            return httpx.Response(self.status)
        if request.url.path == "/api/models":
            return httpx.Response(200, json=SEARCH)
        if request.url.path == "/api/models/bartowski/Qwen3-8B-GGUF/tree/main":
            return httpx.Response(200, json=TREE)
        return httpx.Response(404)


def _hub(fake: FakeHub, ram_gb: float | None = 32.0) -> HuggingFace:
    return HuggingFace(transport=httpx.MockTransport(fake), ram_gb=ram_gb)


async def test_search_parses_repos_and_the_gated_flag() -> None:
    fake = FakeHub()
    repos = await _hub(fake).search("qwen", 5)
    assert repos == [
        {
            "id": "bartowski/Qwen3-8B-GGUF",
            "downloads": 120000,
            "likes": 310,
            "updated": "2026-10-01T08:00:00.000Z",
            "gated": False,
        },
        {
            "id": "meta/Llama-GGUF",
            "downloads": 9000,
            "likes": 12,
            "updated": "2026-09-01T08:00:00.000Z",
            "gated": True,
        },
    ]
    url = fake.requests[0].url
    assert dict(url.params) == {
        "search": "qwen",
        "filter": "gguf",
        "sort": "downloads",
        "limit": "5",
    }
    assert fake.requests[0].content == b""


async def test_an_empty_query_asks_for_the_most_downloaded_repos() -> None:
    fake = FakeHub()
    repos = await _hub(fake).search("  ", 7)
    assert [repo["id"] for repo in repos] == ["bartowski/Qwen3-8B-GGUF", "meta/Llama-GGUF"]
    assert dict(fake.requests[0].url.params) == {
        "filter": "gguf",
        "sort": "downloads",
        "limit": "7",
    }


@pytest.mark.parametrize(
    "link",
    [
        "https://huggingface.co/bartowski/Qwen3-8B-GGUF",
        "https://huggingface.co/bartowski/Qwen3-8B-GGUF/tree/main",
        "http://www.huggingface.co/bartowski/Qwen3-8B-GGUF?show=1",
        "hf.co/bartowski/Qwen3-8B-GGUF:Q4_K_M",
        "  huggingface.co/bartowski/Qwen3-8B-GGUF/ ",
    ],
)
async def test_a_pasted_link_is_read_as_the_repo_id(link: str) -> None:
    assert repo_of(link) == "bartowski/Qwen3-8B-GGUF"
    fake = FakeHub()
    await _hub(fake).search(link)
    assert fake.requests[0].url.params["search"] == "bartowski/Qwen3-8B-GGUF"


def test_other_text_is_not_taken_for_a_link() -> None:
    assert repo_of(" qwen3 coder ") == "qwen3 coder"
    assert repo_of("https://example.com/a/b") == "https://example.com/a/b"


async def test_files_group_quants_sum_splits_and_mark_fit_on_a_32_gb_mac() -> None:
    sizes = await _hub(FakeHub()).sizes("bartowski/Qwen3-8B-GGUF")
    assert [(s["quant"], s["size_gb"], s["files"], s["fit"]) for s in sizes] == [
        ("Q2_K", 3.2, 1, "fits"),
        ("Q4_K_M", 5.0, 1, "fits"),
        ("Q6_K", 6.0, 2, "fits"),
        ("Q8_0", 8.7, 1, "fits"),
        ("F16", 16.2, 3, "tight"),
    ]
    assert [s["quant"] for s in sizes if s["recommended"]] == ["Q4_K_M"]


async def test_the_largest_size_that_fits_is_recommended_without_q4_k_m() -> None:
    tree = [_file("m-Q3_K_S.gguf", 4.0), _file("m-Q8_0.gguf", 9.0), _file("m-F16.gguf", 30.0)]

    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=tree)

    hub = HuggingFace(transport=httpx.MockTransport(handler), ram_gb=32.0)
    sizes = await hub.sizes("u/m")
    assert [(s["quant"], s["fit"], s["recommended"]) for s in sizes] == [
        ("Q3_K_S", "fits", False),
        ("Q8_0", "fits", True),
        ("F16", "too_big", False),
    ]


async def test_nothing_is_recommended_when_the_memory_is_unknown() -> None:
    sizes = await _hub(FakeHub(), ram_gb=None).sizes("bartowski/Qwen3-8B-GGUF")
    assert {s["fit"] for s in sizes} == {None}
    assert not any(s["recommended"] for s in sizes)


@pytest.mark.parametrize("call", ["search", "sizes"])
async def test_a_timeout_gives_the_plain_error(call: str) -> None:
    fake = FakeHub()
    fake.timeout = True
    hub = _hub(fake)
    with pytest.raises(HuggingFaceError) as caught:
        if call == "search":
            await hub.search("qwen")
        else:
            await hub.sizes("bartowski/Qwen3-8B-GGUF")
    assert str(caught.value) == SLOW == "Hugging Face didn't answer. Try again in a moment."


async def test_a_missing_or_gated_repo_and_a_server_error_say_so() -> None:
    fake = FakeHub()
    hub = _hub(fake)
    fake.status = 404
    with pytest.raises(HuggingFaceError, match="no repo"):
        await hub.sizes("a/b")
    fake.status = 401
    with pytest.raises(HuggingFaceError, match="token"):
        await hub.sizes("a/b")
    fake.status = 503
    with pytest.raises(HuggingFaceError, match="didn't answer"):
        await hub.search("x")


@pytest.mark.parametrize(
    ("path", "quant"),
    [
        ("Qwen3-8B-Q4_K_M.gguf", "Q4_K_M"),
        ("Qwen3-8B.IQ3_XS.gguf", "IQ3_XS"),
        ("model-bf16.gguf", "BF16"),
        ("Q5_K_M/model-00001-of-00003.gguf", "Q5_K_M"),
        ("model-Q4_K_M-00002-of-00003.gguf", "Q4_K_M"),
        ("mmproj-F16.gguf", None),
        ("README.md", None),
        ("Qwen3-8B.gguf", None),
    ],
)
def test_quant_of(path: str, quant: str | None) -> None:
    assert quant_of(path) == quant


async def test_a_pull_by_an_hf_name_reaches_ollama_with_that_name(tmp_path: Path) -> None:
    fake = FakeOllama()
    sent: list[BaseModel] = []
    manager = PullManager(
        ModelRouter(GolemSettings()),
        transport=httpx.MockTransport(fake),
        broadcast=sent.append,
        ram_gb=36.0,
        models_dir=tmp_path,
        clock=lambda: 0.0,
        ollama_installed=lambda: True,
    )
    name = "ollama/hf.co/bartowski/Qwen3-8B-GGUF:Q4_K_M"
    ref, started = await manager.start(name)
    assert (ref, started) == (name, True)
    for _ in range(200):
        if ref not in manager.pulling():
            break
        await asyncio.sleep(0.01)
    assert fake.pulled == [{"model": "hf.co/bartowski/Qwen3-8B-GGUF:Q4_K_M", "stream": True}]
    assert cast(dict[str, Any], json.loads(sent[-1].model_dump_json()))["params"] == {
        "ref": ref,
        "ok": True,
        "error": None,
    }
    await manager.aclose()
