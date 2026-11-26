"""Privacy levels of a data source: the rows check, the first guess, the stub for hosted calls."""
# pyright: reportPrivateUsage=false

from __future__ import annotations

import sqlite3
from collections.abc import AsyncIterator, Mapping
from pathlib import Path
from typing import cast

import pytest
from fakes import Calls, ToolCallingChatModel
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import BaseMessage, ToolMessage
from langgraph.checkpoint.memory import InMemorySaver

from golem.config import DataPrivacyLevel, DataSettings, GolemSettings
from golem.data.client import DataWorker, Timing
from golem.data.privacy import guess_privacy, may_use_rows
from golem.data.sources import DataSources
from golem.data.tools import DATA_DESCRIBE, DATA_QUERY
from golem.graphs.chat import ChatRuntime, open_chat
from golem.graphs.data_stub import STUB, stub_local_rows
from golem.graphs.step_up import StepRequest, StepUp
from golem.graphs.tools_node import DATA_KEY
from golem.memory.privacy import ChatPrivacy, Target
from golem.models.pick import Choice
from golem.models.router import ModelRouter
from golem.models.tiers import Tier
from golem.paths import GolemPaths
from golem.store.database import Database
from golem.tools import default_registry
from golem.tools.registry import ToolContext

FAST = Timing(backoff_first=0.05, backoff_max=0.2, kill_after=0.3, stop_seconds=1.0)
LOCAL = "ollama/small"
CHEAP = "deepseek/cheap"
TIERS: dict[str, Tier] = {LOCAL: "local", CHEAP: "budget"}
SECRET = "32.5"
HOSTED = Target(local=False)
ON_DEVICE = Target(local=True)
LOCAL_CHAT = ChatPrivacy(local_only=True)
QUERY: Calls = [("data_query", {"source": "shop", "sql": "select * from orders"})]
DESCRIBE: Calls = [("data_describe", {"source": "shop"})]


# -- the rows check --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("level", "chat", "target", "allowed"),
    [
        ("open", ChatPrivacy(), HOSTED, True),
        ("open", ChatPrivacy(), ON_DEVICE, True),
        ("open", LOCAL_CHAT, HOSTED, True),
        ("local", ChatPrivacy(), HOSTED, False),
        ("local", ChatPrivacy(), ON_DEVICE, True),
        ("local", LOCAL_CHAT, HOSTED, True),
        ("local", LOCAL_CHAT, ON_DEVICE, True),
        ("schema", ChatPrivacy(), HOSTED, False),
        ("schema", ChatPrivacy(), ON_DEVICE, False),
        ("schema", LOCAL_CHAT, HOSTED, False),
        ("schema", LOCAL_CHAT, ON_DEVICE, False),
    ],
)
def test_rows_go_to_a_model_by_the_level_of_the_source(
    level: DataPrivacyLevel, chat: ChatPrivacy, target: Target, allowed: bool
) -> None:
    verdict = may_use_rows(level, chat, target)
    assert verdict.allowed is allowed
    assert (verdict.reason is None) is allowed


def test_the_reason_says_which_level_kept_the_rows_back() -> None:
    assert may_use_rows("local", ChatPrivacy(), HOSTED).reason == "source_local"
    assert may_use_rows("schema", ChatPrivacy(), ON_DEVICE).reason == "source_schema"


HOME = Path("/Users/ann")


@pytest.mark.parametrize(
    ("location", "columns", "level", "reason"),
    [
        ("/Users/ann/Documents/bank.csv", [], "local", "in your home folder"),
        ("~/Documents/bank.csv", [], "local", "in your home folder"),
        ("/data/sales.csv", ["id", "email"], "local", "has an `email` column"),
        ("/data/sales.csv", ["id", "Amount"], "local", "has an `Amount` column"),
        ("/data/sales.csv", ["customer_name"], "local", "has a `customer_name` column"),
        ("/data/sales.csv", ["phone"], "local", "has a `phone` column"),
        ("/data/sales.csv", ["home_address"], "local", "has a `home_address` column"),
        ("/data/sales.csv", ["iban"], "local", "has an `iban` column"),
        ("postgres://localhost/shop", ["id"], "open", "a database on this computer"),
        ("postgres://u:p@127.0.0.1:5432/shop", [], "open", "a database on this computer"),
        ("/Users/ann/app/fixtures/orders.csv", ["id", "qty"], "open", "in a fixtures folder"),
        ("/Users/ann/app/db/seed/orders.csv", [], "open", "in a fixtures folder"),
        ("/Users/ann/app/fixtures/orders.csv", ["email"], "local", "has an `email` column"),
        ("postgres://db.example.com/shop", ["id"], "local", "golem cannot tell"),
        ("/data/sales.csv", ["id", "qty"], "local", "golem cannot tell"),
    ],
)
def test_the_first_guess_for_a_new_source_and_why(
    location: str, columns: list[str], level: DataPrivacyLevel, reason: str
) -> None:
    found, why = guess_privacy(location, columns, home=HOME)
    assert found == level
    assert why.startswith(reason)
    assert "\n" not in why


