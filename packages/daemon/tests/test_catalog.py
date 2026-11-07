from __future__ import annotations

from golem.config import HOSTED_PROVIDERS
from golem.models.catalog import (
    CATEGORIES,
    HostedEntry,
    hosted_problems,
    load_hosted_catalog,
    load_local_catalog,
)
from golem.models.prices import PriceBook


def test_every_hosted_provider_has_current_entries_and_the_schema_check_passes() -> None:
    entries = load_hosted_catalog()
    assert hosted_problems(entries) == []
    for provider in HOSTED_PROVIDERS:
        assert sum(entry.provider == provider for entry in entries) >= 2


def test_each_hosted_entry_has_a_label_a_blurb_and_known_categories() -> None:
    for entry in load_hosted_catalog():
        assert entry.label and entry.blurb
        assert entry.categories
        assert set(entry.categories) <= set(CATEGORIES)


def test_each_hosted_entry_is_a_chat_model_that_calls_tools_in_the_bundled_prices() -> None:
    book = PriceBook.bundled()
    for entry in load_hosted_catalog():
        provider, _, model = entry.ref.partition("/")
        info = book.lookup(provider, model)
        assert info is not None, f"{entry.ref} has no price entry"
        assert info.mode == "chat", entry.ref
        assert info.tools is True, entry.ref
        assert info.ctx is not None, entry.ref


def test_the_schema_check_names_what_is_wrong() -> None:
    good = load_hosted_catalog()
    bad = [
        HostedEntry("openrouter/x", "X", "one line", ("general",)),
        HostedEntry("openai/gpt", "G", "", ("magic",)),
        HostedEntry("openai/gpt", "G", "one line", ()),
    ]
    problems = hosted_problems([*good, *bad])
    assert any("openrouter/x" in line and "hosted provider" in line for line in problems)
    assert any("openai/gpt" in line and "blurb" in line for line in problems)
    assert any("unknown category 'magic'" in line for line in problems)
    assert any("openai/gpt: listed twice" in line for line in problems)
    assert any("openai/gpt: no categories" in line for line in problems)
    without = [entry for entry in good if entry.provider != "anthropic"]
    assert "anthropic: no entries" in hosted_problems(without)


def test_local_and_hosted_entries_share_one_file_without_mixing() -> None:
    assert all(entry.ref.startswith("ollama/") for entry in load_local_catalog())
    assert not any(entry.ref.startswith("ollama/") for entry in load_hosted_catalog())
