"""A paid review end to end, and the local-only refusal (ADR-059, section 5; step 15.9.4, #1360).

Scripted models, a fixed list of model facts. A local lead delegates to the bundled ``reviewer``
(wish ``stronger``, ``gets: diff``): after one question the review runs on the paid model and
reads the diff artifact. In a local-only folder nothing is asked and the reviewer runs on the
local model with a fresh window; with cloud models only nothing is asked either.
"""

# pyright: reportPrivateUsage=false
from __future__ import annotations

import asyncio
import re
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pytest
from fakes import FixedFacts, ToolCallingChatModel
from langchain_core.messages import BaseMessage, HumanMessage, ToolMessage
from langchain_core.outputs import ChatResult
from langgraph.checkpoint.memory import InMemorySaver
from test_helper_model import (  # pyright: ignore
    BIG,
    CHEAP,
    LOCAL,
    _cloud_setup,
    _local_setup,
    _mixed_setup,
    _settings,
)
from test_helper_restart import _Router, _tier  # pyright: ignore

from golem.coding.changes import ChangeStore, session_diff
from golem.config import ModelPrice
from golem.graphs.chat import open_chat
from golem.permissions.policy import Policy
from golem.sessions.bus import EventBus
from golem.sessions.helpers import BRIEF_CUT, question_brief
from golem.sessions.log import SessionLog
from golem.sessions.manager import SessionManager
from golem.store.artifacts import ArtifactStore
from golem.store.blobs import BlobStore
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem.tools import default_registry
from golem_protocol.events import (
    HELPER_BRIEF_MAX_CHARS,
    ChatEvent,
    HelperStartedEvent,
    RouteConsentNeededEvent,
)

_ARTIFACT = re.compile(r"artifact (a_\w+)")


class _Scripted(ToolCallingChatModel):
    """The lead delegates to the reviewer once, the reviewer reads the artifact its brief names
    and answers with what it read, and the lead ends with the review."""

    async def _agenerate(
        self, messages: list[BaseMessage], stop: Any = None, run_manager: Any = None, **kwargs: Any
    ) -> ChatResult:
        humans = [m.text for m in messages if isinstance(m, HumanMessage)]
        helper = humans[0] != "go"
        done = any(isinstance(m, ToolMessage) for m in messages)
        if helper and not done:
            found = _ARTIFACT.search(humans[0])
            assert found is not None
            self.replies = [[("read_artifact", {"artifact_id": found.group(1)})]]
        elif helper:
            tool = next(m for m in reversed(messages) if isinstance(m, ToolMessage))
            self.replies = [f"REVIEW:{tool.text}"]
        elif not done:
            self.replies = [[("delegate", {"agent": "reviewer", "brief": "Review a.py"})]]
        else:
            tool = next(m for m in reversed(messages) if isinstance(m, ToolMessage))
            self.replies = [f"LEAD GOT:{tool.text}"]
        return self._generate(messages, stop, run_manager, **kwargs)


class _Daemon:
    def __init__(
        self,
        database: Database,
        facts: FixedFacts,
        lead: str,
        project: Path,
        home: Path,
        *,
        private: bool = False,
    ) -> None:
        self.lead_model = lead
        self.model = _Scripted(replies=[])
        self.changes = ChangeStore(database, BlobStore(database))
        self.artifacts = ArtifactStore(database)
        settings = _settings(lead, local_only=project if private else None)
        self.runtime = open_chat(
            _Router(settings, model=self.model),
            InMemorySaver(),
            default_registry(),
            Policy(None, home=home),
            self.artifacts,
            price_of=lambda _profile: ModelPrice(input=1.0, output=2.0),
            tier_of=_tier,
            budget_refs=lambda: [CHEAP, BIG],
        )
        self.runtime.changes = self.changes
        self.events = EventLog(database)
        self.records = SessionRecords(database)
        self.log = SessionLog(self.events, EventBus(), self.records)
        self.runs = RunRecords(database)
        self.manager = SessionManager(self.runtime, self.log, self.records, self.runs)
        self.manager.facts = facts
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

    async def lead(self, project: Path, *, after: str = "def a():\n    return 2\n") -> str:
        lead = await self.manager.create(self.lead_model, cwd=str(project))
        if after:
            await self.changes.record(
                session_id=lead,
                run_id=None,
                call_id=None,
                path="a.py",
                before="def a():\n    return 1\n",
                after=after,
                source="tool",
            )
        await self.manager.send(lead, "go")
        return lead

    async def helper_of(self, lead: str) -> str:
        """The helper's id, once the lead's log has started it."""
        events = await self.until(lead, "helper.started")
        return _started(events).data.helper_id

    async def tool_results(self) -> list[str]:
        return [m.text for seen in self.model.seen for m in seen if isinstance(m, ToolMessage)]


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


