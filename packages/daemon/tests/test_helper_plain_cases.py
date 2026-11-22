"""Plain asks never start a helper (ADR-059, section 2; step 15.4, ticket 15.4.7).

A rename over six files, a question about one file and a find-fix-check task are scripted runs
through the real chat graph, the real tool registry and the real ``delegate`` prompt section. The
scripted lead does the work with ordinary tools. Each is run in a local-only setup (a small local
lead, only local models listed) and in a cloud-only setup (a hosted lead, a cheaper and a stronger
hosted model listed). The test asserts that no helper session starts, that ``delegate`` is never
called, that the policy answers fold for an honest estimate of the job, and that the lead was told
to do the work here by default.
"""

from __future__ import annotations

import asyncio
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
from fakes import Calls, ToolCallingChatModel
from langchain_core.messages import AIMessage, SystemMessage, ToolMessage
from langgraph.checkpoint.memory import InMemorySaver
from test_delegate import _Recording, _registry  # pyright: ignore[reportPrivateUsage]

from golem.config import GolemSettings, ModelPrice
from golem.graphs.chat import open_chat
from golem.graphs.delegate_policy import JobEstimate, Prices, should_delegate
from golem.graphs.delegate_prompt import delegate_prompt, prices_of
from golem.graphs.prompt import SystemPrompt
from golem.models.discovery import ListedModel
from golem.models.router import ModelRouter
from golem.models.tiers import Tier, blended
from golem.models.window import ContextWindow
from golem.permissions.policy import Policy
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.manager import SessionManager
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem.tools import default_registry
from golem_protocol.events import ChatEvent

DEFAULT_TEXT = "Do the work here by default. Call delegate with a clear brief only when"


def _price(blend: float) -> ModelPrice:
    return ModelPrice(input=blend, output=blend)


def _listed(ref: str, tier: Tier, price: ModelPrice | None = None) -> ListedModel:
    return ListedModel(
        ref=ref,
        label=ref,
        provider=ref.partition("/")[0],
        source="catalog",
        status="ready",
        price=price,
        tier=tier,
        tools=True,
    )


@dataclass(frozen=True)
class Setup:
    lead: str
    tier: Tier
    window: int
    listed: tuple[ListedModel, ...]
    price: ModelPrice | None

    @property
    def prices(self) -> Prices:
        lead_price = None if self.price is None else blended(self.price)
        return prices_of(self.lead, self.tier, lead_price, self.listed)


LOCAL = Setup(
    "ollama/small",
    "local",
    32_768,
    (_listed("ollama/small", "local"), _listed("ollama/other", "local")),
    None,
)
CLOUD = Setup(
    "anthropic/lead",
    "budget",
    200_000,
    (
        _listed("anthropic/lead", "budget", _price(1.0)),
        _listed("deepseek/cheap", "budget", _price(0.1)),
        _listed("anthropic/strong", "frontier", _price(10.0)),
    ),
    _price(1.0),
)
SETUPS = [pytest.param(LOCAL, id="local-only"), pytest.param(CLOUD, id="cloud-only")]


class _FixedRouter(ModelRouter):
    def chat_model(self, profile: str, overrides: Any = None, *, local_only: bool = False) -> Any:
        del overrides
        if local_only:
            self.ensure_local(profile)
        return self._model


class _Chat:
    """The real chat graph and tools, with the daemon's delegate section and one scripted model."""

    def __init__(
        self, database: Database, model: ToolCallingChatModel, setup: Setup, home: Path
    ) -> None:
        self.setup = setup
        config = home / "config.toml"
        config.write_text(
            '[[rule]]\ntool = "edit_file"\naction = "allow"\n'
            '[[rule]]\ntool = "shell_unsandboxed"\naction = "allow"\n',
            encoding="utf-8",
        )
        settings = GolemSettings(default_model=setup.lead)
        registry = default_registry()
        agents = _registry(home)

        def writes(name: str) -> bool:
            tool = registry.get(name)
            return tool is not None and not tool.read_only

        self.runtime = open_chat(
            _FixedRouter(settings, model=model),
            InMemorySaver(),
            registry,
            Policy(config, home=home),
            prompt=SystemPrompt(
                sections=(
                    delegate_prompt(
                        lambda root: agents.view(root).usable(), writes, settings.agents.delegate
                    ),
                )
            ),
            window_of=lambda _profile, _options: ContextWindow(window=setup.window),
            price_of=lambda _profile: setup.price,
            tier_of=lambda _profile: setup.tier,
            helper_prices=lambda _profile: setup.prices,
        )
        self.events = EventLog(database)
        self.runs = RunRecords(database)
        self.records = SessionRecords(database)
        self.manager = SessionManager(
            self.runtime,
            SessionLog(self.events, EventBus(), self.records),
            self.records,
            self.runs,
            agents=agents,
        )

    async def run(self, folder: Path, text: str) -> list[ChatEvent]:
        session_id = await self.manager.create(None, cwd=str(folder))
        run_id = await self.manager.send(session_id, text)
        async with asyncio.timeout(10):
            while (run := await self.runs.get(run_id)) is None or run.status in (
                "running",
                "waiting",
            ):
                await asyncio.sleep(0.01)
        assert run.status == "completed"
        return await self.events.for_run(run_id)


def _calls(*named: tuple[str, dict[str, Any]]) -> Calls:
    return list(named)


