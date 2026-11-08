from fakes import ScriptedChatModel

from golem.config import GolemSettings, ModelSettings
from golem.models.router import ModelRouter
from golem.models.window import ContextWindow, resolve_window


class _Listed:
    def known_ctx(self, ref: str) -> int | None:
        return 123456 if ref == "anthropic/claude-test" else None


def _router() -> ModelRouter:
    return ModelRouter(
        GolemSettings(
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
    class Knows:
        def known_ctx(self, ref: str) -> int | None:
            return 131072

    assert resolve_window(_router(), "ollama/llama3.2:3b", Knows()) == ContextWindow()


def test_an_unknown_name_and_a_test_double_router_have_no_window() -> None:
    assert resolve_window(_router(), "nope", _Listed()) == ContextWindow()
    double = ModelRouter(model=ScriptedChatModel(replies=["x"]))
    assert resolve_window(double, "anything", _Listed()) == ContextWindow()
