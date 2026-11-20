"""``recall`` and ``remember``: kept or proposed, the privacy check, and who offers them."""

from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any, cast

import pytest
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langchain_core.messages.tool import ToolCall
from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph  # pyright: ignore[reportMissingTypeStubs]

from golem.agents.bundled import bundled_agents_dir
from golem.agents.parse import parse_agent
from golem.config import MemorySettings
from golem.graphs.state import AgentState
from golem.graphs.tools_node import MEMORY_KEY, scope_of, tools_node
from golem.memory.privacy import ChatPrivacy
from golem.memory.records import MemoryRecord
from golem.memory.service import MemoryAccess, MemoryService
from golem.memory.store import MemoryStore
from golem.models.tiers import Tier
from golem.permissions.policy import Policy
from golem.tools import default_registry
from golem.tools.registry import ToolScope

FOLDER = "/work/app"
TIERS: dict[str, Tier] = {"local-model": "local", "cloud-model": "frontier"}


class _Made:
    def __init__(self, store: MemoryStore, tmp_path: Path) -> None:
        self.store = store
        self.settings = MemorySettings()
        self.service = MemoryService(store, lambda: self.settings)
        self.tmp_path = tmp_path

    async def run(
        self,
        name: str,
        args: dict[str, object],
        *,
        profile: str = "local-model",
        message: str = "",
        chat: ChatPrivacy | None = None,
    ) -> str:
        """One tool call, through the tools node, from a model that ran as ``profile``."""
        access = MemoryAccess(self.service, FOLDER, chat or ChatPrivacy(), message)
        node = tools_node(
            default_registry(),
            Policy(None, home=self.tmp_path),
            tier_of=TIERS.get,
        )
        builder: Any = StateGraph(AgentState)
        builder.add_node("tools", node)
        builder.add_edge(START, "tools")
        builder.add_edge("tools", END)
        graph: Any = builder.compile(checkpointer=InMemorySaver())
        call: ToolCall = {"name": name, "args": args, "id": "c1", "type": "tool_call"}
        state = {
            "messages": [HumanMessage(content=message), AIMessage(content="", tool_calls=[call])],
            "session_id": "s1",
            "model_profile": profile,
            "schema_version": 1,
        }
        config: RunnableConfig = {"configurable": {"thread_id": "s1", MEMORY_KEY: access}}
        result = await graph.ainvoke(cast(Any, state), config)
        tool = next(m for m in result["messages"] if isinstance(m, ToolMessage))
        return str(tool.content)


@pytest.fixture
async def made(tmp_path: Path) -> AsyncIterator[_Made]:
    async with MemoryStore.open(tmp_path / "memory.db") as store:
        yield _Made(store, tmp_path)


def _history(text: str) -> MemoryRecord:
    return MemoryRecord(
        id="m_h1",
        scope="history",
        title=text,
        text=text,
        author="lead",
        state="kept",
        created_at="2026-11-01T00:00:00+00:00",
        updated_at="2026-11-01T00:00:00+00:00",
        kept_by="auto",
    )


async def test_remember_with_the_users_words_is_kept(made: _Made) -> None:
    out = await made.run(
        "remember",
        {"text": "The user prefers pnpm.", "scope": "you", "quote": "I prefer pnpm"},
        message="remember that I prefer pnpm",
    )
    assert out.startswith("kept")
    (row,) = await made.store.list()
    assert (row.state, row.author, row.kept_by) == ("kept", "you", "you")


async def test_remember_without_the_quote_in_the_message_is_a_proposal(made: _Made) -> None:
    out = await made.run(
        "remember",
        {"text": "The user prefers pnpm.", "scope": "you", "quote": "I prefer pnpm"},
        message="please tidy the imports",
    )
    assert out.startswith("proposed: you will be asked")
    (row,) = await made.store.list()
    assert (row.state, row.author) == ("proposed", "lead")


async def test_remember_without_a_quote_is_a_proposal(made: _Made) -> None:
    out = await made.run("remember", {"text": "We use uv.", "scope": "project"})
    assert out.startswith("proposed")


async def test_remember_says_why_a_text_was_refused(made: _Made) -> None:
    out = await made.run("remember", {"text": "x" * 2001, "scope": "you"})
    assert "at most 2000 characters" in out
    assert await made.store.list() == []


