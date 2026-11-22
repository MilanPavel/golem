"""resolves_to in agents.list and agents.get, and agents.set_wish (ADR-059, #1305).

The pick is the one a helper gets (``test_helper_model``); here: what the handlers report for it
in the three setups, and where a wish is written for each kind of agent file.
"""

# pyright: reportPrivateUsage=false
from __future__ import annotations

import hashlib
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any, cast

import pytest
from fakes import FixedFacts, model_facts
from test_helper_sessions import _LIVE, _Chat  # pyright: ignore
from test_server import HELLO, RpcClient, error_code, rpc_result, start_daemon, stop_daemon

from golem.agents.bundled import bundled_agents_dir
from golem.agents.edit import AgentEditError, with_wish
from golem.agents.registry import AgentRegistry
from golem.config import (
    BUNDLED_TYPES,
    AgentSettings,
    GolemSettings,
    LadderSettings,
    RoleSettings,
    RoutingSettings,
    load_settings,
)
from golem.paths import resolve_paths
from golem.server.dispatcher import INVALID_PARAMS, RequestContext, RpcCallError
from golem.server.handlers import standard_methods
from golem.server.state import DaemonState
from golem.sessions.helpers import snapshot_of
from golem.store.database import Database

LOCAL = "ollama/qwen3:8b"
OTHER_LOCAL = "ollama/gemma3:12b"
CHEAP = "deepseek/chat"
BIG = "anthropic/big"

FILE = (
    "---\n"
    "# my reviewer\n"
    "description: Reviews a diff.   # keep this\n"
    "model: cheapest   # was cheap\n"
    "tools: read_file\n"
    "---\n"
    "Body line one.\n\n  indented\n"
)


def _local() -> FixedFacts:
    return FixedFacts(model_facts(LOCAL, "local"), model_facts(OTHER_LOCAL, "local", 64000))


def _cloud() -> FixedFacts:
    return FixedFacts(
        model_facts(CHEAP, "budget", price=0.5), model_facts(BIG, "frontier", price=5.0)
    )


def _mixed() -> FixedFacts:
    return FixedFacts(
        model_facts(LOCAL, "local"),
        model_facts(CHEAP, "budget", price=0.5),
        model_facts(BIG, "frontier", price=5.0),
    )


def _settings(default: str, *, local_only: Path | None = None, explore: str = "session") -> Any:
    return GolemSettings(
        default_model=default,
        routing=RoutingSettings(
            ladder=LadderSettings(frontier=BIG),
            local_only=[] if local_only is None else [str(local_only)],
            roles=RoleSettings(explore=explore),
        ),
    )


def _write(folder: Path, name: str, text: str = FILE) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{name}.md"
    path.write_text(text, encoding="utf-8")
    return path


class _World:
    def __init__(
        self,
        home: Path,
        project: Path,
        chat: _Chat,
        trusted: set[Path],
        bundled: Path | None = None,
    ) -> None:
        self.home, self.project, self.chat, self.trusted = home, project, chat, trusted
        self.config = resolve_paths(home).config_file
        self.registry = AgentRegistry(
            AgentSettings(),
            golem_agents=home / "agents",
            trusted=lambda root: root in trusted,
            user_home=home,
            bundled=bundled if bundled is not None else bundled_agents_dir(),
            config_file=self.config,
            load_settings=lambda: load_settings(home=home, project_dir=home).agents,
        )
        self.state = DaemonState(paths=resolve_paths(home), started_at=0.0)
        self.state.agents = self.registry
        self.state.sessions = chat.manager
        chat.manager._agents = self.registry

    async def call(self, method: str, params: dict[str, Any]) -> Any:
        spec = standard_methods()[method]
        context = RequestContext(self.state, cast(Any, None))
        return await spec.call(context, spec.params_model.model_validate(params))

    async def agent(self, name: str, cwd: Path | None = None) -> Any:
        params = {} if cwd is None else {"cwd": str(cwd)}
        listed = await self.call("agents.list", params)
        return next(a for a in listed.agents if a.name == name and a.trusted)


