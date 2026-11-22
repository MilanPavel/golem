"""agents.list and agents.get, the counts of used and finished helpers, and the change signal.

No model is involved: the registry reads files, and the counts read stored events.
"""

from __future__ import annotations

import json
import tomllib
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
    # stopped: c2 c3 (new shape) and o2 o3 (old shape). The old calls have no cost, so the
    # explorer's cost cannot be said; the reviewer's is the sum of its two helper.ended events.
    assert counts["explorer"] == AgentCount(used=10, finished=3, stopped=4, cost_usd=None)
    assert counts["reviewer"] == AgentCount(used=2, finished=2, stopped=0, cost_usd=0.0)
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
    state.user_home = home
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
    assert (explorer.used, explorer.finished, explorer.stopped) == (10, 3, 4)
    assert explorer.cost_usd is None
    reviewer = next(a for a in result.agents if a.name == "reviewer")
    assert (reviewer.stopped, reviewer.cost_usd) == (0, 0.0)
    assert (mine.path, mine.text) == (
        "~/agents/mine.md",
        (world.home / "agents/mine.md").read_text(),
    )
    local = next(a for a in result.agents if a.name == "local")
    assert local.path == ".golem/agents/local.md"
    assert local.prompt == "Prompt."
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
    assert (only.text, only.path) == (None, ".golem/agents/local.md")
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
    assert {(a.stopped, a.cost_usd) for a in listed.agents} == {(None, None)}
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


# --- agents.save, agents.copy, agents.delete --------------------------------------------------


def _text(name: str = "mine", body: str = "Be brief.", extra: str = "") -> str:
    return f"---\nname: {name}\ndescription: Does a thing.\nmodel: cheapest\n{extra}---\n{body}\n"


def _folder(world: _World) -> Path:
    return world.state.paths.agents_dir


def _files(world: _World) -> list[str]:
    folder = _folder(world)
    return sorted(p.name for p in folder.iterdir()) if folder.exists() else []


async def test_copy_changes_the_prompt_and_delete_brings_the_bundled_one_back(
    world: _World,
) -> None:
    bundled = await world.call("agents.get", {"name": "reviewer"})
    assert bundled.origin == "bundled"

    copied = await world.call("agents.copy", {"name": "reviewer"})
    assert (copied.origin, copied.shadowed) == ("user", ["bundled"])
    assert (_folder(world) / "reviewer.md").read_bytes() == (
        bundled_agents_dir() / "reviewer.md"
    ).read_bytes()

    text = copied.text or ""
    changed = text.replace(bundled.prompt.strip(), "My own review prompt.")
    assert changed != text
    saved = await world.call("agents.save", {"text": changed, "name": "reviewer"})
    assert saved.ok and saved.agent is not None and saved.problems == []
    got = await world.call("agents.get", {"name": "reviewer"})
    assert (got.origin, got.prompt.strip()) == ("user", "My own review prompt.")

    deleted = await world.call("agents.delete", {"name": "reviewer"})
    assert deleted.agent is not None and deleted.agent.origin == "bundled"
    back = await world.call("agents.get", {"name": "reviewer"})
    assert (back.origin, back.prompt) == ("bundled", bundled.prompt)
    assert _files(world) == []


async def test_copy_is_refused_for_a_name_that_is_not_bundled_or_already_yours(
    world: _World,
) -> None:
    _agent(_folder(world), "mine")
    for name in ("mine", "nope"):
        with pytest.raises(RpcCallError) as raised:
            await world.call("agents.copy", {"name": name})
        assert raised.value.code == INVALID_PARAMS and "not a built-in" in str(raised.value)
    await world.call("agents.copy", {"name": "worker"})
    with pytest.raises(RpcCallError) as again:
        await world.call("agents.copy", {"name": "worker"})
    assert "already have" in str(again.value)


async def test_save_makes_a_new_agent_and_rename_removes_the_old_file(world: _World) -> None:
    created = await world.call("agents.save", {"text": _text("first")})
    assert created.ok and created.agent is not None
    assert (created.agent.name, created.agent.origin) == ("first", "user")
    assert _files(world) == ["first.md"]

    renamed = await world.call("agents.save", {"text": _text("second"), "name": "first"})
    assert renamed.ok
    assert _files(world) == ["second.md"]
    with pytest.raises(RpcCallError):
        await world.call("agents.get", {"name": "first"})

    same = await world.call("agents.save", {"text": _text("second", "New."), "name": "second"})
    assert same.ok
    assert (await world.call("agents.get", {"name": "second"})).prompt.strip() == "New."
    assert _files(world) == ["second.md"]


