import pytest
from fakes import ScriptedChatModel

from golem.config import GolemSettings, ModelOptions, ModelSettings, OllamaSettings
from golem.models.ollama_chat import OllamaChat
from golem.models.router import ModelRouter
from golem.models.window import ContextWindow, resolve_window


class _Listed:
    def __init__(self, loaded: int | None = None, modelfile: int | None = None) -> None:
        self.loaded = loaded
        self.modelfile = modelfile

    def known_ctx(self, ref: str) -> int | None:
        return 123456 if ref == "anthropic/claude-test" else None

    def modelfile_num_ctx(self, ref: str) -> int | None:
        return self.modelfile

    def loaded_ctx(self, ref: str) -> int | None:
        return self.loaded


def _router(saved: int | None = None) -> ModelRouter:
    return ModelRouter(
        GolemSettings(
            ollama=OllamaSettings(
                models={} if saved is None else {"qwen3:8b": ModelOptions(num_ctx=saved)}
            ),
            default_model="qwen",
            models={
                "qwen": ModelSettings(model="ollama/qwen3:8b", ctx=16384),
                "opus": ModelSettings(model="anthropic/claude-test", ctx=200000),
            },
        )
    )


def test_an_ollama_profile_with_ctx_sends_it_and_has_that_window() -> None:
    assert resolve_window(_router(), "qwen", None) == ContextWindow(16384, 16384)


def test_a_hosted_profile_has_its_ctx_and_no_num_ctx() -> None:
    assert resolve_window(_router(), "opus", None) == ContextWindow(200000, None)


def test_a_bare_hosted_ref_takes_the_listed_window() -> None:
    assert resolve_window(_router(), "anthropic/claude-test", _Listed()) == ContextWindow(
        123456, None
    )
    assert resolve_window(_router(), "anthropic/other", _Listed()) == ContextWindow()


def test_a_bare_ollama_ref_has_no_window_even_when_listed() -> None:
    class Knows(_Listed):
        def known_ctx(self, ref: str) -> int | None:
            return 131072

    assert resolve_window(_router(), "ollama/llama3.2:3b", Knows()) == ContextWindow()


def test_an_unknown_name_and_a_test_double_router_have_no_window() -> None:
    assert resolve_window(_router(), "nope", _Listed()) == ContextWindow()
    double = ModelRouter(model=ScriptedChatModel(replies=["x"]))
    assert resolve_window(double, "anything", _Listed()) == ContextWindow()


def test_a_profile_ctx_wins_over_what_ollama_says() -> None:
    listed = _Listed(loaded=8192, modelfile=4096)
    assert resolve_window(_router(), "qwen", listed) == ContextWindow(16384, 16384)


def test_a_saved_num_ctx_wins_over_the_profile_ctx_and_ollama() -> None:
    listed = _Listed(loaded=8192, modelfile=4096)
    assert resolve_window(_router(32768), "qwen", listed) == ContextWindow(32768, 32768)
    assert resolve_window(_router(32768), "ollama/qwen3:8b", listed) == ContextWindow(32768, 32768)


def test_a_session_override_wins_over_the_saved_num_ctx() -> None:
    got = resolve_window(_router(32768), "qwen", _Listed(), overrides={"num_ctx": 8192})
    assert got == ContextWindow(8192, 8192)


@pytest.mark.parametrize(
    ("saved", "overrides"),
    [(None, None), (32768, None), (32768, {"num_ctx": 8192}), (None, {"num_ctx": 4096})],
)
def test_the_window_matches_the_num_ctx_chat_model_sends(
    saved: int | None, overrides: dict[str, float | str] | None
) -> None:
    router = _router(saved)
    model = router.chat_model("qwen", overrides)
    assert isinstance(model, OllamaChat)
    got = resolve_window(router, "qwen", _Listed(loaded=1, modelfile=2), overrides=overrides)
    assert got.num_ctx == model.num_ctx
    assert got.window == model.num_ctx


def test_a_loaded_window_is_exact_and_not_sent() -> None:
    listed = _Listed(loaded=8192, modelfile=4096)
    assert resolve_window(_router(), "ollama/llama3.2:3b", listed) == ContextWindow(
        8192, None, False
    )


def test_a_modelfile_window_is_estimated() -> None:
    listed = _Listed(loaded=None, modelfile=4096)
    assert resolve_window(_router(), "ollama/llama3.2:3b", listed) == ContextWindow(
        4096, None, True
    )


def test_an_ollama_model_with_nothing_known_has_no_window() -> None:
    assert resolve_window(_router(), "ollama/llama3.2:3b", _Listed()) == ContextWindow()
    assert resolve_window(_router(), "ollama/llama3.2:3b", None) == ContextWindow()
