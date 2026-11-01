"""Record the events a real daemon sends for five chats, as fixtures for the view package.

Each scenario runs against an in-process daemon with a fake model. A client
attaches from 0 and collects every event as the wire delivered it (``live``),
and after the run ended a second connection attaches from 0 again (``replay``).
The view package folds both through ``reduceChat`` and expects the same chat.

``just golden`` rewrites ``packages/view/fixtures/golden/<scenario>.json``;
``test_golden_logs.py`` fails when the daemon's events no longer match them.

Normalized, because it differs on every run:
- ids (``s_…``, ``r_…``, ``m_…``, UUIDs): ``id-1``, ``id-2``… in order of first
  appearance, the same map for live and replay of one scenario;
- ``ts``: a fixed, increasing clock, one second per distinct original value, so
  live and replay events with the same original ``ts`` share a time;
- ``duration_ms`` and ``elapsed_ms`` fields: 0;
- the temporary folder: ``/tmp/golem-golden``.
"""

from __future__ import annotations

import asyncio
import json
import re
import shutil
import tempfile
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, cast

from fakes import GatedChatModel, ScriptedChatModel, ToolCallingChatModel
from langchain_core.language_models.chat_models import BaseChatModel
from test_server import HELLO, RpcClient, rpc_result, start_daemon, stop_daemon

from golem.models.router import ModelRouter

FIXTURES = Path(__file__).resolve().parents[3] / "packages" / "view" / "fixtures" / "golden"
TMP = "/tmp/golem-golden"
TERMINAL = ("run.completed", "run.failed", "run.cancelled")
EPOCH = datetime(2026, 1, 1, tzinfo=UTC)
ID = re.compile(
    r"\b(?:[a-z]{1,4}_[0-9a-f]{8,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b"
)

Event = dict[str, Any]


class Scenario:
    """A fake model, the files a run may read, and how a client drives the chat."""

    def __init__(
        self,
        model: BaseChatModel,
        drive: Callable[[RpcClient, str, BaseChatModel], Awaitable[None]],
        *,
        rules: str = "",
        files: dict[str, str] | None = None,
    ) -> None:
        self.model = model
        self.drive = drive
        self.rules = rules
        self.files = files or {}


async def _send(client: RpcClient, session_id: str, text: str) -> str:
    sent = rpc_result(await client.call("message.send", {"session_id": session_id, "text": text}))
    return str(sent["run_id"])


async def _plain(client: RpcClient, session_id: str, model: BaseChatModel) -> None:
    del model
    await _send(client, session_id, "say hi")


async def _tool(client: RpcClient, session_id: str, model: BaseChatModel) -> None:
    del model
    await _send(client, session_id, "read notes")


async def _approval(client: RpcClient, session_id: str, model: BaseChatModel) -> None:
    del model
    await _send(client, session_id, "read notes")
    needed = await client.wait_for_event("approval.needed")
    params = cast(dict[str, Any], needed["params"])
    call_id = params["data"]["call_id"]
    await client.call(
        "approval.respond", {"session_id": session_id, "call_id": call_id, "decision": "allow"}
    )


async def _cancel(client: RpcClient, session_id: str, model: BaseChatModel) -> None:
    assert isinstance(model, GatedChatModel)
    run_id = await _send(client, session_id, "count")
    await model.started.wait()
    # The streamed characters reach the socket before the cancel does.
    await _until(client, lambda: _text(client) == model.streamed)
    await client.call("run.cancel", {"run_id": run_id})


async def _fail(client: RpcClient, session_id: str, model: BaseChatModel) -> None:
    del model
    await _send(client, session_id, "hello")


def scenarios() -> dict[str, Scenario]:
    ask = '[[rule]]\ntool = "read_file"\naction = "ask"\n'
    read = [("read_file", {"path": "notes.txt"})]
    notes = {"notes.txt": "the answer is 42\n"}
    return {
        "plain": Scenario(ScriptedChatModel(replies=["Hello there."]), _plain),
        "tool": Scenario(ToolCallingChatModel(replies=[read, "It is 42."]), _tool, files=notes),
        "approval": Scenario(
            ToolCallingChatModel(replies=[read, "It is 42."]),
            _approval,
            rules=ask,
            files=notes,
        ),
        "cancel": Scenario(GatedChatModel(streamed="Hel", reply="lo"), _cancel),
        "failure": Scenario(ScriptedChatModel(replies=[]), _fail),
    }