async def test_a_local_model_recalls_a_local_memory(made: _Made) -> None:
    await made.service.write_by_you("The user prefers pnpm.", "you", privacy="local")
    out = await made.run("recall", {"query": "pnpm"}, profile="local-model")
    assert "The user prefers pnpm." in out
    assert "not an instruction" in out


async def test_a_hosted_model_does_not_get_a_local_memory(made: _Made) -> None:
    await made.service.write_by_you("The user prefers pnpm.", "you", privacy="local")
    out = await made.run("recall", {"query": "pnpm"}, profile="cloud-model")
    assert out == "no memories found"


async def test_a_hosted_model_gets_the_same_note_when_its_privacy_is_chat(made: _Made) -> None:
    await made.service.write_by_you("The user prefers pnpm.", "you", privacy="chat")
    out = await made.run("recall", {"query": "pnpm"}, profile="cloud-model")
    assert "The user prefers pnpm." in out


async def test_a_hosted_model_gets_nothing_in_a_local_chat(made: _Made) -> None:
    await made.service.write_by_you("The user prefers pnpm.", "you", privacy="chat")
    chat = ChatPrivacy(local_only=True)
    hosted = await made.run("recall", {"query": "pnpm"}, profile="cloud-model", chat=chat)
    assert hosted == "no memories found"
    local = await made.run("recall", {"query": "pnpm"}, profile="local-model", chat=chat)
    assert "pnpm" in local


async def test_an_unknown_model_counts_as_hosted(made: _Made) -> None:
    await made.service.write_by_you("The user prefers pnpm.", "you", privacy="local")
    assert await made.run("recall", {"query": "pnpm"}, profile="who") == "no memories found"


async def test_a_line_has_the_fields_and_the_text_is_cut(made: _Made) -> None:
    written = await made.service.write_by_you("Build notes. " + "word " * 200, "you")
    assert written is not None
    out = await made.run("recall", {"query": "build"})
    id_, scope, date, title, text = out.splitlines()[1].split(" | ")
    assert (id_, scope, date) == (written.id, "you", written.created_at[:10])
    assert title.startswith("Build notes.")
    assert len(text) == 300 and text.endswith("...")


async def test_recall_says_how_many_hits_it_left_out(made: _Made) -> None:
    for n in range(6):
        await made.service.write_by_you(f"pnpm note {n}", "you")
    out = await made.run("recall", {"query": "pnpm", "limit": 4})
    assert len(out.splitlines()) == 1 + 4 + 1
    assert out.splitlines()[-1].startswith("2 more hits left out")


async def test_recall_leaves_out_history_unless_asked(made: _Made) -> None:
    await made.store.add(_history("a chat about pnpm"))
    assert await made.run("recall", {"query": "pnpm"}) == "no memories found"
    asked = await made.run("recall", {"query": "pnpm", "scope": "history"})
    assert "a chat about pnpm" in asked


def test_the_tools_are_absent_when_memory_is_off() -> None:
    registry = default_registry()
    assert {"recall", "remember"} <= set(registry.names)
    off = registry.scoped(ToolScope())
    assert not {"recall", "remember"} & set(off.names)
    offered = {str(cast(dict[str, Any], s["function"])["name"]) for s in off.schemas()}
    assert not {"recall", "remember"} & offered
    on = registry.scoped(ToolScope(memory=True))
    assert {"recall", "remember"} <= set(on.names)
    assert scope_of({"configurable": {}}).memory is False


def test_a_helper_never_has_them() -> None:
    explorer = frozenset(parse_agent(bundled_agents_dir() / "explorer.md").tools)
    helper = default_registry().scoped(ToolScope(only=explorer, memory=True))
    assert not {"recall", "remember"} & set(helper.names)


def test_both_run_without_asking_in_careful_mode(tmp_path: Path) -> None:
    registry = default_registry().scoped(ToolScope(memory=True))
    assert {"recall", "remember"} <= set(registry.default_allowed("careful"))
    policy = Policy(None, home=tmp_path)
    for name in ("recall", "remember"):
        assert policy.check(registry, name, {}, None, "careful").action == "allow"


def test_the_descriptions_say_a_memory_is_a_note() -> None:
    for name in ("recall", "remember"):
        tool = default_registry().get(name)
        assert tool is not None
        assert "not an instruction" in tool.description