async def test_save_refuses_a_name_that_is_taken_or_a_file_that_is_not_there(
    world: _World,
) -> None:
    await world.call("agents.save", {"text": _text("a")})
    await world.call("agents.save", {"text": _text("b")})
    before = (_folder(world) / "a.md").read_bytes()

    taken = await world.call("agents.save", {"text": _text("a", "Other."), "name": "b"})
    assert not taken.ok and "already have" in taken.problems[0].message
    fresh = await world.call("agents.save", {"text": _text("a", "Other.")})
    assert not fresh.ok
    gone = await world.call("agents.save", {"text": _text("c"), "name": "zzz"})
    assert not gone.ok and "no agent file" in gone.problems[0].message
    assert (_folder(world) / "a.md").read_bytes() == before
    assert _files(world) == ["a.md", "b.md"]


async def test_save_with_problems_writes_nothing_and_gives_the_lines(world: _World) -> None:
    text = (
        "---\nname: mine\ndescription: Does a thing.\nmodel: cheapest\ntools: read_file, nope\n"
        "max-calls: lots\n---\nPrompt.\n"
    )
    result = await world.call("agents.save", {"text": text})
    assert not result.ok and result.agent is None
    lines = {(p.line, p.message.split("`")[1]) for p in result.problems}
    assert lines == {(5, "tools"), (6, "max-calls")}
    assert _files(world) == []

    no_name = await world.call("agents.save", {"text": "---\ndescription: x\n---\nPrompt.\n"})
    assert not no_name.ok and "`name` is missing" in no_name.problems[0].message
    assert no_name.problems[0].line is None
    bad_name = await world.call("agents.save", {"text": _text("Bad Name")})
    assert not bad_name.ok and bad_name.problems[0].line == 2
    no_front = await world.call("agents.save", {"text": "just text\n"})
    assert not no_front.ok
    assert _files(world) == []


async def test_a_name_with_a_path_cannot_write_or_delete_outside_the_folder(
    world: _World, tmp_path: Path
) -> None:
    outside = tmp_path / "outside.md"
    outside.write_text("keep me\n")
    victim = _folder(world).parent / "victim.md"
    victim.write_text("keep me too\n")
    names = ("../victim", "../outside", "a/b", "/etc/passwd", ".hidden", "..", "A", "x.md", "a_b")
    for name in names:
        saved = await world.call("agents.save", {"text": _text(name)})
        assert not saved.ok, name
        replaced = await world.call("agents.save", {"text": _text("ok"), "name": name})
        assert not replaced.ok, name
        for method in ("agents.copy", "agents.delete"):
            with pytest.raises(RpcCallError) as raised:
                await world.call(method, {"name": name})
            assert raised.value.code == INVALID_PARAMS, (method, name)
    assert victim.read_text() == "keep me too\n" and outside.read_text() == "keep me\n"
    assert _files(world) == []


async def test_a_symlinked_file_is_not_written_through(world: _World, tmp_path: Path) -> None:
    target = tmp_path / "elsewhere.md"
    target.write_text("keep me\n")
    _folder(world).mkdir(parents=True)
    (_folder(world) / "link.md").symlink_to(target)

    result = await world.call("agents.save", {"text": _text("link"), "name": "link"})
    assert not result.ok
    with pytest.raises(RpcCallError):
        await world.call("agents.delete", {"name": "link"})
    assert target.read_text() == "keep me\n"


async def test_delete_refuses_bundled_project_and_unknown_agents(world: _World) -> None:
    _agent(world.project / ".golem/agents", "local")
    _trust(world)
    cwd = str(world.project)
    for name, words in (
        ("explorer", "built-in"),
        ("local", "project agent"),
        ("nothing", "no agent file"),
    ):
        with pytest.raises(RpcCallError) as raised:
            await world.call("agents.delete", {"name": name, "cwd": cwd})
        assert raised.value.code == INVALID_PARAMS and words in str(raised.value)
    assert (world.project / ".golem/agents/local.md").exists()

    await world.call("agents.save", {"text": _text("gone")})
    result = await world.call("agents.delete", {"name": "gone"})
    assert result.agent is None


# --- agents.set_limits, agents.set_default_limits ---------------------------------------------


def _config(world: _World) -> dict[str, Any]:
    path = world.state.paths.config_file
    return tomllib.loads(path.read_text()) if path.exists() else {}


def _write_config(world: _World, text: str) -> None:
    world.state.paths.config_file.write_text(text)


