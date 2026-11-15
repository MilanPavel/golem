"""The ``checks`` node: after a turn that changed files, run the project's checks.

It runs each check in the shell sandbox and reports it on the custom stream as
``check.started`` and ``check.completed``. A failure goes back to the model as a
note, at most ``fix_rounds`` times a turn. Whether it runs, or first offers the
checks to the user, comes from ``[coding] checks`` and the session's answer.
"""

from __future__ import annotations

import logging
import os
import time
from collections.abc import Awaitable, Callable, Mapping
from pathlib import Path
from typing import Literal, cast

from langchain_core.runnables import RunnableConfig
from langgraph.config import get_stream_writer

from golem.coding.checks import Check, checks_for, decide, edited_this_turn
from golem.graphs.adapter import STREAM_KEY
from golem.graphs.notes import note
from golem.graphs.state import AgentState
from golem.graphs.tools_node import CWD_KEY, MODE_KEY
from golem.permissions.policy import Policy
from golem.sessions.ids import new_id
from golem.tools import sandbox
from golem.tools.registry import Artifacts

log = logging.getLogger("golem.checks")

CHECKS_KEY = "golem_checks"
"""``configurable`` key: the session's answer, true, false, or None when it was not asked."""

OUTPUT_CHARS = 4000
"""How much of a check's output the event carries, counted from the end."""

NOTE_OUTPUT_CHARS = 3000
"""How much of a failed check's output the note to the model carries, from the end."""

Status = Literal["passed", "failed", "timed_out"]


def checks_node(
    policy: Policy, artifacts: Artifacts | None = None
) -> Callable[[AgentState, RunnableConfig], Awaitable[dict[str, object]]]:
    async def run_checks(state: AgentState, config: RunnableConfig) -> dict[str, object]:
        none: dict[str, object] = {"check_results": []}
        root = _root(config)
        if root is None or not edited_this_turn(state["messages"]):
            return none
        configurable = cast(Mapping[str, object], config.get("configurable", {}))
        answer = configurable.get(CHECKS_KEY)
        mode = configurable.get(MODE_KEY)
        settings = policy.coding()
        what = decide(
            settings.checks,
            answer if isinstance(answer, bool) else None,
            mode if mode in ("careful", "balanced", "autopilot") else policy.default_mode(),
        )
        if what == "skip":
            return none
        checks = checks_for(root, settings)
        if not checks:
            return none
        write = get_stream_writer()
        if what == "offer":
            if state.get("checks_offered"):
                return none
            write(
                {
                    STREAM_KEY: "check.offered",
                    "checks": [{"name": c.name, "command": c.command} for c in checks],
                }
            )
            return {**none, "checks_offered": True}
        if not sandbox.available():
            log.warning("checks not run: this machine has no sandbox")
            return none
        round_no = state.get("check_round", 0)
        results: list[dict[str, object]] = []
        for check in checks:
            results.append(
                await _run(
                    check, root, policy, artifacts, state.get("session_id"), round_no=round_no
                )
            )
        failed = [r for r in results if r["status"] != "passed"]
        if failed and round_no < settings.fix_rounds:
            return {
                "check_results": results,
                "check_round": round_no + 1,
                "messages": [note(_failure_text(failed, round_no + 1, settings.fix_rounds))],
            }
        return {"check_results": results}

    return run_checks


async def _run(
    check: Check,
    root: Path,
    policy: Policy,
    artifacts: Artifacts | None,
    session_id: str | None,
    *,
    round_no: int = 0,
) -> dict[str, object]:
    write = get_stream_writer()
    check_id = new_id("k")
    write(
        {
            STREAM_KEY: "check.started",
            "check_id": check_id,
            "name": check.name,
            "command": check.command,
            "round": round_no,
        }
    )
    started = time.monotonic()
    login = os.environ.get("SHELL") or "/bin/zsh"
    done = await sandbox.run(
        [login, "-lc", check.command],
        root=root,
        settings=policy.shell(),
        timeout=check.timeout_seconds,
        sandboxed=True,
    )
    status: Status = (
        "timed_out" if done.timed_out else "passed" if done.exit_code == 0 else "failed"
    )
    output = done.output.rstrip("\n")
    artifact_id: str | None = None
    if len(output) > OUTPUT_CHARS:
        if artifacts is not None and session_id is not None:
            artifact_id = await artifacts.put(session_id, None, "tool_output", output)
        output = output[-OUTPUT_CHARS:]
    result: dict[str, object] = {
        "check_id": check_id,
        "name": check.name,
        "status": status,
        "exit_code": done.exit_code,
        "duration_ms": _ms(started),
        "output": output,
        "artifact_id": artifact_id,
        "round": round_no,
    }
    write({STREAM_KEY: "check.completed", **result})
    return result


def _failure_text(failed: list[dict[str, object]], round_no: int, rounds: int) -> str:
    """The note for the model: each failed check with the end of its output."""
    parts = ["Checks failed after your changes. Fix them, or say why they cannot be fixed."]
    for result in failed:
        status = str(result["status"])
        what = "timed out" if status == "timed_out" else f"exit {result['exit_code']}"
        output = str(result["output"])[-NOTE_OUTPUT_CHARS:]
        parts.append(f"{result['name']} ({what}):\n{output}")
    parts.append(f"Round {round_no} of {rounds}.")
    return "\n\n".join(parts)


def _ms(started: float) -> int:
    return int((time.monotonic() - started) * 1000)


def _root(config: RunnableConfig) -> Path | None:
    configurable = cast(Mapping[str, object], config.get("configurable", {}))
    raw = configurable.get(CWD_KEY)
    return Path(raw) if isinstance(raw, str) and raw != "" else None


__all__ = ["CHECKS_KEY", "OUTPUT_CHARS", "checks_node"]