def _tool_results(model: ToolCallingChatModel) -> list[ToolMessage]:
    return [m for m in model.seen[-1] if isinstance(m, ToolMessage)]


def _called(model: ToolCallingChatModel) -> list[str]:
    return [
        call["name"] for m in model.seen[-1] if isinstance(m, AIMessage) for call in m.tool_calls
    ]


async def _assert_plain(
    chat: _Chat,
    model: _Recording,
    events: list[ChatEvent],
    estimate: JobEstimate,
    used: list[str],
) -> None:
    setup = chat.setup
    # No helper session: no helper event, and the lead's is the only session there is.
    assert not [e for e in events if e.type.startswith("helper.")]
    assert len(await chat.records.recent(10)) == 1
    # delegate was on offer and never called; the lead used the ordinary tools, and finished.
    assert model.offered and all("delegate" in names for names in model.offered)
    assert "delegate" not in _called(model)
    assert _called(model) == used
    assert not model.replies
    # The policy answers fold, with an honest estimate and this setup's window and prices.
    decision = should_delegate(
        setup.window, 0, estimate, setup.prices, setup.tier, 2, "when_needed"
    )
    assert (decision.reason, decision.shape) == (None, "fold")
    # What the lead was told: do the work here by default.
    first = model.seen[0][0]
    assert isinstance(first, SystemMessage)
    assert DEFAULT_TEXT in first.text
    if setup.tier == "local":
        assert "stronger model" not in first.text
        assert "cheaper model" not in first.text
    else:
        assert "a hard question needs a stronger model" in first.text
        assert "a large read can go to a cheaper model" in first.text


@pytest.mark.parametrize("setup", SETUPS)
async def test_a_rename_over_six_files_starts_no_helper(
    database: Database, tmp_path: Path, setup: Setup
) -> None:
    root = tmp_path / "project"
    root.mkdir()
    for n in range(6):
        (root / f"mod{n}.py").write_text(
            f"from lib import old_name\n\n\ndef use{n}():\n    return old_name({n})\n",
            encoding="utf-8",
        )
    edits = [
        (
            "edit_file",
            {
                "path": f"mod{n}.py",
                "old_string": "old_name",
                "new_string": "new_name",
                "replace_all": True,
            },
        )
        for n in range(6)
    ]
    model = _Recording(
        replies=[
            _calls(("grep", {"pattern": "old_name"})),
            _calls(*[("read_file", {"path": f"mod{n}.py"}) for n in range(6)]),
            _calls(*edits),
            _calls(("grep", {"pattern": "old_name"})),
            "Renamed old_name to new_name in six files.",
        ]
    )
    chat = _Chat(database, model, setup, tmp_path)
    events = await chat.run(root, "rename old_name to new_name everywhere")

    texts = [(root / f"mod{n}.py").read_text() for n in range(6)]
    assert all("new_name" in t and "old_name" not in t for t in texts)
    await _assert_plain(
        chat,
        model,
        events,
        JobEstimate(read_tokens=3_000),
        ["grep", *["read_file"] * 6, *["edit_file"] * 6, "grep"],
    )


@pytest.mark.parametrize("setup", SETUPS)
async def test_a_question_about_one_file_starts_no_helper(
    database: Database, tmp_path: Path, setup: Setup
) -> None:
    root = tmp_path / "project"
    root.mkdir()
    (root / "util.py").write_text("def double(x):\n    return x * 2\n", encoding="utf-8")
    model = _Recording(
        replies=[_calls(("read_file", {"path": "util.py"})), "double(x) returns x times two."]
    )
    chat = _Chat(database, model, setup, tmp_path)
    events = await chat.run(root, "what does double in util.py do?")

    assert "x * 2" in _tool_results(model)[0].text
    await _assert_plain(chat, model, events, JobEstimate(read_tokens=800), ["read_file"])


@pytest.mark.parametrize("setup", SETUPS)
async def test_a_find_fix_check_task_starts_no_helper(
    database: Database, tmp_path: Path, setup: Setup
) -> None:
    root = tmp_path / "project"
    root.mkdir()
    (root / "calc.py").write_text("def add(a, b):\n    return a - b\n", encoding="utf-8")
    (root / "check.py").write_text(
        "from calc import add\n\nassert add(2, 3) == 5, 'add is wrong'\nprint('all good')\n",
        encoding="utf-8",
    )
    check = {"command": f"'{sys.executable}' -B check.py"}
    fix = {"path": "calc.py", "old_string": "return a - b", "new_string": "return a + b"}
    model = _Recording(
        replies=[
            _calls(("shell_unsandboxed", check)),
            _calls(("grep", {"pattern": "def add"})),
            _calls(("read_file", {"path": "calc.py"})),
            _calls(("edit_file", fix)),
            _calls(("shell_unsandboxed", check)),
            "add subtracted; it adds now and check.py passes.",
        ]
    )
    chat = _Chat(database, model, setup, tmp_path)
    events = await chat.run(root, "check.py fails, find the bug, fix it, run it again")

    assert "return a + b" in (root / "calc.py").read_text()
    results = _tool_results(model)
    assert "add is wrong" in results[0].text
    assert "all good" in results[-1].text
    await _assert_plain(
        chat,
        model,
        events,
        JobEstimate(read_tokens=1_500),
        ["shell_unsandboxed", "grep", "read_file", "edit_file", "shell_unsandboxed"],
    )
