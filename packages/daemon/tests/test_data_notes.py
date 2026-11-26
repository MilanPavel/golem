"""The notes of a data source: where they live, how they are read, saved and drafted."""

from __future__ import annotations

from collections.abc import AsyncIterator, Callable
from pathlib import Path
from typing import Any, cast

import pytest
from fakes import ScriptedChatModel
from test_server import HELLO, RpcClient, error_code, rpc_result, start_daemon, stop_daemon

from golem.config import DataSettings
from golem.data import builtin
from golem.data.client import DataWorker, Timing
from golem.data.draft import build_prompt, clean
from golem.data.notes import CUT_NOTE, MAX_BYTES, read_notes, write_notes
from golem.data.sources import DataSources
from golem.data.tools import DATA_DESCRIBE
from golem.models.router import ModelRouter
from golem.paths import GolemPaths
from golem.server.dispatcher import BUDGET_SPENT, INVALID_PARAMS
from golem.sessions.drafts import ModelDrafts
from golem.store.database import Database
from golem.tools.registry import ToolContext

FAST = Timing(backoff_first=0.05, backoff_max=0.2, kill_after=0.3, stop_seconds=1.0)
Make = Callable[..., DataSources]


@pytest.fixture
async def paths(tmp_path: Path) -> GolemPaths:
    found = GolemPaths(tmp_path / "home")
    found.ensure_layout()
    async with Database.open(found.database_file):
        pass
    return found


@pytest.fixture
async def make(paths: GolemPaths) -> AsyncIterator[Make]:
    opened: list[DataSources] = []

    def build(trusted: Callable[[Path], bool] = lambda _root: False) -> DataSources:
        worker = DataWorker(DataSettings(query_timeout_seconds=10, threads=1), paths, timing=FAST)
        found = DataSources(worker, paths, trusted=trusted)
        opened.append(found)
        return found

    yield build
    for found in opened:
        await found.close()


def _config(paths: GolemPaths, text: str) -> None:
    paths.config_file.parent.mkdir(parents=True, exist_ok=True)
    paths.config_file.write_text(text, encoding="utf-8")


def _shop(folder: Path) -> Path:
    shop = folder / "shop"
    shop.mkdir(parents=True, exist_ok=True)
    (shop / "orders.csv").write_text("id,total\n1,10\n2,32.5\n3,7\n")
    return shop


def _trusted(_root: Path) -> bool:
    return True


def _ctx(sources: DataSources) -> ToolContext:
    return ToolContext(root=None, data=sources.access(None))


# -- where the notes live ----------------------------------------------------------------------


async def test_notes_live_in_the_users_data_folder_or_the_projects(
    make: Make,
    paths: GolemPaths,
    tmp_path: Path,
) -> None:
    shop = _shop(paths.home.parent)
    project = tmp_path / "proj"
    (project / ".golem").mkdir(parents=True)
    (project / ".golem" / "config.toml").write_text(
        f'[data.local_shop]\npath = "{shop}/*.csv"\n', encoding="utf-8"
    )
    _config(paths, f'[data.shop]\npath = "{shop}/*.csv"\n')
    sources = make(trusted=_trusted)
    assert sources.notes_path(None, "shop") == paths.home / "data" / "shop" / "DATA.md"
    assert sources.notes_path(None, "golem") == paths.home / "data" / "golem" / "DATA.md"
    found = sources.notes_path(project, "local_shop")
    assert found == project.resolve() / ".golem" / "data" / "local_shop" / "DATA.md"


async def test_the_builtin_source_falls_back_to_its_default_notes(
    make: Make,
    paths: GolemPaths,
) -> None:
    sources = make()
    assert (await sources.describe(None, "golem")).notes == builtin.NOTES
    mine = paths.home / "data" / "golem" / "DATA.md"
    write_notes(mine, "my own words")
    assert (await sources.describe(None, "golem")).notes == "my own words\n"
    write_notes(mine, "  \n")
    assert not mine.exists()
    assert (await sources.describe(None, "golem")).notes == builtin.NOTES


def test_a_file_over_16_kb_is_cut_for_the_model_and_whole_for_a_person(tmp_path: Path) -> None:
    path = tmp_path / "DATA.md"
    path.write_text("é" * MAX_BYTES, encoding="utf-8")  # 32 KB
    cut = read_notes(path)
    assert cut is not None and cut.cut and len(cut.text.encode()) <= MAX_BYTES
    whole = read_notes(path, None)
    assert whole is not None and not whole.cut and len(whole.text) == MAX_BYTES
    assert read_notes(tmp_path / "missing.md") is None


async def test_data_describe_shows_the_notes_file_fresh_and_says_when_it_was_cut(
    make: Make,
    paths: GolemPaths,
) -> None:
    shop = _shop(paths.home.parent)
    _config(paths, f'[data.shop]\npath = "{shop}/*.csv"\n')
    ctx = _ctx(make())
    plain = (await DATA_DESCRIBE.call({"source": "shop"}, ctx)).output
    assert "notes:" not in plain
    path = paths.home / "data" / "shop" / "DATA.md"
    write_notes(path, "total < 0 is a refund")
    shown = (await DATA_DESCRIBE.call({"source": "shop"}, ctx)).output
    assert "notes:\n  total < 0 is a refund" in shown and CUT_NOTE not in shown
    write_notes(path, "x" * (MAX_BYTES + 100))
    long = (await DATA_DESCRIBE.call({"source": "shop"}, ctx)).output
    assert CUT_NOTE in long


