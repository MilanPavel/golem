#!/usr/bin/env python3
"""Hand-check the ``delegate`` line of the system prompt against a real local model.

    uv run python scripts/delegate_check.py --model ollama/qwen3:8b --project .

Not run in CI. Plays one broad prompt in a fresh session, twice, in a throwaway golem home
(never ``~/.golem``). The model has a 32768 token window in the first run, so the line is in
the system prompt. In the second it has a 131072 token window, so the line is left out. The
two runs differ in window as well, because golem has no switch for the line. For each run it
prints the ``delegate`` calls, the helper sessions they started (a helper is a session with a
parent, ADR-059: the lead's log holds ``helper.started``), the direct ``read_file`` calls, and the
parent's peak context share (estimated prompt tokens over the window, of the parent's own calls).
A run ends at the lead's own ``run.completed``, after it was parked for its helpers and woken.
Needs the model to be reachable. It sends no approvals: the config sets ``autopilot``.
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
from typing import Any

from skill_trigger_check import PROTOCOL_MAJOR, Client

ASKS = (
    "what can you tell me about this repo",
    "where is the config file read and what does it change",
    "how do the parts of this project fit together",
)
"""The fixed set of asks. Each runs in a fresh session. All three are wide questions."""


async def play(client: Client, project: Path, ask: str, timeout: float) -> dict[str, Any]:
    created = await client.call("session.create", {"cwd": str(project)})
    session_id = created["session_id"]
    await client.call("session.attach", {"session_id": session_id, "after_seq": 0})
    await client.call("message.send", {"session_id": session_id, "text": ask})
    delegates = helpers = reads = 0
    peak = 0.0
    end = "timeout"
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            event = await asyncio.wait_for(client.events.get(), timeout=deadline - time.monotonic())
        except TimeoutError:
            break
        kind, data = event.get("type"), event.get("data", {})
        if kind == "tool.requested":
            delegates += data["name"] == "delegate"
            reads += data["name"] == "read_file"
        elif kind == "helper.started":
            helpers += 1
        elif kind == "model.call.started":
            used, window = data.get("estimated_tokens"), data.get("context_window")
            if used and window:
                peak = max(peak, used / window)
        elif kind in ("run.completed", "run.failed", "run.cancelled"):
            end = kind.split(".")[1]
            break
    return {
        "delegate_calls": delegates,
        "helper_sessions": helpers,
        "read_file_calls": reads,
        "peak_share": round(peak, 3),
        "end": end,
    }


async def arm(model: str, window: int, project: Path, ask: str, timeout: float) -> dict[str, Any]:
    root = Path(tempfile.mkdtemp(prefix="gd", dir="/var/tmp")).resolve()
    home, user = root / "g", root / "h"
    for folder in (home, user):
        folder.mkdir(parents=True)
    config = f'default_model = "t"\n[models.t]\nmodel = "{model}"\nctx = {window}\n'
    config += '[permissions]\nmode = "autopilot"\n'
    (home / "config.toml").write_text(config, "utf-8")
    env = {**os.environ, "GOLEM_HOME": str(home), "HOME": str(user)}
    daemon = subprocess.Popen(
        [sys.executable, "-m", "golem.cli", "serve"], env=env, stderr=subprocess.DEVNULL
    )
    try:
        socket = home / "run" / "golem.sock"
        for _ in range(100):
            if socket.exists():
                break
            await asyncio.sleep(0.2)
        reader, writer = await asyncio.open_unix_connection(str(socket))
        client = Client(reader, writer)
        hello = {"protocol_major": PROTOCOL_MAJOR, "protocol_minor": 0, "client": "tui"}
        await client.call("hello", hello)
        return {"window": window, **await play(client, project, ask, timeout)}
    finally:
        daemon.terminate()
        daemon.wait(timeout=10)
        shutil.rmtree(root, ignore_errors=True)


async def main() -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n")[0])
    parser.add_argument("--model", required=True, help="a provider/model ref")
    parser.add_argument("--project", type=Path, required=True, help="the repo to ask about")
    parser.add_argument("--timeout", type=float, default=600)
    parser.add_argument("--window", type=int, default=32_768, help="the model's window (ctx)")
    parser.add_argument(
        "--label", default="run", help="a name for this run, such as before or after"
    )
    args = parser.parse_args()
    for ask in ASKS:
        result = await arm(args.model, args.window, args.project.resolve(), ask, args.timeout)
        print(args.label, json.dumps({"ask": ask, **result}))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
