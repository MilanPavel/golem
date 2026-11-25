"""A stuck lead on route auto is nudged once to ask the advisor before the step-up (#1359).

Scripted models behind a real daemon: a setup with local models only, one with cloud models
only, and the cases where there is no nudge.
"""

# pyright: reportPrivateUsage=false
from __future__ import annotations

from pathlib import Path
from typing import cast

from fakes import Calls
from langchain_core.messages import HumanMessage
from test_server import HELLO, RpcClient, rpc_result, start_daemon, stop_daemon
from test_step_up import (
    BAD_TWICE,
    BIG,
    CHEAP,
    LOCAL,
    _ended,
    _escalations,
    _Facts,
    _facts,
    _models,
    _of,
    _Router,
    _router,
    _send,
    _types,
)

from golem.agents.bundled import bundled_agents_dir
from golem.config import AgentSettings, GolemSettings, LadderSettings, RoutingSettings

ASK: Calls = [("delegate", {"agent": "advisor", "brief": "which file? tried a and b, both failed"})]


async def _session(client: RpcClient, profile: str, app_state: object, *, paid: bool = True) -> str:
    await client.call("hello", HELLO)
    created = rpc_result(await client.call("session.create", {"model_profile": profile}))
    session_id = cast(str, created["session_id"])
    rpc_result(await client.call("session.attach", {"session_id": session_id, "after_seq": 0}))
    rpc_result(await client.call("session.set_route", {"session_id": session_id, "mode": "auto"}))
    live = app_state.sessions._sessions[session_id]  # type: ignore[attr-defined]
    live.paid_ok = paid
    return session_id


async def test_a_stuck_local_lead_is_nudged_once_then_the_step_up_is_offered(
    short_home: Path,
) -> None:
    # Two bad calls, the nudge, the advisor, then two more bad calls: the step-up.
    router = _router(
        [*BAD_TWICE, ASK, *BAD_TWICE],
        ["take the first", "done"],
    )
    facts = _Facts(_facts(LOCAL, "local", 32000), _facts(CHEAP, "budget", 128000, 0.5))
    app, task = await start_daemon(
        short_home, router=router, facts=facts, bundled_agents=bundled_agents_dir()
    )
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        session_id = await _session(client, LOCAL, app.state)
        await _send(client, session_id)
        await _ended(client)
        assert "run.completed" in _types(client)
        # The note went in once, and the step-up came after the second struggle.
        history = router.models[LOCAL].seen[-1]
        notes = [m for m in history if isinstance(m, HumanMessage) and "You seem stuck" in m.text]
        assert len(notes) == 1
        assert "2 invalid tool calls in a row" in notes[0].text
        assert "agent `advisor`" in notes[0].text
        (escalated,) = _escalations(client)
        assert escalated["model_profile"] == CHEAP
        assert _models(client) == ["small"] * 5 + ["cheap"]
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_local_only_the_advisor_is_the_same_model_in_a_fresh_window(
    short_home: Path,
) -> None:
    router = _router([*BAD_TWICE, ASK, "take the first", "done"], [], local_only=True)
    facts = _Facts(_facts(LOCAL, "local", 32000), _facts(CHEAP, "budget", 128000, 0.5))
    app, task = await start_daemon(
        short_home, router=router, facts=facts, bundled_agents=bundled_agents_dir()
    )
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        session_id = await _session(client, LOCAL, app.state)
        await _send(client, session_id, cwd=str(short_home))
        await _ended(client)
        assert "run.completed" in _types(client)
        (started,) = _of(client, "helper.started")
        assert started["agent"] == "advisor"
        assert started["model"] == LOCAL
        assert "fresh window" in cast(str, started["pick_reason"])
        # The advisor's call (the fourth) sees its brief, not the lead's failed calls.
        helper_history = router.models[LOCAL].seen[3]
        assert not any("no_such_tool" in str(m.content) for m in helper_history)
        assert any("which file?" in m.text for m in helper_history)
        assert _escalations(client) == []
        assert not router.models[CHEAP].seen
        assert "route.consent.needed" not in _types(client)
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_cloud_only_a_budget_lead_asks_a_frontier_advisor_with_no_question(
    short_home: Path,
) -> None:
    ladder = RoutingSettings(ladder=LadderSettings(frontier=BIG))
    router = _Router(
        GolemSettings(routing=ladder),
        ollama__small=[],
        deepseek__cheap=[*BAD_TWICE, ASK, "done"],
        anthropic__big=["take the first"],
    )
    facts = _Facts(_facts(CHEAP, "budget", 128000, 0.5), _facts(BIG, "frontier", 200000, 5.0))
    app, task = await start_daemon(
        short_home, router=router, facts=facts, bundled_agents=bundled_agents_dir()
    )
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        session_id = await _session(client, CHEAP, app.state)
        await _send(client, session_id)
        await _ended(client)
        assert "run.completed" in _types(client)
        (started,) = _of(client, "helper.started")
        assert started["agent"] == "advisor"
        assert started["model"] == BIG
        assert "route.consent.needed" not in _types(client)
        assert _escalations(client) == []
        assert len(router.models[BIG].seen) == 1
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_no_nudge_when_helpers_are_never_used(short_home: Path) -> None:
    settings = GolemSettings(agents=AgentSettings(use_helpers="never"))
    router = _Router(settings, ollama__small=[*BAD_TWICE, "done"], deepseek__cheap=["done"])
    facts = _Facts(_facts(LOCAL, "local", 32000), _facts(CHEAP, "budget", 128000, 0.5))
    app, task = await start_daemon(
        short_home, router=router, facts=facts, bundled_agents=bundled_agents_dir()
    )
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        session_id = await _session(client, LOCAL, app.state)
        await _send(client, session_id)
        await _ended(client)
        assert not _nudged(router)
        (escalated,) = _escalations(client)
        assert escalated["model_profile"] == CHEAP
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_no_nudge_when_the_route_is_not_auto(short_home: Path) -> None:
    router = _router([*BAD_TWICE, "done"], ["unused"])
    facts = _Facts(_facts(LOCAL, "local", 32000), _facts(CHEAP, "budget", 128000, 0.5))
    app, task = await start_daemon(
        short_home, router=router, facts=facts, bundled_agents=bundled_agents_dir()
    )
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        created = rpc_result(await client.call("session.create", {"model_profile": LOCAL}))
        session_id = cast(str, created["session_id"])
        rpc_result(await client.call("session.attach", {"session_id": session_id, "after_seq": 0}))
        await _send(client, session_id)
        await _ended(client)
        assert "run.completed" in _types(client)
        assert not _nudged(router)
        assert _of(client, "helper.started") == []
    finally:
        await client.close()
        await stop_daemon(app, task)


def _nudged(router: _Router) -> bool:
    return any(
        isinstance(m, HumanMessage) and "You seem stuck" in m.text
        for model in router.models.values()
        for history in model.seen
        for m in history
    )
