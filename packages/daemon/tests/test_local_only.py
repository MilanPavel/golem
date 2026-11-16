"""A chat in a local-only folder never reaches a hosted model (ticket 9.3.9, ADR-055)."""

# pyright: reportPrivateUsage=false
from __future__ import annotations

import asyncio
from collections.abc import Mapping
from pathlib import Path
from typing import cast

import pytest
from fakes import ScriptedChatModel
from langchain_core.language_models import BaseChatModel
from langgraph.checkpoint.memory import InMemorySaver
from test_compact import SETTINGS, WINDOW, _project
from test_context_summary import _ask, _Chat, _replies, _Summing
from test_route_mode import (
    BIG,
    CHEAP,
    LOCAL,
    _Facts,
    _facts,
    _last_input,
    _routed,
    _turn,
    _types,
)
from test_server import HELLO, RpcClient, error_code, rpc_result, start_daemon, stop_daemon

from golem.config import BudgetSettings, GolemSettings, RoutingSettings
from golem.graphs.chat import open_chat
from golem.graphs.summarise import Summariser
from golem.models.router import ModelConfigError, ModelRouter
from golem.models.window import ContextWindow
from golem.server.dispatcher import LOCAL_ONLY
from golem.sessions.titles import ModelTitles, choose_title
from golem.sessions.usage import Usage
from golem.store.database import Database

REFUSAL = "This folder is local only. Pick a local model with /model."


class _Router(ModelRouter):
    """Real name resolution and the real local-only check; a scripted model for each ref."""

    def __init__(self, settings: GolemSettings) -> None:
        super().__init__(settings)
        self.models: dict[str, ScriptedChatModel] = {}

    def chat_model(
        self,
        profile: str,
        overrides: Mapping[str, float | str] | None = None,
        *,
        local_only: bool = False,
    ) -> BaseChatModel:
        if local_only:
            self.ensure_local(profile)
        ref = self.resolve(profile).ref
        return self.models.setdefault(ref, ScriptedChatModel(replies=["done"] * 6))

    def asked(self, ref: str) -> int:
        """How many prompts the model of ``ref`` was sent."""
        model = self.models.get(ref)
        return 0 if model is None else len(model.seen)


def _router(
    folder: Path | None, mode: str = "pinned", budget: BudgetSettings | None = None
) -> _Router:
    return _Router(
        GolemSettings(
            routing=RoutingSettings.model_validate(
                {"mode": mode, "local_only": [] if folder is None else [str(folder)]}
            ),
            budget=budget or BudgetSettings(),
        )
    )


def _folder(home: Path, name: str = "work") -> Path:
    folder = home / name
    folder.mkdir(exist_ok=True)
    return folder


async def _session(client: RpcClient, model: str, cwd: Path | None, mode: str | None = None) -> str:
    params: dict[str, object] = {"model_profile": model}
    if cwd is not None:
        params["cwd"] = str(cwd)
    created = rpc_result(await client.call("session.create", params))
    session_id = cast(str, created["session_id"])
    rpc_result(await client.call("session.attach", {"session_id": session_id, "after_seq": 0}))
    if mode is not None:
        rpc_result(await client.call("session.set_route", {"session_id": session_id, "mode": mode}))
    return session_id


_ALL = (
    _facts(LOCAL, "local", 32000),
    _facts(CHEAP, "budget", 128000, 0.5),
    _facts(BIG, "frontier", 200000, 5.0),
)


