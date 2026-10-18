import os
from pathlib import Path

import pytest
from fakes import ScriptedChatModel
from langchain_anthropic import ChatAnthropic
from langchain_ollama import ChatOllama
from langchain_openai import ChatOpenAI

from golem.config import GolemSettings, ModelSettings, ProviderSettings, load_settings
from golem.models.router import ModelConfigError, ModelIdentity, ModelRouter


def test_injected_model_is_returned_for_the_profile() -> None:
    model = ScriptedChatModel(replies=["ok"])
    router = ModelRouter(model=model)
    assert router.profile_name == "remote"
    assert router.chat_model("remote") is model
    assert router.identity() == ModelIdentity(profile="remote", provider=None, name=None)


def test_injected_model_rejects_other_names() -> None:
    router = ModelRouter(model=ScriptedChatModel(replies=["ok"]))
    with pytest.raises(ModelConfigError, match="unknown model"):
        router.chat_model("other")


def test_a_profile_resolves_to_its_ref() -> None:
    settings = GolemSettings(
        default_model="qwen",
        models={"qwen": ModelSettings(model="ollama/qwen3:8b", ctx=32768)},
    )
    router = ModelRouter(settings)
    resolved = router.resolve("qwen")
    assert resolved.ref == "ollama/qwen3:8b"
    assert resolved.ctx == 32768
    assert router.profile_name == "qwen"
    assert router.identity() == ModelIdentity(profile="qwen", provider="ollama", name="qwen3:8b")


def test_a_ref_resolves_without_a_profile() -> None:
    router = ModelRouter(GolemSettings())
    assert router.identity("anthropic/claude-test") == ModelIdentity(
        profile="anthropic/claude-test", provider="anthropic", name="claude-test"
    )


def test_a_ref_splits_on_the_first_slash() -> None:
    resolved = ModelRouter(GolemSettings()).resolve("openrouter/qwen/qwen3-235b-a22b")
    assert resolved.provider_name == "openrouter"
    assert resolved.model_id == "qwen/qwen3-235b-a22b"


def test_every_resolvable_name_has_an_identity() -> None:
    settings = GolemSettings(
        default_model="qwen",
        models={
            "qwen": ModelSettings(model="ollama/qwen3:8b"),
            "sonnet": ModelSettings(model="anthropic/claude-test"),
        },
    )
    router = ModelRouter(settings)
    assert router.identity("sonnet") == ModelIdentity(
        profile="sonnet", provider="anthropic", name="claude-test"
    )
    assert router.identity("missing") == ModelIdentity(profile="missing", provider=None, name=None)


def test_unknown_name_is_rejected() -> None:
    with pytest.raises(ModelConfigError, match="unknown model: other"):
        ModelRouter(GolemSettings()).chat_model("other")


def test_unknown_provider_is_rejected() -> None:
    with pytest.raises(ModelConfigError, match="unknown model provider: nowhere"):
        ModelRouter(GolemSettings()).chat_model("nowhere/model")


def test_unconfigured_default_is_rejected() -> None:
    router = ModelRouter(GolemSettings())
    with pytest.raises(ModelConfigError, match="no model is configured"):
        router.chat_model(router.profile_name)


def test_ollama_is_native_and_passes_ctx() -> None:
    settings = GolemSettings(models={"qwen": ModelSettings(model="ollama/qwen3:8b", ctx=16384)})
    model = ModelRouter(settings).chat_model("qwen")
    assert isinstance(model, ChatOllama)
    assert model.model == "qwen3:8b"
    assert model.num_ctx == 16384
    assert model.base_url == "http://127.0.0.1:11434"


def test_ollama_without_ctx_keeps_the_server_default() -> None:
    model = ModelRouter(GolemSettings()).chat_model("ollama/qwen3:8b")
    assert isinstance(model, ChatOllama)
    assert model.num_ctx is None


def test_ollama_base_url_drops_the_openai_suffix() -> None:
    settings = GolemSettings(
        providers={"ollama": ProviderSettings(base_url="http://10.0.0.2:11434/v1")}
    )
    model = ModelRouter(settings).chat_model("ollama/qwen3:8b")
    assert isinstance(model, ChatOllama)
    assert model.base_url == "http://10.0.0.2:11434"


def test_anthropic_reads_its_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    model = ModelRouter(GolemSettings()).chat_model("anthropic/claude-test")
    assert isinstance(model, ChatAnthropic)
    assert model.model == "claude-test"


def test_missing_anthropic_key_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    with pytest.raises(ModelConfigError, match="ANTHROPIC_API_KEY"):
        ModelRouter(GolemSettings()).chat_model("anthropic/claude-test")


def test_missing_openai_key_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    with pytest.raises(ModelConfigError, match="OPENAI_API_KEY"):
        ModelRouter(GolemSettings()).chat_model("openai/gpt-test")


