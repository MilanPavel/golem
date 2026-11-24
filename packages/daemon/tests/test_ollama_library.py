"""The shipped Ollama library list, its search, the registry fallback, and ``just catalog``."""

from __future__ import annotations

import tomllib
from pathlib import Path
from typing import Any

import httpx
import pytest

from golem.models import ollama_library
from golem.models.catalog_check import check_library
from golem.models.ollama_library import DOWN, OllamaLibrary, OllamaLibraryError


class FakeRegistry:
    """Answers manifests for the tags in ``known`` (name:tag to bytes) and nothing else."""

    def __init__(self, known: dict[str, int] | None = None) -> None:
        self.known = known or {}
        self.requests: list[str] = []
        self.down = False

    async def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request.url.path)
        if self.down:
            raise httpx.ConnectError("no route", request=request)
        # /v2/library/<name>/manifests/<tag>
        parts = request.url.path.split("/")
        key = f"{'/'.join(parts[2:-2]).removeprefix('library/')}:{parts[-1]}"
        if key not in self.known:
            return httpx.Response(404)
        return httpx.Response(200, json={"layers": [{"size": self.known[key]}]})


def _library(fake: FakeRegistry | None = None, ram_gb: float | None = 32.0) -> OllamaLibrary:
    return OllamaLibrary(transport=httpx.MockTransport(fake or FakeRegistry()), ram_gb=ram_gb)


def test_the_list_loads_and_every_entry_has_a_blurb_and_a_size() -> None:
    names = ollama_library.load()
    assert len(names) >= 40
    assert len({entry.name for entry in names}) == len(names)
    for entry in names:
        assert entry.blurb.strip(), entry.name
        assert entry.sizes, entry.name
        assert all(size.tag and size.size_gb > 0 for size in entry.sizes), entry.name
        assert "embed" not in entry.name


async def test_an_empty_query_returns_the_whole_list_without_the_network() -> None:
    fake = FakeRegistry()
    rows = await _library(fake).search("")
    assert [row["name"] for row in rows] == [entry.name for entry in ollama_library.load()]
    assert fake.requests == []
    assert (await _library(fake).search("   ")) == rows


async def test_a_substring_matches_names_best_first() -> None:
    rows = await _library().search("mistral")
    names = [row["name"] for row in rows]
    assert names[0] == "mistral"
    assert {"mistral-nemo", "mistral-small"} <= set(names)
    assert all("mistral" in name for name in names)
    assert (await _library().search("QWEN"))[0]["name"].startswith("qwen")
    inner = [row["name"] for row in await _library().search("coder")]
    assert "qwen2.5-coder" in inner


async def test_a_name_with_a_tag_matches_on_the_name_only() -> None:
    rows = await _library().search("deepseek-r1:8b")
    assert rows[0]["name"] == "deepseek-r1"
    assert "8b" in [size["tag"] for size in rows[0]["sizes"]]


async def test_fit_and_recommended_follow_the_memory_of_this_mac() -> None:
    [row] = await _library(ram_gb=16.0).search("deepseek-r1")
    sizes = {size["tag"]: size for size in row["sizes"]}
    assert sizes["1.5b"]["fit"] == "fits"
    assert sizes["70b"]["fit"] == "too_big"
    recommended = [size["tag"] for size in row["sizes"] if size["recommended"]]
    fitting = [size for size in row["sizes"] if size["fit"] == "fits"]
    assert recommended == [fitting[-1]["tag"]]
    [big] = await _library(ram_gb=256.0).search("deepseek-r1")
    assert [size["tag"] for size in big["sizes"] if size["recommended"]] == ["70b"]


async def test_nothing_is_recommended_when_the_memory_is_unknown() -> None:
    [row] = await _library(ram_gb=None).search("deepseek-r1")
    assert {size["fit"] for size in row["sizes"]} == {None}
    assert not any(size["recommended"] for size in row["sizes"])


async def test_installed_tags_are_marked() -> None:
    [row] = await _library().search("deepseek-r1", {"deepseek-r1:8b", "qwen3:8b"})
    assert [size["tag"] for size in row["sizes"] if size["installed"]] == ["8b"]


async def test_a_full_name_that_the_list_lacks_comes_from_the_registry() -> None:
    fake = FakeRegistry({"fresh-model:7b": 4_400_000_000})
    rows = await _library(fake).search("fresh-model:7b", {"fresh-model:7b"})
    assert rows == [
        {
            "name": "fresh-model",
            "blurb": "",
            "sizes": [
                {
                    "tag": "7b",
                    "size_gb": 4.4,
                    "fit": "fits",
                    "recommended": True,
                    "installed": True,
                }
            ],
        }
    ]
    assert fake.requests == ["/v2/library/fresh-model/manifests/7b"]


async def test_a_name_the_registry_lacks_gives_an_empty_list() -> None:
    assert await _library().search("nothing-by-this-name") == []
    assert await _library().search("two words") == []


async def test_a_registry_that_does_not_answer_says_so_in_plain_words() -> None:
    fake = FakeRegistry()
    fake.down = True
    with pytest.raises(OllamaLibraryError) as caught:
        await _library(fake).search("fresh-model")
    assert str(caught.value) == DOWN
    # A name in the list never touches the registry.
    assert (await _library(fake).search("mistral"))[0]["name"] == "mistral"


async def test_just_catalog_rewrites_a_changed_size_and_reports_a_gone_tag(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    path = tmp_path / "ollama-library.toml"
    path.write_text(
        "# kept comment\n"
        "[[model]]\n"
        'name = "alpha"\n'
        'blurb = "One"\n'
        "\n"
        "[[model.sizes]]\n"
        'tag = "1b"\n'
        "size_gb = 1.0\n"
        "\n"
        "[[model.sizes]]\n"
        'tag = "2b"\n'
        "size_gb = 2.0\n"
        "\n"
        "[[model.sizes]]\n"
        'tag = "3b"\n'
        "size_gb = 3.0\n",
        "utf-8",
    )
    fake = FakeRegistry({"alpha:1b": 1_500_000_000, "alpha:2b": 2_000_000_000})
    code = await check_library(path, transport=httpx.MockTransport(fake))
    out = capsys.readouterr().out
    assert code == 1
    assert "alpha:1b: size 1.0 GB -> 1.5 GB" in out
    assert "alpha:3b: gone from the registry" in out
    text = path.read_text("utf-8")
    assert "# kept comment" in text
    parsed: dict[str, Any] = tomllib.loads(text)
    sizes = {size["tag"]: size["size_gb"] for size in parsed["model"][0]["sizes"]}
    assert sizes == {"1b": 1.5, "2b": 2.0, "3b": 3.0}
