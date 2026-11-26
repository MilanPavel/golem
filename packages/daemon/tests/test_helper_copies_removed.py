"""Copies are removed on close of the lead and swept at startup (ADR-059, step 15.10.7).

No model: scripted replies, the checks through a fake runner. A closed lead removes the copies
of its helpers; a helper closed on its own keeps its copy; the startup sweep removes the
folders nobody owns and keeps the diff of a helper whose lead is open.
"""

# pyright: reportPrivateUsage=false
from __future__ import annotations

import shutil
from pathlib import Path

import pytest
from test_helper_restart import SETUPS, _Setup  # pyright: ignore
from test_helper_worker_copy import _Daemon, _git, _home, _settled, lead  # pyright: ignore
from test_helper_worker_diff import WORKERS, _configured, _daemon, _fake  # pyright: ignore

from golem.coding import copies
from golem.paths import resolve_paths
from golem.sessions.recovery import sweep_copies
from golem.store.database import Database
from golem.store.records import SessionRecords

__all__ = ["_configured", "_home", "_settled", "lead"]


async def _owned(daemon: _Daemon, lead_id: str) -> dict[str, Path]:
    found = await daemon.records.copies_of_helpers(lead_id)
    return {helper: Path(path) for helper, path in found}


def _worktrees(folder: Path) -> list[str]:
    out = _git(folder, "worktree", "list", "--porcelain")
    return [line for line in out.splitlines() if line.startswith("worktree ")]


async def _ready(
    setup: _Setup, database: Database, lead: Path, tmp_path: Path, settled: list[_Daemon]
) -> tuple[_Daemon, str, dict[str, Path]]:
    daemon = _daemon(setup, database, lead, tmp_path, settled)
    daemon.manager.check_runner = _fake
    session, _events = await daemon.run(lead)
    owned = await _owned(daemon, session)
    assert len(owned) == WORKERS and all(p.is_dir() for p in owned.values())
    return daemon, session, owned


@pytest.mark.parametrize("setup", SETUPS)
async def test_closing_the_lead_removes_the_copies_of_its_helpers(
    setup: _Setup,
    database: Database,
    lead: Path,
    tmp_path: Path,
    _home: Path,
    _settled: list[_Daemon],
) -> None:
    daemon, session, owned = await _ready(setup, database, lead, tmp_path, _settled)

    await daemon.manager.close(session)

    assert not any(p.exists() for p in owned.values())
    assert await daemon.records.copies_of_helpers(session) == []
    assert copies.list_copies() == []
    assert len(_worktrees(lead)) == 1


@pytest.mark.parametrize("setup", SETUPS)
async def test_a_helper_closed_on_its_own_keeps_its_copy_so_its_diff_can_be_applied(
    setup: _Setup,
    database: Database,
    lead: Path,
    tmp_path: Path,
    _home: Path,
    _settled: list[_Daemon],
) -> None:
    daemon, session, owned = await _ready(setup, database, lead, tmp_path, _settled)
    first = sorted(owned)[0]

    await daemon.manager.close(first)

    assert owned[first].is_dir()
    assert set(await _owned(daemon, session)) == set(owned)
    await sweep_copies(daemon.records)  # the lead is open: the copy stays after a restart too
    assert all(p.is_dir() for p in owned.values())


@pytest.mark.parametrize("setup", SETUPS)
async def test_the_startup_sweep_after_a_crash_removes_orphans_and_keeps_pending_diffs(
    setup: _Setup,
    database: Database,
    lead: Path,
    tmp_path: Path,
    _home: Path,
    _settled: list[_Daemon],
) -> None:
    daemon, session, owned = await _ready(setup, database, lead, tmp_path, _settled)
    names = sorted(owned)
    forgotten, vanished = names[0], names[1]
    stray = await copies.create(lead, "stray-folder")  # a copy no record names
    await daemon.records.clear_copy(forgotten)  # a record lost in the crash
    shutil.rmtree(owned[vanished])  # a folder lost: its worktree entry is stale

    restarted = SessionRecords(database)  # the daemon stopped without cleanup
    removed = await sweep_copies(restarted)

    assert {p.name for p in removed} == {"stray-folder", forgotten}
    assert not stray.path.exists() and not owned[forgotten].exists()
    for name in names[2:]:
        assert owned[name].is_dir()
    assert await restarted.copy_of(vanished) is None
    assert set(await _owned(daemon, session)) == set(names[2:])
    assert len(_worktrees(lead)) == 1 + len(names[2:])
    assert sorted(p.name for p in copies.list_copies()) == names[2:]


@pytest.mark.parametrize("setup", SETUPS)
async def test_the_startup_sweep_removes_every_copy_of_a_lead_that_is_closed(
    setup: _Setup,
    database: Database,
    lead: Path,
    tmp_path: Path,
    _home: Path,
    _settled: list[_Daemon],
) -> None:
    daemon, session, owned = await _ready(setup, database, lead, tmp_path, _settled)
    async with database.transaction() as tx:  # the daemon died after it marked the lead closed
        await tx.execute(
            "UPDATE sessions SET closed_at = '2026-11-26T00:00:00Z' WHERE session_id = ?",
            (session,),
        )

    removed = await sweep_copies(SessionRecords(database))

    assert len(removed) == len(owned)
    assert copies.list_copies() == []
    assert await daemon.records.copies_of_helpers(session) == []
    assert len(_worktrees(lead)) == 1


async def test_the_sweep_touches_nothing_outside_the_copies_folder(
    database: Database, tmp_path: Path, _home: Path
) -> None:
    outside = tmp_path / "precious"
    outside.mkdir()
    (outside / "keep.txt").write_text("keep", encoding="utf-8")
    async with database.transaction() as tx:
        await tx.execute(
            "INSERT INTO sessions (session_id, model_profile, created_at, updated_at, route,"
            " copy_path, copy_baseline) VALUES ('s_x', 'm', 't', 't', 'pinned', ?, 'abc')",
            (str(outside),),
        )
    resolve_paths().copies_dir.mkdir(parents=True)

    removed = await sweep_copies(SessionRecords(database))

    assert removed == [] and (outside / "keep.txt").read_text(encoding="utf-8") == "keep"
