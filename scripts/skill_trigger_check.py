#!/usr/bin/env python3
"""Hand-check skill triggering against a real model, in a throwaway golem home.

    uv run python scripts/skill_trigger_check.py --model ollama/llama3.2:3b \
        --skills scripts/skill-trigger/skills/* --prompts scripts/skill-trigger/prompts.json

Starts a daemon on a new home (never ``~/.golem``), copies each skill folder
under ``--skills`` into the home's ``skills`` folder (or ``--claude-skill``
folders into a fake ``~/.claude/skills``), sends each prompt in a fresh session
inside an empty project folder, and prints which skill the model loaded and
which tools it called. Needs the model's provider to be reachable, and a key
in the keychain for a remote one. It sends no approvals: a run that asks for
one is reported as ``approval``. ``--config`` adds TOML to ``config.toml``, with ``;`` for a
new line: ``--config '[permissions]; mode = "autopilot"'`` skips the approvals.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, cast

PROTOCOL_MAJOR = 2


class Client:
    def __init__(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        self.reader, self.writer = reader, writer
        self.next_id = 1
        self.events: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self.waiters: dict[int, asyncio.Future[dict[str, Any]]] = {}
        self.pump = asyncio.create_task(self._pump())

    async def _pump(self) -> None:
        while line := await self.reader.readline():
            message = json.loads(line)
            waiter = self.waiters.pop(message["id"], None) if "id" in message else None
            if waiter is not None:
                waiter.set_result(message)
            elif message.get("method") == "event":
                await self.events.put(message["params"])

    async def call(self, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        request_id, self.next_id = self.next_id, self.next_id + 1
        waiter: asyncio.Future[dict[str, Any]] = asyncio.get_running_loop().create_future()
        self.waiters[request_id] = waiter
        body = {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params or {}}
        self.writer.write(json.dumps(body).encode() + b"\n")
        await self.writer.drain()
        reply = await asyncio.wait_for(waiter, timeout=60)
        if "error" in reply:
            raise RuntimeError(f"{method}: {reply['error']}")
        return cast(dict[str, Any], reply["result"])


async def run_prompt(client: Client, project: Path, prompt: str, timeout: float) -> dict[str, Any]:
    created = await client.call("session.create", {"cwd": str(project)})
    session_id = created["session_id"]
    await client.call("session.attach", {"session_id": session_id, "after_seq": 0})
    while not client.events.empty():
        client.events.get_nowait()
    await client.call("message.send", {"session_id": session_id, "text": prompt})
    loaded: list[str] = []
    tools: list[str] = []
    end = "timeout"
    final = ""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            event = await asyncio.wait_for(client.events.get(), timeout=deadline - time.monotonic())
        except TimeoutError:
            break
        kind, data = event.get("type"), event.get("data", {})
        if kind == "skill.activated" and data.get("how") == "model":
            loaded.append(data["name"])
        elif kind == "tool.requested":
            tools.append(data["name"])
            if data["name"] == "read_file":
                tools[-1] += f" {Path(str(data['args'].get('path', ''))).name}"
        elif kind == "message.completed" and data.get("role") == "assistant":
            final = str(data.get("text", ""))
        elif kind == "approval.needed":
            end = "approval"
            break
        elif kind in ("run.completed", "run.failed", "run.cancelled"):
            end = kind.split(".")[1]
            break
    return {"loaded": loaded, "tools": tools, "end": end, "answer": final[:300]}


async def main() -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n")[0])
    parser.add_argument("--model", required=True, help="a profile or provider/model ref")
    parser.add_argument("--prompts", type=Path, required=True, help="JSON: [{prompt, expect}]")
    parser.add_argument("--skills", type=Path, nargs="*", default=[], help="skill folders")
    parser.add_argument("--claude-skill", type=Path, nargs="*", default=[], help="skill folders")
    parser.add_argument("--timeout", type=float, default=300)
    parser.add_argument("--project-file", type=Path, nargs="*", default=[], help="copied in")
    parser.add_argument("--config", default="", help="TOML added to config.toml")
    args = parser.parse_args()

    root = Path(tempfile.mkdtemp(prefix="gs", dir="/var/tmp")).resolve()
    home, user, project = root / "g", root / "h", root / "p"
    for folder in (home / "skills", user / ".claude" / "skills", project):
        folder.mkdir(parents=True)
    for skill in args.skills:
        shutil.copytree(skill, home / "skills" / skill.name)
    for skill in args.claude_skill:
        shutil.copytree(skill, user / ".claude" / "skills" / skill.name)
    for file in args.project_file:
        shutil.copy(file, project / file.name)
    extra = args.config.replace(";", "\n")
    (home / "config.toml").write_text(f'default_model = "{args.model}"\n{extra}\n', "utf-8")
    env = {**os.environ, "GOLEM_HOME": str(home), "HOME": str(user)}
    daemon = subprocess.Popen(
        [sys.executable, "-m", "golem.cli", "serve"], env=env, stderr=subprocess.DEVNULL
    )
    failed = 0
    try:
        socket = home / "run" / "golem.sock"
        for _ in range(100):
            if socket.exists():
                break
            await asyncio.sleep(0.2)
        reader, writer = await asyncio.open_unix_connection(str(socket))
        client = Client(reader, writer)
        await client.call(
            "hello", {"protocol_major": PROTOCOL_MAJOR, "protocol_minor": 0, "client": "tui"}
        )
        for row in json.loads(args.prompts.read_text("utf-8")):
            result = await run_prompt(client, project, row["prompt"], args.timeout)
            expect = row.get("expect")
            got = result["loaded"][0] if result["loaded"] else None
            ok = got == expect
            failed += not ok
            print(json.dumps({"ok": ok, "expect": expect, "got": got, **result}))
    finally:
        daemon.terminate()
        daemon.wait(timeout=10)
        shutil.rmtree(root, ignore_errors=True)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
