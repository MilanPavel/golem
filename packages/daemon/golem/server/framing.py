"""NDJSON framing for the Unix socket.

One UTF-8 JSON value per line. A line over :data:`MAX_LINE_BYTES` is rejected
and the connection is closed.
"""

from __future__ import annotations

import asyncio

MAX_LINE_BYTES = 1_048_576


class FrameTooLong(Exception):
    """A line crossed :data:`MAX_LINE_BYTES` before the newline."""


async def read_frame(reader: asyncio.StreamReader) -> bytes | None:
    """Return one line without its trailing newline, or ``None`` on EOF."""
    try:
        line = await reader.readuntil(b"\n")
    except asyncio.LimitOverrunError as exc:
        raise FrameTooLong from exc
    except asyncio.IncompleteReadError:
        return None
    if line.endswith(b"\n"):
        line = line[:-1]
    if line.endswith(b"\r"):
        line = line[:-1]
    return line
