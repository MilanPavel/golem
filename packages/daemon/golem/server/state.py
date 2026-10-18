"""Mutable daemon facts handlers are allowed to read."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from golem.models.discovery import ModelDiscovery
from golem.paths import GolemPaths
from golem.sessions.manager import SessionManager


@dataclass
class DaemonState:
    """Process-wide state shared with request handlers."""

    paths: GolemPaths
    started_at: float
    state: Literal["running", "draining"] = "running"
    sessions: SessionManager | None = None
    models: ModelDiscovery | None = None