async def test_list_and_get_show_the_resolved_limits_and_which_come_from_config(
    world: _World,
) -> None:
    _agent(_folder(world), "mine")
    _write_config(
        world,
        "[agents]\nmax_tokens = 9000\nmax_cost = 2.0\n"
        "[agents.worker]\nmax_calls = 4\n[agents.explorer]\ntimeout_seconds = 120\n",
    )

    listed = {a.name: a for a in (await world.call("agents.list", {})).agents}

    worker = listed["worker"]
    assert worker.limits.max_calls == 4
    assert (worker.limits.max_tokens, worker.limits.max_cost_usd) == (9000, 2.0)
    assert worker.limits_from_config == ["max_calls"]
    explorer = listed["explorer"]
    assert explorer.limits.max_seconds == 120
    assert explorer.limits_from_config == ["max_seconds"]
    assert listed["reviewer"].limits_from_config == []
    mine = listed["mine"]
    assert (mine.limits.max_calls, mine.limits.max_tokens) == (7, 9000)
    assert mine.limits_from_config == []
    assert (mine.text or "").count("max-calls: 7") == 1
    got = await world.call("agents.get", {"name": "worker"})
    assert got.limits.max_calls == 4 and got.limits_from_config == ["max_calls"]


async def test_set_and_clear_each_limit_of_a_bundled_type(world: _World) -> None:
    _write_config(world, "# mine\n[agents.worker]\nmodel = 'cheapest'\n")
    info = await world.call(
        "agents.set_limits",
        {
            "name": "worker",
            "max_calls": 5,
            "working_seconds": 90,
            "max_cost": 0.5,
            "max_tokens": 4000,
        },
    )
    table = _config(world)["agents"]["worker"]
    assert table == {
        "model": "cheapest",
        "max_calls": 5,
        "working_seconds": 90,
        "max_cost": 0.5,
        "max_tokens": 4000,
    }
    assert world.state.paths.config_file.read_text().startswith("# mine")
    assert (info.limits.max_calls, info.limits.max_seconds) == (5, 90)
    assert (info.limits.max_cost_usd, info.limits.max_tokens) == (0.5, 4000)
    assert info.limits_from_config == ["max_calls", "max_seconds", "max_cost_usd", "max_tokens"]

    for key in ("max_calls", "working_seconds", "max_cost", "max_tokens"):
        cleared = await world.call("agents.set_limits", {"name": "worker", "clear": [key]})
        assert key not in _config(world)["agents"]["worker"]
    assert _config(world)["agents"]["worker"] == {"model": "cheapest"}
    assert cleared.limits_from_config == []
    assert cleared.limits.max_calls == 30  # the bundled file

    untouched = await world.call("agents.set_limits", {"name": "worker", "max_calls": 3})
    again = await world.call("agents.set_limits", {"name": "worker", "max_tokens": 10})
    assert untouched.limits.max_calls == 3 and again.limits.max_calls == 3
    assert _config(world)["agents"]["worker"]["max_calls"] == 3


async def test_the_explorers_old_timeout_key_is_replaced(world: _World) -> None:
    _write_config(world, "[agents.explorer]\ntimeout_seconds = 120\nanswer_chars = 500\n")
    info = await world.call("agents.set_limits", {"name": "explorer", "working_seconds": 60})
    assert _config(world)["agents"]["explorer"] == {"answer_chars": 500, "working_seconds": 60}
    assert info.limits.max_seconds == 60
    assert info.limits_from_config == ["max_seconds", "answer_chars"]

    _write_config(world, "[agents.explorer]\ntimeout_seconds = 120\n")
    cleared = await world.call(
        "agents.set_limits", {"name": "explorer", "clear": ["working_seconds"]}
    )
    assert "agents" not in _config(world)
    assert cleared.limits_from_config == []
    assert cleared.limits.max_seconds != 120


async def test_set_and_clear_each_limit_of_your_own_agent(world: _World) -> None:
    text = (
        "---\n# mine\nname: mine\ndescription: Does a thing.   # keep\nmodel: cheapest\n"
        "max-calls: 7   # seven\nmax-tokens: 100\n---\nBody.\n\n  indented\n"
    )
    path = _folder(world) / "mine.md"
    _folder(world).mkdir(parents=True)
    path.write_text(text)

    info = await world.call(
        "agents.set_limits",
        {
            "name": "mine",
            "max_calls": 9,
            "working_seconds": 30,
            "max_cost": 1.5,
            "clear": ["max_tokens"],
        },
    )

    expected = (
        "---\n# mine\nname: mine\ndescription: Does a thing.   # keep\nmodel: cheapest\n"
        "max-calls: 9   # seven\nmax-seconds: 30\nmax-cost-usd: 1.5\n---\nBody.\n\n  indented\n"
    )
    assert path.read_text() == expected
    assert (info.limits.max_calls, info.limits.max_seconds) == (9, 30)
    assert (info.limits.max_cost_usd, info.limits.max_tokens) == (1.5, None)
    assert info.limits_from_config == []
    assert info.text == expected

    for key in ("max_calls", "working_seconds", "max_cost"):
        await world.call("agents.set_limits", {"name": "mine", "clear": [key]})
    assert path.read_text() == text.replace("max-calls: 7   # seven\nmax-tokens: 100\n", "")
    assert not world.state.paths.config_file.exists()


