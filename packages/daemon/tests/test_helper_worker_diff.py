"""A worker returns its diff and its check result in ``helper.ended`` (ADR-059, step 15.10.4).

No model: scripted replies. The checks run through a fake runner, so no test needs the shell
sandbox. One test each for a setup with local models only and one with cloud models only.
"""

# pyright: reportPrivateUsage=false
from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import pytest
import test_helper_worker_copy as base
from langchain_core.messages import BaseMessage, HumanMessage, ToolMessage
from langchain_core.outputs import ChatResult
from test_helper_restart import SETUPS, _Setup  # pyright: ignore
from test_helper_worker_copy import _Daemon, _git, _home, _settled, lead  # pyright: ignore

from golem.coding.checks import Check
from golem.coding.worker_result import CheckOutcome, files_of
from golem.config import (
    AgentModelSettings,
    AgentSettings,
    CheckSettings,
    CodingSettings,
    GolemSettings,
    RoutingSettings,
)
from golem.permissions.policy import Policy
from golem.sessions.helpers import worker_line
from golem.store.artifacts import ArtifactStore
from golem.store.database import Database
from golem_protocol.events import ChatEvent, HelperEndedData

__all__ = ["_home", "_settled", "lead"]

WORKERS = 5


class _Batch(base._Scripted):  # pyright: ignore
    """The lead delegates a batch. A helper writes the files its brief names, then answers."""

    count: int = WORKERS
    writes: int = 1

    async def _agenerate(
        self, messages: list[BaseMessage], stop: Any = None, run_manager: Any = None, **kwargs: Any
    ) -> ChatResult:
        humans = [m.text for m in messages if isinstance(m, HumanMessage)]
        tools = [m for m in messages if isinstance(m, ToolMessage)]
        if humans[0] == "go":
            if not tools:
                batch = [
                    {"agent": self.agent, "brief": f"job {n}", "label": f"w{n}"}
                    for n in range(self.count)
                ]
                self.replies = [[("delegate", {"batch": batch})]]
            else:
                self.replies = ["all done"]
        else:
            n = humans[0].split("job ")[1].split()[0]
            if len(tools) < self.writes:
                step = ("write_file", {"path": f"f{n}_{len(tools)}.txt", "content": f"{n}\n"})
                self.replies = [[step]]
            else:
                self.replies = ["helper done"]
        return self._generate(messages, stop, run_manager, **kwargs)


@pytest.fixture(autouse=True)
def _configured(monkeypatch: pytest.MonkeyPatch) -> None:
    def settings(self: _Setup, project: Path) -> GolemSettings:
        if self.cloud:
            start = GolemSettings(default_model="anthropic/big")
        else:
            start = GolemSettings(
                default_model="ollama/qwen3:8b",
                routing=RoutingSettings(local_only=[str(project)]),
            )
        agents = AgentSettings(
            max_per_batch=WORKERS, at_once=WORKERS, worker=AgentModelSettings(max_calls=2)
        )
        return start.model_copy(update={"agents": agents})

    def coding(self: Policy) -> CodingSettings:
        return CodingSettings(
            checks="auto",
            check=[
                CheckSettings(name="tests", command="true"),
                CheckSettings(name="lint", command="true"),
            ],
        )

    monkeypatch.setattr(base, "_Scripted", _Batch)
    monkeypatch.setattr(_Setup, "settings", settings)
    monkeypatch.setattr(Policy, "coding", coding)


async def _fake(check: Check, root: Path) -> CheckOutcome:
    """Lint fails in the copy that holds ``f3_0.txt``; the tests of the copy with f4 time out."""
    if check.name == "lint" and (root / "f3_0.txt").exists():
        return "failed"
    if check.name == "tests" and (root / "f4_0.txt").exists():
        return "timed_out"
    return "passed"


def _daemon(
    setup: _Setup,
    database: Database,
    lead: Path,
    tmp_path: Path,
    settled: list[_Daemon],
    **params: Any,
) -> _Daemon:
    daemon = _Daemon(database, setup, lead, tmp_path)
    daemon.runtime.artifacts = ArtifactStore(database)
    for name, value in params.items():
        setattr(daemon.model, name, value)
    settled.append(daemon)
    return daemon


def _ended(events: list[ChatEvent]) -> list[HelperEndedData]:
    return [e.data for e in events if e.type == "helper.ended"]


@pytest.mark.parametrize("setup", SETUPS)
async def test_five_workers_return_five_diffs_with_their_check_results(
    setup: _Setup,
    database: Database,
    lead: Path,
    tmp_path: Path,
    _home: Path,
    _settled: list[_Daemon],
) -> None:
    daemon = _daemon(setup, database, lead, tmp_path, _settled)
    daemon.manager.check_runner = _fake

    _session, events = await daemon.run(lead)

    ended = _ended(events)
    assert len(ended) == WORKERS
    by_file = {d.files[0].path: d for d in ended if d.files}
    assert sorted(by_file) == [f"f{n}_0.txt" for n in range(WORKERS)]
    helpers = {e.data.helper_id for e in events if e.type == "helper.started"}
    for name, data in by_file.items():
        assert data.stopped == "done"
        assert data.files is not None and data.files[0].status == "created"
        assert (data.added, data.removed) == (1, 0)
        assert data.diff_artifact_id is not None
        page = None
        for helper in helpers:
            page = page or await daemon.runtime.artifacts.read(  # pyright: ignore
                helper, data.diff_artifact_id, 0, 10_000
            )
        assert page is not None and name in page.text
    assert by_file["f0_0.txt"].checks == "passed" and by_file["f0_0.txt"].checks_failed is None
    assert by_file["f3_0.txt"].checks == "failed"
    assert by_file["f3_0.txt"].checks_failed == ["lint"]
    assert by_file["f4_0.txt"].checks == "failed"
    assert by_file["f4_0.txt"].checks_failed == ["tests"]
    assert by_file["f4_0.txt"].checks_note == "timed out: tests"
    # The copies are kept, and the lead's folder is untouched.
    assert _git(lead, "status", "--porcelain") == ""
    for helper in helpers:
        found = await daemon.records.copy_of(helper)
        assert found is not None and Path(found[0]).is_dir()
    # The lead reads one line per worker.
    text = "\n".join(daemon.results())
    assert "+1 \u22120 in 1 file \u00b7 checks pass \u00b7 diff in artifact" in text
    assert "checks failed: lint" in text
    assert text.count("diff in artifact") == WORKERS