def test_openrouter_preset_needs_its_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    router = ModelRouter(GolemSettings())
    with pytest.raises(ModelConfigError, match="OPENROUTER_API_KEY"):
        router.chat_model("openrouter/qwen/qwen3-235b-a22b")
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or")
    model = router.chat_model("openrouter/qwen/qwen3-235b-a22b")
    assert isinstance(model, ChatOpenAI)
    assert model.model_name == "qwen/qwen3-235b-a22b"
    assert model.openai_api_base == "https://openrouter.ai/api/v1"


def test_lmstudio_preset_needs_no_key() -> None:
    model = ModelRouter(GolemSettings()).chat_model("lmstudio/gemma")
    assert isinstance(model, ChatOpenAI)
    assert model.openai_api_base == "http://127.0.0.1:1234/v1"


def test_a_new_provider_is_openai_compatible(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MY_KEY", "secret")
    settings = GolemSettings(
        providers={"mine": ProviderSettings(base_url="http://127.0.0.1:9/v1", api_key_env="MY_KEY")}
    )
    model = ModelRouter(settings).chat_model("mine/model-x")
    assert isinstance(model, ChatOpenAI)
    assert model.openai_api_base == "http://127.0.0.1:9/v1"


def test_a_new_provider_without_base_url_is_rejected() -> None:
    settings = GolemSettings(providers={"mine": ProviderSettings()})
    with pytest.raises(ModelConfigError, match="mine needs base_url"):
        ModelRouter(settings).chat_model("mine/model-x")


def test_legacy_ollama_settings_become_a_native_profile() -> None:
    settings = GolemSettings(model_provider="openai_compat", model_name="qwen3.5:4b")
    router = ModelRouter(settings)
    assert router.identity() == ModelIdentity(
        profile="remote", provider="ollama", name="qwen3.5:4b"
    )
    assert isinstance(router.chat_model("remote"), ChatOllama)


def test_legacy_settings_keep_a_custom_server() -> None:
    settings = GolemSettings(
        model_provider="openai_compat",
        model_name="gemma4:e4b",
        model_base_url="http://127.0.0.1:9/v1",
    )
    model = ModelRouter(settings).chat_model("remote")
    assert isinstance(model, ChatOpenAI)
    assert model.model_name == "gemma4:e4b"
    assert model.openai_api_base == "http://127.0.0.1:9/v1"


def test_legacy_profile_uses_the_old_profile_name(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    settings = GolemSettings(
        model_profile="work", model_provider="anthropic", model_name="claude-test"
    )
    router = ModelRouter(settings)
    assert router.profile_name == "work"
    assert isinstance(router.chat_model("work"), ChatAnthropic)


def test_a_named_profile_wins_over_the_legacy_one() -> None:
    settings = GolemSettings(
        model_provider="openai_compat",
        model_name="old",
        models={"remote": ModelSettings(model="ollama/new")},
    )
    assert ModelRouter(settings).resolve("remote").model_id == "new"


def test_default_model_wins_over_the_legacy_profile() -> None:
    settings = GolemSettings(
        default_model="ollama/qwen3:8b", model_provider="openai_compat", model_name="old"
    )
    router = ModelRouter(settings)
    assert router.profile_name == "ollama/qwen3:8b"
    assert router.resolve("remote").model_id == "old"


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def _touch_later(path: Path, text: str) -> None:
    before = path.stat().st_mtime_ns
    _write(path, text)
    os.utime(path, ns=(before + 1_000_000_000, before + 1_000_000_000))


def test_config_edits_reload_without_a_restart(tmp_path: Path) -> None:
    config = tmp_path / "config.toml"
    _write(config, '[models.qwen]\nmodel = "ollama/qwen3:8b"\n')
    router = ModelRouter(load_settings(home=tmp_path, project_dir=tmp_path), home=tmp_path)
    assert router.resolve("qwen").model_id == "qwen3:8b"
    with pytest.raises(ModelConfigError):
        router.resolve("sonnet")
    _touch_later(
        config,
        '[models.qwen]\nmodel = "ollama/qwen3:8b"\n'
        '[models.sonnet]\nmodel = "anthropic/claude-test"\n',
    )
    assert router.resolve("sonnet").ref == "anthropic/claude-test"


def test_an_invalid_edit_keeps_the_last_good_models(tmp_path: Path) -> None:
    config = tmp_path / "config.toml"
    _write(config, '[models.qwen]\nmodel = "ollama/qwen3:8b"\n')
    router = ModelRouter(load_settings(home=tmp_path, project_dir=tmp_path), home=tmp_path)
    _touch_later(config, '[models.qwen]\nmodel = "no-slash"\n')
    assert router.resolve("qwen").model_id == "qwen3:8b"
