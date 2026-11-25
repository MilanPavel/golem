"""The reviewer gets the lead's diff as an artifact it can read (ADR-059, step 15.9.1, #1357).

An agent file with ``gets: diff`` makes golem write the lead's change set as an artifact of the
helper and name it in the brief. One test each for a setup with local models only and one with
cloud models only, and the cases with no change and with a bad ``gets``.
"""

# pyright: reportPrivateUsage=false
from __future__ import annotations

import asyncio
import re
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pytest
from fakes import ToolCallingChatModel
from langchain_core.messages import BaseMessage, HumanMessage, ToolMessage
from langchain_core.outputs import ChatResult
from langgraph.checkpoint.memory import InMemorySaver
from test_helper_restart import SETUPS, _Router, _Setup, _tier  # pyright: ignore

from golem.agents.parse import parse_agent
from golem.coding.changes import ChangeStore, session_diff
from golem.config import ModelPrice
from golem.graphs.chat import open_chat
from golem.permissions.policy import Policy
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.manager import SessionManager
from golem.store.artifacts import ArtifactStore
from golem.store.blobs import BlobStore
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem.tools import default_registry
from golem_protocol.events import ChatEvent

_ARTIFACT = re.compile(r"artifact (a_\w+)")


class _Scripted(ToolCallingChatModel):
    """The lead delegates to the reviewer once. The reviewer reads the artifact its brief names
    (when it names one) and answers with what it read."""

    async def _agenerate(
        self, messages: list[BaseMessage], stop: Any = None, run_manager: Any = None, **kwargs: Any
    ) -> ChatResult:
        humans = [m.text for m in messages if isinstance(m, HumanMessage)]
        helper = humans[0] != "go"
        done = any(isinstance(m, ToolMessage) for m in messages)
        if helper and not done:
            found = _ARTIFACT.search(humans[0])
            if found is not None:
                self.replies = [[("read_artifact", {"artifact_id": found.group(1)})]]
            else:
                self.replies = ["no diff to read"]
        elif helper:
            tool = next(m for m in reversed(messages) if isinstance(m, ToolMessage))
            self.replies = [f"READ:{tool.text}"]
        elif not done:
            self.replies = [[("delegate", {"agent": "reviewer", "brief": "Look at a.py"})]]
        else:
            self.replies = ["all done"]
        return self._generate(messages, stop, run_manager, **kwargs)


class _Daemon:
    def __init__(self, database: Database, setup: _Setup, project: Path, home: Path) -> None:
        self.setup = setup
        self.model = _Scripted(replies=[])
        self.changes = ChangeStore(database, BlobStore(database))
        self.artifacts = ArtifactStore(database)
        self.runtime = open_chat(
            _Router(setup.settings(project), model=self.model),
            InMemorySaver(),
            default_registry(),
            Policy(None, home=home),
            self.artifacts,
            price_of=lambda _profile: ModelPrice(input=1.0, output=2.0),
            tier_of=_tier,
            budget_refs=lambda: ["deepseek/chat"] if setup.cloud else [],
        )
        self.runtime.changes = self.changes
        self.events = EventLog(database)
        self.records = SessionRecords(database)
        self.log = SessionLog(self.events, EventBus(), self.records)
        self.manager = SessionManager(self.runtime, self.log, self.records, RunRecords(database))
        self.runtime.helpers = self.manager

    async def stored(self, session_id: str) -> list[ChatEvent]:
        return await self.events.after(session_id, 0)

    async def until(self, session_id: str, kind: str) -> list[ChatEvent]:
        try:
            async with asyncio.timeout(10):
                while not any(e.type == kind for e in await self.stored(session_id)):
                    await asyncio.sleep(0.01)
        except TimeoutError:
            kinds = [e.type for e in await self.stored(session_id)]
            raise AssertionError(f"no {kind} in {kinds}") from None
        return await self.stored(session_id)

    async def review(self, project: Path, *, change: bool) -> tuple[str, str, list[ChatEvent]]:
        """Run a lead that delegates to the reviewer. Returns the lead, the helper, its log."""
        lead = await self.manager.create(self.setup.profile, cwd=str(project))
        if change:
            await self.changes.record(
                session_id=lead,
                run_id=None,
                call_id=None,
                path="a.py",
                before="def a():\n    return 1\n",
                after="def a():\n    return 2\n",
                source="tool",
            )
        await self.manager.send(lead, "go")
        events = await self.until(lead, "run.completed")
        started = next(e for e in events if e.type == "helper.started")
        helper = started.data.helper_id
        return lead, helper, await self.stored(helper)


