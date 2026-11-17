"""The routing table: each case of ``data/routing_cases.toml`` runs the whole decision (9.9.1).

A case gives settings, a session, a folder, the spend so far and the size of the prompt, and
names the model that must run, the reason, and optionally what was left out. The cases go
through ``SessionManager.send`` on a daemon with fake facts and scripted models, so no case
touches the network. ``expect`` holds decisions only, never log text.
"""

# pyright: reportPrivateUsage=false

from __future__ import annotations

import asyncio
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any, cast

import httpx
import pytest
from fakes import ToolCallingChatModel
from langgraph.checkpoint.memory import InMemorySaver
from routing_table import DOC, Case, in_doc, load, render
from test_fallback import FlakyModel, _Http, _Router
from test_server import HELLO, RpcClient, error_code, rpc_result, start_daemon, stop_daemon
from test_step_up import BAD_TWICE
from test_step_up_consent import _waits

from golem.config import GolemSettings, ModelPrice
from golem.graphs.chat import open_chat
from golem.models import ollama
from golem.models.facts import ModelFacts
from golem.models.roles import for_role
from golem.models.router import ModelRouter
from golem.models.tiers import Tier, blended
from golem.server.app import DaemonApp
from golem.server.dispatcher import (
    BUDGET_SPENT,
    LOCAL_ONLY,
    MODEL_NOT_CONFIGURED,
)

FIXTURES, CASES = load()
ERRORS = {
    MODEL_NOT_CONFIGURED: "model_not_configured",
    BUDGET_SPENT: "budget_spent",
    LOCAL_ONLY: "local_only",
}


@pytest.fixture(autouse=True)
def installed(monkeypatch: pytest.MonkeyPatch) -> None:
    """Ollama counts as installed on any machine."""
    monkeypatch.setattr(ollama, "installed", lambda: True)


def _facts(fixture: dict[str, Any]) -> ModelFacts:
    price = fixture.get("price")
    model_price = None if price is None else ModelPrice(input=price, output=price)
    window = fixture.get("window")
    return ModelFacts(
        ref=fixture["ref"],
        profile=fixture["ref"],
        tier=cast(Tier, fixture["tier"]),
        ready=fixture.get("ready", True),
        why_not_ready=fixture.get("why_not_ready"),
        window=window,
        window_exact=window is not None,
        tools=fixture.get("tools", True),
        vision=fixture.get("vision", False),
        price=model_price,
        blended=None if model_price is None else blended(model_price),
        prompt_tps=None,
        reply_tps=None,
        tool_score=fixture.get("tool_score"),
    )


class _Facts:
    def __init__(self, models: list[ModelFacts]) -> None:
        self.models = models

    async def facts(self, refs: Any, *, overrides: Any = None) -> list[ModelFacts]:
        del refs, overrides
        return list(self.models)


def _settings(case: Case, folder: Path | None) -> GolemSettings:
    raw: dict[str, Any] = {k: dict(v) for k, v in case.settings.items()}
    if folder is not None:
        raw.setdefault("routing", {})["local_only"] = [str(folder)]
    return GolemSettings.model_validate(raw)


def _models_of(case: Case) -> dict[str, FlakyModel]:
    """A scripted model for each ref; the session's model has the script of the action."""
    models = {FIXTURES[n]["ref"]: FlakyModel(replies=["done"] * 8) for n in case.models}
    own = FIXTURES[case.session_model]["ref"]
    if case.action == "struggle":
        models[own] = FlakyModel(replies=[*BAD_TWICE, "done", "second"])
    elif case.action == "provider_down":
        models[own] = FlakyModel(replies=["done"], errors=[httpx.ConnectError("down")])
    elif case.action == "rate_limited":
        models[own] = FlakyModel(replies=["done"], errors=[_Http(429), _Http(429)])
    return models


def _params(event: Any) -> dict[str, Any]:
    return cast(dict[str, Any], event["params"])


def _after(client: RpcClient, start: int, kind: str) -> list[dict[str, Any]]:
    found = [_params(e) for e in client.events[start:]]
    return [p["data"] for p in found if p["type"] == kind]


def _count(client: RpcClient, kind: str) -> int:
    return sum(1 for e in client.events if _params(e)["type"] == kind)


def _seed(app: DaemonApp, session_id: str, case: Case) -> None:
    """Record the size of the last prompt and what the session spent today."""
    now = datetime.now().astimezone()
    with sqlite3.connect(app.paths.database_file) as db:
        if case.prompt_tokens is not None:
            db.execute(
                "INSERT INTO model_calls (call_id, session_id, run_id, role, started_at, day,"
                " input) VALUES ('c_seed', ?, 'r_seed', 'chat', '2999-01-01T00:00:00Z',"
                " '2999-01-01', ?)",
                (session_id, case.prompt_tokens),
            )
        if case.spent_today:
            db.execute(
                "INSERT INTO model_calls (call_id, session_id, run_id, role, started_at, day,"
                " cost_usd) VALUES ('c_spent', ?, 'r_seed', 'chat', ?, ?, ?)",
                (session_id, now.isoformat(), now.date().isoformat(), case.spent_today),
            )


async def _settle(client: RpcClient, ends: int, asks: int) -> bool:
    """Wait for the run to end or to ask the paid question. True when it asked."""
    for _ in range(300):
        await client.take_events()
        if _count(client, "route.consent.needed") > asks:
            return True
        if _count(client, "run.completed") + _count(client, "run.failed") > ends:
            return False
        await asyncio.sleep(0.01)
    raise TimeoutError(case_events(client))


