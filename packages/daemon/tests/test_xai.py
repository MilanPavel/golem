"""xAI: the model list, the key check, and a chat that calls a tool.

The responses in ``data/xai-*.json`` are recorded from xAI's API.
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
            HostedEntry("xai/grok-4.3", "grok-4.3", "b", ("general",)),
            HostedEntry("xai/grok-3-mini", "grok-3-mini", "b", ("general",)),
        ],
    )


async def test_the_key_is_checked_by_listing_the_models() -> None:
    seen: list[httpx.Request] = []

    def answer(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=_recorded("xai-models.json"))

    discovery = _discovery(httpx.MockTransport(answer))
    try:
        assert await discovery.check_key("xai", "xai-good") == 2
    finally:
        await discovery.aclose()
    assert str(seen[0].url) == "https://api.x.ai/v1/language-models"
    assert seen[0].headers["authorization"] == "Bearer xai-good"


async def test_a_key_that_does_not_exist_is_rejected() -> None:
    bad = httpx.Response(400, json=_recorded("xai-bad-key.json"))
    discovery = _discovery(httpx.MockTransport(lambda _r: bad))
    try:
        with pytest.raises(
            KeyRejected, match=r"xai rejected the key \(400 · Incorrect API key provided"
        ):
            await discovery.check_key("xai", "nope")
    finally:
        await discovery.aclose()


async def test_the_listed_models_have_prices_and_tools() -> None:
    store = MemoryKeyStore({"xai": "xai-good"})
    discovery = _discovery(
        httpx.MockTransport(lambda _r: httpx.Response(200, json=_recorded("xai-models.json"))),
        store,
    )
    try:
        listing = await discovery.list()
    finally:
        await discovery.aclose()
    found = {m.ref: m for m in listing.models if m.provider == "xai"}
    assert sorted(found) == ["xai/grok-3-mini", "xai/grok-4.3"]
    chat = found["xai/grok-4.3"]
    assert chat.price is not None and chat.ctx is not None and chat.tools


def test_xai_needs_its_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("XAI_API_KEY", raising=False)
    with pytest.raises(ModelConfigError, match="XAI_API_KEY"):
        ModelRouter(GolemSettings()).chat_model("xai/grok-4.3")


def test_xai_chats_through_its_openai_compatible_api() -> None:
    router = ModelRouter(GolemSettings(), keys=MemoryKeyStore({"xai": "xai-good"}))
    model = router.chat_model("xai/grok-4.3")
    assert isinstance(model, ChatOpenAI)
    assert model.model_name == "grok-4.3"
    assert model.openai_api_base == "https://api.x.ai/v1"
    assert model.stream_usage is True


async def test_a_recorded_reply_that_calls_a_tool_becomes_a_tool_call() -> None:
    @tool
    def read_file(path: str) -> str:
        """Read a file."""
        return path

    def answer(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/chat/completions"
        assert request.headers["authorization"] == "Bearer xai-good"
        body = json.loads(request.content)
        assert body["model"] == "grok-4.3"
        assert body["tools"][0]["function"]["name"] == "read_file"
        return httpx.Response(200, json=_recorded("xai-chat-tool-call.json"))

    router = ModelRouter(GolemSettings(), keys=MemoryKeyStore({"xai": "xai-good"}))
    built = router.chat_model("xai/grok-4.3")
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