@pytest.fixture
async def _settled(database: Database) -> AsyncIterator[list[_Daemon]]:
    live: list[_Daemon] = []
    yield live
    for daemon in live:
        await daemon.manager.cancel_all()


@pytest.fixture
def project(tmp_path: Path) -> Path:
    root = tmp_path / "project"
    root.mkdir()
    (root / "a.py").write_text("def a():\n    return 1\n", encoding="utf-8")
    return root


def _brief(own: list[ChatEvent]) -> str:
    users = [e for e in own if e.type == "message.completed" and e.data.role == "user"]
    return users[0].data.text


@pytest.mark.parametrize("setup", SETUPS)
async def test_the_reviewer_brief_names_the_diff_artifact_and_read_artifact_returns_it(
    setup: _Setup, database: Database, project: Path, tmp_path: Path, _settled: list[_Daemon]
) -> None:
    daemon = _Daemon(database, setup, project, tmp_path)
    _settled.append(daemon)

    lead, helper, own = await daemon.review(project, change=True)

    brief = _brief(own)
    assert brief.startswith("Look at a.py")
    found = _ARTIFACT.search(brief)
    assert found is not None
    artifact_id = found.group(1)
    assert "read it with read_artifact" in brief
    real = await session_diff(daemon.changes, lead)
    assert "+    return 2" in real
    assert f"({real.count(chr(10))} lines)" in brief
    # The helper owns it, so its own read_artifact reads the real diff.
    assert daemon.manager.diff_artifact_of(helper) == artifact_id
    page = await daemon.artifacts.read(helper, artifact_id, 0, 100_000)
    assert page is not None and page.text == real
    tool_results = [
        m.text for seen in daemon.model.seen for m in seen if isinstance(m, ToolMessage)
    ]
    assert any(text.startswith(real) for text in tool_results)


@pytest.mark.parametrize("setup", SETUPS)
async def test_no_change_means_no_artifact_and_the_brief_says_so(
    setup: _Setup, database: Database, project: Path, tmp_path: Path, _settled: list[_Daemon]
) -> None:
    daemon = _Daemon(database, setup, project, tmp_path)
    _settled.append(daemon)

    _lead, helper, own = await daemon.review(project, change=False)

    brief = _brief(own)
    assert "There is no change to review" in brief
    assert _ARTIFACT.search(brief) is None
    assert daemon.manager.diff_artifact_of(helper) is None
    rows = await database.fetch_all("SELECT artifact_id FROM artifacts")
    assert list(rows) == []


def _agent(tmp_path: Path, gets: str) -> Any:
    path = tmp_path / "peeker.md"
    path.write_text(
        f"---\ndescription: Peeks.\ntools: read_file\ngets: {gets}\n---\nPeek.\n",
        encoding="utf-8",
    )
    return parse_agent(path)


def test_the_bundled_reviewer_gets_the_diff_and_can_read_it() -> None:
    reviewer = parse_agent(
        Path(__file__).parents[1] / "golem" / "agents" / "bundled" / "reviewer.md"
    )
    assert reviewer.valid
    assert reviewer.gets == ("diff",)
    assert "read_artifact" in reviewer.tools


def test_gets_takes_text_or_a_list_and_adds_read_artifact(tmp_path: Path) -> None:
    agent = _agent(tmp_path, "[diff]")
    assert agent.valid and agent.gets == ("diff",)
    assert agent.tools == ("read_file", "read_artifact")


def test_an_unknown_gets_value_is_a_readable_error(tmp_path: Path) -> None:
    agent = _agent(tmp_path, "everything")
    assert not agent.valid
    assert any("`gets`" in e and "everything" in e and "diff" in e for e in agent.errors)