def case_events(client: RpcClient) -> list[str]:
    return [_params(e)["type"] for e in client.events]


async def _turn(
    app: DaemonApp, client: RpcClient, session_id: str, *, stronger: bool, start: int
) -> dict[str, Any]:
    """One message. The decision it led to; the paid question is answered with ``once``."""
    ends = _count(client, "run.completed") + _count(client, "run.failed")
    asks = _count(client, "route.consent.needed")
    params: dict[str, Any] = {"session_id": session_id, "text": "go"}
    if stronger:
        params["stronger"] = True
    sent = await client.call("message.send", params)
    if "error" in sent:
        return {"error": ERRORS[error_code(sent)]}
    asked = await _settle(client, ends, asks)
    if asked:
        question = _after(client, start, "route.consent.needed")[-1]
        run_id = cast(str, rpc_result(sent)["run_id"])
        await _waits(app, session_id)
        answer = {"session_id": session_id, "run_id": run_id, "answer": "once"}
        rpc_result(await client.call("route.consent.answer", answer))
        await _settle(client, ends, asks + 1)
        found = {"asks": True, "model": question["model_profile"]}
    else:
        found = {}
    failed = _after(client, start, "run.failed")
    if failed:
        return {"error": failed[-1]["code"]}
    routed = _after(client, start, "model.routed")
    if routed:
        last = routed[-1]
        refs = sorted(r["ref"] for r in last["rejected"])
        return {**found, "model": last["model_profile"], "reason": last["reason"], "rejected": refs}
    # A pinned session says nothing: the model that was called is the decision.
    called = _after(client, start, "model.call.started")[0]
    return {"model": f"{called['provider']}/{called['model']}", "reason": "pinned"}


async def _run_send(case: Case, home: Path) -> dict[str, Any]:
    folder = home / "work" if case.local_only_folder else None
    if folder is not None:
        folder.mkdir()
    facts = [_facts(FIXTURES[n]) for n in case.models]
    router = _Router(_settings(case, folder), cast(Any, _models_of(case)))
    app, task = await start_daemon(home, router=router, facts=_Facts(facts))
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        params: dict[str, Any] = {"model_profile": FIXTURES[case.session_model]["ref"]}
        if folder is not None:
            params["cwd"] = str(folder)
        created = rpc_result(await client.call("session.create", params))
        session_id = cast(str, created["session_id"])
        attach = {"session_id": session_id, "after_seq": 0}
        rpc_result(await client.call("session.attach", attach))
        route = {"session_id": session_id, "mode": case.route}
        rpc_result(await client.call("session.set_route", route))
        assert app.state.sessions is not None
        live = app.state.sessions._sessions[session_id]
        live.paid_ok = case.paid_ok
        live.step_floor = cast(Tier | None, case.step_floor)
        if case.action == "stronger":
            # The answer to retry: a first turn on the session's model, before any spend.
            await _turn(app, client, session_id, stronger=False, start=0)
        _seed(app, session_id, case)
        start = len(client.events)
        return await _turn(app, client, session_id, stronger=case.action == "stronger", start=start)
    finally:
        await client.close()
        await stop_daemon(app, task)


def _run_role(case: Case) -> dict[str, Any]:
    """The model of a role (titles, or the helper of ``delegate``) from the settings."""
    facts = [_facts(FIXTURES[n]) for n in case.models]
    tiers: dict[str, Tier] = {f.ref: f.tier for f in facts}

    def tier_of(ref: str) -> Tier | None:
        return tiers.get(ref)

    own = FIXTURES[case.session_model]["ref"]
    settings = _settings(case, None)
    if case.action == "helper_role":
        router = ModelRouter(settings, model=ToolCallingChatModel(replies=[]))
        runtime = open_chat(router, InMemorySaver(), tier_of=tier_of)
        role = runtime.explore_role(own, local_only=case.local_only_folder)
    else:
        budget = sorted(
            (f for f in facts if f.tier == "budget" and f.ready and f.tools),
            key=lambda f: (f.blended or 0.0, f.ref),
        )
        role = for_role(
            "titles",
            session_profile=own,
            settings=settings.routing.roles,
            tier_of_profile=tier_of,
            budget_models=[f.ref for f in budget],
            local_only=case.local_only_folder,
        )
    return {"model": role.profile, "reason": role.reason}


@pytest.mark.parametrize("case", CASES, ids=[case.name for case in CASES])
async def test_the_case_gets_its_model(case: Case, short_home: Path) -> None:
    if case.action.endswith("_role"):
        found = _run_role(case)
    else:
        found = await _run_send(case, short_home)
    expect = case.expect
    wanted = {key: expect[key] for key in ("model", "reason", "asks", "error") if key in expect}
    if "rejected" in expect:
        wanted["rejected"] = sorted(expect["rejected"])
    assert {key: found.get(key) for key in wanted} == wanted


def test_the_case_names_are_unique() -> None:
    names = [case.name for case in CASES]
    assert len(set(names)) == len(names)


def test_the_table_in_the_docs_is_the_one_the_cases_make() -> None:
    shown = in_doc(DOC.read_text(encoding="utf-8"))
    assert shown is not None, "docs/architecture/models.md has no routing-table markers"
    assert shown == render(), "out of date: run `just routing-table` and paste the output"
