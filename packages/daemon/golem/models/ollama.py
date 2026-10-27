"""Ollama on this machine: whether it is installed, and what to say when it does not answer.

The daemon runs under launchd with no ``PATH`` of the user's, so ``which``
alone can miss a Homebrew or app install. The known paths cover those.
"""

from __future__ import annotations

import shutil
from pathlib import Path
from urllib.parse import urlparse

BINARIES = (
    "/opt/homebrew/bin/ollama",
    "/usr/local/bin/ollama",
    "/Applications/Ollama.app/Contents/Resources/ollama",
)

_LOCAL_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})


def installed() -> bool:
    """True when an ``ollama`` binary is on ``PATH`` or at a known install path."""
    return shutil.which("ollama") is not None or any(Path(path).exists() for path in BINARIES)


def is_local(base_url: str) -> bool:
    """True when ``base_url`` points at this machine."""
    return urlparse(base_url).hostname in _LOCAL_HOSTS


def down(is_installed: bool) -> tuple[str, str]:
    """``(message, hint)`` for a local Ollama that does not answer."""
    if is_installed:
        return "Ollama is not running", "run ollama serve"
    return "Ollama is not installed", "run brew install ollama"


def down_text(is_installed: bool) -> str:
    """The message and the hint as one line, for errors that have no separate hint."""
    message, hint = down(is_installed)
    return f"{message}: {hint}"
