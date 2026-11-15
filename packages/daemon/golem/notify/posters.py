"""The things that show a notice: macOS ``osascript``, or nothing."""

from __future__ import annotations

import asyncio
import logging
import sys
from pathlib import Path

from golem.notify.notifier import Notice, Poster

log = logging.getLogger("golem.notify")

_SCRIPT = (
    "on run argv",
    "display notification (item 2 of argv) with title (item 1 of argv)",
    "end run",
)
_TIMEOUT_SECONDS = 10.0


class NullPoster:
    """Shows nothing. Used in tests, off macOS, and under a temporary ``GOLEM_HOME``."""

    name = "none"

    async def post(self, notice: Notice) -> bool:
        return False


class OsascriptPoster:
    """The fallback of ADR-050: ``osascript display notification``, with no click.

    The text goes in as script arguments, never into the script source.
    """

    name = "osascript"

    async def post(self, notice: Notice) -> bool:
        args = ["osascript"]
        for line in _SCRIPT:
            args += ["-e", line]
        args += ["--", notice.title, notice.body]
        try:
            process = await asyncio.create_subprocess_exec(
                *args,
                stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            async with asyncio.timeout(_TIMEOUT_SECONDS):
                return await process.wait() == 0
        except (OSError, TimeoutError):
            log.warning("osascript could not post a notification", exc_info=True)
            return False


def default_poster(home: Path) -> Poster:
    """The macOS poster for the real golem home, and nothing anywhere else.

    A home other than ``~/.golem`` is a test or a sandbox: it never posts.
    """
    if sys.platform != "darwin" or home != (Path.home() / ".golem").resolve():
        return NullPoster()
    return OsascriptPoster()


__all__ = ["NullPoster", "OsascriptPoster", "default_poster"]
