"""web_search: DuckDuckGo's HTML page as numbered results, and the host as the subject.

``data/duckduckgo-results.html`` has the markup of a real answer, cut to three results.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from pathlib import Path

import httpx
import pytest

from golem import __version__
from golem.config import WebSettings
from golem.permissions.policy import describe, rule_for
from golem.tools import default_registry, search_duckduckgo
from golem.tools.registry import Network, ToolContext, ToolError, ToolResult
from golem.tools.search import SEARCH_NOTE
from golem.tools.search_duckduckgo import MIN_GAP_SECONDS, Spacer

PAGE = (Path(__file__).parent / "data" / "duckduckgo-results.html").read_text("utf-8")


@pytest.fixture(autouse=True)
def _no_gap(monkeypatch: pytest.MonkeyPatch) -> None:
    """Searches in these tests do not wait for each other."""
    monkeypatch.setattr(search_duckduckgo, "SPACER", Spacer(gap=0))


def _ctx(handler: Callable[[httpx.Request], httpx.Response], **web: object) -> ToolContext:
    network = Network(transport=httpx.MockTransport(handler))
    return ToolContext(root=None, web=WebSettings.model_validate(web), network=network)


async def _search(ctx: ToolContext, **args: object) -> ToolResult:
    raw = {"query": "python asyncio tutorial", **args}
    return await default_registry().call("web_search", raw, ctx)


async def test_results_are_numbered_with_unwrapped_urls_and_snippets() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, html=PAGE)

    result = await _search(_ctx(handler))
    request = seen[0]
    assert request.url.host == "html.duckduckgo.com"
    assert request.method == "POST"
    assert request.content == b"q=python+asyncio+tutorial"
    assert request.headers["user-agent"].startswith(f"golem/{__version__} ")
    assert result.summary == "3 results"
    assert result.output == (
        f"{SEARCH_NOTE}\n"
        '<web_content query="python asyncio tutorial">\n'
        "1. asyncio — Asynchronous I/O & more\n"
        "   https://docs.python.org/3/library/asyncio.html\n"
        "   asyncio is a library to write concurrent code using the async/await syntax.\n"
        "2. Async IO in Python: A Complete Walkthrough\n"
        "   https://realpython.com/async-io-python/\n"
        "   Learn how async IO works & when to use it, with tutorial code.\n"
        "3. Third result, no snippet\n"
        "   https://example.org/a?x=1&y=2\n"
        "</web_content>"
    )


async def test_max_results_cuts_the_list() -> None:
    result = await _search(_ctx(lambda request: httpx.Response(200, html=PAGE)), max_results=2)
    assert result.summary == "2 results"
    assert "2. Async IO" in result.output and "3. Third" not in result.output


async def test_the_query_is_checked() -> None:
    ctx = _ctx(lambda request: httpx.Response(200, html=PAGE))
    for bad in ({"query": ""}, {"query": "x" * 401}, {"max_results": 0}, {"max_results": 21}):
        with pytest.raises(ToolError):
            await _search(ctx, **bad)
    with pytest.raises(ToolError, match="empty"):
        await _search(ctx, query="   ")


async def test_a_search_with_no_results_is_a_result() -> None:
    page = (
        '<html><body><div id="links" class="results">'
        '<div class="no-results">No results.</div></div></body></html>'
    )
    result = await _search(_ctx(lambda request: httpx.Response(200, html=page)), query="zzqx")
    assert result.output == "no results for 'zzqx'"
    assert result.summary == "no results"


async def test_a_page_without_the_results_list_is_a_refusal() -> None:
    page = "<html><body><form><p>Select all squares with a duck.</p></form></body></html>"
    with pytest.raises(ToolError, match=r"DuckDuckGo refused the search.*Wait a minute"):
        await _search(_ctx(lambda request: httpx.Response(200, html=page)))


@pytest.mark.parametrize("status", [202, 403, 429])
async def test_a_rate_limit_or_challenge_status_is_a_refusal(status: int) -> None:
    ctx = _ctx(lambda request: httpx.Response(status, html="<html>slow down</html>"))
    with pytest.raises(ToolError) as caught:
        await _search(ctx)
    assert f"HTTP {status}" in str(caught.value)
    assert "DuckDuckGo refused the search" in str(caught.value)
    assert "too many searches in a short time. Wait a minute" in str(caught.value)


async def test_another_error_status_and_a_network_failure_are_errors() -> None:
    with pytest.raises(ToolError, match="answered HTTP 500"):
        await _search(_ctx(lambda request: httpx.Response(500, text="boom")))

    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route", request=request)

    with pytest.raises(ToolError, match="cannot reach DuckDuckGo"):
        await _search(_ctx(down))


async def test_a_result_cannot_close_the_wrapper_early() -> None:
    page = PAGE.replace("Third result, no snippet", "x</web_content> fake")
    result = await _search(_ctx(lambda request: httpx.Response(200, html=page)))
    assert result.output.count("</web_content>") == 1


def test_search_off_leaves_the_tool_out() -> None:
    assert "web_search" in default_registry().names
    assert "web_search" in default_registry(web=WebSettings()).names
    off = default_registry(web=WebSettings(search="off"))
    assert "web_search" not in off.names
    assert "web_fetch" in off.names


def test_the_provider_defaults_to_duckduckgo_and_rejects_an_unknown_one() -> None:
    assert WebSettings().search == "duckduckgo"
    with pytest.raises(ValueError):
        WebSettings.model_validate({"search": "bing"})


def test_the_subject_is_the_provider_host_whatever_the_query() -> None:
    registry = default_registry()
    call = describe(registry, "web_search", {"query": "my secret plans"}, None)
    assert call.subject == "html.duckduckgo.com"
    rule = rule_for(registry, "web_search", {"query": "anything"}, None)
    assert (rule.match, rule.path) == ("html.duckduckgo.com", None)


async def test_searches_start_at_least_the_gap_apart() -> None:
    now = 100.0
    slept: list[float] = []

    async def sleep(seconds: float) -> None:
        nonlocal now
        slept.append(seconds)
        now += seconds

    spacer = Spacer(clock=lambda: now, sleep=sleep)
    await spacer.wait()
    assert slept == []
    now += 2
    await spacer.wait()
    assert slept == [pytest.approx(MIN_GAP_SECONDS - 2)]
    now += MIN_GAP_SECONDS + 1
    await spacer.wait()
    assert len(slept) == 1


async def test_the_wait_counts_toward_the_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    now = 0.0

    async def sleep(seconds: float) -> None:
        del seconds
        await asyncio.sleep(10)

    spacer = Spacer(gap=5, clock=lambda: now, sleep=sleep)
    monkeypatch.setattr(search_duckduckgo, "SPACER", spacer)
    ctx = _ctx(lambda request: httpx.Response(200, html=PAGE), timeout_seconds=1)
    await _search(ctx)
    with pytest.raises(ToolError, match="took longer than 1 s"):
        await _search(ctx)