async def test_removing_a_source_leaves_its_notes_and_adding_it_again_finds_them(
    make: Make,
    paths: GolemPaths,
) -> None:
    shop = _shop(paths.home.parent)
    _config(paths, f'[data.shop]\npath = "{shop}/*.csv"\n')
    write_notes(paths.home / "data" / "shop" / "DATA.md", "kept")
    paths.config_file.write_text("", encoding="utf-8")
    assert (paths.home / "data" / "shop" / "DATA.md").read_text() == "kept\n"
    _config(paths, f'[data.shop]\npath = "{shop}/*.csv"\n')
    found = await make().describe(None, "shop")
    assert found.notes == "kept\n"


# -- the prompt --------------------------------------------------------------------------------


async def _described(
    make: Make,
    paths: GolemPaths,
    privacy: str,
    shop: Path,
) -> Any:
    _config(paths, f'[data.shop]\npath = "{shop}/*.csv"\nprivacy = "{privacy}"\n')
    return await make().describe(None, "shop", sample=20)


async def test_the_prompt_holds_columns_always_and_rows_only_where_they_may_go(
    make: Make,
    paths: GolemPaths,
) -> None:
    shop = _shop(paths.home.parent)
    for privacy, local, rows in [
        ("schema", True, False),
        ("schema", False, False),
        ("open", False, True),
        ("open", True, True),
        ("local", True, True),
        ("local", False, False),
    ]:
        found = await _described(make, paths, privacy, shop)
        text = build_prompt(found, local=local)
        assert "total  DOUBLE" in text and "orders" in text
        assert ("32.5" in text) is rows, (privacy, local)


def test_a_reply_loses_its_code_fence_and_is_cut_to_16_kb() -> None:
    assert clean("```markdown\n# shop\nOrders.\n```") == "# shop\nOrders."
    assert clean("  \n ") == ""
    assert len(clean("a" * (MAX_BYTES * 2))) == MAX_BYTES


# -- the methods over the socket ---------------------------------------------------------------


def _csv(home: Path) -> Path:
    shop = home.parent / f"{home.name}-shop"
    shop.mkdir(exist_ok=True)
    (shop / "orders.csv").write_text("id,total\n1,10\n2,32.5\n")
    return shop


async def _start(home: Path, model: ScriptedChatModel | None = None) -> Any:
    router = ModelRouter(model=model) if model is not None else None
    app, task = await start_daemon(home, router=router)
    client = await RpcClient.connect(app.paths.socket_path)
    await client.call("hello", HELLO)
    return app, task, client


async def _call(client: RpcClient, method: str, **params: object) -> dict[str, Any]:
    return cast(dict[str, Any], rpc_result(await client.call(method, dict(params), timeout=20)))


async def test_get_set_and_clear_notes_announce_the_change(short_home: Path) -> None:
    shop = _csv(short_home)
    short_home.mkdir(exist_ok=True)
    (short_home / "config.toml").write_text(f'[data.shop]\npath = "{shop}/*.csv"\n')
    app, task, client = await _start(short_home)
    try:
        path = str(short_home / "data" / "shop" / "DATA.md")
        assert await _call(client, "data.notes.get", source="shop") == {
            "text": None,
            "path": path,
        }
        saved = await _call(client, "data.notes.set", source="shop", text="total is in euros")
        assert saved == {"path": path}
        assert Path(path).read_text() == "total is in euros\n"
        got = await _call(client, "data.notes.get", source="shop")
        assert got["text"] == "total is in euros\n"
        await client.take_events()
        assert {"source": "shop", "reason": "notes"} in [
            n["params"] for n in client.notices if n["method"] == "data.changed"
        ]
        await _call(client, "data.notes.set", source="shop", text="")
        assert not Path(path).exists()
        assert (await _call(client, "data.notes.get", source="shop"))["text"] is None
        builtin_text = (await _call(client, "data.notes.get", source="golem"))["text"]
        assert builtin_text == builtin.NOTES
        too_long = await client.call(
            "data.notes.set", {"source": "shop", "text": "x" * (MAX_BYTES + 1)}
        )
        assert error_code(too_long) == INVALID_PARAMS and "16 KB" in str(too_long["error"])
        nope = await client.call("data.notes.set", {"source": "nope", "text": "x"})
        assert error_code(nope) == INVALID_PARAMS
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_notes_of_an_untrusted_project_source_are_not_saved(
    short_home: Path, tmp_path: Path
) -> None:
    shop = _shop(short_home)
    project = tmp_path / "proj"
    (project / ".golem").mkdir(parents=True)
    (project / ".golem" / "config.toml").write_text(f'[data.mine]\npath = "{shop}/*.csv"\n')
    short_home.mkdir(exist_ok=True)
    app, task, client = await _start(short_home)
    try:
        created = rpc_result(await client.call("session.create", {"cwd": str(project)}))
        session_id = str(created["session_id"])
        refused = await client.call(
            "data.notes.set", {"source": "mine", "text": "x", "session_id": session_id}
        )
        assert error_code(refused) == INVALID_PARAMS
        assert "not in trusted_projects" in str(refused["error"])
        assert not (project / ".golem" / "data").exists()
    finally:
        await client.close()
        await stop_daemon(app, task)
    (short_home / "config.toml").write_text(f'trusted_projects = ["{project.resolve()}"]\n')
    app, task, client = await _start(short_home)
    try:
        created = rpc_result(await client.call("session.create", {"cwd": str(project)}))
        session_id = str(created["session_id"])
        saved = await _call(
            client, "data.notes.set", source="mine", text="ok", session_id=session_id
        )
        assert saved["path"] == str(project.resolve() / ".golem" / "data" / "mine" / "DATA.md")
    finally:
        await client.close()
        await stop_daemon(app, task)


