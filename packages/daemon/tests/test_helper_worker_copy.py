"""A worker writes only in its copy and still reads the lead's folder (ADR-059, step 15.10.2).

No model: scripted replies. One test each for a setup with local models only and one with cloud
models only, where a run is involved.
"""

# pyright: reportPrivateUsage=false
from __future__ import annotations

import asyncio
import subprocess
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pytest
from fakes import ToolCallingChatModel
from langchain_core.messages import BaseMessage, HumanMessage, ToolMessage
from langchain_core.outputs import ChatResult
from langgraph.checkpoint.memory import InMemorySaver
from pydantic import Field
from test_helper_restart import SETUPS, _Router, _Setup, _tier  # pyright: ignore

from golem.agents.parse import parse_agent
from golem.coding.copies import NOT_GIT_MESSAGE
from golem.config import ModelPrice
from golem.graphs.chat import open_chat
from golem.permissions.policy import Policy
from golem.sessions.bus import EventBus
from golem.sessions.helpers import unavailable_reason
from golem.sessions.log import SessionLog
from golem.sessions.manager import SessionManager
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem.tools import default_registry
from golem_protocol.events import ChatEvent


def _git(folder: Path, *args: str) -> str:
    done = subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@t", *args],
        cwd=folder,
        check=True,
        capture_output=True,
        text=True,
    )
    return done.stdout


class _Scripted(ToolCallingChatModel):
    """The lead delegates once. The helper works through ``steps`` and then answers."""

    agent: str = "worker"
    steps: list[tuple[str, dict[str, Any]]] = Field(
        default_factory=list[tuple[str, dict[str, Any]]]
    )

    async def _agenerate(
        self, messages: list[BaseMessage], stop: Any = None, run_manager: Any = None, **kwargs: Any
    ) -> ChatResult:
        humans = [m.text for m in messages if isinstance(m, HumanMessage)]
        tools = [m for m in messages if isinstance(m, ToolMessage)]
        if humans[0] != "go":
            if len(tools) < len(self.steps):
                self.replies = [[self.steps[len(tools)]]]
            else:
                self.replies = ["helper done"]
        elif not tools:
            self.replies = [[("delegate", {"agent": self.agent, "brief": "Make the change"})]]
        else:
            self.replies = ["all done"]
        return self._generate(messages, stop, run_manager, **kwargs)


class _Daemon:
    def __init__(self, database: Database, setup: _Setup, lead: Path, home: Path) -> None:
        self.model = _Scripted(replies=[])
        self.setup = setup
        self.runtime = open_chat(
            _Router(setup.settings(lead), model=self.model),
            InMemorySaver(),
            default_registry(),
            Policy(None, home=home),
            price_of=lambda _profile: ModelPrice(input=1.0, output=2.0),
            tier_of=_tier,
            budget_refs=lambda: ["deepseek/chat"] if setup.cloud else [],
        )
        self.events = EventLog(database)
        self.records = SessionRecords(database)
        log = SessionLog(self.events, EventBus(), self.records)
        self.manager = SessionManager(self.runtime, log, self.records, RunRecords(database))
        self.runtime.helpers = self.manager

    async def stored(self, session_id: str) -> list[ChatEvent]:
        return await self.events.after(session_id, 0)

    async def run(self, lead: Path, mode: Any = None) -> tuple[str, list[ChatEvent]]:
        session = await self.manager.create(self.setup.profile, cwd=str(lead))
        if mode is not None:
            await self.manager.set_mode(session, mode)
        await self.manager.send(session, "go")
        try:
            async with asyncio.timeout(20):
                while not any(e.type == "run.completed" for e in await self.stored(session)):
                    await asyncio.sleep(0.01)
        except TimeoutError:
            kinds = [e.type for e in await self.stored(session)]
            for sid in await self.records.open_helpers(session):
                kinds += ["|", *(f"{e.type}" for e in await self.stored(sid))]
            raise AssertionError(f"lead never finished: {kinds}") from None
        return session, await self.stored(session)

    def results(self) -> list[str]:
        return [m.text for seen in self.model.seen for m in seen if isinstance(m, ToolMessage)]


@pytest.fixture
async def _settled(database: Database) -> AsyncIterator[list[_Daemon]]:
    live: list[_Daemon] = []
    yield live
    for daemon in live:
        await daemon.manager.cancel_all()


@pytest.fixture
def _home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    home = tmp_path / "golem-home"
    monkeypatch.setenv("GOLEM_HOME", str(home))
    return home


@pytest.fixture
def lead(tmp_path: Path) -> Path:
    folder = tmp_path / "lead"
    folder.mkdir()
    _git(folder, "init", "-q", "-b", "main")
    (folder / "a.py").write_text("def a():\n    return 1\n", encoding="utf-8")
    _git(folder, "add", "-A")
    _git(folder, "commit", "-q", "-m", "first")
    return folder


