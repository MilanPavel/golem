"""Close the runs a stopped daemon left open.

A run still ``running`` at startup lost its task. Its log gets the end it
never wrote: each tool call still open fails, the open assistant message
completes, then ``run.failed``. The
partial reply also goes into the checkpoint, so the model sees what the user
saw.

A helper's run is not closed. It goes on from its checkpoint, unless its lead's run was
closed: the helpers of that lead are cancelled. Then the leads parked for their helpers
are looked at again (ADR-059, section 9).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

from golem.coding import copies
from golem.graphs.chat import ChatRuntime
from golem.paths import resolve_paths
from golem.sessions.interrupted import close_reply
from golem.sessions.log import SessionLog
from golem.store.events import EventLog
from golem.store.records import RunRecord, RunRecords, SessionRecords
from golem_protocol.events import (
    ChatEvent,
    MessageCompletedEvent,
    MessageDeltaEvent,
    MessageStartedEvent,
    RunCancelledData,
    RunFailedData,
    ToolCompletedEvent,
    ToolFailedData,
    ToolFailedEvent,
    ToolRequestedEvent,
)

log = logging.getLogger("golem.sessions")

STOPPED_MESSAGE = "the daemon stopped during this run"


@dataclass(frozen=True, slots=True)
class OpenTurn:
    """What one unfinished run's events say about its messages."""

    user_message_id: str | None
    assistant_message_id: str | None
    partial: str
    open_calls: list[str] = field(default_factory=list[str])


def open_turn(events: list[ChatEvent]) -> OpenTurn:
    """Find the user message and the assistant message that never completed."""
    user: str | None = None
    started: str | None = None
    completed: set[str] = set()
    parts: dict[str, list[str]] = {}
    calls: list[str] = []
    for event in events:
        if getattr(event.data, "parent_call_id", None) is not None:
            continue  # a child run's call, which ends with the delegate call that holds it
        if isinstance(event, MessageCompletedEvent):
            if event.data.role == "user":
                user = event.data.message_id
            completed.add(event.data.message_id)
        elif isinstance(event, MessageStartedEvent):
            started = event.data.message_id
        elif isinstance(event, MessageDeltaEvent):
            parts.setdefault(event.data.message_id, []).append(event.data.text)
        elif isinstance(event, ToolRequestedEvent):
            calls.append(event.data.call_id)
        elif (
            isinstance(event, ToolCompletedEvent | ToolFailedEvent) and event.data.call_id in calls
        ):
            calls.remove(event.data.call_id)
    if started is None or started in completed:
        return OpenTurn(
            user_message_id=user, assistant_message_id=None, partial="", open_calls=calls
        )
    return OpenTurn(
        user_message_id=user,
        assistant_message_id=started,
        partial="".join(parts.get(started, [])),
        open_calls=calls,
    )


class HelperRecovery(Protocol):
    """What recovery asks of the session manager for runs of helper sessions."""

    async def is_helper(self, session_id: str) -> bool:
        """Whether the session is a helper session."""
        ...

    async def cancel_helpers(self, lead_id: str) -> None:
        """End the runs of the helpers of ``lead_id`` that are still open."""
        ...

    async def resume_helper(self, run: RunRecord) -> None:
        """Run a helper's ``running`` run on from its checkpoint."""
        ...

    async def reconcile_helpers(self) -> None:
        """Write the ``helper.ended`` a crash lost, and wake the leads that are ready."""
        ...