def _tier(monkeypatch: pytest.MonkeyPatch, tier: str) -> None:
    """Make the drafting model local or hosted: the scripted model has no profile to tell."""

    def fixed(_self: ModelDrafts, _profile: str) -> str:
        return tier

    monkeypatch.setattr(ModelDrafts, "_tier_of_profile", fixed)


async def _drafted(
    home: Path, privacy: str, reply: str = "# shop\nOrders.\n"
) -> tuple[dict[str, Any], str]:
    shop = _csv(home)
    home.mkdir(exist_ok=True)
    (home / "config.toml").write_text(
        f'[data.shop]\npath = "{shop}/*.csv"\nprivacy = "{privacy}"\n'
    )
    model = ScriptedChatModel(replies=[reply])
    app, task, client = await _start(home, model)
    try:
        assert app.state.drafts is not None
        got = await _call(client, "data.notes.draft", source="shop")
        assert not (home / "data").exists() or not (home / "data" / "shop").exists()
        return got, model.seen[0][1]
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_draft_is_a_proposal_that_is_not_saved(
    short_home: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _tier(monkeypatch, "frontier")
    got, prompt = await _drafted(short_home, "open", "```\n# shop\nOrders.\n```")
    assert got == {"text": "# shop\nOrders.\n"}
    assert "Source: shop" in prompt and "total  DOUBLE" in prompt


async def test_a_draft_of_a_schema_source_has_columns_and_no_rows(
    short_home: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _tier(monkeypatch, "local")
    _, prompt = await _drafted(short_home, "schema")
    assert "total  DOUBLE" in prompt and "32.5" not in prompt


async def test_a_draft_of_an_open_source_has_rows_for_a_hosted_model(
    short_home: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _tier(monkeypatch, "frontier")
    _, prompt = await _drafted(short_home, "open")
    assert "32.5" in prompt


async def test_a_draft_of_a_local_source_has_rows_for_a_local_model(
    short_home: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _tier(monkeypatch, "local")
    _, prompt = await _drafted(short_home, "local")
    assert "32.5" in prompt


async def test_a_draft_of_a_local_source_has_no_rows_for_a_hosted_model(
    short_home: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _tier(monkeypatch, "frontier")
    _, prompt = await _drafted(short_home, "local")
    assert "32.5" not in prompt and "total  DOUBLE" in prompt


async def test_an_empty_reply_is_a_sentence_not_an_empty_proposal(short_home: Path) -> None:
    shop = _csv(short_home)
    short_home.mkdir(exist_ok=True)
    (short_home / "config.toml").write_text(f'[data.shop]\npath = "{shop}/*.csv"\n')
    app, task, client = await _start(short_home, ScriptedChatModel(replies=[" "]))
    try:
        refused = await client.call("data.notes.draft", {"source": "shop"}, timeout=20)
        assert error_code(refused) == INVALID_PARAMS and "couldn't draft" in str(refused)
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_spent_budget_stops_a_paid_draft(
    short_home: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _tier(monkeypatch, "frontier")
    shop = _csv(short_home)
    short_home.mkdir(exist_ok=True)
    (short_home / "config.toml").write_text(f'[data.shop]\npath = "{shop}/*.csv"\n')
    model = ScriptedChatModel(replies=["# shop"])
    app, task, client = await _start(short_home, model)

    async def spent(_session: str | None) -> bool:
        return False

    try:
        assert app.state.drafts is not None
        app.state.drafts.limit(spent)
        refused = await client.call("data.notes.draft", {"source": "shop"}, timeout=20)
        assert error_code(refused) == BUDGET_SPENT and "budget" in str(refused["error"])
        assert model.seen == []
    finally:
        await client.close()
        await stop_daemon(app, task)


@pytest.mark.parametrize("method", ["data.notes.get", "data.notes.set", "data.notes.draft"])
def test_the_notes_methods_are_for_the_browser(method: str) -> None:
    from golem_protocol.methods import METHOD_ACCESS

    assert METHOD_ACCESS[method] == "browser"