async def test_auto_never_picks_a_hosted_model_even_with_a_yes_and_room(short_home: Path) -> None:
    work = _folder(short_home)
    router = _router(work, budget=BudgetSettings(daily_usd=100.0, session_usd=50.0))
    app, task = await start_daemon(short_home, router=router, facts=_Facts(*_ALL))
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        session_id = await _session(client, BIG, work, "auto")
        sessions = app.state.sessions
        assert sessions is not None
        sessions._sessions[session_id].paid_ok = True
        # The local model cannot take this much, and a hosted one could.
        _last_input(app, session_id, 20000)
        await _turn(client, session_id, "a long question " * 3)
        routed = _routed(client)
        assert len(routed) == 1
        assert routed[0]["tier"] == "local"
        assert routed[0]["model_profile"] == LOCAL
        rejected = {r["ref"] for r in cast(list[dict[str, str]], routed[0]["rejected"])}
        assert {BIG, CHEAP} <= rejected
        assert router.asked(BIG) == 0
        assert router.asked(CHEAP) == 0
        assert router.asked(LOCAL) >= 1
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_auto_with_only_hosted_models_refuses_and_says_why(short_home: Path) -> None:
    work = _folder(short_home)
    router = _router(work)
    facts = _Facts(_facts(BIG, "frontier", 200000, 5.0), _facts(CHEAP, "budget", 128000, 0.5))
    app, task = await start_daemon(short_home, router=router, facts=facts)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        session_id = await _session(client, BIG, work, "auto")
        sessions = app.state.sessions
        assert sessions is not None
        sessions._sessions[session_id].paid_ok = True
        refused = await client.call("message.send", {"session_id": session_id, "text": "hi"})
        assert error_code(refused) == LOCAL_ONLY
        assert REFUSAL in str(refused)
        assert "run.started" not in _types(client)
        assert router.asked(BIG) == 0
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_auto_without_facts_falls_back_to_the_sessions_model_only_when_it_is_local(
    short_home: Path,
) -> None:
    work = _folder(short_home)
    router = _router(work)
    app, task = await start_daemon(short_home, router=router, facts=_Facts())
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        hosted = await _session(client, BIG, work, "auto")
        refused = await client.call("message.send", {"session_id": hosted, "text": "hi"})
        assert error_code(refused) == LOCAL_ONLY
        local = await _session(client, LOCAL, work, "auto")
        await _turn(client, local)
        assert router.asked(LOCAL) >= 1
        assert router.asked(BIG) == 0
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_pinned_hosted_session_is_refused_and_a_pinned_local_one_runs(
    short_home: Path,
) -> None:
    work = _folder(short_home)
    router = _router(work)
    app, task = await start_daemon(short_home, router=router, facts=_Facts(*_ALL))
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        hosted = await _session(client, BIG, work)
        refused = await client.call("message.send", {"session_id": hosted, "text": "hi"})
        assert error_code(refused) == LOCAL_ONLY
        assert str(cast(dict[str, object], refused["error"])["message"]) == REFUSAL
        assert "run.started" not in _types(client)
        local = await _session(client, LOCAL, work)
        await _turn(client, local)
        assert _types(client).count("run.completed") == 1
        assert router.asked(BIG) == 0
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_switching_to_a_hosted_model_in_a_local_only_folder_does_not_get_it_called(
    short_home: Path,
) -> None:
    work = _folder(short_home)
    router = _router(work)
    app, task = await start_daemon(short_home, router=router, facts=_Facts(*_ALL))
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        session_id = await _session(client, LOCAL, work)
        rpc_result(await client.call("session.set_model", {"session_id": session_id, "model": BIG}))
        refused = await client.call("message.send", {"session_id": session_id, "text": "hi"})
        assert error_code(refused) == LOCAL_ONLY
        rpc_result(
            await client.call("session.set_model", {"session_id": session_id, "model": LOCAL})
        )
        await _turn(client, session_id)
        assert router.asked(BIG) == 0
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_folder_that_comes_with_the_first_message_counts_from_that_message(
    short_home: Path,
) -> None:
    work = _folder(short_home)
    other = _folder(short_home, "other")
    router = _router(work)
    app, task = await start_daemon(short_home, router=router, facts=_Facts(*_ALL))
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        session_id = await _session(client, BIG, None)
        refused = await client.call(
            "message.send", {"session_id": session_id, "text": "hi", "cwd": str(work)}
        )
        assert error_code(refused) == LOCAL_ONLY
        assert router.asked(BIG) == 0
        # The refused message did not give the session its folder.
        listed = rpc_result(await client.call("session.list", {}))
        assert cast(list[dict[str, object]], listed["sessions"])[0]["cwd"] is None
        rpc_result(
            await client.call(
                "message.send", {"session_id": session_id, "text": "hi", "cwd": str(other)}
            )
        )
        await client.wait_for_event("run.completed")
        assert router.asked(BIG) >= 1
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_the_session_list_says_which_sessions_are_local_only(short_home: Path) -> None:
    work = _folder(short_home)
    other = _folder(short_home, "other")
    router = _router(work)
    app, task = await start_daemon(short_home, router=router, facts=_Facts(*_ALL))
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        (work / "sub").mkdir()
        inside = await _session(client, LOCAL, work / "sub")
        outside = await _session(client, LOCAL, other)
        loose = await _session(client, LOCAL, None)
        listed = rpc_result(await client.call("session.list", {}))
        flags = {
            cast(str, s["session_id"]): s["local_only"]
            for s in cast(list[dict[str, object]], listed["sessions"])
        }
        assert flags == {inside: True, outside: False, loose: False}
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_project_file_makes_its_folder_local_only_without_being_trusted(
    short_home: Path,
) -> None:
    repo = _folder(short_home, "repo")
    (repo / ".golem").mkdir()
    (repo / ".golem" / "config.toml").write_text("[routing]\nlocal_only = true\n")
    router = _router(None)
    assert router.routing_settings().local_only == []
    app, task = await start_daemon(short_home, router=router, facts=_Facts(*_ALL))
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        session_id = await _session(client, BIG, repo)
        refused = await client.call("message.send", {"session_id": session_id, "text": "hi"})
        assert error_code(refused) == LOCAL_ONLY
        listed = rpc_result(await client.call("session.list", {}))
        assert cast(list[dict[str, object]], listed["sessions"])[0]["local_only"] is True
        assert router.asked(BIG) == 0
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_project_file_cannot_make_a_chat_less_private(short_home: Path) -> None:
    work = _folder(short_home)
    (work / ".golem").mkdir()
    (work / ".golem" / "config.toml").write_text("[routing]\nlocal_only = false\n")
    router = _router(work)
    app, task = await start_daemon(short_home, router=router, facts=_Facts(*_ALL))
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        session_id = await _session(client, BIG, work)
        refused = await client.call("message.send", {"session_id": session_id, "text": "hi"})
        assert error_code(refused) == LOCAL_ONLY
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_the_title_of_a_local_only_chat_is_written_by_a_local_model(
    short_home: Path,
) -> None:
    work = _folder(short_home)
    router = _router(work)
    titles = ModelTitles(router)
    app, task = await start_daemon(short_home, router=router, titles=titles, facts=_Facts(*_ALL))
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        # Its own model is hosted. The turn runs on a local one, and so does the title.
        session_id = await _session(client, BIG, work, "auto")
        await _turn(client, session_id, "name this chat")
        listed: dict[str, object] = {"sessions": [{"title": None}]}
        for _ in range(200):
            listed = rpc_result(await client.call("session.list", {}))
            if cast(list[dict[str, object]], listed["sessions"])[0]["title"] is not None:
                break
            await asyncio.sleep(0.01)
        title = cast(list[dict[str, object]], listed["sessions"])[0]["title"]
        assert title is not None
        assert _routed(client)[0]["model_profile"] == LOCAL
        assert router.asked(BIG) == 0
        assert router.asked(CHEAP) == 0
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_title_for_a_local_only_chat_is_skipped_when_only_a_hosted_model_is_left() -> None:
    router = _router(None)
    titles = ModelTitles(router)
    with pytest.raises(ModelConfigError) as caught:
        await titles.title(BIG, "a prompt", "a reply", None, "s_1", True)
    assert caught.value.code == "local_only"
    title = await choose_title(
        titles,
        model_profile=BIG,
        prompt="first line\nsecond",
        reply="a reply",
        session_id="s_1",
        local_only=True,
    )
    assert title == "first line"
    assert router.asked(BIG) == 0


