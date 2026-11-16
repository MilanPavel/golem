"""One scripted coding session over the socket, checked stage by stage.

A fake model plays the whole phase in order: plan first, build, check and fix,
undo a hunk and a file, tell the model, a stale file, and a restart. The stages
are tests that share one daemon and run in file order, each one building on what
the one before left behind. A broken stage fails its own test with a message that
names the stage, and the stages after it fail too.
"""

from __future__ import annotations

import asyncio
import shutil
from collections.abc import AsyncGenerator, AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, cast

import pytest
import pytest_asyncio
from conftest import make_short_home
from fakes import Calls, ToolCallingChatModel
from langchain_core.messages import BaseMessage, ToolMessage
from test_server import HELLO, RpcClient, error_code, rpc_result, start_daemon, stop_daemon

from golem.graphs.notes import is_note
from golem.graphs.tools_node import PLAN_REFUSAL
from golem.models.router import ModelRouter
from golem.server.app import DaemonApp
from golem.server.dispatcher import SESSION_BUSY
from golem.tools import sandbox

pytestmark = pytest.mark.asyncio(loop_scope="module")
needs_sandbox = pytest.mark.skipif(not sandbox.available(), reason="needs the shell sandbox")

MARKER = "BUG_MARKER"
BODY = ["total = 0", *[f"step_{n:02d} = {n}" for n in range(1, 31)], 'return "end"']
BODY_AFTER = [f"total = 10  # {MARKER}", *BODY[1:-1], 'return "finish"']
A_BEFORE = "def run():\n" + "".join(f"    {line}\n" for line in BODY)
B_TEXT = "def helper():\n    return 1\n"
CHECK_SCRIPT = f'if grep -q {MARKER} a.py; then echo "a.py still has {MARKER}"; exit 1; fi\n'
CONFIG = (
    '[coding]\nchecks = "auto"\nfix_rounds = 2\n'
    '[[coding.check]]\nname = "marker"\ncommand = "sh check.sh"\n'
)


def _edit_a(indent: str) -> Calls:
    """An edit of the body of run(), with ``indent`` as the base indentation of both texts."""
    return [
        (
            "edit_file",
            {
                "path": "a.py",
                "old_string": "\n".join(indent + line for line in BODY),
                "new_string": "\n".join(indent + line for line in BODY_AFTER),
            },
        )
    ]


EDIT_A = _edit_a("    ")
# The model copies the body of run() without its four spaces of indentation.
EDIT_A_DEDENTED = _edit_a("")
WRITE_B: Calls = [("write_file", {"path": "b.py", "content": B_TEXT})]
FIX_A: Calls = [
    (
        "edit_file",
        {"path": "a.py", "old_string": f"total = 10  # {MARKER}", "new_string": "total = 10"},
    )
]
PLAN: Calls = [
    (
        "propose_plan",
        {"title": "Add a helper", "steps": [{"text": "Write b.py", "files": ["b.py"]}]},
    )
]


def _params(event: dict[str, object]) -> dict[str, Any]:
    return cast("dict[str, Any]", event["params"])


@dataclass
class Play:
    """The daemon, the socket client and the fake model of one session."""

    app: DaemonApp
    task: asyncio.Task[None]
    client: RpcClient
    model: ToolCallingChatModel
    router: ModelRouter
    home: Path
    folder: Path
    session_id: str
    run_id: str = ""
    build_run: str = ""
    build_events: list[dict[str, Any]] = field(default_factory=list[dict[str, Any]])
    before_restart: Any = None

    async def send(
        self, text: str, replies: list[str | Calls], *, session_id: str | None = None
    ) -> list[dict[str, Any]]:
        """Queue ``replies``, send ``text`` and return the run's events once it ends."""
        self.model.replies.extend(replies)
        start = len(self.client.events)
        sent = rpc_result(
            await self.client.call(
                "message.send", {"session_id": session_id or self.session_id, "text": text}
            )
        )
        run_id = str(sent["run_id"])
        async with asyncio.timeout(15):
            while True:
                taken = await self.client.take_events()
                mine = [p for p in map(_params, taken[start:]) if p.get("run_id") == run_id]
                if any(e["type"] in ("run.completed", "run.failed") for e in mine):
                    break
                await asyncio.sleep(0.02)
        assert mine[-1]["type"] == "run.completed", f"the run did not complete: {mine[-1]}"
        self.run_id = run_id
        return mine

    async def call(self, method: str, params: dict[str, Any]) -> dict[str, object]:
        """Call ``method``, waiting out the moment before a finished run frees the session."""
        full = {"session_id": self.session_id, **params}
        reply = await self.client.call(method, full)
        for _ in range(100):
            if "error" not in reply or error_code(reply) != SESSION_BUSY:
                break
            await asyncio.sleep(0.02)
            reply = await self.client.call(method, full)
        return reply

    async def set(self, method: str, **params: Any) -> None:
        params.setdefault("session_id", self.session_id)
        rpc_result(await self.client.call(method, params))

    async def revert(self, target: dict[str, Any], *, force: bool = False) -> dict[str, object]:
        return rpc_result(await self.call("changes.revert", {"target": target, "force": force}))

    async def files(self) -> dict[str, dict[str, Any]]:
        listed = rpc_result(await self.call("changes.list", {}))
        return {f["path"]: f for f in cast("list[dict[str, Any]]", listed["files"])}

    async def answers(self) -> tuple[dict[str, dict[str, Any]], list[str]]:
        """What changes.list and changes.diff say now: the files, and every diff."""
        files = await self.files()
        diffs: list[str] = []
        for path in files:
            diffs.append(str(rpc_result(await self.call("changes.diff", {"path": path}))["diff"]))
        for change_id in [i for f in files.values() for i in f["change_ids"]]:
            reply = await self.call("changes.diff", {"change_id": change_id})
            diffs.append(str(rpc_result(reply)["diff"]))
        return files, diffs

    def text(self, name: str) -> str:
        return (self.folder / name).read_text("utf-8")