def _started(events: list[ChatEvent]) -> HelperStartedEvent:
    return next(e for e in events if isinstance(e, HelperStartedEvent))


def _kinds(events: list[ChatEvent]) -> set[str]:
    return {e.type for e in events}


def _last_text(events: list[ChatEvent]) -> str:
    last = [e for e in events if e.type == "message.completed" and e.data.role == "assistant"][-1]
    return last.data.text


async def test_a_local_lead_gets_a_paid_review_of_its_diff_after_one_question(
    database: Database, project: Path, tmp_path: Path, _settled: list[_Daemon]
) -> None:
    daemon = _Daemon(database, _mixed_setup(), LOCAL, project, tmp_path)
    _settled.append(daemon)

    lead = await daemon.lead(project)
    helper = await daemon.helper_of(lead)
    own = await daemon.until(helper, "route.consent.needed")

    # The helper waits on one question, asked before any model call.
    asked = next(e for e in own if isinstance(e, RouteConsentNeededEvent)).data
    assert (asked.model_profile, asked.tier, asked.agent) == (CHEAP, "budget", "reviewer")
    assert asked.helper_id == helper
    assert asked.alternatives == ["session", "once", "local"]
    assert "model.call.started" not in _kinds(own)
    # It shows the brief and names the diff, which already is the helper's artifact.
    artifact_id = daemon.manager.diff_artifact_of(helper)
    assert artifact_id is not None and asked.diff_artifact_id == artifact_id
    assert asked.brief is not None and asked.brief.startswith("Review a.py")
    assert f"artifact {artifact_id}" in asked.brief
    assert any(line.startswith("the diff of the lead's change") for line in asked.sent or [])
    real = await session_diff(daemon.changes, lead)
    page = await daemon.artifacts.read(helper, artifact_id, 0, 100_000)
    assert page is not None and page.text == real
    # The same fields reach the Inbox item.
    activity = await daemon.records.activity(helper)
    assert activity is not None
    item = await daemon.manager._events.pending(activity)
    assert item is not None and item.kind == "consent"
    assert (item.brief, item.diff_artifact_id) == (asked.brief, artifact_id)

    run = await daemon.runs.latest(helper)
    assert run is not None
    await daemon.manager.answer_consent(helper, run.run_id, "once")
    events = await daemon.until(lead, "run.completed")

    # The review ran on the paid model, read the diff, and the lead got it.
    assert _started(events).data.model == CHEAP
    routed = [e for e in await daemon.stored(helper) if e.type == "model.routed"]
    assert [e.data.model_profile for e in routed] == [CHEAP]
    assert any(text.startswith(real) for text in await daemon.tool_results())
    assert _last_text(events).startswith("LEAD GOT:")
    assert "+    return 2" in _last_text(events)


