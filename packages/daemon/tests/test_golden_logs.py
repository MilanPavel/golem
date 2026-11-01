"""The recorded event logs in packages/view/fixtures/golden still match what the daemon sends."""

from __future__ import annotations

import pytest
from golden import FIXTURES, record, render, scenarios


@pytest.mark.parametrize("name", list(scenarios()))
async def test_the_fixture_matches_the_daemons_events(name: str) -> None:
    recorded = render(await record(name))
    stored = (FIXTURES / f"{name}.json").read_text(encoding="utf-8")
    assert recorded == stored, (
        "the daemon's events changed; run `just golden` and check the view tests"
    )
