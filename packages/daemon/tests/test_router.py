import pytest
from fakes import ScriptedChatModel
from langchain_openai import ChatOpenAI

from golem.config import GolemSettings
from golem.models.router import ModelConfigError, ModelRouter


def test_injected_model_is_returned_for_the_profile() -> None:
    model = ScriptedChatModel(replies=["ok"])
    router = ModelRouter(model=model)
    assert router.profile_name == "remote"
    assert router.chat_model("remote") is model


def test_unknown_profile_is_rejected() -> None:
    router = ModelRouter(model=ScriptedChatModel(replies=["ok"]))
    with pytest.raises(ModelConfigError, match="unknown model profile"):
        router.chat_model("other")


def test_missing_api_key_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    settings = GolemSettings(model_provider="anthropic", model_name="claude-test")
    router = ModelRouter(settings)
    with pytest.raises(ModelConfigError, match="ANTHROPIC_API_KEY"):
        router.chat_model("remote")


def test_missing_openai_key_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    settings = GolemSettings(model_provider="openai", model_name="gpt-test")
    router = ModelRouter(settings)
    with pytest.raises(ModelConfigError, match="OPENAI_API_KEY"):
        router.chat_model("remote")


def test_openai_compat_needs_no_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    settings = GolemSettings(model_provider="openai_compat", model_name="qwen3.5:4b")
    model = ModelRouter(settings).chat_model("remote")
    assert isinstance(model, ChatOpenAI)
    assert model.model_name == "qwen3.5:4b"
    assert model.openai_api_base == "http://127.0.0.1:11434/v1"


def test_openai_compat_uses_the_configured_base_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    settings = GolemSettings(
        model_provider="openai_compat",
        model_name="gemma4:e4b",
        model_base_url="http://127.0.0.1:9/v1",
    )
    model = ModelRouter(settings).chat_model("remote")
    assert isinstance(model, ChatOpenAI)
    assert model.model_name == "gemma4:e4b"
    assert model.openai_api_base == "http://127.0.0.1:9/v1"


def test_openai_compat_without_a_name_is_rejected() -> None:
    settings = GolemSettings(model_provider="openai_compat")
    with pytest.raises(ModelConfigError, match="not configured"):
        ModelRouter(settings).chat_model("remote")


def test_unconfigured_model_is_rejected() -> None:
    router = ModelRouter(GolemSettings())
    with pytest.raises(ModelConfigError, match="not configured"):
        router.chat_model("remote")