async def test_the_estimate_of_the_paid_question_counts_the_diff_the_reviewer_reads(
    database: Database, project: Path, tmp_path: Path, _settled: list[_Daemon]
) -> None:
    estimates: list[float | None] = []
    for after in ("", "def a():\n" + "    return 2\n" * 2000):
        daemon = _Daemon(database, _mixed_setup(), LOCAL, project, tmp_path)
        _settled.append(daemon)
        lead = await daemon.lead(project, after=after)
        helper = await daemon.helper_of(lead)
        own = await daemon.until(helper, "route.consent.needed")
        asked = next(e for e in own if isinstance(e, RouteConsentNeededEvent)).data
        estimates.append(asked.estimated_usd)

    without, with_diff = estimates
    assert without is not None and with_diff is not None
    assert with_diff > without + 0.005  # 24k characters at 1 USD per million tokens, and more


async def test_a_local_only_folder_refuses_the_paid_reviewer_and_reviews_locally(
    database: Database, project: Path, tmp_path: Path, _settled: list[_Daemon]
) -> None:
    daemon = _Daemon(database, _mixed_setup(), LOCAL, project, tmp_path, private=True)
    _settled.append(daemon)

    lead = await daemon.lead(project)
    events = await daemon.until(lead, "run.completed")

    helper = _started(events).data.helper_id
    own = await daemon.stored(helper)
    # No question at all, and the reviewer is on the local model with a fresh window.
    assert "route.consent.needed" not in _kinds(own) | _kinds(events)
    started = _started(events).data
    assert started.model == LOCAL and started.wish == "stronger"
    assert "this chat stays on this Mac" in started.pick_reason
    assert "fresh window" in started.pick_reason
    record = await daemon.records.get(helper)
    assert record is not None and record.model_profile == LOCAL
    # It still reads the diff, and the lead gets the review.
    real = await session_diff(daemon.changes, lead)
    assert any(text.startswith(real) for text in await daemon.tool_results())
    assert "+    return 2" in _last_text(events)


async def test_local_models_only_review_on_the_local_model_with_a_fresh_window_and_no_question(
    database: Database, project: Path, tmp_path: Path, _settled: list[_Daemon]
) -> None:
    daemon = _Daemon(database, _local_setup(), LOCAL, project, tmp_path)
    _settled.append(daemon)

    lead = await daemon.lead(project)
    events = await daemon.until(lead, "run.completed")

    started = _started(events).data
    assert started.model == LOCAL
    assert "fresh window" in started.pick_reason
    assert "route.consent.needed" not in _kinds(await daemon.stored(started.helper_id))


async def test_cloud_models_only_review_on_a_stronger_model_with_no_question(
    database: Database, project: Path, tmp_path: Path, _settled: list[_Daemon]
) -> None:
    daemon = _Daemon(database, _cloud_setup(), CHEAP, project, tmp_path)
    _settled.append(daemon)

    lead = await daemon.lead(project)
    events = await daemon.until(lead, "run.completed")

    started = _started(events).data
    assert started.model == BIG and started.wish == "stronger"
    assert "route.consent.needed" not in _kinds(await daemon.stored(started.helper_id))
    assert "+    return 2" in _last_text(events)


async def test_cloud_models_only_from_the_top_tier_the_same_model_with_a_fresh_window(
    database: Database, project: Path, tmp_path: Path, _settled: list[_Daemon]
) -> None:
    daemon = _Daemon(database, _cloud_setup(), BIG, project, tmp_path)
    _settled.append(daemon)

    lead = await daemon.lead(project)
    events = await daemon.until(lead, "run.completed")

    started = _started(events).data
    assert started.model == BIG
    assert "fresh window" in started.pick_reason
    assert "route.consent.needed" not in _kinds(await daemon.stored(started.helper_id))


def test_a_long_brief_is_cut_to_the_limit_with_a_visible_mark() -> None:
    assert question_brief("short") == "short"
    whole = "x" * HELPER_BRIEF_MAX_CHARS
    assert question_brief(whole) == whole
    cut = question_brief(whole + "y")
    assert len(cut) == HELPER_BRIEF_MAX_CHARS and cut.endswith(BRIEF_CUT)
