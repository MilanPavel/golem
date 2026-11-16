"""A provider that fails does not end a run on route auto (9.4.3)."""

from __future__ import annotations

import asyncio
from collections.abc import Iterator, Mapping, Sequence
from pathlib import Path
from types import SimpleNamespace
from typing import Any, cast

import httpx
import pytest
from fakes import StreamingToolChatModel
from langchain_core.callbacks import CallbackManagerForLLMRun
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessageChunk, BaseMessage
from langchain_core.outputs import ChatGenerationChunk, ChatResult
from pydantic import Field
from test_facts import _Discovery, _hosted  # pyright: ignore
from test_facts import _router as _facts_router  # pyright: ignore[reportPrivateUsage]
from test_paid_consent import _facts  # pyright: ignore[reportPrivateUsage]
from test_server import HELLO, RpcClient, rpc_result, start_daemon, stop_daemon

from golem.config import GolemSettings, RoutingSettings
from golem.graphs.step_up import StepRequest
from golem.models import ollama
from golem.models.errors import RETRY_MAX, failure_of, provider_error, retry_delay
from golem.models.facts import ListedFacts, ModelFacts
from golem.models.health import Health
from golem.models.router import ModelRouter
from golem.models.window import ContextWindow
from golem.server.app import DaemonApp

LOCAL = "ollama/small"
CHEAP = "deepseek/cheap"
OTHER = "moonshot/other"
BIG = "anthropic/big"


class _Http(Exception):
    """What a provider SDK raises: a ``status_code``, a body, and a response with headers."""

    def __init__(self, status: int, body: str = "", retry_after: str | None = None) -> None:
        super().__init__(f"Error code: {status} - {body}")
        self.status_code = status
        self.body = body
        headers = {} if retry_after is None else {"retry-after": retry_after}
        self.response = SimpleNamespace(status_code=status, headers=headers)


class ConnectError(Exception):
    pass


class ReadTimeout(Exception):
    pass


@pytest.mark.parametrize(
    ("exc", "want"),
    [
        (_Http(429), "rate_limited"),
        (_Http(500), "server_error"),
        (_Http(503), "server_error"),
        (_Http(401), "auth"),
        (_Http(403), "auth"),
        (_Http(402), "no_credit"),
        (_Http(400, "insufficient_quota"), "no_credit"),
        (_Http(429, "You exceeded your current quota"), "no_credit"),
        (_Http(400, "bad request"), "other"),
        (ConnectError("down"), "unreachable"),
        (httpx.ConnectError("down"), "unreachable"),
        (ReadTimeout("slow"), "unreachable"),
        (TimeoutError(), "unreachable"),
        (ValueError("nope"), "other"),
    ],
)
def test_failure_of(exc: BaseException, want: str) -> None:
    assert failure_of(exc) == want


def test_a_connect_error_under_another_error_is_unreachable() -> None:
    try:
        try:
            raise ConnectError("down")
        except ConnectError as inner:
            raise RuntimeError("wrapped") from inner
    except RuntimeError as outer:
        assert failure_of(outer) == "unreachable"


def test_retry_after_is_honoured_up_to_ten_seconds() -> None:
    assert retry_delay(_Http(429)) == 2.0
    assert retry_delay(_Http(429, retry_after="5")) == 5.0
    assert retry_delay(_Http(429, retry_after="120")) == RETRY_MAX
    assert retry_delay(_Http(429, retry_after="soon")) == 2.0


def test_each_failure_has_a_code_and_a_hint() -> None:
    limited = provider_error("deepseek", "rate_limited")
    assert (limited.code, limited.hint) == ("rate_limited", "wait a minute and try again")
    credit = provider_error("deepseek", "no_credit")
    assert (credit.code, credit.hint) == ("no_credit", "add credit at deepseek")
    key = provider_error("deepseek", "auth")
    assert (key.code, key.hint) == ("auth_failed", "/login deepseek")


# Health


def test_health_remembers_a_provider_for_sixty_seconds() -> None:
    now = [100.0]
    health = Health(lambda: now[0])
    assert health.why("deepseek") is None
    health.mark("deepseek", "rate_limited")
    assert health.why("deepseek") == "rate-limited"
    assert health.why("openai") is None
    now[0] = 159.0
    assert health.why("deepseek") == "rate-limited"
    now[0] = 160.0
    assert health.why("deepseek") is None


