"""Mutable daemon facts handlers are allowed to read."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from golem.mcp import McpSupervisor
from golem.models.discovery import ModelDiscovery
from golem.models.pulls import PullManager
from golem.paths import GolemPaths
from golem.permissions.policy import Policy
from golem.secrets import SecretStore
from golem.sessions.manager import SessionManager
from golem.store.artifacts import ArtifactStore
from golem.tools.registry import ToolRegistry


@dataclass
class DaemonState:
    """Process-wide state shared with request handlers."""

    paths: GolemPaths
    started_at: float
    state: Literal["running", "draining"] = "running"
    sessions: SessionManager | None = None
    models: ModelDiscovery | None = None
    pulls: PullManager | None = None
    policy: Policy | None = None
    tools: ToolRegistry | None = None
    artifacts: ArtifactStore | None = None
    mcp: McpSupervisor | None = None
    secrets: SecretStore | None = None
