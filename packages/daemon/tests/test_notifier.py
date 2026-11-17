"""The notifier (ADR-050): who is told, about what, and how often. Nothing is really posted."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from fakes import ScriptedChatModel
from test_server import HELLO, RpcClient, rpc_result, start_daemon, stop_daemon

from golem.config import GolemSettings, NotificationSettings
from golem.models.router import ModelRouter
from golem.notify import (
    Notice,
    Notifier,
    NotifierKinds,
    NullPoster,
    SessionFacts,
    default_poster,
)
from golem.notify.posters import with_open_hint
from golem.sessions.bus import EventBus
from golem_protocol.events import CHAT_EVENT, ChatEvent


class _Poster:
    name = "fake"

    def __init__(self) -> None:
        self.notices: list[Notice] = []

    async def post(self, notice: Notice) -> bool:
        self.notices.append(notice)
        return True


class _Target:
    def deliver(self, event: ChatEvent) -> None:
        del event


def _event(kind: str, data: dict[str, Any], session_id: str = "s1", seq: int = 1) -> ChatEvent:
    return CHAT_EVENT.validate_python(
        {
            "seq": seq,
            "session_id": session_id,
            "run_id": "r1",
            "ts": "2026-11-15T10:00:00+00:00",
            "type": kind,
            "data": data,
        }
    )


def _ask(session_id: str = "s1", call_id: str = "c1") -> ChatEvent:
    return _event(
        "approval.needed",
        {
            "call_id": call_id,
            "name": "shell",
            "args": {"command": "make deploy"},
            "source": "built-in default",
            "subject": "make deploy",
        },
        session_id,
    )


def _failed(message: str = "model unreachable", session_id: str = "s1") -> ChatEvent:
    return _event("run.failed", {"message": message}, session_id)


def _completed(run_id: str = "r1", summary: str | None = "All done", session_id: str = "s1"):
    return _event(
        "session.completed",
        {"run_id": run_id, "status": "completed", "summary": summary},
        session_id,
    )


def _setup(
    facts: dict[str, SessionFacts] | None = None, kinds: NotifierKinds | None = None
) -> tuple[Notifier, EventBus, _Poster]:
    known = facts or {}
    poster = _Poster()

    async def lookup(session_id: str) -> SessionFacts | None:
        return known.get(session_id)

    bus = EventBus()
    notifier = Notifier(poster, lookup, bus.attached, kinds)
    bus.observe(notifier.on_event)
    return notifier, bus, poster


async def test_an_approval_with_nobody_attached_notifies_once() -> None:
    notifier, bus, poster = _setup({"s1": SessionFacts("Nightly report", "routine:nightly")})
    bus.publish(_ask())
    bus.publish(_ask())
    await notifier.drain()
    assert poster.notices == [
        Notice("needs_you", "s1", "Nightly report", "Allow shell make deploy")
    ]


async def test_an_approval_with_an_attached_client_is_silent() -> None:
    notifier, bus, poster = _setup()
    bus.subscribe("s1", _Target())
    bus.publish(_ask())
    await notifier.drain()
    assert poster.notices == []


@pytest.mark.parametrize(("origin", "posts"), [("user", 0), ("cli", 1), ("routine:nightly", 1)])
async def test_an_approval_notifies_only_for_a_headless_origin(origin: str, posts: int) -> None:
    notifier, bus, poster = _setup({"s1": SessionFacts(None, origin)})
    bus.publish(_ask())
    await notifier.drain()
    assert len(poster.notices) == posts


async def test_a_session_nobody_knows_is_a_user_session_and_stays_silent() -> None:
    notifier, bus, poster = _setup()
    bus.publish(_ask())
    await notifier.drain()
    assert poster.notices == []


async def test_a_new_approval_in_the_same_session_notifies_again() -> None:
    notifier, bus, poster = _setup({"s1": SessionFacts(None, "cli")})
    bus.publish(_ask(call_id="c1"))
    bus.publish(_ask(call_id="c2"))
    await notifier.drain()
    assert [n.kind for n in poster.notices] == ["needs_you", "needs_you"]


async def test_two_identical_failures_notify_once() -> None:
    notifier, bus, poster = _setup()
    bus.publish(_failed())
    bus.publish(_failed())
    await notifier.drain()
    assert [n.body for n in poster.notices] == ["model unreachable"]


async def test_a_routine_that_keeps_failing_in_new_sessions_notifies_once() -> None:
    routine = SessionFacts(None, "routine:hourly")
    notifier, bus, poster = _setup({"a": routine, "b": routine})
    bus.publish(_failed(session_id="a"))
    await notifier.drain()
    bus.publish(_failed(session_id="b"))
    await notifier.drain()
    assert len(poster.notices) == 1
    assert poster.notices[0].title == "hourly"


async def test_a_success_clears_the_failure_so_the_next_one_notifies() -> None:
    routine = SessionFacts(None, "routine:hourly")
    notifier, bus, poster = _setup({s: routine for s in ("a", "b", "c")})
    for event in (_failed(session_id="a"), _completed(session_id="b"), _failed(session_id="c")):
        bus.publish(event)
        await notifier.drain()
    assert [n.kind for n in poster.notices] == ["failed", "failed"]


async def test_finished_is_off_until_turned_on() -> None:
    notifier, bus, poster = _setup()
    bus.publish(_completed())
    await notifier.drain()
    assert poster.notices == []

    notifier, bus, poster = _setup(kinds=NotifierKinds(finished=True))
    bus.publish(_completed())
    await notifier.drain()
    assert poster.notices == [Notice("finished", "s1", "golem", "All done")]


async def test_needs_you_cannot_be_turned_off() -> None:
    notifier, bus, poster = _setup(
        {"s1": SessionFacts(None, "cli")}, NotifierKinds(failed=False, finished=False)
    )
    bus.publish(_ask())
    bus.publish(_failed())
    await notifier.drain()
    assert [n.kind for n in poster.notices] == ["needs_you"]


async def test_a_long_body_is_cut() -> None:
    notifier, bus, poster = _setup()
    bus.publish(_failed("x" * 500))
    await notifier.drain()
    assert len(poster.notices[0].body) <= 160
    assert poster.notices[0].body.endswith("…")


async def test_a_poster_that_raises_does_not_break_the_bus() -> None:
    class _Broken:
        name = "broken"

        async def post(self, notice: Notice) -> bool:
            raise RuntimeError("boom")

    async def lookup(session_id: str) -> SessionFacts | None:
        return None

    bus = EventBus()
    notifier = Notifier(_Broken(), lookup, bus.attached)
    bus.observe(notifier.on_event)
    bus.publish(_ask())
    await notifier.drain()


async def test_test_posts_a_sample() -> None:
    notifier, _bus, poster = _setup()
    assert await notifier.test() is True
    assert poster.notices[0].body == "Notifications work."


def test_only_the_real_golem_home_gets_a_real_poster(tmp_path: Path) -> None:
    assert isinstance(default_poster(tmp_path), NullPoster)
    assert isinstance(default_poster(tmp_path / ".golem"), NullPoster)


def test_the_osascript_banner_says_how_to_open_the_session() -> None:
    notice = Notice("needs_you", "s1", "nightly", "Allow bash")
    assert with_open_hint(notice) == "Allow bash\ngolem open s1"
    sample = Notice("needs_you", "test", "golem", "Notifications work.")
    assert with_open_hint(sample) == "Notifications work."


def test_open_in_defaults_to_web_and_is_checked() -> None:
    assert GolemSettings().notifications.open_in == "web"
    assert NotificationSettings(open_in="terminal").open_in == "terminal"
    with pytest.raises(ValueError):
        NotificationSettings(open_in="window")  # type: ignore[arg-type]
    with pytest.raises(ValueError):
        NotificationSettings(nope=1)  # type: ignore[call-arg]


@pytest.mark.parametrize("kind", ["needs_you", "failed", "finished"])
def test_kinds_are_known(kind: str) -> None:
    assert NotifierKinds().on(kind) is (kind != "finished")  # type: ignore[arg-type]


async def test_notify_test_posts_nothing_under_a_temp_home(short_home: Path) -> None:
    app, task = await start_daemon(
        short_home, router=ModelRouter(model=ScriptedChatModel(replies=["ok"]))
    )
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        assert rpc_result(await client.call("notify.test", {})) == {
            "posted": False,
            "mechanism": "none",
        }
    finally:
        await client.close()
        await stop_daemon(app, task)
