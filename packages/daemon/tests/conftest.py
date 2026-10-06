import pytest


@pytest.fixture(autouse=True)
def _clear_golem_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GOLEM_HOME", raising=False)
    monkeypatch.delenv("GOLEM_LOG_LEVEL", raising=False)
