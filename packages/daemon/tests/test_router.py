import os
from pathlib import Path

import pytest
from fakes import ScriptedChatModel
from langchain_anthropic import ChatAnthropic
from langchain_ollama import ChatOllama
from langchain_openai import ChatOpenAI
from pydantic import SecretStr

from golem.config import GolemSettings, ModelSettings, ProviderSettings, load_settings
from golem.models.keys import KeyStoreError, MemoryKeyStore
from golem.models.router import ModelConfigError, ModelIdentity, ModelRouter


class _BrokenStore:
    def get(self, provider: str) -> str | None:
        raise KeyStoreError("keychain is unavailable: locked")

    def set(self, provider: str, key: str) -> None:
        raise KeyStoreError("keychain is unavailable: locked")

    def delete(self, provider: str) -> bool:
        raise KeyStoreError("keychain is unavailable: locked")


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
    resolved = ModelRouter(GolemSettings()).resolve("ollama/library/qwen3")
    assert resolved.provider_name == "ollama"
    assert resolved.model_id == "library/qwen3"


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
    assert router.default is None
    with pytest.raises(ModelConfigError, match=r"^no model chosen yet$"):
        router.chat_model(router.profile_name)


def test_a_session_made_before_a_default_uses_it_once_chosen() -> None:
    settings = GolemSettings(default_model="ollama/qwen3:8b")
    assert ModelRouter(settings).resolve("remote").ref == "ollama/qwen3:8b"


def test_an_old_config_with_model_profile_remote_still_loads() -> None:
    settings = GolemSettings(model_profile="remote", model_provider="anthropic", model_name="old")
    router = ModelRouter(settings)
    assert router.default == "remote"
    assert router.resolve("remote").ref == "anthropic/old"


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


def test_a_stored_key_is_used_when_the_env_has_none(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    router = ModelRouter(GolemSettings(), keys=MemoryKeyStore({"anthropic": "sk-stored"}))
    model = router.chat_model("anthropic/claude-test")
    assert isinstance(model, ChatAnthropic)
    assert model.anthropic_api_key.get_secret_value() == "sk-stored"


def test_the_env_wins_over_a_stored_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-env")
    router = ModelRouter(GolemSettings(), keys=MemoryKeyStore({"anthropic": "sk-stored"}))
    model = router.chat_model("anthropic/claude-test")
    assert isinstance(model, ChatAnthropic)
    assert model.anthropic_api_key.get_secret_value() == "sk-env"


def test_a_missing_key_names_login_and_the_env_var(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    router = ModelRouter(GolemSettings(), keys=MemoryKeyStore())
    with pytest.raises(ModelConfigError, match=r"needs key: /login anthropic .*ANTHROPIC_API_KEY"):
        router.chat_model("anthropic/claude-test")


def test_an_unreadable_store_is_a_config_error(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    router = ModelRouter(GolemSettings(), keys=_BrokenStore())
    with pytest.raises(ModelConfigError, match="keychain is unavailable"):
        router.chat_model("anthropic/claude-test")


def test_a_custom_provider_uses_a_stored_key() -> None:
    settings = GolemSettings(providers={"xai": ProviderSettings(base_url="http://127.0.0.1:9/v1")})
    router = ModelRouter(settings, keys=MemoryKeyStore({"xai": "sk-xai"}))
    model = router.chat_model("xai/model-x")
    assert isinstance(model, ChatOpenAI)
    assert isinstance(model.openai_api_key, SecretStr)
    assert model.openai_api_key.get_secret_value() == "sk-xai"


def test_key_statuses_report_where_each_key_is(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "sk-env")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    router = ModelRouter(GolemSettings(), keys=MemoryKeyStore({"anthropic": "sk-stored"}))
    statuses = {status.provider: status for status in router.key_statuses()}
    assert statuses["anthropic"].source == "keychain"
    assert statuses["openai"].source == "env"
    assert not statuses["ollama"].takes_key
    assert list(statuses) == sorted(statuses)


def test_key_statuses_list_the_six_providers_and_ollama() -> None:
    statuses = {s.provider: s for s in ModelRouter(GolemSettings()).key_statuses()}
    assert sorted(statuses) == [
        "anthropic",
        "deepseek",
        "google",
        "moonshot",
        "ollama",
        "openai",
        "xai",
    ]
    assert {name: s.env_var for name, s in statuses.items() if s.takes_key} == {
        "anthropic": "ANTHROPIC_API_KEY",
        "deepseek": "DEEPSEEK_API_KEY",
        "google": "GOOGLE_API_KEY",
        "moonshot": "MOONSHOT_API_KEY",
        "openai": "OPENAI_API_KEY",
        "xai": "XAI_API_KEY",
    }


def test_missing_openai_key_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    with pytest.raises(ModelConfigError, match="OPENAI_API_KEY"):
        ModelRouter(GolemSettings()).chat_model("openai/gpt-test")


def test_the_removed_providers_are_gone() -> None:
    for name in ("openrouter", "groq", "together", "lmstudio"):
        assert name not in ModelRouter(GolemSettings()).providers()
        with pytest.raises(ModelConfigError, match="unknown model provider"):
            ModelRouter(GolemSettings()).resolve(f"{name}/some-model")


def test_an_unknown_provider_lists_the_six() -> None:
    with pytest.raises(ModelConfigError) as caught:
        ModelRouter(GolemSettings()).resolve("groq/llama")
    assert "openai, anthropic, google, deepseek, xai, moonshot" in str(caught.value)


def test_a_provider_section_for_another_name_is_rejected() -> None:
    with pytest.raises(
        ValueError, match=r"unknown model provider: groq\. Choose one of .*moonshot"
    ):
        GolemSettings(providers={"groq": ProviderSettings(base_url="http://127.0.0.1:9/v1")})


def test_a_new_provider_is_openai_compatible(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MY_KEY", "secret")
    settings = GolemSettings(
        providers={"xai": ProviderSettings(base_url="http://127.0.0.1:9/v1", api_key_env="MY_KEY")}
    )
    model = ModelRouter(settings).chat_model("xai/model-x")
    assert isinstance(model, ChatOpenAI)
    assert model.openai_api_base == "http://127.0.0.1:9/v1"


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
