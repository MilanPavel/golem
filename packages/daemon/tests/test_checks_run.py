"""The checks node: what runs after a turn that changed files, and what it reports."""

from __future__ import annotations

from pathlib import Path
from typing import cast

import pytest
from fakes import Calls, ToolCallingChatModel
from langgraph.checkpoint.memory import InMemorySaver

from golem.config import PermissionMode
from golem.graphs.adapter import (
    CheckCompleted,
    CheckOffered,
    CheckStarted,
    Fact,
    translate,
)
from golem.graphs.chat import ChatRuntime, open_chat
from golem.models.router import ModelRouter
from golem.permissions.policy import Policy
from golem.tools import sandbox

pytestmark = pytest.mark.skipif(not sandbox.available(), reason="needs the shell sandbox")

TWO = (
    '[[coding.check]]\nname = "pass"\ncommand = "true"\n'
    '[[coding.check]]\nname = "fail"\ncommand = "false"\n'
)
WRITE: Calls = [("write_file", {"path": "a.txt", "content": "x"})]


def _runtime(tmp_path: Path, config: str, replies: list[str | Calls]) -> tuple[ChatRuntime, Path]:
    home = tmp_path / "h"
    project = tmp_path / "p"
    home.mkdir()
    project.mkdir()
    file = home / "config.toml"
    file.write_text(config, encoding="utf-8")
    model = ToolCallingChatModel(replies=replies)
    return open_chat(
        ModelRouter(model=model), InMemorySaver(), policy=Policy(file, home=home)
    ), project


async def _turn(
    runtime: ChatRuntime,
    project: Path,
    *,
    n: int = 1,
    mode: PermissionMode = "autopilot",
    checks: bool | None = None,
) -> list[Fact]:
    facts: list[Fact] = []
    async for part in runtime.stream(
        session_id="s_test",
        text=f"turn {n}",
        model_profile="remote",
        schema_version=1,
        user_message_id=f"m_user{n}",
        assistant_message_id=f"m_reply{n}",
        cwd=str(project),
        permission_mode=mode,
        checks=checks,
    ):
        fact = translate(part)
        if isinstance(fact, CheckOffered | CheckStarted | CheckCompleted):
            facts.append(fact)
    return facts


async def test_an_edit_turn_runs_each_check_in_order(tmp_path: Path) -> None:
    runtime, project = _runtime(tmp_path, TWO, [WRITE, "done"])
    facts = await _turn(runtime, project)
    assert [type(f).__name__ for f in facts] == [
        "CheckStarted",
        "CheckCompleted",
        "CheckStarted",
        "CheckCompleted",
    ]
    started = [f for f in facts if isinstance(f, CheckStarted)]
    done = [f for f in facts if isinstance(f, CheckCompleted)]
    assert [(f.name, f.command, f.round) for f in started] == [
        ("pass", "true", 0),
        ("fail", "false", 0),
    ]
    assert [(f.status, f.exit_code, f.round) for f in done] == [("passed", 0, 0), ("failed", 1, 0)]
    assert [f.check_id for f in started] == [f.check_id for f in done]
    results = (await runtime.values("s_test"))["check_results"]
    assert [r["status"] for r in cast("list[dict[str, object]]", results)] == ["passed", "failed"]


async def test_a_turn_without_edits_runs_nothing(tmp_path: Path) -> None:
    runtime, project = _runtime(tmp_path, TWO, ["just talk"])
    assert await _turn(runtime, project) == []


async def test_checks_off_runs_nothing(tmp_path: Path) -> None:
    runtime, project = _runtime(tmp_path, '[coding]\nchecks = "off"\n' + TWO, [WRITE, "done"])
    assert await _turn(runtime, project) == []


async def test_a_folder_without_checks_runs_nothing(tmp_path: Path) -> None:
    runtime, project = _runtime(tmp_path, "", [WRITE, "done"])
    assert await _turn(runtime, project) == []


async def test_ask_in_balanced_offers_once_and_runs_nothing(tmp_path: Path) -> None:
    config = '[[rule]]\ntool = "write_file"\naction = "allow"\n' + TWO
    runtime, project = _runtime(tmp_path, config, [WRITE, "one", WRITE, "two"])
    first = await _turn(runtime, project, mode="balanced")
    assert len(first) == 1
    offer = first[0]
    assert isinstance(offer, CheckOffered)
    assert offer.checks == (("pass", "true"), ("fail", "false"))
    assert await _turn(runtime, project, n=2, mode="balanced") == []


async def test_after_a_yes_the_next_edit_turn_runs_the_checks(tmp_path: Path) -> None:
    config = '[[rule]]\ntool = "write_file"\naction = "allow"\n' + TWO
    runtime, project = _runtime(tmp_path, config, [WRITE, "one", WRITE, "two"])
    assert len(await _turn(runtime, project, mode="balanced")) == 1
    facts = await _turn(runtime, project, n=2, mode="balanced", checks=True)
    assert [type(f).__name__ for f in facts].count("CheckCompleted") == 2


async def test_a_no_stops_the_checks_in_autopilot(tmp_path: Path) -> None:
    runtime, project = _runtime(tmp_path, TWO, [WRITE, "done"])
    assert await _turn(runtime, project, checks=False) == []


async def test_auto_runs_without_an_offer_in_balanced(tmp_path: Path) -> None:
    config = '[coding]\nchecks = "auto"\n[[rule]]\ntool = "write_file"\naction = "allow"\n' + TWO
    runtime, project = _runtime(tmp_path, config, [WRITE, "done"])
    facts = await _turn(runtime, project, mode="balanced")
    assert not any(isinstance(f, CheckOffered) for f in facts)
    assert sum(isinstance(f, CheckCompleted) for f in facts) == 2


async def test_a_check_past_its_timeout_is_timed_out(tmp_path: Path) -> None:
    config = '[[coding.check]]\nname = "slow"\ncommand = "sleep 5"\ntimeout_seconds = 1\n'
    runtime, project = _runtime(tmp_path, config, [WRITE, "done"])
    facts = await _turn(runtime, project)
    done = [f for f in facts if isinstance(f, CheckCompleted)]
    assert [(f.status, f.exit_code) for f in done] == [("timed_out", None)]


async def test_long_output_is_cut_to_the_tail(tmp_path: Path) -> None:
    command = "yes line | head -n 2000"
    config = f'[[coding.check]]\nname = "loud"\ncommand = "{command}"\n'
    runtime, project = _runtime(tmp_path, config, [WRITE, "done"])
    facts = await _turn(runtime, project)
    done = [f for f in facts if isinstance(f, CheckCompleted)]
    assert len(done[0].output) == 4000
    assert done[0].status == "passed"
    assert done[0].artifact_id is None
