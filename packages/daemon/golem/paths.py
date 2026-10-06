"""Filesystem layout for a golem home directory."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

_HOME_ENV = "GOLEM_HOME"


@dataclass(frozen=True, slots=True)
class GolemPaths:
    """Resolved paths under a golem home directory."""

    home: Path

    @property
    def config_file(self) -> Path:
        return self.home / "config.toml"

    @property
    def database_file(self) -> Path:
        return self.home / "golem.db"

    @property
    def checkpoints_file(self) -> Path:
        return self.home / "checkpoints.db"

    @property
    def memory_file(self) -> Path:
        return self.home / "memory.db"

    @property
    def skills_dir(self) -> Path:
        return self.home / "skills"

    @property
    def flows_dir(self) -> Path:
        return self.home / "flows"

    @property
    def logs_dir(self) -> Path:
        return self.home / "logs"

    @property
    def log_file(self) -> Path:
        return self.logs_dir / "golem.jsonl"

    @property
    def run_dir(self) -> Path:
        return self.home / "run"

    @property
    def socket_path(self) -> Path:
        return self.run_dir / "golem.sock"

    def ensure_layout(self) -> None:
        """Create the directories the daemon expects. Existing files stay in place."""
        self.home.mkdir(parents=True, exist_ok=True)
        for directory in (self.skills_dir, self.flows_dir, self.logs_dir, self.run_dir):
            directory.mkdir(parents=True, exist_ok=True)


def resolve_paths(home: Path | None = None) -> GolemPaths:
    """Resolve the golem home.

    Precedence: explicit ``home``, then ``GOLEM_HOME``, then ``~/.golem``.
    """
    if home is not None:
        return GolemPaths(_normalize(home))
    env = os.environ.get(_HOME_ENV, "").strip()
    if env:
        return GolemPaths(_normalize(Path(env)))
    return GolemPaths(Path.home() / ".golem")


def _normalize(path: Path) -> Path:
    return path.expanduser().resolve()