async def test_a_title_in_a_local_only_chat_never_takes_a_budget_model() -> None:
    router = _router(None)
    titles = ModelTitles(router)
    titles.bind(lambda ref: "local" if ref.startswith("ollama/") else "budget", lambda: [CHEAP])
    await titles.title(LOCAL, "a prompt", "a reply", None, "s_1", True)
    assert router.asked(LOCAL) == 1
    assert router.asked(CHEAP) == 0
    # Not local only: the same session takes the budget model it is allowed.
    await titles.title(BIG, "a prompt", "a reply", None, "s_1", False)
    assert router.asked(CHEAP) == 1


async def test_a_summary_for_a_local_only_chat_is_local_or_refused() -> None:
    router = _router(None)
    summariser = Summariser(router, budget_refs=lambda: [CHEAP])
    with pytest.raises(ModelConfigError) as caught:
        await summariser.make(
            session_id="s_1",
            session_profile=BIG,
            options=None,
            messages=[],
            earlier=None,
            local_only=True,
        )
    assert caught.value.code == "local_only"
    assert router.asked(BIG) == 0
    assert router.asked(CHEAP) == 0


class _Switch(ModelRouter):
    """A router over one scripted model whose folder can be made local only after a chat."""

    def __init__(self, model: _Summing) -> None:
        super().__init__(GolemSettings(default_model="anthropic/big"))
        self._double = model
        self.private = False

    def routing_settings(self) -> RoutingSettings:
        return RoutingSettings.model_validate({"local_only": ["/"] if self.private else []})

    def chat_model(
        self,
        profile: str,
        overrides: Mapping[str, float | str] | None = None,
        *,
        local_only: bool = False,
    ) -> BaseChatModel:
        if local_only:
            self.ensure_local(profile)
        self.resolve(profile)
        return self._double


async def test_compact_summarises_only_with_a_local_model_in_a_local_only_folder(
    database: Database, tmp_path: Path
) -> None:
    model = _Summing(replies=_replies(8))
    router = _Switch(model)
    runtime = open_chat(
        router,
        InMemorySaver(),
        window_of=lambda _profile, _overrides: ContextWindow(window=WINDOW),
        context=SETTINGS,
        summariser=Summariser(router, usage=Usage(database)),
    )
    chat = _Chat(database, runtime)
    project = _project(tmp_path)
    for n in range(5):
        await chat.turn(_ask(n), project)
    router.private = True
    with pytest.raises(ModelConfigError) as caught:
        await chat.manager.compact(chat.session_id, "summarise", None)
    assert caught.value.code == "local_only"
    assert model.asked == []
    # Clearing old tool results makes no model call, so it still works.
    cleared = await chat.manager.compact(chat.session_id, "clear", None)
    assert cleared.count >= 0