@pytest.fixture(autouse=True)
async def _settled(database: Database) -> AsyncIterator[None]:
    yield
    for chat in _LIVE:
        await chat.manager.cancel_all()
    _LIVE.clear()


@pytest.fixture
def make(database: Database, tmp_path: Path) -> Any:
    def build(
        default: str,
        facts: FixedFacts | None,
        *,
        local_only: bool = False,
        explore: str = "session",
        bundled: Path | None = None,
    ) -> _World:
        home = tmp_path / "home"
        project = tmp_path / "project"
        home.mkdir(exist_ok=True)
        project.mkdir(exist_ok=True)
        settings = _settings(default, local_only=project if local_only else None, explore=explore)
        chat = _Chat(database, ["done"], settings=settings, home=tmp_path)
        if facts is not None:
            chat.manager.facts = facts
        return _World(home, project, chat, set(), bundled)

    return build


# --- the text edit ---------------------------------------------------------------------------


def test_the_wish_line_is_rewritten_and_the_rest_is_kept_byte_for_byte() -> None:
    changed = with_wish(FILE, "stronger")

    assert changed == FILE.replace("model: cheapest   # was cheap", "model: stronger   # was cheap")


def test_a_missing_key_is_added_at_the_end_of_the_frontmatter() -> None:
    text = "---\ndescription: d\n# note\n---\nBody\n"

    assert with_wish(text, "same") == "---\ndescription: d\n# note\nmodel: same\n---\nBody\n"


def test_crlf_files_keep_their_line_endings() -> None:
    text = "---\r\ndescription: d\r\nmodel: same\r\n---\r\nBody\r\n"

    assert with_wish(text, "frontier") == text.replace("model: same", "model: frontier")
    assert with_wish("---\r\ndescription: d\r\n---\r\nB\r\n", "same").count("\r\n") == 5


@pytest.mark.parametrize("wish", ["", "two words", "true", "a: b", "# no", "[x]"])
def test_a_wish_the_parser_would_not_read_back_is_refused(wish: str) -> None:
    with pytest.raises(AgentEditError):
        with_wish(FILE, wish)


def test_a_file_without_frontmatter_is_refused() -> None:
    with pytest.raises(AgentEditError):
        with_wish("just a prompt\n", "same")


# --- resolves_to -----------------------------------------------------------------------------


async def test_local_models_only_every_wish_resolves_to_a_local_model(make: Any) -> None:
    world = make(LOCAL, _local())
    for wish in ("cheapest", "same", "stronger", "frontier", "budget"):
        _write(world.home / "agents", "mine", FILE.replace("cheapest", wish))
        world.registry.check()
        found = await world.agent("mine")
        assert found.resolves_to.tier == "local", wish
        assert found.resolves_to.model in (LOCAL, OTHER_LOCAL), wish
    # stronger has no tier above: the same model with a fresh window, and no paid question
    _write(world.home / "agents", "mine", FILE.replace("cheapest", "stronger"))
    got = (await world.agent("mine")).resolves_to
    assert (got.model, got.fresh_window) == (LOCAL, True)
    assert "waits for your yes" not in got.reason


async def test_cloud_models_only_cheapest_is_the_cheapest_hosted_and_stronger_the_next(
    make: Any,
) -> None:
    world = make(CHEAP, _cloud())
    explorer = (await world.agent("explorer")).resolves_to
    assert (explorer.model, explorer.tier) == (CHEAP, "budget")
    reviewer = (await world.agent("reviewer")).resolves_to  # stronger
    assert (reviewer.model, reviewer.tier, reviewer.fresh_window) == (BIG, "frontier", False)
    assert "waits for your yes" not in reviewer.reason  # a paid lead asks nothing
    got = await world.call("agents.get", {"name": "reviewer"})
    assert got.resolves_to == (await world.agent("reviewer")).resolves_to


