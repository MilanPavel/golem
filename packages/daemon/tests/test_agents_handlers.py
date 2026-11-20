"""agents.list and agents.get, the counts of used and finished helpers, and the change signal.

No model is involved: the registry reads files, and the counts read stored events.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, cast

import pytest
from test_server import HELLO, RpcClient, error_code, rpc_result, start_daemon, stop_daemon

from golem.agents.bundled import bundled_agents_dir
from golem.agents.registry import AgentRegistry
from golem.config import AgentSettings
from golem.paths import resolve_paths
from golem.server.dispatcher import INVALID_PARAMS, RequestContext, RpcCallError
from golem.server.handlers import standard_methods
from golem.server.state import DaemonState
from golem.sessions.agent_usage import AgentCount, AgentUsage
from golem.store.database import Database
from golem_protocol.commands import AgentsGetParams, AgentsListParams

NOW = datetime(2026, 11, 20, 12, 0, 0, tzinfo=UTC)
CUTOFF = NOW - timedelta(days=30)


def _agent(
    folder: Path, name: str, description: str = "Does a thing.", body: str = "Prompt."
) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    (folder / f"{name}.md").write_text(
        f"---\ndescription: {description}\nmodel: cheapest\ntools: read_file\nmax-calls: 7\n"
        f"---\n{body}\n"
    )


# --- the counts -------------------------------------------------------------------------------


class _Log:
    """Raw rows in ``events``: the shapes golem wrote, with the times a test picks."""

    def __init__(self, database: Database, session: str = "lead") -> None:
        self._database = database
        self._session = session
        self._seq = 0

    async def open(self) -> None:
        async with self._database.transaction() as tx:
            await tx.execute(
                "INSERT INTO sessions (session_id, model_profile, created_at, updated_at)"
                " VALUES (?, 'x', '', '')",
                (self._session,),
            )

    async def add(self, ts: datetime, type_: str, data: dict[str, Any]) -> None:
        self._seq += 1
        async with self._database.transaction() as tx:
            await tx.execute(
                "INSERT INTO events (session_id, seq, ts, type, run_id, message_id, data)"
                " VALUES (?, ?, ?, ?, NULL, NULL, ?)",
                (self._session, self._seq, ts.isoformat(), type_, json.dumps(data)),
            )

    async def started(self, call: str, agent: str, ts: datetime, index: int = 0) -> None:
        await self.add(
            ts,
            "helper.started",
            {
                "call_id": call,
                "index": index,
                "helper_id": f"h_{call}_{index}",
                "agent": agent,
                "label": agent,
                "model": "m",
                "wish": "cheapest",
                "pick_reason": "",
            },
        )

    async def ended(self, call: str, stopped: str, ts: datetime, index: int = 0) -> None:
        await self.add(
            ts,
            "helper.ended",
            {
                "call_id": call,
                "index": index,
                "stopped": stopped,
                "model_calls": 1,
                "tokens": 1,
                "answer_tokens": 1,
                "cost_usd": 0,
                "duration_ms": 1,
                "working_ms": 1,
            },
        )

    async def requested(self, call: str, name: str, ts: datetime, **args: str) -> None:
        await self.add(
            ts,
            "tool.requested",
            {"call_id": call, "message_id": "m1", "name": name, "args": {"brief": "b", **args}},
        )

    async def completed(self, call: str, preview: str, ts: datetime) -> None:
        await self.add(ts, "tool.completed", {"call_id": call, "summary": "s", "preview": preview})

    async def failed(self, call: str, ts: datetime) -> None:
        await self.add(ts, "tool.failed", {"call_id": call, "message": "nope"})


@pytest.fixture
async def database(tmp_path: Path) -> AsyncIterator[Database]:
    async with Database.open(tmp_path / "golem.db") as database:
        yield database


async def _fixture_log(database: Database) -> None:
    log = _Log(database)
    await log.open()
    recent = NOW - timedelta(days=1)
    # New shape: a helper is a session of its own, and the lead's log has started and ended.
    await log.requested("c1", "delegate", recent)
    await log.started("c1", "explorer", recent)
    await log.ended("c1", "done", recent)
    await log.started("c2", "explorer", recent)
    await log.ended("c2", "calls", recent)
    await log.started("c3", "explorer", recent)
    await log.ended("c3", "cancelled", recent)
    await log.started("c4", "explorer", recent)  # still running: used, not finished
    await log.started("c5", "reviewer", recent)
    await log.ended("c5", "done", recent)
    # Two helpers of one call count one each.
    await log.started("c6", "explorer", recent, index=0)
    await log.started("c6", "reviewer", recent, index=1)
    await log.ended("c6", "done", recent, index=1)
    # The 30-day edge: a start exactly 30 days ago counts, a second earlier does not.
    await log.started("edge_in", "explorer", CUTOFF)
    await log.ended("edge_in", "done", CUTOFF + timedelta(seconds=5))
    await log.started("edge_out", "explorer", CUTOFF - timedelta(seconds=1))
    await log.ended("edge_out", "done", CUTOFF + timedelta(seconds=5))
    # Old shape: only tool events. The agent defaults to explorer.
    await log.requested("o1", "delegate", recent)
    await log.completed("o1", "The answer.", recent)
    await log.requested("o2", "delegate", recent, agent="explorer")
    await log.completed("o2", "explorer finished: calls\n\nPartial.", recent)
    await log.requested("o3", "delegate", recent)
    await log.failed("o3", recent)
    await log.requested("o4", "delegate", recent)  # no outcome yet
    await log.requested("o5", "delegate", CUTOFF - timedelta(days=5))  # too old
    await log.completed("o5", "Old answer.", CUTOFF - timedelta(days=5))
    await log.requested("r1", "read_file", recent)  # not a delegate call


async def test_counts_new_shape_old_shape_and_the_30_day_edge(database: Database) -> None:
    await _fixture_log(database)

    counts = await AgentUsage(database, clock=lambda: NOW).counts()

    # explorer, new shape: c1 c2 c3 c4 c6 edge_in used; c1 and edge_in finished.
    # explorer, old shape: o1 o2 o3 o4 used (c1 has a tool.requested too and is not counted
    # twice); only o1 finished, since o2's result starts "explorer finished:".
    assert counts["explorer"] == AgentCount(used=10, finished=3)
    assert counts["reviewer"] == AgentCount(used=2, finished=2)
    assert set(counts) == {"explorer", "reviewer"}


async def test_nothing_is_counted_on_an_empty_store(database: Database) -> None:
    assert await AgentUsage(database, clock=lambda: NOW).counts() == {}


# --- the handlers -----------------------------------------------------------------------------


class _World:
    def __init__(self, home: Path, project: Path, state: DaemonState, trusted: set[Path]) -> None:
        self.home = home
        self.project = project
        self.state = state
        self.trusted = trusted

    async def call(self, method: str, params: dict[str, Any]) -> Any:
        spec = standard_methods()[method]
        context = RequestContext(self.state, cast(Any, None))
        return await spec.call(context, spec.params_model.model_validate(params))


@pytest.fixture
async def world(tmp_path: Path, database: Database) -> _World:
    home = tmp_path / "home"
    project = tmp_path / "project"
    home.mkdir()
    project.mkdir()
    trusted: set[Path] = set()
    registry = AgentRegistry(
        AgentSettings(),
        golem_agents=home / "agents",
        trusted=lambda root: root in trusted,
        user_home=home,
        bundled=bundled_agents_dir(),
    )
    state = DaemonState(paths=resolve_paths(home), started_at=0.0)
    state.agents = registry
    state.agent_usage = AgentUsage(database, clock=lambda: NOW)
    return _World(home, project, state, trusted)


def _trust(world: _World) -> None:
    world.trusted.add(world.project)


async def test_list_shows_bundled_user_and_trusted_project_agents(
    world: _World, database: Database
) -> None:
    _agent(world.home / "agents", "mine", "My own.")
    _agent(world.project / ".golem/agents", "local", "In the project.")
    _trust(world)
    await _fixture_log(database)

    result = await world.call("agents.list", {"cwd": str(world.project)})

    rows = [(a.name, a.origin, a.trusted) for a in result.agents]
    assert rows[:2] == [("local", "project", True), ("mine", "user", True)]
    assert {("explorer", "bundled", True), ("worker", "bundled", True)} <= set(rows)
    mine = next(a for a in result.agents if a.name == "mine")
    assert (mine.wish, mine.tools, mine.limits.max_calls) == ("cheapest", ["read_file"], 7)
    explorer = next(a for a in result.agents if a.name == "explorer")
    assert (explorer.used, explorer.finished) == (10, 3)
    assert (mine.used, mine.finished) == (0, 0)

    without = await world.call("agents.list", {})
    assert [a.origin for a in without.agents if a.name == "local"] == []
    assert [a.name for a in without.agents if a.origin == "user"] == ["mine"]


async def test_a_project_agent_of_an_untrusted_folder_is_blocked_not_offered(
    world: _World,
) -> None:
    _agent(world.project / ".golem/agents", "local", "In the project.", body="Secret prompt.")
    _agent(world.project / ".golem/agents", "explorer", "A look-alike.")

    listed = await world.call("agents.list", {"cwd": str(world.project)})
    blocked = [a for a in listed.agents if not a.trusted]
    assert sorted((a.name, a.origin) for a in blocked) == [
        ("explorer", "project"),
        ("local", "project"),
    ]

    only = await world.call("agents.get", {"name": "local", "cwd": str(world.project)})
    assert (only.trusted, only.prompt) == (False, "")
    # The look-alike does not take the bundled explorer's name.
    resolved = await world.call("agents.get", {"name": "explorer", "cwd": str(world.project)})
    assert (resolved.origin, resolved.trusted) == ("bundled", True)
    assert resolved.prompt != ""

    _trust(world)
    after = await world.call("agents.list", {"cwd": str(world.project)})
    assert all(a.trusted for a in after.agents)
    winner = await world.call("agents.get", {"name": "explorer", "cwd": str(world.project)})
    assert (winner.origin, winner.shadowed) == ("project", ["bundled"])


async def test_get_returns_the_prompt_and_an_unknown_name_is_invalid_params(
    world: _World,
) -> None:
    _agent(world.home / "agents", "mine", body="Do it well.")

    got = await world.call("agents.get", {"name": "mine"})

    assert (got.name, got.origin, got.prompt.strip()) == ("mine", "user", "Do it well.")
    with pytest.raises(RpcCallError) as raised:
        await world.call("agents.get", {"name": "nope"})
    assert raised.value.code == INVALID_PARAMS


async def test_a_broken_agent_is_listed_with_its_errors(world: _World) -> None:
    (world.home / "agents").mkdir()
    (world.home / "agents" / "broken.md").write_text("no frontmatter at all\n")

    listed = await world.call("agents.list", {})

    broken = next(a for a in listed.agents if a.name == "broken")
    assert broken.errors != []


async def test_without_a_store_the_counts_are_unknown(world: _World) -> None:
    world.state.agent_usage = None

    listed = await world.call("agents.list", {})

    assert {a.finished for a in listed.agents} == {None}
    assert AgentsListParams(cwd=None).cwd is None and AgentsGetParams(name="x").name == "x"


# --- over the socket --------------------------------------------------------------------------


async def test_the_daemon_answers_and_announces_a_change(short_home: Path) -> None:
    _agent(short_home / "agents", "mine", "My own.")
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        listed = rpc_result(await client.call("agents.list", {}))
        assert [a["name"] for a in cast(list[dict[str, Any]], listed["agents"])] == ["mine"]

        _agent(short_home / "agents", "second", "Another.")
        assert app.state.agents is not None
        assert app.state.agents.check() == [None]
        await client.take_events()
        notes = [n for n in client.notices if n.get("method") == "agent.registry.changed"]
        assert [n["params"] for n in notes] == [{"root": None}]

        got = rpc_result(await client.call("agents.get", {"name": "second"}))
        assert got["description"] == "Another."
        assert error_code(await client.call("agents.get", {"name": "nope"})) == INVALID_PARAMS
        assert error_code(await client.call("agents.list", {"cwd": "relative"})) == INVALID_PARAMS
    finally:
        await client.close()
        await stop_daemon(app, task)
