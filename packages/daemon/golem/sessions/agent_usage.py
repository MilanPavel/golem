"""How often each agent type was used and finished, counted from stored events (ADR-059).

``used`` counts the helpers of an agent type started in the last 30 days. ``finished`` counts
the ones that ended with ``stopped = "done"``. Both are read from the lead's log:

* A helper is one ``helper.started`` event (its ``agent`` names the type). Its end is the
  ``helper.ended`` with the same ``call_id`` and ``index``, in the same log. A helper with no
  ``helper.ended`` yet is still running: it counts as used and not finished, so
  ``finished`` can rise after a count was shown.
* Logs written before helpers were sessions have no ``helper.*`` events. A ``delegate``
  call there is one ``tool.requested`` named ``delegate`` (its ``args.agent``, ``explorer``
  when left out). It counts as used, and as finished when its ``tool.completed`` preview does
  not start ``<agent> finished:`` (the old result text for a helper stopped by a limit). A
  ``tool.failed``, or no outcome yet, is not finished. A call that has a ``helper.started``
  in the same log is a new-shape call and is not counted twice.

Cost: the ``events`` table has no index on ``type`` or ``ts``, so each of the two queries
scans the whole table once and decodes the JSON of only the rows it keeps (helper events
in the window; ``delegate`` requests in the window). The old-shape query also looks up the
outcome of each ``delegate`` request in that lead's log, by its primary key. Nothing is loaded
into memory except the matching rows, and no session log is read whole. Fine for a list that
opens a page; it should not run on every event.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from golem.store.database import Database

WINDOW_DAYS = 30
KEEP_SECONDS = 60

DEFAULT_OLD_AGENT = "explorer"
"""The agent of an old ``delegate`` call that did not name one."""

_PREVIEW_HEAD = 200

# Both queries compare ``ts`` as text with the first 19 characters of the cutoff, which keeps
# every row of the cutoff second or later. The exact edge is then decided in Python.
_NEW_SHAPE = """
SELECT type, ts, session_id,
       json_extract(data, '$.call_id') AS call_id,
       json_extract(data, '$.index') AS idx,
       json_extract(data, '$.agent') AS agent,
       json_extract(data, '$.stopped') AS stopped
FROM events
WHERE type IN ('helper.started', 'helper.ended') AND ts >= ?
"""

_OLD_SHAPE = f"""
SELECT r.ts AS ts, r.session_id AS session_id,
       json_extract(r.data, '$.call_id') AS call_id,
       json_extract(r.data, '$.args.agent') AS agent,
       c.type AS outcome,
       substr(coalesce(json_extract(c.data, '$.preview'), ''), 1, {_PREVIEW_HEAD}) AS head
FROM events r
LEFT JOIN events c
  ON c.session_id = r.session_id AND c.seq > r.seq
 AND c.type IN ('tool.completed', 'tool.failed')
 AND json_extract(c.data, '$.call_id') = json_extract(r.data, '$.call_id')
WHERE r.type = 'tool.requested' AND r.ts >= ?
  AND json_extract(r.data, '$.name') = 'delegate'
"""


@dataclass(frozen=True, slots=True)
class AgentCount:
    used: int = 0
    finished: int = 0


class AgentUsage:
    """Counts helpers per agent type from ``golem.db``."""

    def __init__(self, database: Database, *, clock: Callable[[], datetime] | None = None) -> None:
        self._database = database
        self._clock = clock or (lambda: datetime.now(UTC))
        self._kept: tuple[datetime, dict[str, AgentCount]] | None = None

    async def counts(self) -> dict[str, AgentCount]:
        """The counts for the last 30 days, by agent name. A type never used is absent.

        Each read scans the events table, so the answer is kept for ``KEEP_SECONDS``: a list
        that is opened or refreshed again within a minute does not scan again.
        """
        now = self._clock()
        if self._kept is not None and 0 <= (now - self._kept[0]).total_seconds() < KEEP_SECONDS:
            return dict(self._kept[1])
        found = await self._read(now)
        self._kept = (now, found)
        return dict(found)

    async def _read(self, now: datetime) -> dict[str, AgentCount]:
        cutoff = now - timedelta(days=WINDOW_DAYS)
        prefix = cutoff.astimezone(UTC).isoformat()[:19]
        used: Counter[str] = Counter()
        finished: Counter[str] = Counter()

        started: dict[tuple[str, str, int], tuple[str, datetime]] = {}
        stopped: dict[tuple[str, str, int], str] = {}
        for row in await self._database.fetch_all(_NEW_SHAPE, (prefix,)):
            key = (row["session_id"], row["call_id"], row["idx"])
            if row["type"] == "helper.started":
                started[key] = (row["agent"], _when(row["ts"]))
            else:
                stopped[key] = row["stopped"]
        new_calls = {(session, call) for session, call, _ in started}
        for key, (agent, ts) in started.items():
            if ts < cutoff:
                continue
            used[agent] += 1
            # No helper.ended yet means it is still running: used, not finished.
            if stopped.get(key) == "done":
                finished[agent] += 1

        for row in await self._database.fetch_all(_OLD_SHAPE, (prefix,)):
            if (row["session_id"], row["call_id"]) in new_calls or _when(row["ts"]) < cutoff:
                continue
            agent = row["agent"] or DEFAULT_OLD_AGENT
            used[agent] += 1
            if row["outcome"] == "tool.completed" and not row["head"].startswith(
                f"{agent} finished:"
            ):
                finished[agent] += 1

        return {name: AgentCount(used[name], finished[name]) for name in used}


def _when(ts: str) -> datetime:
    parsed = datetime.fromisoformat(ts)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


__all__ = ["WINDOW_DAYS", "AgentCount", "AgentUsage"]