async def test_health_makes_the_listing_skip_a_provider_for_a_minute() -> None:
    now = [0.0]
    health = Health(lambda: now[0])
    source = ListedFacts(
        _Discovery([_hosted()]),
        _facts_router(),
        lambda profile, overrides: ContextWindow(),
        health=health,
    )
    [fine] = await source.facts(["anthropic/claude-test"])
    assert fine.ready
    health.mark("anthropic", "rate_limited")
    [skipped] = await source.facts(["anthropic/claude-test"])
    assert not skipped.ready
    assert skipped.why_not_ready == "rate-limited"
    now[0] = 61.0
    [back] = await source.facts(["anthropic/claude-test"])
    assert back.ready


# A run through the daemon


class FlakyModel(StreamingToolChatModel):
    """Fails with the next of ``errors`` (None: answers). ``partial`` is streamed first."""

    errors: list[BaseException | None] = Field(default_factory=list[BaseException | None])
    partial: str = ""
    attempts: int = 0
    inside: bool = False

    def _error(self) -> BaseException | None:
        self.attempts += 1
        return self.errors.pop(0) if self.errors else None

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        error = None if self.inside else self._error()
        if error is not None:
            raise error
        return super()._generate(messages, stop, run_manager, **kwargs)

    def _stream(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> Iterator[ChatGenerationChunk]:
        error = self._error()
        if error is not None:
            if self.partial:
                yield ChatGenerationChunk(message=AIMessageChunk(content=self.partial))
            raise error
        self.inside = True
        try:
            yield from super()._stream(messages, stop, run_manager, **kwargs)
        finally:
            self.inside = False


class _Facts:
    def __init__(self, *models: ModelFacts) -> None:
        self.models = list(models)

    async def facts(
        self, refs: Sequence[str], *, overrides: Mapping[str, float | str] | None = None
    ) -> list[ModelFacts]:
        del refs, overrides
        return list(self.models)


@pytest.fixture(autouse=True)
def installed(monkeypatch: pytest.MonkeyPatch) -> None:
    """Ollama counts as installed, so a local model that is down is unreachable on any machine."""
    monkeypatch.setattr(ollama, "installed", lambda: True)


class _Router(ModelRouter):
    def __init__(self, settings: GolemSettings, models: dict[str, FlakyModel]) -> None:
        super().__init__(settings)
        self.models = models
        self.slept: list[float] = []
        self.sleep = self._nap

    async def _nap(self, seconds: float) -> None:
        self.slept.append(seconds)

    def chat_model(
        self,
        profile: str,
        overrides: Mapping[str, float | str] | None = None,
        *,
        local_only: bool = False,
    ) -> BaseChatModel:
        return self.models[self.resolve(profile).ref]


def _flaky(*errors: BaseException | None, partial: str = "") -> FlakyModel:
    return FlakyModel(replies=["done"], errors=list(errors), partial=partial)


def _all(**models: FlakyModel) -> _Router:
    """A router with the models by ref (``deepseek__cheap`` is ``deepseek/cheap``)."""
    wanted = {ref.replace("__", "/"): m for ref, m in models.items()}
    return _Router(GolemSettings(), wanted)


def _facts_all() -> _Facts:
    return _Facts(
        _facts(LOCAL, "local", 32000),
        _facts(CHEAP, "budget", 128000, 0.5),
        _facts(OTHER, "budget", 128000, 0.7),
        _facts(BIG, "frontier", 200000, 5.0),
    )


def _data(event: Mapping[str, object]) -> dict[str, object]:
    return cast(dict[str, object], cast(dict[str, object], event["params"])["data"])


def _of(client: RpcClient, kind: str) -> list[dict[str, object]]:
    return [_data(e) for e in client.events if cast(dict[str, object], e["params"])["type"] == kind]


def _types(client: RpcClient) -> list[str]:
    return [cast(str, cast(dict[str, object], e["params"])["type"]) for e in client.events]


def _models(client: RpcClient) -> list[str | None]:
    return [cast(str | None, d.get("model")) for d in _of(client, "model.call.started")]


def _fallbacks(client: RpcClient) -> list[dict[str, object]]:
    return [r for r in _of(client, "model.routed") if r["reason"] == "fallback"]


async def _ended(client: RpcClient) -> None:
    for _ in range(300):
        await client.take_events()
        if "run.completed" in _types(client) or "run.failed" in _types(client):
            return
        await asyncio.sleep(0.01)
    raise TimeoutError(_types(client))


async def _session(
    app: DaemonApp, client: RpcClient, model: str, mode: str | None = "auto", *, paid: bool = True
) -> str:
    await client.call("hello", HELLO)
    created = rpc_result(await client.call("session.create", {"model_profile": model}))
    session_id = cast(str, created["session_id"])
    rpc_result(await client.call("session.attach", {"session_id": session_id, "after_seq": 0}))
    if mode is not None:
        rpc_result(await client.call("session.set_route", {"session_id": session_id, "mode": mode}))
    assert app.state.sessions is not None
    live = app.state.sessions._sessions[session_id]  # pyright: ignore[reportPrivateUsage]
    live.paid_ok = paid
    return session_id


async def _run(
    app: DaemonApp,
    client: RpcClient,
    model: str,
    mode: str | None = "auto",
    *,
    floor: bool = True,
    cwd: str | None = None,
) -> None:
    """One message to a session on ``model``. ``floor`` keeps the first pick off the local tier."""
    session_id = await _session(app, client, model, mode)
    assert app.state.sessions is not None
    live = app.state.sessions._sessions[session_id]  # pyright: ignore[reportPrivateUsage]
    if floor:
        live.step_floor = "budget"
    params: dict[str, object] = {"session_id": session_id, "text": "go"}
    if cwd is not None:
        params["cwd"] = cwd
    rpc_result(await client.call("message.send", params))
    await _ended(client)


async def _with(
    home: Path, router: _Router, facts: _Facts | None = None
) -> tuple[DaemonApp, Any, RpcClient]:
    app, task = await start_daemon(home, router=router, facts=facts or _facts_all())
    return app, task, await RpcClient.connect(app.paths.socket_path)


async def test_a_rate_limit_once_is_retried_after_two_seconds(short_home: Path) -> None:
    cheap = _flaky(_Http(429))
    router = _all(deepseek__cheap=cheap, moonshot__other=_flaky(), anthropic__big=_flaky())
    app, task, client = await _with(short_home, router)
    try:
        await _run(app, client, CHEAP)
        assert "run.completed" in _types(client)
        assert router.slept == [2.0]
        assert cheap.attempts == 2
        assert _fallbacks(client) == []
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_retry_after_header_sets_the_wait(short_home: Path) -> None:
    router = _all(deepseek__cheap=_flaky(_Http(429, retry_after="7")))
    app, task, client = await _with(short_home, router)
    try:
        await _run(app, client, CHEAP)
        assert "run.completed" in _types(client)
        assert router.slept == [7.0]
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_two_rate_limits_fall_back_to_another_model_of_the_tier(short_home: Path) -> None:
    router = _all(
        deepseek__cheap=_flaky(_Http(429), _Http(429)),
        moonshot__other=_flaky(),
        anthropic__big=_flaky(),
    )
    app, task, client = await _with(short_home, router)
    try:
        await _run(app, client, CHEAP)
        assert "run.completed" in _types(client)
        (note,) = _fallbacks(client)
        assert note["model_profile"] == OTHER
        assert note["tier"] == "budget"
        assert note["detail"] == "deepseek is rate-limited"
        assert _models(client) == ["cheap", "other"]
        assert router.slept == [2.0]
        assert router.health.why("deepseek") == "rate-limited"
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_hosted_provider_that_is_down_falls_back_to_local_at_once(
    short_home: Path,
) -> None:
    router = _all(deepseek__cheap=_flaky(httpx.ConnectError("down")), ollama__small=_flaky())
    only = _Facts(_facts(LOCAL, "local", 32000), _facts(CHEAP, "budget", 128000, 0.5))
    app, task, client = await _with(short_home, router, only)
    try:
        await _run(app, client, CHEAP)
        assert "run.completed" in _types(client)
        assert router.slept == []
        (note,) = _fallbacks(client)
        assert note["model_profile"] == LOCAL
        assert _models(client) == ["cheap", "small"]
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_pinned_session_fails_with_the_code_and_the_hint(short_home: Path) -> None:
    router = _all(deepseek__cheap=_flaky(_Http(429), _Http(429)), moonshot__other=_flaky())
    app, task, client = await _with(short_home, router)
    try:
        await _run(app, client, CHEAP, mode=None)
        (failed,) = _of(client, "run.failed")
        assert failed["code"] == "rate_limited"
        assert failed["hint"] == "wait a minute and try again"
        assert failed["provider"] == "deepseek"
        assert _fallbacks(client) == []
    finally:
        await client.close()
        await stop_daemon(app, task)


@pytest.mark.parametrize(
    ("error", "code", "hint"),
    [
        (_Http(402), "no_credit", "add credit at deepseek"),
        (_Http(401), "auth_failed", "/login deepseek"),
    ],
)
async def test_credit_and_key_failures_have_their_own_codes(
    short_home: Path, error: Exception, code: str, hint: str
) -> None:
    router = _all(deepseek__cheap=_flaky(error))
    app, task, client = await _with(short_home, router)
    try:
        await _run(app, client, CHEAP, mode=None)
        (failed,) = _of(client, "run.failed")
        assert (failed["code"], failed["hint"]) == (code, hint)
        assert router.slept == []
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_run_falls_back_twice_and_then_fails_with_the_last_error(
    short_home: Path,
) -> None:
    router = _all(
        deepseek__cheap=_flaky(_Http(429), _Http(429)),
        moonshot__other=_flaky(_Http(429), _Http(429)),
        anthropic__big=_flaky(_Http(429), _Http(429)),
        ollama__small=_flaky(),
    )
    app, task, client = await _with(short_home, router)
    try:
        await _run(app, client, CHEAP)
        assert [r["model_profile"] for r in _fallbacks(client)] == [OTHER, BIG]
        assert _models(client) == ["cheap", "other", "big"]
        (failed,) = _of(client, "run.failed")
        assert failed["code"] == "rate_limited"
        assert failed["provider"] == "anthropic"
        assert not router.models[LOCAL].attempts
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_more_expensive_fallback_needs_the_sessions_yes(short_home: Path) -> None:
    router = _all(deepseek__cheap=_flaky(), anthropic__big=_flaky())
    only = _Facts(_facts(CHEAP, "budget", 128000, 0.5), _facts(BIG, "frontier", 200000, 5.0))
    app, task, client = await _with(short_home, router, only)
    try:
        session_id = await _session(app, client, CHEAP, paid=False)
        assert app.state.sessions is not None
        sessions = app.state.sessions
        ask = StepRequest("fallback")
        assert await sessions._next_model(session_id, CHEAP, ask) is None  # pyright: ignore
        sessions._sessions[session_id].paid_ok = True  # pyright: ignore[reportPrivateUsage]
        found = await sessions._next_model(session_id, CHEAP, ask)  # pyright: ignore
        assert found is not None
        assert (found.profile, found.tier) == (BIG, "frontier")
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_local_only_session_never_falls_back_to_a_hosted_model(
    short_home: Path,
) -> None:
    settings = GolemSettings(routing=RoutingSettings.model_validate({"local_only": ["/"]}))
    local = _flaky(httpx.ConnectError("down"))
    router = _Router(settings, {LOCAL: local, CHEAP: _flaky(), BIG: _flaky()})
    app, task, client = await _with(short_home, router)
    try:
        await _run(app, client, LOCAL, cwd=str(short_home))
        assert _fallbacks(client) == []
        (failed,) = _of(client, "run.failed")
        assert failed["code"] == "model_unreachable"
        assert not router.models[CHEAP].attempts
        assert not router.models[BIG].attempts
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_text_that_was_streamed_is_closed_and_the_next_call_is_a_new_reply(
    short_home: Path,
) -> None:
    router = _all(deepseek__cheap=_flaky(_Http(503), partial="Let me"), moonshot__other=_flaky())
    app, task, client = await _with(short_home, router)
    try:
        await _run(app, client, CHEAP)
        assert "run.completed" in _types(client)
        # No retry: the user saw text.
        assert router.slept == []
        assert router.models[CHEAP].attempts == 1
        (note,) = _fallbacks(client)
        assert note["detail"] == "deepseek had a server error"
        cut = [d for d in _of(client, "message.completed") if d.get("interrupted") is True]
        assert [d["text"] for d in cut] == ["Let me"]
        started = [d["message_id"] for d in _of(client, "message.started")]
        assert len(set(started)) == 2
        failed_calls = [d for d in _of(client, "model.call.completed") if d["failed"] is True]
        assert len(failed_calls) == 1
        done = [
            d
            for d in _of(client, "message.completed")
            if d["role"] == "assistant" and d.get("interrupted") is not True
        ]
        assert [d["text"] for d in done] == ["done"]
    finally:
        await client.close()
        await stop_daemon(app, task)
