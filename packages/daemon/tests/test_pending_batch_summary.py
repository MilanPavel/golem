"""A batch item is in ``pending_items`` and never in the old ``pending`` field (ADR-059, #1315)."""

from __future__ import annotations

from golem.sessions.summaries import summarize
from golem.store.records import SessionActivity, SessionRecord
from golem_protocol.commands import PendingItem

_BATCH = PendingItem(kind="batch", since="t1", call_id="c9", helper_count=2, agents=["a", "b"])
_ASK = PendingItem(kind="approval", since="t2", call_id="c1", name="shell", subject="ls")


def _activity() -> SessionActivity:
    record = SessionRecord("s1", "local", None, "t0", "t0", None)
    return SessionActivity(record, running=False, last_seq=3, waiting=True)


def test_pending_skips_a_batch_and_pending_items_keeps_it() -> None:
    summary = summarize(_activity(), items=[_BATCH, _ASK])
    assert summary.pending == _ASK
    assert summary.pending_items == [_BATCH, _ASK]


def test_a_lone_batch_leaves_pending_empty() -> None:
    summary = summarize(_activity(), items=[_BATCH])
    assert summary.pending is None
    assert summary.pending_items == [_BATCH]