async def test_mixed_setup_a_paid_wish_is_reported_and_says_it_asks_first(make: Any) -> None:
    world = make(LOCAL, _mixed())

    cheapest = (await world.agent("explorer")).resolves_to
    assert (cheapest.model, cheapest.tier) == (LOCAL, "local")
    stronger = (await world.agent("advisor")).resolves_to
    assert (stronger.model, stronger.tier) == (CHEAP, "budget")
    assert "waits for your yes" in stronger.reason
    assert len(stronger.reason) <= 200


async def test_a_local_only_folder_resolves_every_wish_to_a_local_model(make: Any) -> None:
    world = make(LOCAL, _mixed(), local_only=True)

    inside = await world.agent("advisor", world.project)
    assert (inside.resolves_to.model, inside.resolves_to.tier) == (LOCAL, "local")
    assert inside.resolves_to.fresh_window is True
    elsewhere = await world.agent("advisor")
    assert elsewhere.resolves_to.tier == "budget"  # a paid pick, outside the folder


async def test_without_model_facts_resolves_to_is_left_out(make: Any) -> None:
    world = make(LOCAL, None)

    assert (await world.agent("explorer")).resolves_to is None
    world.state.sessions = None
    assert (await world.agent("explorer")).resolves_to is None


async def test_the_explorer_follows_roles_explore_and_says_so(make: Any) -> None:
    world = make(CHEAP, _cloud(), explore=BIG)

    found = await world.agent("explorer")

    assert found.wish == "cheapest"  # the file
    assert found.resolves_to.model == BIG
    assert "[routing.roles] explore" in found.resolves_to.reason


# --- set_wish --------------------------------------------------------------------------------


async def test_a_user_agent_keeps_its_comments_and_body(make: Any) -> None:
    world = make(CHEAP, _cloud())
    path = _write(world.home / "agents", "mine")

    result = await world.call("agents.set_wish", {"name": "mine", "wish": "stronger"})

    assert path.read_text(encoding="utf-8") == FILE.replace(
        "model: cheapest   # was cheap", "model: stronger   # was cheap"
    )
    assert (result.origin, result.wish, result.resolves_to.model) == ("user", "stronger", BIG)
    assert (await world.agent("mine")).wish == "stronger"


def _agents_folder_files(world: _World) -> list[Path]:
    folder = world.home / "agents"
    return sorted(folder.iterdir()) if folder.is_dir() else []


async def test_a_bundled_type_gets_a_config_key_not_a_copy(make: Any) -> None:
    world = make(CHEAP, _cloud())
    world.config.write_text("# my settings\n[agents.explorer]\nmax_calls = 20  # keep\n")
    bundled = bundled_agents_dir() / "explorer.md"
    before = hashlib.sha256(bundled.read_bytes()).hexdigest()

    result = await world.call("agents.set_wish", {"name": "explorer", "wish": "stronger"})

    config = world.config.read_text(encoding="utf-8")
    assert config.startswith("# my settings\n")
    assert "max_calls = 20  # keep" in config
    assert 'model = "stronger"' in config
    assert _agents_folder_files(world) == []
    assert hashlib.sha256(bundled.read_bytes()).hexdigest() == before
    assert (result.origin, result.wish, result.shadowed) == ("bundled", "stronger", [])
    assert result.resolves_to.model == BIG
    assert (await world.agent("explorer")).wish == "stronger"
    assert load_settings(home=world.home, project_dir=world.home).agents.explorer.max_calls == 20


async def test_a_helper_gets_the_new_bundled_prompt_and_the_set_wish(
    make: Any, tmp_path: Path
) -> None:
    folder = tmp_path / "bundled"
    folder.mkdir()
    explorer = (bundled_agents_dir() / "explorer.md").read_text(encoding="utf-8")
    (folder / "explorer.md").write_text(explorer, encoding="utf-8")
    world = make(CHEAP, _cloud(), bundled=folder)
    await world.call("agents.set_wish", {"name": "explorer", "wish": "stronger"})

    # A new release ships another prompt for the same type.
    (folder / "explorer.md").write_text(explorer + "\nNew release line.\n", encoding="utf-8")
    agent = world.registry.view(world.project).get("explorer")

    assert agent is not None
    assert "New release line." in agent.body
    assert agent.wish == "stronger"
    snapshot = snapshot_of(agent, "bundled", agent.tools, AgentSettings())
    lead = await world.chat.manager.create(CHEAP, cwd=str(world.project))
    ref = await world.chat.manager.start_helper(
        lead, "call-1", 0, snapshot, "look", CHEAP, str(world.project)
    )
    await world.chat.until(ref.session_id, "session.completed")
    assert ref.model == BIG


