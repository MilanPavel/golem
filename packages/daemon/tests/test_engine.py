"""The engine profile: Ollama's values, the lookup by kind, and the state reader."""

from __future__ import annotations

import dataclasses
import subprocess
import sys
from collections.abc import Callable
from typing import Any

import httpx
import pytest

from golem.config import OllamaSettings
from golem.models.engine import OLLAMA, EngineState, LoadedModel, engine_for

URL = "http://127.0.0.1:11434"


def _transport(handler: Callable[[httpx.Request], httpx.Response]) -> httpx.MockTransport:
    return httpx.MockTransport(handler)


def test_the_lookup_returns_ollamas_profile_for_kind_ollama() -> None:
    assert engine_for("ollama") is OLLAMA


@pytest.mark.parametrize("kind", ["anthropic", "openai", "google", "xai", "openai_compat", ""])
def test_the_lookup_returns_nothing_for_a_hosted_kind(kind: str) -> None:
    assert engine_for(kind) is None


def test_ollamas_profile_has_the_values_of_the_adr() -> None:
    assert (OLLAMA.id, OLLAMA.at_once, OLLAMA.max_loaded) == ("ollama", "slots", 1)
    assert (OLLAMA.capacity, OLLAMA.window, OLLAMA.queue) == (
        "slots_x_window",
        "fixed_at_load",
        "golem",
    )
    assert OLLAMA.prefix_cache == "per_slot"
    assert OLLAMA.reload_on == {"window", "slots"}
    assert (OLLAMA.tools, OLLAMA.structured, OLLAMA.owns_server) == ("native", True, True)


def test_max_slots_is_the_most_the_setting_allows() -> None:
    assert OLLAMA.max_slots == 8
    assert OllamaSettings(parallel=OLLAMA.max_slots).parallel == 8
    with pytest.raises(ValueError):
        OllamaSettings(parallel=OLLAMA.max_slots + 1)


def test_a_profile_cannot_be_changed() -> None:
    with pytest.raises(dataclasses.FrozenInstanceError):
        OLLAMA.max_loaded = 2  # pyright: ignore[reportAttributeAccessIssue]


async def test_the_state_lists_the_loaded_models() -> None:
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        body = {
            "models": [
                {"name": "qwen3:14b", "size": 10, "size_vram": 9, "context_length": 8192},
                {"model": "llama3:8b"},
            ]
        }
        return httpx.Response(200, json=body)

    state = await OLLAMA.read_state(URL, transport=_transport(handler))
    assert state == EngineState((LoadedModel("qwen3:14b", 10, 9, 8192), LoadedModel("llama3:8b")))
    assert seen == [f"{URL}/api/ps"]


async def test_a_url_with_the_v1_suffix_reads_the_same_server() -> None:
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        return httpx.Response(200, json={"models": []})

    state = await OLLAMA.read_state(f"{URL}/v1/", transport=_transport(handler))
    assert state == EngineState()
    assert seen == [f"{URL}/api/ps"]


def _refused(request: httpx.Request) -> httpx.Response:
    raise httpx.ConnectError("refused", request=request)


def _timeout(request: httpx.Request) -> httpx.Response:
    raise httpx.ReadTimeout("slow", request=request)


def _unexpected(request: httpx.Request) -> httpx.Response:
    raise RuntimeError("boom")


def _answer(status: int, **content: Any) -> Callable[[httpx.Request], httpx.Response]:
    return lambda _request: httpx.Response(status, **content)


@pytest.mark.parametrize(
    "handler",
    [
        _refused,
        _timeout,
        _unexpected,
        _answer(500, text="oops"),
        _answer(200, text="not json"),
        _answer(200, json=["a list"]),
        _answer(200, json={"models": "none"}),
    ],
    ids=["refused", "timeout", "unexpected", "status", "not-json", "list", "models-not-a-list"],
)
async def test_the_state_is_nothing_on_any_failure(
    handler: Callable[[httpx.Request], httpx.Response],
) -> None:
    assert await OLLAMA.read_state(URL, transport=_transport(handler)) is None


async def test_the_state_skips_an_entry_it_cannot_read() -> None:
    body = {"models": ["x", {"size": 1}, {"name": "a", "size": -1, "size_vram": True}]}
    state = await OLLAMA.read_state(
        URL, transport=_transport(lambda _request: httpx.Response(200, json=body))
    )
    assert state == EngineState((LoadedModel("a"),))


async def test_an_engine_with_no_reader_gives_nothing() -> None:
    other = dataclasses.replace(OLLAMA, id="other")
    assert await other.read_state(URL, transport=_transport(_refused)) is None


def test_importing_the_module_touches_no_network_and_no_binary() -> None:
    code = (
        "import socket, subprocess\n"
        "def no(*a, **k): raise AssertionError('touched')\n"
        "socket.socket.connect = no\n"
        "socket.getaddrinfo = no\n"
        "subprocess.Popen = no\n"
        "import golem.models.engine as e\n"
        "assert e.engine_for('anthropic') is None and e.engine_for('ollama') is e.OLLAMA\n"
    )
    subprocess.run([sys.executable, "-c", code], check=True)