async def recover_runs(
    runs: RunRecords,
    events: EventLog,
    session_log: SessionLog,
    runtime: ChatRuntime,
    helpers: HelperRecovery | None = None,
) -> list[str]:
    """Close every open run. Returns the ids closed.

    A run that fails to close is logged and stays open for the next start. With ``helpers``,
    a helper's run is not closed: the helpers of a lead whose run was closed are cancelled, and
    the rest go on from their checkpoints. Then ``helpers`` looks at the parked leads.
    """
    closed: list[str] = []
    helper_runs: list[RunRecord] = []
    for run in await runs.running():
        try:
            if helpers is not None and await helpers.is_helper(run.session_id):
                helper_runs.append(run)
                continue
            await _close(run, await events.for_run(run.run_id), session_log, runtime)
            if helpers is not None:
                await helpers.cancel_helpers(run.session_id)
        except Exception:
            log.exception("could not close run %s", run.run_id)
            continue
        closed.append(run.run_id)
    if closed:
        log.info("closed %d run(s) left open by a stopped daemon", len(closed))
    if helpers is None:
        return closed
    for run in helper_runs:
        try:
            current = await runs.get(run.run_id)
            if current is not None and current.status == "running":
                await helpers.resume_helper(current)
        except Exception:
            log.exception("could not resume helper run %s", run.run_id)
    try:
        await helpers.reconcile_helpers()
    except Exception:
        log.exception("could not reconcile the helpers")
    return closed


async def sweep_copies(records: SessionRecords, *, copies_dir: Path | None = None) -> list[Path]:
    """Remove the copies nobody owns any more. Returns the folders removed.

    Each folder under ``copies_dir`` is removed when no helper record names it, or the lead of
    the helper is closed or gone. A copy whose lead is open is kept, whether its helper is
    running, ended with a diff waiting for apply or discard, or closed on its own: apply and
    discard clear the record, so a record that is still there is a copy the user may need.
    Records whose folder is gone are cleared. Then ``git worktree prune`` runs in each lead
    folder seen. Nothing outside ``copies_dir`` is touched.
    """
    root = (copies_dir if copies_dir is not None else resolve_paths().copies_dir).resolve()
    owners = {Path(o.path).resolve(): o for o in await records.all_copies()}
    removed: list[Path] = []
    leads: set[str] = set()
    for folder in copies.list_copies(copies_dir=root):
        owner = owners.pop(folder.resolve(), None)
        if owner is not None and owner.lead_cwd is not None:
            leads.add(owner.lead_cwd)
        if owner is not None and owner.lead_open:
            continue
        try:
            await copies.remove(folder)
            if owner is not None:
                await records.clear_copy(owner.helper_id)
        except Exception:
            log.exception("could not remove the copy %s", folder)
            continue
        removed.append(folder)
    for path, owner in owners.items():
        if not path.is_relative_to(root) or path.exists():
            continue  # not ours to judge, or listed but not a folder
        await records.clear_copy(owner.helper_id)
        if owner.lead_cwd is not None:
            leads.add(owner.lead_cwd)
    for lead in sorted(leads):
        await copies.prune(lead)
    if removed:
        log.info("removed %d copy folder(s) nobody owns", len(removed))
    return removed


async def end_run(
    run: RunRecord,
    found: list[ChatEvent],
    session_log: SessionLog,
    runtime: ChatRuntime,
    cancelled: RunCancelledData | None = None,
) -> None:
    """Write the end of a run that has no task: ``run.failed``, or ``run.cancelled``."""
    await _close(run, found, session_log, runtime, cancelled)


async def _close(
    run: RunRecord,
    found: list[ChatEvent],
    session_log: SessionLog,
    runtime: ChatRuntime,
    cancelled: RunCancelledData | None = None,
) -> None:
    turn = open_turn(found)
    for call_id in turn.open_calls:
        await session_log.emit(
            run.session_id,
            run.run_id,
            "tool.failed",
            ToolFailedData(call_id=call_id, message=STOPPED_MESSAGE),
        )
    if turn.assistant_message_id is not None:
        await close_reply(
            runtime,
            session_log,
            session_id=run.session_id,
            run_id=run.run_id,
            user_message_id=turn.user_message_id,
            assistant_message_id=turn.assistant_message_id,
            partial=turn.partial,
        )
    if cancelled is not None:
        await session_log.emit(run.session_id, run.run_id, "run.cancelled", cancelled)
        return
    await session_log.emit(
        run.session_id,
        run.run_id,
        "run.failed",
        RunFailedData(message=STOPPED_MESSAGE),
    )


__all__ = [
    "STOPPED_MESSAGE",
    "HelperRecovery",
    "OpenTurn",
    "end_run",
    "open_turn",
    "recover_runs",
    "sweep_copies",
]
