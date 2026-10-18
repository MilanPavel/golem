from pathlib import Path

import httpx
import pytest

from golem.models import hardware, prices
from golem.models.catalog import load_local_catalog
from golem.models.prices import PriceBook, trim


def test_trim_keeps_golem_providers_and_fields() -> None:
    raw = {
        "sample_spec": {"note": "not a model"},
        "claude-x": {
            "litellm_provider": "anthropic",
            "mode": "chat",
            "input_cost_per_token": 1e-06,
            "extra": 1,
        },
        "bedrock/claude-x": {"litellm_provider": "bedrock", "mode": "chat"},
    }
    assert trim(raw) == {
        "claude-x": {"litellm_provider": "anthropic", "mode": "chat", "input_cost_per_token": 1e-06}
    }


def test_a_bare_id_must_belong_to_the_provider() -> None:
    book = PriceBook(
        {
            "llama-x": {
                "litellm_provider": "groq",
                "input_cost_per_token": 1e-06,
                "output_cost_per_token": 1e-06,
            },
            "together_ai/meta/llama": {
                "litellm_provider": "together_ai",
                "input_cost_per_token": 2e-06,
                "output_cost_per_token": 2e-06,
            },
        }
    )
    assert book.lookup("openai", "llama-x") is None
    found = book.lookup("together", "meta/llama")
    assert found is not None and found.price is not None
    assert found.price.input == pytest.approx(2.0)


@pytest.mark.parametrize(
    ("provider", "litellm_provider"),
    [
        ("anthropic", "anthropic"),
        ("openai", "openai"),
        ("groq", "groq"),
        ("together", "together_ai"),
    ],
)
def test_every_bundled_chat_model_resolves_from_a_golem_ref(
    provider: str, litellm_provider: str
) -> None:
    book = PriceBook.bundled()
    entries = book._entries  # pyright: ignore[reportPrivateUsage]
    keys = [
        key
        for key, entry in entries.items()
        if entry.get("litellm_provider") == litellm_provider
        and entry.get("mode") == "chat"
        and "input_cost_per_token" in entry
        and "output_cost_per_token" in entry
    ]
    assert keys, f"the bundled copy has no {litellm_provider} chat models"
    prefix = f"{litellm_provider}/"
    for key in keys:
        model_id = key.removeprefix(prefix)
        found = book.lookup(provider, model_id)
        assert found is not None and found.price is not None, key


def test_the_bundled_copy_prices_a_current_anthropic_model() -> None:
    found = PriceBook.bundled().lookup("anthropic", "claude-sonnet-4-5")
    assert found is not None and found.price is not None
    assert found.price.input > 0 and found.ctx is not None


async def test_fetch_caches_a_trimmed_copy(tmp_path: Path) -> None:
    body = {
        "gpt-x": {
            "litellm_provider": "openai",
            "mode": "chat",
            "input_cost_per_token": 1e-06,
            "output_cost_per_token": 2e-06,
        }
    }
    transport = httpx.MockTransport(lambda _request: httpx.Response(200, json=body))
    async with httpx.AsyncClient(transport=transport) as client:
        book = await prices.fetch(client, tmp_path, now=50.0)
    assert book.is_fresh(60.0)
    loaded = PriceBook.load(tmp_path)
    assert loaded.fetched_at == 50.0
    found = loaded.lookup("openai", "gpt-x")
    assert (
        found is not None and found.price is not None and found.price.output == pytest.approx(2.0)
    )


def test_a_missing_cache_falls_back_to_the_bundled_copy(tmp_path: Path) -> None:
    assert PriceBook.load(tmp_path).fetched_at is None


@pytest.mark.parametrize(
    ("size_gb", "ram_gb", "ctx", "expected"),
    [
        (5.2, 36.0, None, "fits"),
        (5.2, 36.0, 32768, "fits"),
        (18.6, 36.0, None, "tight"),
        (40.0, 36.0, None, "too_big"),
        (3.3, 8.0, None, "tight"),
        (5.2, 8.0, None, "too_big"),
        (13.8, 16.0, None, "too_big"),
    ],
)
def test_fit(size_gb: float, ram_gb: float, ctx: int | None, expected: str) -> None:
    assert hardware.fit(size_gb, ram_gb, ctx) == expected


def test_total_ram_is_known_here() -> None:
    ram = hardware.total_ram_gb()
    assert ram is not None and ram > 1


def test_the_local_catalog_is_sorted_by_size_and_names_ollama_refs() -> None:
    entries = load_local_catalog()
    assert len(entries) >= 8
    assert [entry.size_gb for entry in entries] == sorted(entry.size_gb for entry in entries)
    assert all(entry.ref.startswith("ollama/") for entry in entries)
    assert len({entry.ref for entry in entries}) == len(entries)
