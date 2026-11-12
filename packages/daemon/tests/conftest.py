import os
import shutil
import tempfile
import uuid
from collections.abc import AsyncIterator, Iterator
from pathlib import Path

import pytest

from golem.store.database import Database


@pytest.fixture(autouse=True)
def _clear_golem_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GOLEM_HOME", raising=False)
    monkeypatch.delenv("GOLEM_LOG_LEVEL", raising=False)
    monkeypatch.delenv("GOLEM_MODEL_PROFILE", raising=False)
    monkeypatch.delenv("GOLEM_MODEL_PROVIDER", raising=False)
    monkeypatch.delenv("GOLEM_MODEL_NAME", raising=False)
    monkeypatch.delenv("GOLEM_MODEL_BASE_URL", raising=False)
    monkeypatch.delenv("GOLEM_SESSION_TITLES", raising=False)


@pytest.fixture
async def database(tmp_path: Path) -> AsyncIterator[Database]:
    """A migrated ``golem.db`` in a temporary directory."""
    async with Database.open(tmp_path / "golem.db") as opened:
        yield opened


# Longest path a test builds under a home: "/<8 hex>" + "/run/golem.sock", plus margin.
_SOCKET_SUFFIX_BYTES = 40
_MAX_SOCKET_BYTES = 103  # sockaddr_un is 104 bytes on macOS, including the NUL.


def make_short_home(repo_root: Path) -> Path:
    """A new directory for a test home, under ``<repo_root>/.test-socks`` when sockets fit.

    Falls back to a short ``/var/tmp`` directory when the repo (for example a git worktree
    with a long path) would make the socket path too long.
    """
    base = repo_root / ".test-socks"
    if len(os.fsencode(base)) + _SOCKET_SUFFIX_BYTES <= _MAX_SOCKET_BYTES:
        root = base / uuid.uuid4().hex[:8]
        root.mkdir(parents=True)
        return root
    # Not /tmp: the sandbox tests treat /tmp as a place commands may write to.
    return Path(tempfile.mkdtemp(prefix="gt", dir="/var/tmp")).resolve()


@pytest.fixture
def short_home() -> Iterator[Path]:
    """A home whose socket path fits in sockaddr_un (104 bytes on macOS)."""
    root = make_short_home(Path(__file__).resolve().parents[3])
    try:
        yield root
    finally:
        shutil.rmtree(root, ignore_errors=True)