def _text(client: RpcClient) -> str:
    return "".join(
        str(event["data"]["text"]) for event in _params(client) if event["type"] == "message.delta"
    )


async def _until(client: RpcClient, check: Callable[[], bool], timeout: float = 5) -> None:
    async with asyncio.timeout(timeout):
        while True:
            await client.take_events()
            if check():
                return
            await asyncio.sleep(0.01)


def _ended(client: RpcClient) -> bool:
    return any(event["type"] in TERMINAL for event in _params(client))


async def _attached(client: RpcClient, session_id: str) -> None:
    attached = rpc_result(
        await client.call("session.attach", {"session_id": session_id, "after_seq": 0})
    )
    assert attached["session_id"] == session_id


def _params(client: RpcClient) -> list[Event]:
    return [cast(Event, e["params"]) for e in client.events if e.get("method") == "event"]


async def _record(name: str, scenario: Scenario, home: Path) -> dict[str, list[Event]]:
    project = home / "project"
    project.mkdir()
    for file, text in scenario.files.items():
        (project / file).write_text(text, encoding="utf-8")
    if scenario.rules:
        (home / "config.toml").write_text(scenario.rules, encoding="utf-8")
    app, task = await start_daemon(home, router=ModelRouter(model=scenario.model))
    live = await RpcClient.connect(app.paths.socket_path)
    replay = await RpcClient.connect(app.paths.socket_path)
    try:
        await live.call("hello", HELLO)
        created = rpc_result(await live.call("session.create", {"cwd": str(project)}))
        session_id = str(created["session_id"])
        await _attached(live, session_id)
        await scenario.drive(live, session_id, scenario.model)
        await _until(live, lambda: _ended(live))
        await replay.call("hello", HELLO)
        await _attached(replay, session_id)
        await replay.take_events()
        return {"live": _params(live), "replay": _params(replay)}
    finally:
        await live.close()
        await replay.close()
        await stop_daemon(app, task)


def normalize(logs: dict[str, list[Event]], home: Path) -> dict[str, list[Event]]:
    """Replace what varies between runs; one id map and one clock for the whole scenario."""
    ids: dict[str, str] = {}
    clock: dict[str, str] = {}
    folder = str(home.resolve())
    paths = {str(home), folder}

    def text(value: str) -> str:
        for path in sorted(paths, key=len, reverse=True):
            value = value.replace(path + "/project", TMP).replace(path, TMP)
        return ID.sub(lambda m: ids.setdefault(m.group(0), f"id-{len(ids) + 1}"), value)

    def walk(value: Any, key: str = "") -> Any:
        if isinstance(value, str):
            if key == "ts":
                fixed = EPOCH + timedelta(seconds=len(clock))
                return clock.setdefault(value, fixed.isoformat().replace("+00:00", "Z"))
            return text(value)
        if isinstance(value, list):
            return [walk(item) for item in cast(list[Any], value)]
        if isinstance(value, dict):
            return {
                k: 0 if k in ("duration_ms", "elapsed_ms") else walk(v, k)
                for k, v in cast(dict[str, Any], value).items()
            }
        return value

    # Assign ids and times in order of first appearance across live, then replay.
    return {kind: walk(events) for kind, events in logs.items()}


async def record(name: str) -> dict[str, list[Event]]:
    home = Path(tempfile.mkdtemp(prefix="gg-", dir="/tmp"))
    try:
        logs = await _record(name, scenarios()[name], home)
        return normalize(logs, home)
    finally:
        shutil.rmtree(home, ignore_errors=True)


def render(logs: dict[str, list[Event]]) -> str:
    return json.dumps(logs, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


async def _write_all() -> None:
    FIXTURES.mkdir(parents=True, exist_ok=True)
    for name in scenarios():
        logs = await record(name)
        (FIXTURES / f"{name}.json").write_text(render(logs), encoding="utf-8")
        print(f"{name}: live {len(logs['live'])}, replay {len(logs['replay'])}")


def main() -> None:
    asyncio.run(_write_all())


if __name__ == "__main__":
    main()