# -- the tools and the stub ------------------------------------------------------------------


@pytest.fixture
async def paths(tmp_path: Path) -> GolemPaths:
    found = GolemPaths(tmp_path / "home")
    found.ensure_layout()
    async with Database.open(found.database_file):
        pass
    sqlite3.connect(found.database_file).close()
    return found


def _shop(paths: GolemPaths, level: str) -> None:
    shop = paths.home.parent / "shop"
    shop.mkdir(parents=True, exist_ok=True)
    (shop / "orders.csv").write_text("id,total\n1,10\n2,32.5\n3,7\n")
    paths.config_file.parent.mkdir(parents=True, exist_ok=True)
    paths.config_file.write_text(
        f'[data.shop]\npath = "{shop}/*.csv"\nprivacy = "{level}"\n', encoding="utf-8"
    )


@pytest.fixture
async def sources(paths: GolemPaths) -> AsyncIterator[DataSources]:
    worker = DataWorker(DataSettings(query_timeout_seconds=10, threads=1), paths, timing=FAST)
    found = DataSources(worker, paths, trusted=lambda _root: False)
    yield found
    await found.close()


def _ctx(sources: DataSources, target: Target) -> ToolContext:
    return ToolContext(root=None, data=sources.access(None), memory_target=target)


async def test_a_local_source_gives_the_user_and_a_local_model_the_rows(
    paths: GolemPaths, sources: DataSources
) -> None:
    _shop(paths, "local")
    on_device = await DATA_QUERY.call(QUERY[0][1], _ctx(sources, ON_DEVICE))
    assert SECRET in on_device.output and on_device.rows_withheld is False
    assert on_device.data is not None and on_device.data.privacy == "local"
    hosted = await DATA_QUERY.call(QUERY[0][1], _ctx(sources, HOSTED))
    # The tool still returns the whole result: the screen shows it, the checkpoint keeps it.
    assert SECRET in hosted.output and hosted.rows_withheld is True
    assert hosted.data is not None and hosted.data.hosted is not None
    assert SECRET not in hosted.data.hosted


async def test_a_schema_source_gives_no_model_any_row_but_the_user_sees_them(
    paths: GolemPaths, sources: DataSources
) -> None:
    _shop(paths, "schema")
    for target in (HOSTED, ON_DEVICE):
        result = await DATA_QUERY.call(QUERY[0][1], _ctx(sources, target))
        assert SECRET not in result.output
        assert result.output.startswith(
            "3 rows from shop, shown to the user, not sent to the model."
        )
        assert "id BIGINT" in result.output and "total DOUBLE" in result.output
        assert result.shown is not None and SECRET in result.shown
        assert result.rows_withheld is True


async def test_an_open_source_is_unchanged_for_a_hosted_model(
    paths: GolemPaths, sources: DataSources
) -> None:
    _shop(paths, "open")
    result = await DATA_QUERY.call(QUERY[0][1], _ctx(sources, HOSTED))
    assert SECRET in result.output and result.rows_withheld is False
    assert result.data is not None and result.data.hosted is None
    assert result.shown is None


async def test_the_builtin_source_is_unchanged_for_a_hosted_model(sources: DataSources) -> None:
    result = await DATA_QUERY.call(
        {"source": "golem", "sql": "select count(*) as n from usage"}, _ctx(sources, HOSTED)
    )
    assert "n" in result.output and result.rows_withheld is False
    message = ToolMessage(
        content=result.output,
        tool_call_id="c1",
        name="data_query",
        additional_kwargs={DATA_KEY: {"source": "golem", "privacy": "open", "hosted": None}},
    )
    assert stub_local_rows([message])[0].content == result.output


async def test_describing_a_local_source_gives_a_hosted_model_no_range_and_no_sample(
    paths: GolemPaths, sources: DataSources
) -> None:
    _shop(paths, "local")
    result = await DATA_DESCRIBE.call({"source": "shop"}, _ctx(sources, ON_DEVICE))
    assert "1 … 3" in result.output and SECRET in result.output
    assert result.data is not None and result.data.hosted is not None
    hosted = result.data.hosted
    assert "orders  3 rows" in hosted and "BIGINT" in hosted
    assert "1 … 3" not in hosted and "distinct" not in hosted
    assert SECRET not in hosted and "<data_rows" not in hosted


def _result(content: str, name: str, source: str, level: str, hosted: str | None) -> ToolMessage:
    return ToolMessage(
        content=content,
        tool_call_id="c1",
        name=name,
        additional_kwargs={DATA_KEY: {"source": source, "privacy": level, "hosted": hosted}},
    )


