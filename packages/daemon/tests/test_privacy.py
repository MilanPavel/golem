"""Local-only folders: the folder test, the project flag, the router backstop, the roles."""

from __future__ import annotations

from pathlib import Path

import pytest

from golem.config import GolemSettings, RoleSettings, load_settings
from golem.models.privacy import is_local_only
from golem.models.project_privacy import project_local_only
from golem.models.roles import for_role
from golem.models.router import ModelConfigError, ModelRouter
from golem.models.tiers import Tier


def _dir(path: Path) -> str:
    path.mkdir(parents=True, exist_ok=True)
    return str(path)


def test_an_exact_folder_and_a_subfolder_are_local_only(tmp_path: Path) -> None:
    work = _dir(tmp_path / "work")
    assert is_local_only(work, [work], False)
    assert is_local_only(_dir(tmp_path / "work" / "a" / "b"), [work], False)


def test_a_sibling_with_the_same_prefix_is_not(tmp_path: Path) -> None:
    work = _dir(tmp_path / "work")
    assert not is_local_only(_dir(tmp_path / "work2"), [work], False)
    assert not is_local_only(_dir(tmp_path / "wor"), [work], False)


def test_a_folder_above_a_listed_one_is_not(tmp_path: Path) -> None:
    work = _dir(tmp_path / "work")
    assert not is_local_only(str(tmp_path), [work], False)


def test_a_home_relative_entry_is_expanded(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    here = _dir(tmp_path / "work" / "x")
    assert is_local_only(here, ["~/work"], False)
    assert is_local_only("~/work/x", ["~/work"], False)
    assert not is_local_only(here, ["~/other"], False)


def test_a_symlinked_path_counts_by_its_real_path(tmp_path: Path) -> None:
    work = _dir(tmp_path / "work")
    _dir(tmp_path / "work" / "x")
    link = tmp_path / "link"
    link.symlink_to(work)
    # A link into the private folder is the private folder ...
    assert is_local_only(str(link / "x"), [work], False)
    # ... and a listed link names the folder it points to.
    assert is_local_only(str(tmp_path / "work" / "x"), [str(link)], False)


def test_no_folder_is_never_local_only() -> None:
    assert not is_local_only(None, ["/a"], False)
    assert not is_local_only(None, [], False)


def test_the_project_flag_alone_is_enough(tmp_path: Path) -> None:
    assert is_local_only(str(tmp_path), [], True)
    assert is_local_only(None, [], True)


def test_blank_and_relative_entries_match_nothing(tmp_path: Path) -> None:
    assert not is_local_only(str(tmp_path), ["", "  ", "work", "."], False)


def _project(folder: Path, text: str) -> str:
    (folder / ".golem").mkdir(parents=True, exist_ok=True)
    (folder / ".golem" / "config.toml").write_text(text)
    return str(folder)


def test_a_project_file_with_the_flag_is_read_for_the_folder_and_below(tmp_path: Path) -> None:
    root = tmp_path / "repo"
    _project(root, "[routing]\nlocal_only = true\n")
    assert project_local_only(str(root))
    assert project_local_only(_dir(root / "src" / "deep"))
    assert not project_local_only(_dir(tmp_path / "elsewhere"))
    assert not project_local_only(None)


def test_only_the_boolean_true_is_a_flag(tmp_path: Path) -> None:
    assert not project_local_only(_project(tmp_path / "a", "[routing]\nlocal_only = false\n"))
    # A list is the user's key, and a project cannot use it.
    assert not project_local_only(_project(tmp_path / "b", '[routing]\nlocal_only = ["/x"]\n'))
    assert not project_local_only(_project(tmp_path / "c", '[routing]\nlocal_only = "true"\n'))
    assert not project_local_only(_project(tmp_path / "d", "[routing]\nmode = 'auto'\n"))
    assert not project_local_only(_project(tmp_path / "e", "this is not toml ["))


def test_a_changed_project_file_is_read_again(tmp_path: Path) -> None:
    here = _project(tmp_path / "repo", "[routing]\nlocal_only = false\n")
    assert not project_local_only(here)
    _project(tmp_path / "repo", "[routing]\nlocal_only = true\n# changed\n")
    assert project_local_only(here)


def test_the_flag_does_not_break_loading_a_project_layer(tmp_path: Path) -> None:
    home = _dir(tmp_path / "home")
    project = Path(_project(tmp_path / "repo", "[routing]\nlocal_only = true\nmode = 'auto'\n"))
    settings = load_settings(home=Path(home), project_dir=project)
    assert settings.routing.local_only == []
    assert settings.routing.mode == "auto"


def _router() -> ModelRouter:
    return ModelRouter(GolemSettings(default_model="ollama/qwen3:8b"))


def test_a_hosted_model_is_refused_for_a_local_only_chat(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    router = _router()
    for key in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY"):
        monkeypatch.setenv(key, "sk-test")
    for ref in ("anthropic/claude-opus", "openai/gpt-5"):
        with pytest.raises(ModelConfigError) as caught:
            router.chat_model(ref, local_only=True)
        assert caught.value.code == "local_only"
        assert str(caught.value) == f"this chat stays on this Mac: {ref} is a hosted model"
    # Without the flag the same model is built, as before.
    assert router.chat_model("anthropic/claude-opus") is not None


def test_the_refusal_comes_before_the_missing_key() -> None:
    with pytest.raises(ModelConfigError) as caught:
        _router().chat_model("deepseek/deepseek-chat", local_only=True)
    assert caught.value.code == "local_only"


def test_an_ollama_model_passes_for_a_local_only_chat() -> None:
    assert _router().chat_model("ollama/qwen3:8b", local_only=True) is not None


def test_an_unknown_name_still_fails_as_unknown() -> None:
    with pytest.raises(ModelConfigError) as caught:
        _router().chat_model("mystery", local_only=True)
    assert caught.value.code is None


_TIERS: dict[str, Tier] = {
    "ollama/qwen": "local",
    "ollama/tiny": "local",
    "anthropic/opus": "frontier",
    "deepseek/chat": "budget",
}


def _role(session: str, settings: RoleSettings | None = None) -> tuple[str, str]:
    chosen = for_role(
        "titles",
        session_profile=session,
        settings=settings or RoleSettings(),
        tier_of_profile=_TIERS.get,
        budget_models=("deepseek/chat",),
        local_only=True,
    )
    return chosen.profile, chosen.reason


def test_a_local_only_role_never_takes_a_budget_model() -> None:
    assert _role("ollama/qwen") == ("ollama/qwen", "session is local")
    assert _role("anthropic/opus") == ("anthropic/opus", "no local model")


def test_a_local_only_role_takes_a_configured_model_only_when_it_is_local() -> None:
    assert _role("ollama/qwen", RoleSettings(titles="ollama/tiny")) == (
        "ollama/tiny",
        "configured",
    )
    assert _role("ollama/qwen", RoleSettings(titles="deepseek/chat")) == (
        "ollama/qwen",
        "session is local",
    )
    assert _role("anthropic/opus", RoleSettings(titles="deepseek/chat")) == (
        "anthropic/opus",
        "no local model",
    )
