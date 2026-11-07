"""Moonshot: the model list, the key check, and a chat that calls a tool.

The responses in ``data/moonshot-*.json`` are recorded from Moonshot's API.
"""

from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest
from langchain_core.messages import HumanMessage
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI

from golem.config import GolemSettings
from golem.models.catalog import HostedEntry
from golem.models.discovery import KeyRejected, ModelDiscovery
from golem.models.keys import MemoryKeyStore
from golem.models.prices import PriceBook
from golem.models.router import ModelConfigError, ModelRouter

DATA = Path(__file__).parent / "data"


def _recorded(name: str) -> object:
    return json.loads((DATA / name).read_text("utf-8"))


def _discovery(
    transport: httpx.MockTransport, store: MemoryKeyStore | None = None
) -> ModelDiscovery:
    return ModelDiscovery(
        ModelRouter(GolemSettings(), keys=store or MemoryKeyStore()),
        None,
        transport=transport,
        detect_ram=False,
        fetch_prices=False,
        price_book=PriceBook.bundled(),
        # Before any model here was retired, and with the fixture's models in the catalog.
        clock=lambda: 1_700_000_000.0,
        hosted=[
            HostedEntry("moonshot/kimi-k2.5", "kimi-k2.5", "b", ("general",)),
            HostedEntry("moonshot/moonshot-v1-8k", "moonshot-v1-8k", "b", ("general",)),
        ],
    )


async def test_the_key_is_checked_by_listing_the_models() -> None:
    seen: list[httpx.Request] = []

    def answer(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=_recorded("moonshot-models.json"))

    discovery = _discovery(httpx.MockTransport(answer))
    try:
        assert await discovery.check_key("moonshot", "sk-good") == 2
    finally:
        await discovery.aclose()
    assert str(seen[0].url) == "https://api.moonshot.ai/v1/models"
    assert seen[0].headers["authorization"] == "Bearer sk-good"


async def test_a_key_that_does_not_exist_is_rejected() -> None:
    bad = httpx.Response(401, json=_recorded("moonshot-bad-key.json"))
    discovery = _discovery(httpx.MockTransport(lambda _r: bad))
    try:
        with pytest.raises(
            KeyRejected, match=r"moonshot rejected the key \(401 · Invalid Authentication"
        ):
            await discovery.check_key("moonshot", "nope")
    finally:
        await discovery.aclose()


async def test_the_listed_models_have_prices_and_tools() -> None:
    store = MemoryKeyStore({"moonshot": "sk-good"})
    discovery = _discovery(
        httpx.MockTransport(lambda _r: httpx.Response(200, json=_recorded("moonshot-models.json"))),
        store,
    )
    try:
        listing = await discovery.list()
    finally:
        await discovery.aclose()
    found = {m.ref: m for m in listing.models if m.provider == "moonshot"}
    assert sorted(found) == ["moonshot/kimi-k2.5", "moonshot/moonshot-v1-8k"]
    chat = found["moonshot/kimi-k2.5"]
    assert chat.price is not None and chat.ctx is not None and chat.tools


def test_moonshot_needs_its_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("MOONSHOT_API_KEY", raising=False)
    with pytest.raises(ModelConfigError, match="MOONSHOT_API_KEY"):
        ModelRouter(GolemSettings()).chat_model("moonshot/kimi-k2.5")


def test_moonshot_chats_through_its_openai_compatible_api() -> None:
    router = ModelRouter(GolemSettings(), keys=MemoryKeyStore({"moonshot": "sk-good"}))
    model = router.chat_model("moonshot/kimi-k2.5")
    assert isinstance(model, ChatOpenAI)
    assert model.model_name == "kimi-k2.5"
    assert model.openai_api_base == "https://api.moonshot.ai/v1"


async def test_a_recorded_reply_that_calls_a_tool_becomes_a_tool_call() -> None:
    @tool
    def read_file(path: str) -> str:
        """Read a file."""
        return path

    def answer(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/chat/completions"
        assert request.headers["authorization"] == "Bearer sk-good"
        body = json.loads(request.content)
        assert body["model"] == "kimi-k2.5"
        assert body["tools"][0]["function"]["name"] == "read_file"
        return httpx.Response(200, json=_recorded("moonshot-chat-tool-call.json"))

    router = ModelRouter(GolemSettings(), keys=MemoryKeyStore({"moonshot": "sk-good"}))
    built = router.chat_model("moonshot/kimi-k2.5")
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
