"""Handlers for ``inbox.list`` and ``inbox.done``: what query routines left in the Inbox."""

from __future__ import annotations

from datetime import UTC, datetime

from golem.server.dispatcher import INVALID_PARAMS, RequestContext, RpcCallError
from golem.store.inbox_posts import InboxPostRecord
from golem_protocol.commands import (
    InboxDoneParams,
    InboxDoneResult,
    InboxListParams,
    InboxListResult,
    InboxPost,
    RoutineChanged,
)
from golem_protocol.rpc import RoutineChangedNotification


def post_of(record: InboxPostRecord) -> InboxPost:
    return InboxPost(
        post_id=record.post_id,
        routine=record.routine,
        scope=record.scope,
        source=record.source,
        saved=record.saved,
        row_count=record.row_count,
        columns=record.columns,
        rows=record.rows,
        error=record.error,
        at=record.at,
    )


async def inbox_list(ctx: RequestContext, params: InboxListParams) -> InboxListResult:
    del params
    posts = ctx.state.inbox_posts
    found = [] if posts is None else await posts.open_posts()
    return InboxListResult(posts=[post_of(record) for record in found])


async def inbox_done(ctx: RequestContext, params: InboxDoneParams) -> InboxDoneResult:
    posts = ctx.state.inbox_posts
    if posts is None or not await posts.done(params.post_id, datetime.now(UTC).isoformat()):
        raise RpcCallError(INVALID_PARAMS, "that Inbox item is not there, or is done already")
    # Other windows list the Inbox again when a routine changed.
    ctx.state.broadcast(
        RoutineChangedNotification(params=RoutineChanged(name=None, change="reloaded"))
    )
    return InboxDoneResult(post_id=params.post_id)