@asynccontextmanager
async def _open() -> AsyncGenerator[Play]:
    home = make_short_home(Path(__file__).resolve().parents[3])
    folder = home / "project"
    folder.mkdir()
    (folder / "a.py").write_text(A_BEFORE, "utf-8")
    (folder / "c.py").write_text("VALUE = 1\n", "utf-8")
    (folder / "check.sh").write_text(CHECK_SCRIPT, "utf-8")
    (home / "config.toml").write_text(CONFIG, "utf-8")
    model = ToolCallingChatModel(replies=[])
    router = ModelRouter(model=model)
    app, task = await start_daemon(home, router=router)
    client = await RpcClient.connect(app.paths.socket_path)
    play = Play(app, task, client, model, router, home, folder, "")
    try:
        await client.call("hello", HELLO)
        created = rpc_result(await client.call("session.create", {"cwd": str(folder)}))
        play.session_id = str(created["session_id"])
        await play.set("session.attach", after_seq=0)
        yield play
    finally:
        await play.client.close()
        await stop_daemon(play.app, play.task)
        shutil.rmtree(home, ignore_errors=True)


@pytest_asyncio.fixture(scope="module", loop_scope="module")
async def play() -> AsyncIterator[Play]:
    async with _open() as opened:
        yield opened


def _tool_results(history: list[BaseMessage]) -> list[str]:
    return [m.text for m in history if isinstance(m, ToolMessage)]


def _notes(history: list[BaseMessage]) -> list[str]:
    return [m.text for m in history if is_note(m)]


async def test_1_plan_first_proposes_a_plan_and_changes_nothing(play: Play) -> None:
    await play.set("session.set_plan", on=True)
    events = await play.send(
        "add a helper",
        [[("read_file", {"path": "a.py"}), EDIT_A[0]], PLAN, "Here is the plan."],
    )
    await play.set("session.set_plan", on=False)

    types = [e["type"] for e in events]
    failed = [e["data"]["message"] for e in events if e["type"] == "tool.failed"]
    assert failed == [PLAN_REFUSAL], "stage 1: the edit in plan first was not refused"
    assert types.count("plan.proposed") == 1, "stage 1: no plan.proposed arrived"
    assert "file.changed" not in types, "stage 1: a file changed in plan first"
    assert play.text("a.py") == A_BEFORE, "stage 1: a.py changed in plan first"
    assert not (play.folder / "b.py").exists(), "stage 1: b.py was created in plan first"


@needs_sandbox
async def test_2_build_lands_an_edit_and_a_new_file(play: Play) -> None:
    await play.set("session.set_mode", mode="autopilot")
    events = await play.send(
        "add a helper",
        [[("read_file", {"path": "a.py"})], [*EDIT_A, *WRITE_B], "Done.", FIX_A, "Fixed."],
    )
    play.build_run, play.build_events = play.run_id, events

    changed = [e["data"] for e in events if e["type"] == "file.changed"]
    assert [c["path"] for c in changed[:2]] == ["a.py", "b.py"], "stage 2: wrong file.changed"
    assert [c["status"] for c in changed[:2]] == ["modified", "created"]
    assert {c["source"] for c in changed} == {"tool"}
    assert "    total = 10" in play.text("a.py"), "stage 2: the edit did not land"
    assert play.text("b.py") == B_TEXT, "stage 2: b.py was not created"
    # The model's third call is the one after the edit and the new file.
    results = _tool_results(play.model.seen[-3])[-2:]
    assert results == ["edited a.py (+2 -2)", "created b.py (+2 -0)"], f"stage 2: {results}"
    files = await play.files()
    assert list(files) == ["a.py", "b.py"], "stage 2: changes.list has the wrong files"
    assert [(f["status"], f["added"], f["removed"]) for f in files.values()] == [
        ("modified", 2, 2),
        ("created", 2, 0),
    ], "stage 2: changes.list has the wrong counts"


