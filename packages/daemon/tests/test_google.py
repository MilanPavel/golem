"""Google (Gemini): the model list, the key check, and a chat that calls a tool.

The responses in ``data/google-*.json`` are recorded from Google's API.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import cast

import httpx
import pytest
from langchain_core.messages import HumanMessage
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI

from golem.config import GolemSettings
from golem.models.discovery import KeyRejected, ModelDiscovery
from golem.models.keys import MemoryKeyStore
from golem.models.prices import PriceBook
from golem.models.router import ModelConfigError, ModelRouter

DATA = Path(__file__).parent / "data"
MODELS_URL = "https://generativelanguage.googleapis.com/v1beta/models"


def _recorded(name: str) -> object:
    return json.loads((DATA / name).read_text("utf-8"))


def _discovery(handler: httpx.MockTransport, store: MemoryKeyStore | None = None) -> ModelDiscovery:
    return ModelDiscovery(
        ModelRouter(GolemSettings(), keys=store or MemoryKeyStore()),
        None,
        transport=handler,
        detect_ram=False,
        fetch_prices=False,
    )


async def test_the_key_is_checked_and_the_chat_models_are_listed() -> None:
    seen: list[httpx.Request] = []

    def answer(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=_recorded("google-models.json"))

    discovery = _discovery(httpx.MockTransport(answer))
    try:
        assert await discovery.check_key("google", "AIza-good") == 2
    finally:
        await discovery.aclose()
    assert str(seen[0].url).startswith(MODELS_URL)
    assert seen[0].headers["x-goog-api-key"] == "AIza-good"


async def test_models_drop_the_prefix_and_keep_name_and_context() -> None:
    store = MemoryKeyStore({"google": "AIza-good"})
    discovery = _discovery(
        httpx.MockTransport(lambda _r: httpx.Response(200, json=_recorded("google-models.json"))),
        store,
    )
    try:
        listing = await discovery.list()
    finally:
        await discovery.aclose()
    google = {m.ref: m for m in listing.models if m.provider == "google"}
    assert sorted(google) == ["google/gemini-2.5-flash", "google/gemini-2.5-pro"]
    flash = google["google/gemini-2.5-flash"]
    assert (flash.label, flash.ctx) == ("Gemini 2.5 Flash", 1048576)


async def test_google_answers_400_for_a_key_that_does_not_exist() -> None:
    bad = httpx.Response(400, json=_recorded("google-bad-key.json"))
    discovery = _discovery(httpx.MockTransport(lambda _r: bad))
    try:
        with pytest.raises(KeyRejected, match=r"google rejected the key \(400 · API key not valid"):
            await discovery.check_key("google", "nope")
    finally:
        await discovery.aclose()


async def test_a_second_page_of_models_is_followed() -> None:
    models = cast(list[object], cast(dict[str, object], _recorded("google-models.json"))["models"])
    pages: dict[str | None, dict[str, object]] = {
        None: {"models": models[:1], "nextPageToken": "p2"},
        "p2": {"models": models[1:2]},
    }

    def answer(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=pages[request.url.params.get("pageToken")])

    discovery = _discovery(httpx.MockTransport(answer))
    try:
        assert await discovery.check_key("google", "AIza-good") == 2
    finally:
        await discovery.aclose()


def test_google_needs_its_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    with pytest.raises(ModelConfigError, match="GOOGLE_API_KEY"):
        ModelRouter(GolemSettings()).chat_model("google/gemini-2.5-flash")


def test_google_chats_through_the_openai_compatible_endpoint() -> None:
    router = ModelRouter(GolemSettings(), keys=MemoryKeyStore({"google": "AIza-good"}))
    model = router.chat_model("google/gemini-2.5-flash")
    assert isinstance(model, ChatOpenAI)
    assert model.model_name == "gemini-2.5-flash"
    assert model.openai_api_base == "https://generativelanguage.googleapis.com/v1beta/openai/"


async def test_a_recorded_reply_that_calls_a_tool_becomes_a_tool_call() -> None:
    @tool
    def read_file(path: str) -> str:
        """Read a file."""
        return path

    def answer(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1beta/openai/chat/completions"
        assert request.headers["authorization"] == "Bearer AIza-good"
        body = json.loads(request.content)
        assert body["model"] == "gemini-2.5-flash"
        assert body["tools"][0]["function"]["name"] == "read_file"
        return httpx.Response(200, json=_recorded("google-chat-tool-call.json"))

    router = ModelRouter(GolemSettings(), keys=MemoryKeyStore({"google": "AIza-good"}))
    built = router.chat_model("google/gemini-2.5-flash")
    assert isinstance(built, ChatOpenAI)
    model = ChatOpenAI(
        model=built.model_name,
        base_url=built.openai_api_base,
        api_key=built.openai_api_key,
        http_async_client=httpx.AsyncClient(transport=httpx.MockTransport(answer)),
    )
    bound = model.bind_tools([read_file])  # pyright: ignore[reportUnknownMemberType]
    reply = await bound.ainvoke([HumanMessage("read notes.txt")])
    assert reply.tool_calls[0]["name"] == "read_file"
    assert reply.tool_calls[0]["args"] == {"path": "notes.txt"}


def test_the_bundled_prices_know_gemini() -> None:
    found = PriceBook.bundled().lookup("google", "gemini-2.5-flash")
    assert found is not None and found.price is not None and found.tools