def _steps(lead: Path) -> list[tuple[str, dict[str, Any]]]:
    return [
        ("read_file", {"path": str(lead / "a.py")}),
        ("write_file", {"path": str(lead / "a.py"), "content": "hacked\n"}),
        ("write_file", {"path": "new.txt", "content": "hello\n"}),
    ]


@pytest.mark.parametrize("setup", SETUPS)
async def test_a_worker_reads_the_lead_folder_and_writes_only_in_its_copy(
    setup: _Setup,
    database: Database,
    lead: Path,
    tmp_path: Path,
    _home: Path,
    _settled: list[_Daemon],
) -> None:
    daemon = _Daemon(database, setup, lead, tmp_path)
    _settled.append(daemon)
    daemon.model.steps = _steps(lead)

    _session, events = await daemon.run(lead)

    started = next(e for e in events if e.type == "helper.started")
    helper = started.data.helper_id
    found = await daemon.records.copy_of(helper)
    assert found is not None
    path, baseline = found
    copy = Path(path).resolve()
    assert copy.parent == (_home / "copies").resolve() and copy.name == helper
    assert baseline == _git(copy, "rev-parse", "HEAD").strip()
    results = daemon.results()
    assert any("def a()" in r for r in results)  # the read of the lead's file worked
    assert any("outside the project folder" in r for r in results)  # the write was refused
    assert (lead / "a.py").read_text(encoding="utf-8") == "def a():\n    return 1\n"
    assert (copy / "new.txt").read_text(encoding="utf-8") == "hello\n"
    assert not (lead / "new.txt").exists()
    # The write in the copy asked nothing.
    assert not any(e.type == "approval.needed" for e in await daemon.stored(helper))
    assert _git(lead, "status", "--porcelain") == ""


@pytest.mark.parametrize("setup", SETUPS)
async def test_the_shell_of_a_worker_runs_in_its_copy(
    setup: _Setup,
    database: Database,
    lead: Path,
    tmp_path: Path,
    _home: Path,
    _settled: list[_Daemon],
) -> None:
    daemon = _Daemon(database, setup, lead, tmp_path)
    _settled.append(daemon)
    daemon.model.steps = [("shell", {"command": "pwd"})]

    _session, events = await daemon.run(lead, mode="autopilot")

    helper = next(e for e in events if e.type == "helper.started").data.helper_id
    found = await daemon.records.copy_of(helper)
    assert found is not None
    copy = Path(found[0]).resolve()
    shown = [r.strip().splitlines()[0] for r in daemon.results() if r.strip()]
    assert any(r.startswith("/") and Path(r).resolve() == copy for r in shown), shown


@pytest.mark.parametrize("setup", SETUPS)
async def test_a_folder_that_is_not_git_refuses_the_worker_with_the_reason(
    setup: _Setup, database: Database, tmp_path: Path, _home: Path, _settled: list[_Daemon]
) -> None:
    plain = tmp_path / "plain"
    plain.mkdir()
    daemon = _Daemon(database, setup, plain, tmp_path)
    _settled.append(daemon)

    _session, events = await daemon.run(plain)

    assert not any(e.type == "helper.started" for e in events)
    assert any(NOT_GIT_MESSAGE in r for r in daemon.results())
    assert not (_home / "copies").exists()


@pytest.mark.parametrize("setup", SETUPS)
async def test_an_explorer_runs_in_the_lead_folder_with_no_copy(
    setup: _Setup,
    database: Database,
    lead: Path,
    tmp_path: Path,
    _home: Path,
    _settled: list[_Daemon],
) -> None:
    daemon = _Daemon(database, setup, lead, tmp_path)
    _settled.append(daemon)
    daemon.model.agent = "explorer"
    daemon.model.steps = [("read_file", {"path": "a.py"})]

    _session, events = await daemon.run(lead)

    helper = next(e for e in events if e.type == "helper.started").data.helper_id
    assert await daemon.records.copy_of(helper) is None
    assert any("def a()" in r for r in daemon.results())
    assert not (_home / "copies").exists()


def test_availability_follows_the_lead_folder(lead: Path, tmp_path: Path) -> None:
    worker = parse_agent(Path(__file__).parents[1] / "golem" / "agents" / "bundled" / "worker.md")
    tools = default_registry()

    def is_read_only(name: str) -> bool:
        tool = tools.get(name)
        return tool is not None and tool.read_only

    assert unavailable_reason(worker, is_read_only, lead) is None
    plain = tmp_path / "plain"
    plain.mkdir()
    reason = unavailable_reason(worker, is_read_only, plain)
    assert reason is not None and NOT_GIT_MESSAGE in reason
    reason = unavailable_reason(worker, is_read_only, None)
    assert reason is not None and "no folder" in reason
