"""Logging for the daemon.

The ``golem`` logger writes JSON lines to ``logs/golem.jsonl`` and a short
text line to stderr. Child loggers (``golem.server``, …) propagate here.
"""

from __future__ import annotations

import json
import logging
import sys
from datetime import UTC, datetime

from golem.config import GolemSettings
from golem.paths import GolemPaths

_LOGGER_NAME = "golem"


class JsonFormatter(logging.Formatter):
    """One JSON object per line."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, str] = {
            "ts": datetime.now(UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


class PrettyFormatter(logging.Formatter):
    """Short text for a terminal."""

    def __init__(self) -> None:
        super().__init__(fmt="%(asctime)s %(levelname)s %(name)s: %(message)s", datefmt="%H:%M:%S")


def configure_logging(settings: GolemSettings, paths: GolemPaths) -> None:
    """Attach stderr and JSON-file handlers to the ``golem`` logger.

    Calling this again replaces the previous handlers.
    """
    paths.logs_dir.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger(_LOGGER_NAME)
    for handler in list(logger.handlers):
        handler.close()
        logger.removeHandler(handler)
    logger.setLevel(settings.log_level)
    logger.propagate = False

    stderr_handler = logging.StreamHandler(sys.stderr)
    stderr_handler.setFormatter(PrettyFormatter())
    logger.addHandler(stderr_handler)

    file_handler = logging.FileHandler(paths.log_file, encoding="utf-8")
    file_handler.setFormatter(JsonFormatter())
    logger.addHandler(file_handler)