@needs_sandbox
async def test_3_a_failed_check_is_fixed_in_round_one(play: Play) -> None:
    events = play.build_events

    checks = [
        (e["data"]["status"], e["data"]["round"]) for e in events if e["type"] == "check.completed"
    ]
    assert checks == [("failed", 0), ("passed", 1)], f"stage 3: the checks were {checks}"
    notes = _notes(play.model.seen[-2])
    assert len(notes) == 1, "stage 3: the model got no note about the failed check"
    assert f"a.py still has {MARKER}" in notes[0], "stage 3: the note lacks the check's output"
    assert MARKER not in play.text("a.py"), "stage 3: the marker is still in a.py"
    assert [e["data"]["path"] for e in events if e["type"] == "file.changed"][-1] == "a.py"
    assert events[-1]["type"] == "run.completed"


@needs_sandbox
async def test_4_a_hunk_and_a_file_are_undone(play: Play) -> None:
    mark = len(play.client.events)

    first = await play.revert({"kind": "hunk", "path": "a.py", "hunk": 0})
    second = await play.revert({"kind": "file", "path": "b.py"})

    assert first == {"reverted": ["a.py"], "conflicts": []}, "stage 4: the hunk was not undone"
    assert second == {"reverted": ["b.py"], "conflicts": []}, "stage 4: b.py was not undone"
    assert not (play.folder / "b.py").exists(), "stage 4: b.py is still there"
    expected = A_BEFORE.replace('return "end"', 'return "finish"')
    assert play.text("a.py") == expected, "stage 4: a.py lost more than the one hunk"
    events = [_params(e) for e in (await play.client.take_events())[mark:]]
    undone = [e["data"] for e in events if e["type"] == "file.changed"]
    assert [(c["path"], c["source"]) for c in undone] == [
        ("a.py", "revert"),
        ("b.py", "revert"),
    ], "stage 4: file.changed does not say source revert"
    assert [c["status"] for c in undone] == ["modified", "deleted"]


@needs_sandbox
async def test_5_the_model_is_told_what_was_undone(play: Play) -> None:
    await play.send("go on", ["Noted."])

    told = [n for n in _notes(play.model.seen[-1]) if "a.py" in n and "b.py" in n]
    assert told, "stage 5: the next model call has no undo note naming a.py and b.py"


@needs_sandbox
async def test_6_a_file_changed_on_disk_is_a_conflict_until_forced(play: Play) -> None:
    by_hand = A_BEFORE + "# by hand\n"
    (play.folder / "a.py").write_text(by_hand, "utf-8")

    assert (await play.files())["a.py"]["stale"] is True, "stage 6: a.py is not stale"
    plain = await play.revert({"kind": "run", "run_id": play.build_run})

    assert plain["reverted"] == [], f"stage 6: a stale file was written: {plain}"
    assert [(c["path"], c["reason"]) for c in cast("list[dict[str, str]]", plain["conflicts"])] == [
        ("a.py", "changed_on_disk")
    ], "stage 6: no conflict was reported"
    assert play.text("a.py") == by_hand, "stage 6: the conflict changed a.py"

    forced = await play.revert({"kind": "run", "run_id": play.build_run}, force=True)

    assert forced == {"reverted": ["a.py"], "conflicts": []}, f"stage 6: force: {forced}"
    assert play.text("a.py") == A_BEFORE, "stage 6: force did not rewind a.py"
    assert not (play.folder / "b.py").exists()
    assert play.text("c.py") == "VALUE = 1\n"


@needs_sandbox
async def test_7_changes_survive_a_restart(play: Play) -> None:
    await play.send("one more", [[("write_file", {"path": "d.py", "content": "D = 1\n"})], "ok"])
    before = await play.answers()
    assert "d.py" in before[0], "stage 7: changes.list lacks the new file"
    assert before[1] and all(before[1]), "stage 7: a diff was empty before the restart"
    await play.client.close()
    await stop_daemon(play.app, play.task)

    play.app, play.task = await start_daemon(play.home, router=play.router)
    play.client = await RpcClient.connect(play.app.paths.socket_path)
    await play.client.call("hello", HELLO)
    await play.set("session.attach", after_seq=0)

    assert await play.answers() == before, "stage 7: changes.list or changes.diff changed"


@needs_sandbox
async def test_8_an_edit_with_the_wrong_base_indentation_lands(play: Play) -> None:
    other = play.folder.parent / "other"
    other.mkdir()
    (other / "a.py").write_text(A_BEFORE, "utf-8")
    (other / "check.sh").write_text(CHECK_SCRIPT, "utf-8")
    created = rpc_result(await play.client.call("session.create", {"cwd": str(other)}))
    session_id = str(created["session_id"])
    await play.set("session.attach", session_id=session_id, after_seq=0)
    await play.set("session.set_mode", session_id=session_id, mode="autopilot")
    try:
        await play.send("edit", [EDIT_A_DEDENTED, "Done.", FIX_A, "Fixed."], session_id=session_id)
    finally:
        play.model.replies.clear()

    assert (other / "a.py").read_text("utf-8").count("    total = 10") == 1, (
        "stage 2: the edit with the wrong base indentation did not land"
    )
