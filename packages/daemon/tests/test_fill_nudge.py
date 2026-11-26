"""A lead that reads past `fill_share` is told once to hand the reading on (#1805).

Scripted models behind a real daemon: a 64K local lead, a hosted lead with a large window, and
the cases where there is no note.
"""

# pyright: reportPrivateUsage=false
from __future__ import annotations

from pathlib import Path
from typing import cast

from fakes import Calls
from langchain_core.messages import HumanMessage
from test_server import HELLO, RpcClient, rpc_result, start_daemon, stop_daemon
from test_step_up import (
    CHEAP,
    LOCAL,
    _ended,
    _Facts,
    _facts,
    _of,
    _Router,
    _send,
    _types,
)

from golem.agents.bundled import bundled_agents_dir
from golem.config import AgentSettings, ChatSettings, DelegateSettings, GolemSettings, ModelSettings
from golem.models.facts import ModelFacts

READ: Calls = [("read_file", {"path": "big.txt"})]
ASK: Calls = [("delegate", {"agent": "explorer", "brief": "find the config loader in src"})]


LEAD = "lead"
HOSTED = "hosted"


def _settings(
    share: float = 0.1, use: str = "when_needed", calls: int | None = None
) -> GolemSettings:
    agents = AgentSettings.model_validate(
        {"use_helpers": use, "delegate": DelegateSettings(fill_share=share)}
    )
    models = {
        LEAD: ModelSettings(model=LOCAL, ctx=64000),
        HOSTED: ModelSettings(model=CHEAP, ctx=200000),
    }
    chat = ChatSettings() if calls is None else ChatSettings(max_model_calls=calls)
    return GolemSettings(agents=agents, models=models, chat=chat)


def _big(folder: Path) -> None:
    (folder / "big.txt").write_text("".join(f"line {i} of the file\n" for i in range(1500)))


async def _session(client: RpcClient, profile: str, app_state: object) -> str:
    await client.call("hello", HELLO)
    created = rpc_result(await client.call("session.create", {"model_profile": profile}))
    session_id = cast(str, created["session_id"])
    rpc_result(await client.call("session.attach", {"session_id": session_id, "after_seq": 0}))
    live = app_state.sessions._sessions[session_id]  # type: ignore[attr-defined]
    live.paid_ok = True
    return session_id


def _notes(router: _Router) -> list[str]:
    """The distinct fill notes any model was shown, by message id."""
    found: dict[str | None, str] = {}
    for model in router.models.values():
        for history in model.seen:
            for m in history:
                if isinstance(m, HumanMessage) and "fill_share" in m.text:
                    found[m.id] = m.text
    return list(found.values())


async def _run(
    home: Path, router: _Router, profile: str, *facts: ModelFacts
) -> tuple[list[str], list[dict[str, object]]]:
    _big(home)
    app, task = await start_daemon(
        home, router=router, facts=_Facts(*facts), bundled_agents=bundled_agents_dir()
    )
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        session_id = await _session(client, profile, app.state)
        await _send(client, session_id, "go", cwd=str(home))
        await _ended(client)
        assert "run.completed" in _types(client)
        return _notes(router), _of(client, "helper.started")
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_64k_local_lead_is_told_once_then_an_explorer_starts(short_home: Path) -> None:
    router = _Router(
        _settings(),
        ollama__small=[READ, READ, ASK, "found it", "done"],
        deepseek__cheap=[],
    )
    notes, started = await _run(
        short_home, router, LEAD, _facts(LOCAL, "local", 64000), _facts(CHEAP, "budget", 128000)
    )
    assert len(notes) == 1
    assert "agent `explorer`" in notes[0]
    assert "% full" in notes[0]
    assert [s["agent"] for s in started] == ["explorer"]


async def test_a_hosted_lead_with_a_large_window_is_told_past_the_share(short_home: Path) -> None:
    router = _Router(
        _settings(share=0.02),
        ollama__small=[],
        deepseek__cheap=[READ, ASK, "found it", "done"],
    )
    notes, started = await _run(short_home, router, HOSTED, _facts(CHEAP, "budget", 200000, 0.5))
    assert len(notes) == 1
    assert "of 128000 tokens" in notes[0]
    assert "working window" in notes[0]
    assert [s["agent"] for s in started] == ["explorer"]


async def test_no_note_below_the_share(short_home: Path) -> None:
    router = _Router(_settings(share=0.9), ollama__small=[READ, "done"], deepseek__cheap=[])
    notes, started = await _run(short_home, router, LEAD, _facts(LOCAL, "local", 64000))
    assert not notes
    assert started == []


async def test_no_note_when_helpers_are_never_used(short_home: Path) -> None:
    router = _Router(_settings(use="never"), ollama__small=[READ, "done"], deepseek__cheap=[])
    notes, started = await _run(short_home, router, LEAD, _facts(LOCAL, "local", 64000))
    assert not notes
    assert started == []


async def test_no_note_without_a_read(short_home: Path) -> None:
    router = _Router(
        _settings(share=0.001),
        ollama__small=[[("write_note", {})], "done"],
        deepseek__cheap=[],
    )
    notes, _ = await _run(short_home, router, LEAD, _facts(LOCAL, "local", 64000))
    assert not notes


async def test_a_helper_is_never_nudged(short_home: Path) -> None:
    # The lead delegates at once; the explorer reads past the share and is told nothing.
    router = _Router(
        _settings(share=0.05),
        ollama__small=[ASK, READ, "found it", "done"],
        deepseek__cheap=[],
    )
    notes, started = await _run(short_home, router, LEAD, _facts(LOCAL, "local", 64000))
    assert not notes
    assert len(started) == 1


async def test_no_note_in_the_wrap_up_zone(short_home: Path) -> None:
    # Five calls: the big read is call 3, so 2 are left, within the wrap-up margin of 3.
    (short_home / "small.txt").write_text("tiny\n")
    small: Calls = [("read_file", {"path": "small.txt"})]
    router = _Router(
        _settings(calls=5),
        ollama__small=[small, small, READ, "done"],
        deepseek__cheap=[],
    )
    notes, started = await _run(short_home, router, LEAD, _facts(LOCAL, "local", 64000))
    assert not notes
    assert started == []
