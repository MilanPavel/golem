"""What golem knows about one agent file, valid or not."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

AGENT_SUFFIX = ".md"

WISHES = ("cheapest", "same", "stronger", "local", "budget", "frontier")
"""The words a model wish may be. Any other text is a model name."""


@dataclass(frozen=True, slots=True)
class AgentLimits:
    """What stops a helper of this type. ``None`` means the file sets no limit."""

    max_calls: int | None = None
    """Model calls."""
    max_seconds: int | None = None
    """Working time, not counting the time spent waiting for you or a provider."""
    max_cost_usd: float | None = None
    answer_chars: int | None = None
    max_tokens: int | None = None


@dataclass(frozen=True, slots=True)
class Agent:
    """One ``agents/<name>.md``, parsed.

    An agent with errors is still an ``Agent``, so a list can say what is wrong
    with it. Only an agent without errors is ever used. The wish is kept as
    written: choosing a model for it happens elsewhere.
    """

    name: str
    description: str
    path: Path
    """The file, as it was found (it may be a symlink)."""
    real_path: Path
    """The file with symlinks resolved, so one file reached twice counts once."""
    hash: str
    """sha256 of the file, or empty when it could not be read."""
    wish: str = "cheapest"
    """One of :data:`WISHES`, or a model name."""
    tools: tuple[str, ...] = ()
    """Names of golem's own tools. A file that leaves ``tools`` out gets none."""
    limits: AgentLimits = field(default_factory=AgentLimits)
    asks: bool = False
    """Whether the helper may ask you a question."""
    line: str = ""
    """What the lead's prompt says this type is for, a few words. Empty: use ``description``."""
    body: str = ""
    """The prompt."""
    extras: Mapping[str, Any] = field(default_factory=dict[str, Any])
    """Frontmatter fields golem does not use, kept as they are."""
    errors: tuple[str, ...] = ()
    warnings: tuple[str, ...] = ()

    @property
    def valid(self) -> bool:
        return not self.errors


__all__ = ["AGENT_SUFFIX", "WISHES", "Agent", "AgentLimits"]
