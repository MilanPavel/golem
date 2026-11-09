"""The option table, and the defaults a model brings."""

from __future__ import annotations

import httpx

from golem.models import options

NINE = {
    "temperature",
    "top_p",
    "top_k",
    "min_p",
    "repeat_penalty",
    "num_ctx",
    "num_predict",
    "seed",
    "keep_alive",
}


def test_the_table_covers_the_nine_options_with_sane_ranges() -> None:
    assert {row.name for row in options.OPTIONS} == NINE
    for row in options.OPTIONS:
        assert row.minimum < row.maximum
        assert row.step > 0
        assert row.short.endswith(".")
        assert len(row.long) > len(row.short)
        if isinstance(row.default, (int, float)):
            assert row.minimum <= row.default <= row.maximum


def test_a_model_s_own_parameters_are_read_and_the_rest_dropped() -> None:
    text = (
        'stop                           "<|im_end|>"\n'
        + "temperature                    0.6\n"
        + "top_k                          20.0\n"
        + "num_ctx                        32768\n"
        + "keep_alive                     10m\n"
        + "temperature                    0.7\n"
        + "top_p                          high\n"
    )
    assert options.parse_parameters(text) == {
        "temperature": 0.7,
        "top_k": 20,
        "num_ctx": 32768,
        "keep_alive": "10m",
    }


def test_a_default_comes_from_the_model_first_then_ollama() -> None:
    values = options.defaults({"temperature": 0.6, "top_k": 20})
    assert values["temperature"] == 0.6
    assert values["top_k"] == 20
    assert values["top_p"] == 0.9
    assert "seed" not in values
    assert options.defaults() == options.defaults(None)


async def test_the_model_parameters_come_from_api_show() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/show"
        return httpx.Response(200, json={"parameters": "temperature 0.6\nnum_ctx 8192"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        found = await options.model_parameters(client, "http://x", "qwen3:8b")
    assert found == {"temperature": 0.6, "num_ctx": 8192}


async def test_an_ollama_that_does_not_answer_gives_no_parameters() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        assert await options.model_parameters(client, "http://x", "qwen3:8b") == {}
