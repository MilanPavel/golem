"""Mutable daemon facts handlers are allowed to read."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from golem.mcp import McpSupervisor
from golem.mcp.importer import ScanStore
from golem.models.discovery import ModelDiscovery
from golem.models.install import BrewInstaller, OllamaInstaller
from golem.models.ollama import LocalServers
from golem.models.pulls import PullManager
from golem.paths import GolemPaths
from golem.permissions.policy import Policy
from golem.secrets import SecretStore
from golem.sessions.manager import SessionManager
from golem.skills.registry import SkillRegistry
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
    skills: SkillRegistry | None = None
    local_servers: LocalServers | None = None
    installer: OllamaInstaller | None = None
    runtimes: dict[str, BrewInstaller] = field(default_factory=dict[str, BrewInstaller])
    user_home: Path | None = None
    """The home folder other apps keep their config in. None means the real one."""
    mcp_imports: ScanStore = field(default_factory=ScanStore)