async def test_a_user_file_of_the_same_name_wins_and_is_edited_in_place(make: Any) -> None:
    world = make(CHEAP, _cloud())
    path = _write(world.home / "agents", "explorer")
    world.config.write_text('[agents.explorer]\nmodel = "frontier"\n')
    world.registry.check()

    assert (await world.agent("explorer")).wish == "cheapest"  # the file wins over the key
    result = await world.call("agents.set_wish", {"name": "explorer", "wish": "same"})

    assert "model: same   # was cheap" in path.read_text(encoding="utf-8")
    assert world.config.read_text(encoding="utf-8") == '[agents.explorer]\nmodel = "frontier"\n'
    assert (result.origin, result.wish) == ("user", "same")


async def test_a_copy_from_the_earlier_version_keeps_working(make: Any) -> None:
    world = make(CHEAP, _cloud())
    bundled = (bundled_agents_dir() / "explorer.md").read_text(encoding="utf-8")
    copy = _write(
        world.home / "agents", "explorer", bundled.replace("model: cheapest", "model: stronger")
    )

    found = await world.agent("explorer")

    assert (found.origin, found.wish, found.shadowed) == ("user", "stronger", ["bundled"])
    assert copy.is_file()


async def test_a_bad_wish_for_a_bundled_type_writes_nothing(make: Any) -> None:
    world = make(CHEAP, _cloud())
    with pytest.raises(RpcCallError) as raised:
        await world.call("agents.set_wish", {"name": "explorer", "wish": "a b"})
    assert raised.value.code == INVALID_PARAMS
    assert not world.config.exists()


async def test_resolves_to_follows_the_key_with_local_models_only(make: Any) -> None:
    world = make(LOCAL, _local())

    result = await world.call("agents.set_wish", {"name": "reviewer", "wish": OTHER_LOCAL})

    assert result.wish == OTHER_LOCAL
    assert result.resolves_to.tier == "local"
    assert result.resolves_to.model == OTHER_LOCAL
    assert not (world.home / "agents").exists()


async def test_resolves_to_follows_the_key_with_cloud_models_only(make: Any) -> None:
    world = make(CHEAP, _cloud())

    result = await world.call("agents.set_wish", {"name": "reviewer", "wish": "frontier"})

    assert result.wish == "frontier"
    assert result.resolves_to.model == BIG
    assert result.resolves_to.tier == "frontier"


def test_the_config_takes_a_model_for_every_bundled_type_and_old_configs_load() -> None:
    names = {path.stem for path in bundled_agents_dir().glob("*.md")}
    assert names == set(BUNDLED_TYPES)
    old = AgentSettings.model_validate({"explorer": {"max_calls": 9}})
    assert old.explorer.max_calls == 9
    assert old.wish_for("explorer") is None
    new = AgentSettings.model_validate({name: {"model": "same"} for name in BUNDLED_TYPES})
    assert all(new.wish_for(name) == "same" for name in BUNDLED_TYPES)
    assert new.wish_for("mine") is None
    with pytest.raises(ValueError):
        AgentSettings.model_validate({"mine": {"model": "same"}})
    with pytest.raises(ValueError):
        AgentSettings.model_validate({"worker": {"model": "a b"}})


async def test_set_wish_on_the_explorer_writes_the_key_and_roles_explore_still_wins(
    make: Any,
) -> None:
    world = make(CHEAP, _cloud(), explore=CHEAP)

    result = await world.call("agents.set_wish", {"name": "explorer", "wish": "frontier"})

    assert result.wish == "frontier"
    assert result.resolves_to.model == CHEAP
    assert "[routing.roles] explore" in result.resolves_to.reason


