"""The ``delegate`` section of the system prompt: small windows only, and the same every call."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from pathlib import Path

import pytest
from fakes import ToolCallingChatModel
from langchain_core.messages import SystemMessage
from langgraph.checkpoint.memory import InMemorySaver

from golem.agents.bundled import bundled_agents_dir
from golem.agents.parse import parse_agent
from golem.config import DelegateSettings, ModelPrice
from golem.graphs.chat import ChatRuntime, open_chat
from golem.graphs.delegate_policy import Prices
from golem.graphs.delegate_prompt import (
    delegate_prompt,
    delegate_text,
    line_of,
    prices_of,
    reasons_for,
)
from golem.graphs.prompt import PromptContext, Section, SystemPrompt
from golem.models.discovery import ListedModel
from golem.models.dispatcher import Dispatcher
from golem.models.router import ModelRouter
from golem.models.tiers import Tier
from golem.models.window import ContextWindow
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.manager import SessionManager
from golem.store.blobs import BlobStore
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem.tools import default_registry
from golem_protocol.events import ModelCallStartedEvent

AGENTS = [parse_agent(path) for path in sorted(bundled_agents_dir().glob("*.md"))]
WRITING = {"write_file", "edit_file", "shell"}


def writes(name: str) -> bool:
    return name in WRITING


def section() -> Section:
    return delegate_prompt(lambda _root: AGENTS, writes)


def build(window: int | None, tier: Tier | None, prices: Prices | None = None) -> str | None:
    context = PromptContext(
        state={}, tools=("read_file", "delegate"), window=window, tier=tier, prices=prices
    )
    return section()(context)


def names(text: str | None) -> list[str]:
    return [line[2:].split(":")[0] for line in (text or "").splitlines() if line.startswith("- ")]


def test_local_only_offers_the_window_reason_and_the_explorer_never_a_paid_line() -> None:
    text = build(32_768, "local", Prices())
    assert text is not None
    assert "by default" in text
    assert names(text) == ["explorer"]
    for paid in ("stronger", "cheaper", "at once"):
        assert paid not in text


def test_a_local_lead_with_a_stronger_model_ready_is_offered_the_hard_question() -> None:
    # Local lead, paid advisor: the one paid reason a local lead gets. Never at once or cheaper.
    text = build(32_768, "local", Prices(0.0, 0.0, 5.0))
    assert names(text) == ["advisor", "explorer", "reviewer"]
    assert "stronger" in (text or "")
    for other in ("cheaper", "at once"):
        assert other not in (text or "")


def test_cloud_only_budget_lead_gets_every_reason_and_type_by_price() -> None:
    text = build(128_000, "budget", Prices(lead=0.5, cheaper=0.1, stronger=5.0))
    assert text is not None
    assert names(text) == ["advisor", "explorer", "reviewer", "worker"]
    assert "stronger model" in text and "cheaper model" in text and "at once" in text


def test_cloud_only_frontier_lead_has_no_stronger_model_to_offer() -> None:
    text = build(200_000, "frontier", Prices(lead=6.0, cheaper=0.5, stronger=None))
    assert names(text) == ["explorer", "worker"]
    assert "cheaper model" in (text or "") and "stronger" not in (text or "")


def test_a_cloud_lead_that_is_not_dearer_than_three_times_gets_no_cheaper_line() -> None:
    text = build(200_000, "frontier", Prices(lead=1.0, cheaper=0.5, stronger=None))
    assert "cheaper" not in (text or "")


def test_an_unknown_tier_counts_as_hosted_and_unknown_prices_offer_no_paid_model() -> None:
    text = build(128_000, None)
    assert names(text) == ["explorer", "worker"]


@pytest.mark.parametrize(
    ("window", "shown"), [(32_768, True), (65_536, True), (65_537, False), (131_072, False)]
)
def test_a_local_lead_is_told_at_64k_and_below_only(window: int, shown: bool) -> None:
    assert (build(window, "local") is not None) is shown


def test_a_cloud_lead_with_a_large_window_is_still_told() -> None:
    assert names(build(1_000_000, "frontier", Prices())) == ["explorer", "worker"]


@pytest.mark.parametrize(
    ("window", "tools"),
    [(None, ("delegate",)), (32_768, ("read_file",)), (32_768, ())],
)
def test_nothing_without_delegate_or_a_known_window(
    window: int | None, tools: tuple[str, ...]
) -> None:
    context = PromptContext(state={}, tools=tools, window=window, tier="local")
    assert section()(context) is None


def test_reasons_come_from_the_policy_thresholds() -> None:
    prices = Prices(1.0, 0.2, None)  # five times dearer
    assert reasons_for(100_000, "budget", prices).cheaper
    assert not reasons_for(100_000, "budget", prices, DelegateSettings(price_ratio=10)).cheaper


def test_a_user_agent_file_without_a_line_gets_its_description_as_the_line(
    tmp_path: Path,
) -> None:
    path = tmp_path / "summariser.md"
    path.write_text(
        "---\ndescription: Summarises long logs for you. Use it on big files.\n"
        "tools: read_file\n---\nYou summarise.\n",
        "utf-8",
    )
    agent = parse_agent(path)
    assert agent.errors == () and agent.line == ""
    assert line_of(agent) == "summarises long logs for you"
    text = delegate_text([agent], 32_768, "local", Prices(), writes)
    assert text is not None and "- summariser: summarises long logs for you" in text


def test_a_user_agent_with_a_line_and_a_paid_wish_is_hidden_from_a_local_lead(
    tmp_path: Path,
) -> None:
    path = tmp_path / "critic.md"
    path.write_text(
        "---\ndescription: Critiques a plan.\nline: critiques a plan\n"
        "model: stronger\n---\nYou critique.\n",
        "utf-8",
    )
    agent = parse_agent(path)
    assert agent.errors == () and line_of(agent) == "critiques a plan"
    assert delegate_text([agent], 32_768, "local", Prices(), writes) is None
    shown = delegate_text([agent], 128_000, "budget", Prices(1.0, 0.1, 5.0), writes)
    assert shown is not None and "- critic: critiques a plan" in shown


def test_every_bundled_type_has_its_own_short_line() -> None:
    assert [a.name for a in AGENTS] == ["advisor", "explorer", "reviewer", "worker"]
    assert all(a.line and a.errors == () for a in AGENTS)


def test_prices_come_from_ready_models_one_tier_up_and_at_or_below() -> None:
    def model(ref: str, tier: Tier, input_: float | None, status: str = "ready") -> ListedModel:
        price = None if input_ is None else ModelPrice(input=input_, output=input_)
        return ListedModel(ref, ref, "x", "hosted", status, price=price, tier=tier)  # type: ignore[arg-type]

    listed = [
        model("cheap", "budget", 0.1),
        model("lead", "budget", 0.5),
        model("big", "frontier", 5.0),
        model("bigger", "frontier", 9.0),
        model("off", "frontier", 1.0, "no key"),
    ]
    assert prices_of("lead", "budget", 0.5, listed) == Prices(0.5, 0.1, 5.0)
    assert prices_of("big", "frontier", 5.0, listed) == Prices(5.0, 0.1, None)


def test_the_text_is_short() -> None:
    long = build(200_000, "budget", Prices(lead=0.5, cheaper=0.1, stronger=5.0))
    assert long is not None and len(long) < 800
    small = build(32_768, "local")
    assert small is not None and len(small) < 260


LOCAL_TEXT = build(32_768, "local", Prices()) or ""
CHILD_PROMPT = parse_agent(bundled_agents_dir() / "explorer.md").body


class _Chat:
    def __init__(self, database: Database, model: ToolCallingChatModel, window: int | None) -> None:
        self.runtime: ChatRuntime = open_chat(
            ModelRouter(model=model),
            InMemorySaver(),
            default_registry(),
            prompt=SystemPrompt(sections=(section(),)),
            tier_of=lambda _profile: "local",
            blobs=BlobStore(database),
            window_of=lambda _profile, _overrides: ContextWindow(window=window),
            dispatcher=Dispatcher(lambda _call: 2),
        )
        self.runs = RunRecords(database)
        self.events = EventLog(database)
        records = SessionRecords(database)
        self.manager = SessionManager(
            self.runtime, SessionLog(self.events, EventBus(), records), records, self.runs
        )

    async def send(self, session_id: str, text: str) -> list[ModelCallStartedEvent]:
        run_id = await self.manager.send(session_id, text)

        async def done() -> bool:
            run = await self.runs.get(run_id)
            return run is not None and run.status != "running"

        await _until(done)
        events = await self.events.for_run(run_id)
        return [e for e in events if isinstance(e, ModelCallStartedEvent)]


async def _until(check: Callable[[], Awaitable[bool]], timeout: float = 5) -> None:
    async with asyncio.timeout(timeout):
        while not await check():
            await asyncio.sleep(0.01)


async def test_inspect_shows_the_section_for_a_small_window(database: Database) -> None:
    chat = _Chat(database, ToolCallingChatModel(replies=["hi"]), 32_768)
    session_id = await chat.manager.create(None)
    view = await chat.manager.inspect(session_id)
    await chat.manager.cancel_all()

    assert [m.role for m in view.messages] == ["system"]
    assert view.messages[0].text == LOCAL_TEXT


async def test_inspect_leaves_it_out_for_a_large_or_unknown_window(database: Database) -> None:
    for window in (200_000, None):
        chat = _Chat(database, ToolCallingChatModel(replies=["hi"]), window)
        session_id = await chat.manager.create(None)
        view = await chat.manager.inspect(session_id)
        await chat.manager.cancel_all()
        assert view.messages == []


async def test_two_calls_of_a_run_send_the_same_prompt_and_name_the_section(
    database: Database,
) -> None:
    model = ToolCallingChatModel(replies=[[("list_dir", {"path": "."})], "done"])
    chat = _Chat(database, model, 32_768)
    session_id = await chat.manager.create(None)
    first, second = await chat.send(session_id, "hello")
    await chat.manager.cancel_all()

    assert first.data.system_prompt_sha == second.data.system_prompt_sha is not None
    assert [s.name for s in first.data.system_sections or []] == ["delegate"]
    assert isinstance(model.seen[0][0], SystemMessage)
    assert model.seen[0][0].content == LOCAL_TEXT


async def test_a_helper_gets_its_own_prompt_not_the_section(
    database: Database, tmp_path: Path
) -> None:
    model = ToolCallingChatModel(
        replies=[[("delegate", {"agent": "explorer", "brief": "look around"})], "found", "ok"]
    )
    chat = _Chat(database, model, 32_768)
    session_id = await chat.manager.create(None, cwd=str(tmp_path))
    await chat.send(session_id, "what is this repo")

    # The lead's run parks as soon as the helper is started: wait for the helper's own call.
    async def helper_called() -> bool:
        return len(model.seen) >= 2

    await _until(helper_called)
    await chat.manager.cancel_all()

    parent_first, helper_first = model.seen[0][0], model.seen[1][0]
    assert isinstance(parent_first, SystemMessage)
    assert parent_first.content == LOCAL_TEXT
    assert isinstance(helper_first, SystemMessage)
    assert helper_first.content == CHILD_PROMPT
