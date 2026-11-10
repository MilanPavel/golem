"""The option table, and the defaults a model brings."""

from __future__ import annotations

import httpx
import pytest

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
    "think",
}


def test_the_table_covers_the_ten_options_with_sane_ranges() -> None:
    assert {row.name for row in options.OPTIONS} == NINE
    for row in options.OPTIONS:
        if row.kind != "choice":
            assert row.minimum < row.maximum
            assert row.step > 0
        assert row.short.endswith(".")
        assert len(row.long) > len(row.short)
        if isinstance(row.default, (int, float)) and row.kind != "choice":
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
    assert "num_ctx" not in values
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


def test_a_value_is_checked_against_the_table() -> None:
    assert options.validate("top_k", 20) == 20
    assert options.validate("temperature", 0.4) == 0.4
    assert options.validate("keep_alive", "10m") == "10m"
    assert options.validate("keep_alive", -1) == -1
    for name, value in (
        ("temperature", 3),
        ("top_k", 2.5),
        ("temperature", True),
        ("keep_alive", "soon"),
        ("nope", 1),
    ):
        with pytest.raises(ValueError):
            options.validate(name, value)


def test_num_ctx_has_no_fixed_default_and_a_modelfile_one_is_kept() -> None:
    assert "num_ctx" not in options.defaults()
    assert options.defaults({"num_ctx": 8192})["num_ctx"] == 8192
    row = next(r for r in options.OPTIONS if r.name == "num_ctx")
    assert row.default is None


def test_think_is_checked_against_the_values_of_the_model() -> None:
    assert options.validate("think", "on", ["off", "on"]) == "on"
    assert options.validate("think", "high", ["low", "medium", "high"]) == "high"
    assert options.validate("think", "medium") == "medium"
    with pytest.raises(ValueError, match="off, on"):
        options.validate("think", "high", ["off", "on"])
    with pytest.raises(ValueError, match="does not take think"):
        options.validate("think", "on", [])
    for bad in (True, 1, None):
        with pytest.raises(ValueError):
            options.validate("think", bad, ["off", "on"])


def test_a_bool_is_still_rejected_for_a_number_and_a_time() -> None:
    for name in ("temperature", "top_k", "keep_alive"):
        with pytest.raises(ValueError):
            options.validate(name, True)


def test_think_has_no_default_and_no_range() -> None:
    row = options.spec("think")
    assert row is not None
    assert row.kind == "choice"
    assert row.default is None
    assert "think" not in options.defaults()
    assert "tokens" in row.long


def test_model_options_load_a_saved_think() -> None:
    from golem.config import ModelOptions

    assert ModelOptions.model_validate({"think": "off"}).think == "off"
    assert ModelOptions().think is None
    with pytest.raises(ValueError):
        ModelOptions.model_validate({"think": "maybe"})