def test_the_stub_changes_only_a_result_the_model_may_not_read() -> None:
    local = _result("rows 32.5", "data_query", "shop", "local", "3 rows from shop, withheld")
    schema = _result("3 rows, withheld", "data_query", "shop", "schema", None)
    open_ = _result("rows 32.5", "data_query", "pub", "open", "unused")
    unknown = ToolMessage(content="rows 32.5", tool_call_id="c2", name="data_query")
    other = ToolMessage(content="rows 32.5", tool_call_id="c3", name="read_file")
    failed = ToolMessage(
        content="error: no",
        tool_call_id="c4",
        name="data_query",
        additional_kwargs={"golem_error": "x"},
    )
    kept = stub_local_rows([local, schema, open_, unknown, other, failed])
    assert [m.content for m in kept] == [
        "3 rows from shop, withheld",
        "3 rows, withheld",
        "rows 32.5",
        STUB,
        "rows 32.5",
        "error: no",
    ]
    # A local chat may send the rows of a local source anywhere, a schema source never.
    both = stub_local_rows([local, schema], LOCAL_CHAT)
    assert [m.content for m in both] == ["rows 32.5", "3 rows, withheld"]
    # The input is not changed: the checkpoint keeps the whole result.
    assert local.content == "rows 32.5"


# -- a live run ------------------------------------------------------------------------------


class _Models(ModelRouter):
    def __init__(self, models: dict[str, ToolCallingChatModel]) -> None:
        super().__init__(GolemSettings())
        self.models = models

    def chat_model(
        self,
        profile: str,
        overrides: Mapping[str, float | str] | None = None,
        *,
        local_only: bool = False,
    ) -> BaseChatModel:
        return self.models[self.resolve(profile).ref]


def _runtime(
    models: dict[str, ToolCallingChatModel], sources: DataSources, *, to: str | None = None
) -> ChatRuntime:
    async def next_model(session_id: str, profile: str, ask: StepRequest) -> StepUp | None:
        del session_id, profile, ask
        return None if to is None else StepUp(to, "budget", Choice(None, "fit", "", ()))

    runtime = open_chat(
        _Models(models),
        InMemorySaver(),
        tools=default_registry(),
        tier_of=TIERS.get,
        next_model=next_model,
    )
    runtime.data = sources
    return runtime


async def _run(runtime: ChatRuntime, profile: str, n: int = 0, step_up: bool = True) -> None:
    async for _ in runtime.stream(
        session_id="s_data",
        text=f"look {n}",
        model_profile=profile,
        schema_version=1,
        user_message_id=f"m_user{n}",
        assistant_message_id=f"m_reply{n}",
        step_up=step_up,
    ):
        pass


def _results(request: list[BaseMessage], name: str = "data_query") -> list[str]:
    return [str(m.content) for m in request if isinstance(m, ToolMessage) and m.name == name]


async def test_a_hosted_call_gets_a_stub_the_checkpoint_keeps_the_rows_and_a_local_call_reads_them(
    paths: GolemPaths, sources: DataSources
) -> None:
    _shop(paths, "local")
    models = {
        LOCAL: ToolCallingChatModel(replies=[QUERY, "", "again"]),
        CHEAP: ToolCallingChatModel(replies=["done"]),
    }
    runtime = _runtime(models, sources, to=CHEAP)
    await _run(runtime, LOCAL)
    (sent,) = _results(models[CHEAP].seen[0])
    assert SECRET not in sent
    assert sent.startswith("3 rows from shop, shown to the user, not sent to this model.")
    assert "id BIGINT" in sent
    stored = await runtime.values("s_data")
    (kept,) = _results(cast(list[BaseMessage], stored["messages"]))
    assert SECRET in kept
    await _run(runtime, LOCAL, n=1, step_up=False)
    (full,) = _results(models[LOCAL].seen[-1])
    assert SECRET in full


async def test_a_hosted_model_asked_to_describe_a_local_source_gets_no_sample(
    paths: GolemPaths, sources: DataSources
) -> None:
    _shop(paths, "local")
    models = {CHEAP: ToolCallingChatModel(replies=[DESCRIBE, "done"])}
    await _run(_runtime(models, sources), CHEAP)
    (text,) = _results(models[CHEAP].seen[1], "data_describe")
    assert "orders  3 rows" in text
    assert SECRET not in text and "1 … 3" not in text


async def test_a_schema_source_never_sends_a_row_to_any_model(
    paths: GolemPaths, sources: DataSources
) -> None:
    _shop(paths, "schema")
    models = {LOCAL: ToolCallingChatModel(replies=[QUERY, "done"])}
    runtime = _runtime(models, sources)
    await _run(runtime, LOCAL)
    (seen,) = _results(models[LOCAL].seen[1])
    assert SECRET not in seen and "not sent to the model" in seen
