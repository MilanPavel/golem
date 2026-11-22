"""Mutable daemon facts handlers are allowed to read."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Literal

from pydantic import BaseModel

from golem.agents.registry import AgentRegistry
from golem.coding.changes import ChangeStore
from golem.mcp import McpSupervisor
from golem.mcp.importer import ScanStore
from golem.memory.service import MemoryService
from golem.models.bench_manager import BenchManager
from golem.models.check import CheckManager
from golem.models.discovery import ModelDiscovery
from golem.models.facts import FactsSource
from golem.models.install import BrewInstaller, OllamaInstaller
from golem.models.ollama import LocalServers
from golem.models.pulls import PullManager
from golem.models.scores import Scores
from golem.notify import Notifier
from golem.pairing import PairingManager
from golem.paths import GolemPaths
from golem.permissions.policy import Policy
from golem.routine_scheduler import RoutineScheduler
from golem.routine_watcher import FileWatcher
from golem.routines import local_zone
from golem.secrets import SecretStore
from golem.sessions.agent_usage import AgentUsage
from golem.sessions.drafts import ModelDrafts
from golem.sessions.manager import SessionManager
from golem.sessions.usage import Usage
from golem.skills.registry import SkillRegistry
from golem.store.artifacts import ArtifactStore
from golem.store.devices import DeviceStore
from golem.store.routine_runs import RoutineRuns
from golem.tools.registry import ToolRegistry


@dataclass
class DaemonState:
    """Process-wide state shared with request handlers."""

    paths: GolemPaths
    started_at: float
    state: Literal["running", "draining"] = "running"
    sessions: SessionManager | None = None
    notifier: Notifier | None = None
    routines: RoutineScheduler | None = None
    """The routine scheduler, once the daemon serves. ``routine.run`` fires through it."""
    watcher: FileWatcher | None = None
    """The file watcher of the ``on`` routines, once the daemon serves."""
    routine_runs: RoutineRuns | None = None
    devices: DeviceStore | None = None
    """The device registry, once the database is open."""
    pairing: PairingManager | None = None
    """The open phone pairing, if any. Made with the registry."""
    models: ModelDiscovery | None = None
    facts: FactsSource | None = None
    pulls: PullManager | None = None
    checks: CheckManager | None = None
    benches: BenchManager | None = None
    policy: Policy | None = None
    tools: ToolRegistry | None = None
    artifacts: ArtifactStore | None = None
    changes: ChangeStore | None = None
    usage: Usage | None = None
    drafts: ModelDrafts | None = None
    """Drafts instruction lines for ``chat.draft``, once the database is open."""
    scores: Scores | None = None
    mcp: McpSupervisor | None = None
    secrets: SecretStore | None = None
    skills: SkillRegistry | None = None
    agents: AgentRegistry | None = None
    agent_usage: AgentUsage | None = None
    """Counts of helpers per agent type. None until the database is open."""
    memory: MemoryService | None = None
    """The memory service. None when ``[memory] enabled = false``."""
    local_servers: LocalServers | None = None
    installer: OllamaInstaller | None = None
    runtimes: dict[str, BrewInstaller] = field(default_factory=dict[str, BrewInstaller])
    user_home: Path | None = None
    """The home folder other apps keep their config in. None means the real one."""
    mcp_imports: ScanStore = field(default_factory=ScanStore)
    broadcast: Callable[[BaseModel], None] = field(default=lambda _notification: None)
    """Queues a notification on every connection that said hello."""
    broadcast_owner: Callable[[BaseModel], None] = field(default=lambda _notification: None)
    """Like ``broadcast``, but skips a paired phone's connection."""
    clock: Callable[[], datetime] = field(default=lambda: datetime.now(local_zone()))
    """The time, with the Mac's zone. A test sets its own."""