async def test_set_limits_refuses_a_project_agent_and_wrong_values_and_writes_nothing(
    world: _World,
) -> None:
    _agent(world.project / ".golem/agents", "local")
    _trust(world)
    cwd = str(world.project)
    before = (world.project / ".golem/agents/local.md").read_text()
    with pytest.raises(RpcCallError) as project:
        await world.call("agents.set_limits", {"name": "local", "cwd": cwd, "max_calls": 2})
    assert project.value.code == INVALID_PARAMS and "read-only" in str(project.value)
    assert (world.project / ".golem/agents/local.md").read_text() == before

    _agent(_folder(world), "mine")
    mine = (_folder(world) / "mine.md").read_text()
    bad: list[tuple[str, dict[str, Any], str]] = [
        ("worker", {"max_calls": 0}, "max_calls must be a whole number"),
        ("worker", {"working_seconds": 0}, "working_seconds must be"),
        ("worker", {"max_tokens": -5}, "max_tokens must be"),
        ("worker", {"max_cost": -0.1}, "max_cost must be 0 or more"),
        ("worker", {"max_calls": 2, "clear": ["max_calls"]}, "both set and cleared"),
        ("explorer", {"max_calls": 51}, "50 or less"),
        ("mine", {"max_cost": 0}, "above 0"),
        ("mine", {"max_calls": 0}, "max_calls"),
        ("nope", {"max_calls": 2}, "no agent named"),
    ]
    for name, params, words in bad:
        with pytest.raises(RpcCallError) as raised:
            await world.call("agents.set_limits", {"name": name, **params})
        assert raised.value.code == INVALID_PARAMS and words in str(raised.value), (name, params)
    assert not world.state.paths.config_file.exists()
    assert (_folder(world) / "mine.md").read_text() == mine
    ok = await world.call("agents.set_limits", {"name": "explorer", "max_calls": 50})
    assert ok.limits.max_calls == 50


async def test_default_limits_are_set_cleared_and_read_with_keep(world: _World) -> None:
    _write_config(world, "# mine\n[agents]\nkeep_days = 3\n")
    got = await world.call("agents.keep", {})
    assert (got.values.max_calls, got.values.max_cost) == (None, None)

    saved = await world.call(
        "agents.set_default_limits",
        {"max_calls": 8, "working_seconds": 120, "max_cost": 0.25, "max_tokens": 5000},
    )
    assert saved.ok and saved.values is not None
    assert (saved.values.max_calls, saved.values.working_seconds) == (8, 120)
    assert (saved.values.max_cost, saved.values.max_tokens) == (0.25, 5000)
    assert saved.values.keep_days == 3
    assert _config(world)["agents"] == {
        "keep_days": 3,
        "max_calls": 8,
        "working_seconds": 120,
        "max_cost": 0.25,
        "max_tokens": 5000,
    }
    assert world.state.paths.config_file.read_text().startswith("# mine")
    worker = await world.call("agents.get", {"name": "worker"})
    assert (worker.limits.max_cost_usd, worker.limits_from_config) == (0.25, [])

    cleared = await world.call(
        "agents.set_default_limits", {"clear": ["max_calls", "working_seconds", "max_cost"]}
    )
    assert cleared.values is not None
    assert (cleared.values.max_calls, cleared.values.max_tokens) == (None, 5000)
    assert _config(world)["agents"] == {"keep_days": 3, "max_tokens": 5000}

    wrong = await world.call("agents.set_default_limits", {"max_calls": 0, "max_tokens": 1})
    assert not wrong.ok and wrong.errors[0].path == "agents.max_calls"
    assert _config(world)["agents"] == {"keep_days": 3, "max_tokens": 5000}


async def test_set_limits_on_your_own_file_removes_the_config_keys_that_would_win(
    world: _World,
) -> None:
    _folder(world).mkdir(parents=True)
    (_folder(world) / "explorer.md").write_text(_text("explorer", extra="max-calls: 5\n"))
    _write_config(
        world, "[agents.explorer]\nmax_calls = 9\ntimeout_seconds = 120\nanswer_chars = 500\n"
    )

    info = await world.call("agents.set_limits", {"name": "explorer", "max_calls": 20})

    assert "max-calls: 20\n" in (_folder(world) / "explorer.md").read_text()
    assert _config(world)["agents"]["explorer"] == {"timeout_seconds": 120, "answer_chars": 500}
    assert info.limits.max_calls == 20
    assert "max_calls" not in info.limits_from_config

    listed = {a.name: a for a in (await world.call("agents.list", {})).agents}
    assert listed["explorer"].limits.max_calls == 20

    await world.call("agents.set_limits", {"name": "explorer", "working_seconds": 45})
    assert _config(world)["agents"]["explorer"] == {"answer_chars": 500}