async def test_a_project_agent_is_changed_only_in_a_trusted_project(make: Any) -> None:
    world = make(CHEAP, _cloud())
    path = _write(world.project / ".golem/agents", "local")
    params = {"name": "local", "wish": "stronger", "cwd": str(world.project)}

    with pytest.raises(RpcCallError) as raised:
        await world.call("agents.set_wish", params)
    assert raised.value.code == INVALID_PARAMS
    assert "trusted_projects" in str(raised.value)
    assert path.read_text(encoding="utf-8") == FILE

    world.trusted.add(world.project)
    result = await world.call("agents.set_wish", params)
    assert (result.origin, result.wish) == ("project", "stronger")
    assert "model: stronger" in path.read_text(encoding="utf-8")


async def test_an_untrusted_project_cannot_shadow_a_bundled_type_either(make: Any) -> None:
    world = make(CHEAP, _cloud())
    look_alike = _write(world.project / ".golem/agents", "explorer")

    await world.call(
        "agents.set_wish", {"name": "explorer", "wish": "same", "cwd": str(world.project)}
    )

    assert look_alike.read_text(encoding="utf-8") == FILE
    assert 'model = "same"' in world.config.read_text(encoding="utf-8")
    assert not (world.home / "agents").exists()


@pytest.mark.parametrize(
    ("name", "wish", "words"),
    [("nope", "same", "no agent named nope"), ("mine", "two words", "not a wish")],
)
async def test_an_unknown_name_and_a_bad_wish_are_readable_errors(
    make: Any, name: str, wish: str, words: str
) -> None:
    world = make(CHEAP, _cloud())
    path = _write(world.home / "agents", "mine")

    with pytest.raises(RpcCallError) as raised:
        await world.call("agents.set_wish", {"name": name, "wish": wish})

    assert raised.value.code == INVALID_PARAMS
    assert words in str(raised.value)
    assert path.read_text(encoding="utf-8") == FILE


async def test_a_broken_agent_file_is_a_readable_error_and_is_not_touched(make: Any) -> None:
    world = make(CHEAP, _cloud())
    path = _write(world.home / "agents", "broken", "no frontmatter at all\n")

    with pytest.raises(RpcCallError) as raised:
        await world.call("agents.set_wish", {"name": "broken", "wish": "same"})

    assert raised.value.code == INVALID_PARAMS
    assert "has errors" in str(raised.value)
    assert path.read_text(encoding="utf-8") == "no frontmatter at all\n"


async def test_a_broken_user_copy_of_a_bundled_type_is_left_alone(make: Any) -> None:
    world = make(CHEAP, _cloud())
    path = _write(world.home / "agents", "explorer", "broken\n")

    result = await world.call("agents.set_wish", {"name": "explorer", "wish": "same"})

    assert (result.origin, result.wish) == ("bundled", "same")  # a broken file never wins
    assert path.read_text(encoding="utf-8") == "broken\n"


# --- over the socket -------------------------------------------------------------------------


async def test_the_method_over_the_socket(short_home: Path) -> None:
    path = _write(short_home / "agents", "mine")
    app, task = await start_daemon(short_home)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        done = rpc_result(await client.call("agents.set_wish", {"name": "mine", "wish": "same"}))
        assert (done["name"], done["wish"], done["origin"]) == ("mine", "same", "user")
        assert "model: same   # was cheap" in path.read_text(encoding="utf-8")
        got = rpc_result(await client.call("agents.get", {"name": "mine"}))
        assert got["wish"] == "same"
        bad = await client.call("agents.set_wish", {"name": "mine", "wish": "a b"})
        assert error_code(bad) == INVALID_PARAMS
        assert error_code(await client.call("agents.set_wish", {"name": "x"})) == INVALID_PARAMS
    finally:
        await client.close()
        await stop_daemon(app, task)