@pytest.mark.parametrize("setup", SETUPS)
async def test_a_slow_worker_check_does_not_drop_the_workers_line(
    setup: _Setup,
    database: Database,
    lead: Path,
    tmp_path: Path,
    _home: Path,
    _settled: list[_Daemon],
) -> None:
    daemon = _daemon(setup, database, lead, tmp_path, _settled)

    async def slow(check: Check, root: Path) -> CheckOutcome:
        if (root / "f2_0.txt").exists():
            await asyncio.sleep(0.3)
        return "passed"

    daemon.manager.check_runner = slow

    await daemon.run(lead)

    text = "\n".join(daemon.results())
    assert text.count("diff in artifact") == WORKERS


@pytest.mark.parametrize("setup", SETUPS)
async def test_a_worker_stopped_at_its_call_limit_still_returns_its_diff(
    setup: _Setup,
    database: Database,
    lead: Path,
    tmp_path: Path,
    _home: Path,
    _settled: list[_Daemon],
) -> None:
    daemon = _daemon(setup, database, lead, tmp_path, _settled, count=1, writes=5)
    daemon.manager.check_runner = _fake

    _session, events = await daemon.run(lead)

    (data,) = _ended(events)
    assert data.stopped == "calls"
    assert data.files is not None and sorted(f.path for f in data.files) == [
        "f0_0.txt",
        "f0_1.txt",
    ]
    assert data.added == 2 and data.checks == "passed"
    assert "diff in artifact" in "\n".join(daemon.results())


@pytest.mark.parametrize("setup", SETUPS)
async def test_a_worker_that_changed_nothing_skips_the_checks(
    setup: _Setup,
    database: Database,
    lead: Path,
    tmp_path: Path,
    _home: Path,
    _settled: list[_Daemon],
) -> None:
    ran: list[str] = []

    async def spy(check: Check, root: Path) -> CheckOutcome:
        ran.append(check.name)
        return "passed"

    daemon = _daemon(setup, database, lead, tmp_path, _settled, count=1, writes=0)
    daemon.manager.check_runner = spy

    _session, events = await daemon.run(lead)

    (data,) = _ended(events)
    assert data.files == [] and data.diff_artifact_id is None
    assert data.checks == "none" and data.checks_note == "no changes"
    assert ran == []


@pytest.mark.parametrize("setup", SETUPS)
async def test_a_read_only_helper_has_no_worker_fields(
    setup: _Setup,
    database: Database,
    lead: Path,
    tmp_path: Path,
    _home: Path,
    _settled: list[_Daemon],
) -> None:
    daemon = _daemon(setup, database, lead, tmp_path, _settled, count=1, writes=0, agent="explorer")

    _session, events = await daemon.run(lead)

    (data,) = _ended(events)
    assert data.diff_artifact_id is None and data.files is None
    assert data.added is None and data.removed is None
    assert data.checks is None and data.checks_failed is None and data.checks_note is None
    assert "diff in artifact" not in "\n".join(daemon.results())


def test_files_of_reads_status_counts_and_binary_files() -> None:
    patch = (
        "diff --git a/a.py b/a.py\nindex 1..2 100644\n--- a/a.py\n+++ b/a.py\n"
        "@@ -1,2 +1,2 @@\n-x\n+y\n+z\n context\n"
        "diff --git a/new.txt b/new.txt\nnew file mode 100644\nindex 0..3\n"
        "--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1 @@\n+--- not a header\n"
        "diff --git a/old.txt b/old.txt\ndeleted file mode 100644\nindex 3..0\n"
        "--- a/old.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-gone\n"
        "diff --git a/img.png b/img.png\nnew file mode 100644\nindex 0..4\n"
        "GIT binary patch\nliteral 4\nLcmZQz0000\n\n"
    )
    got = [(f.path, f.status, f.added, f.removed) for f in files_of(patch)]
    assert got == [
        ("a.py", "modified", 2, 1),
        ("new.txt", "created", 1, 0),
        ("old.txt", "deleted", 0, 1),
        ("img.png", "created", 0, 0),
    ]
    assert files_of("") == []


def test_the_worker_line() -> None:
    assert (
        worker_line(files=3, added=38, removed=12, checks="passed")
        == "+38 \u221212 in 3 files \u00b7 checks pass"
    )
    assert "checks not run (no checks found)" in worker_line(
        files=1, added=1, removed=0, checks="none", note="no checks found"
    )
    assert worker_line(files=0, added=0, removed=0, checks="none", note="no changes") == (
        "The worker changed no file."
    )
