"""``notifications.get`` and ``notifications.set``: the ``[notifications]`` settings for the web.

A write checks the values with the settings model first, so a wrong value comes back as a
field error and nothing is written. The file keeps its comments.
"""

from __future__ import annotations

import asyncio
import logging

from pydantic import ValidationError

from golem.config import TERMINAL_APPS, NotificationSettings, load_settings
from golem.config_edit import RawConflictError, set_keys
from golem.server.dispatcher import INTERNAL_ERROR, RequestContext, RpcCallError
from golem_protocol.commands import (
    ConfigError,
    NotificationsGetParams,
    NotificationsSetParams,
    NotificationsSetResult,
    NotificationsValues,
)

log = logging.getLogger(__name__)


async def _values(ctx: RequestContext) -> NotificationsValues:
    paths = ctx.state.paths
    settings = await asyncio.to_thread(load_settings, home=paths.home, project_dir=paths.home)
    notifications = settings.notifications
    return NotificationsValues(
        needs_you=notifications.needs_you,
        failed=notifications.failed,
        finished=notifications.finished,
        open_in=notifications.open_in,
        terminal_app=notifications.terminal_app,
        terminal_apps=list(TERMINAL_APPS),
        finished_routines=[
            item.name
            for item in settings.routine
            if item.notify_finished is True and not notifications.finished
        ],
        failed_routines=[
            item.name
            for item in settings.routine
            if item.notify_failed is True and not notifications.failed
        ],
    )


async def notifications_get(
    ctx: RequestContext, _params: NotificationsGetParams
) -> NotificationsValues:
    return await _values(ctx)


async def notifications_set(
    ctx: RequestContext, params: NotificationsSetParams
) -> NotificationsSetResult:
    patch = params.model_dump(exclude_none=True)
    current = (await _values(ctx)).model_dump(include=set(NotificationSettings.model_fields))
    try:
        NotificationSettings.model_validate({**current, **patch})
    except ValidationError as exc:
        return NotificationsSetResult(
            ok=False,
            errors=[
                ConfigError(
                    path=f"notifications.{'.'.join(str(part) for part in error['loc'])}",
                    message=error["msg"],
                )
                for error in exc.errors()
            ],
        )
    config_file = ctx.state.paths.config_file
    try:
        if patch:
            await asyncio.to_thread(set_keys, config_file, {"notifications": patch})
    except (RawConflictError, ValueError) as exc:
        return NotificationsSetResult(ok=False, errors=[ConfigError(message=str(exc))])
    except OSError as exc:
        raise RpcCallError(INTERNAL_ERROR, f"could not write {config_file}: {exc}") from exc
    log.info("notification settings saved keys=%s", sorted(patch))
    return NotificationsSetResult(ok=True, values=await _values(ctx))
