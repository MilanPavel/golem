import shutil
import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest


@pytest.fixture(autouse=True)
def _clear_golem_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GOLEM_HOME", raising=False)
    monkeypatch.delenv("GOLEM_LOG_LEVEL", raising=False)


@pytest.fixture
def short_home() -> Iterator[Path]:
    """A home whose socket path fits in sockaddr_un (104 bytes on macOS)."""
    root = Path(__file__).resolve().parents[3] / ".test-socks" / uuid.uuid4().hex[:8]
    root.mkdir(parents=True)
    try:
        yield root
    finally:
        shutil.rmtree(root, ignore_errors=True)
