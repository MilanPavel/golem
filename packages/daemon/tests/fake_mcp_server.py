"""An MCP server over stdio for the tests. Run it with the test's Python.

Tools: ``echo`` answers with its text, ``fail`` is a tool error, ``weird.name``
has a name providers do not take, ``slow`` never answers in time, ``crash``
exits, ``grow`` adds a tool and says the list changed, and ``replies`` shows
what golem answered to the server's own requests. ``tools/list`` comes in
pages of two. ``--exit-at-start`` exits before the handshake.
"""

from __future__ import annotations

import json
import sys
import time
from typing import Any

TOOLS: list[dict[str, Any]] = [
    {
        "name": "echo",
        "description": "Says the text back.",
        "inputSchema": {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "type": "object",
            "properties": {"text": {"type": "string"}},
            "required": ["text"],
        },
    },
    {"name": "fail", "description": "Always fails.", "inputSchema": {"type": "object"}},
    {"name": "weird.name", "inputSchema": {"type": "object"}},
    {"name": "slow", "description": "Takes too long.", "inputSchema": {"type": "object"}},
    {"name": "crash", "description": "Exits.", "inputSchema": {"type": "object"}},
    {"name": "grow", "description": "Adds a tool.", "inputSchema": {"type": "object"}},
    {"name": "replies", "description": "What golem answered.", "inputSchema": {"type": "object"}},
]
replies: list[dict[str, Any]] = []


def send(message: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()


def text(value: str, *, error: bool = False) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": value}], "isError": error}


def call(name: str, arguments: dict[str, Any]) -> dict[str, Any] | None:
    if name == "echo":
        return text(f"echo: {arguments.get('text')}")
    if name == "fail":
        return text("it broke", error=True)
    if name == "weird.name":
        return {"content": [{"type": "image", "data": "AAAA", "mimeType": "image/png"}]}
    if name == "slow":
        time.sleep(30)
        return text("late")
    if name == "crash":
        sys.stderr.write("going down\n")
        sys.stderr.flush()
        sys.exit(3)
    if name == "grow":
        TOOLS.append({"name": "late", "inputSchema": {"type": "object"}})
        send({"jsonrpc": "2.0", "method": "notifications/tools/list_changed"})
        return text("grown")
    if name == "replies":
        return text(json.dumps(replies))
    return None


def handle(message: dict[str, Any]) -> None:
    method = message.get("method")
    if method is None:
        replies.append(message)
        return
    if method == "notifications/initialized":
        send({"jsonrpc": "2.0", "id": "s1", "method": "ping"})
        send({"jsonrpc": "2.0", "id": "s2", "method": "roots/list"})
        return
    if "id" not in message:
        return
    params: dict[str, Any] = message.get("params") or {}
    if method == "initialize":
        result: dict[str, Any] = {
            "protocolVersion": params.get("protocolVersion"),
            "capabilities": {"tools": {"listChanged": True}},
            "serverInfo": {"name": "fake", "version": "1"},
        }
    elif method == "tools/list":
        start = int(params.get("cursor") or 0)
        result = {"tools": TOOLS[start : start + 2]}
        if start + 2 < len(TOOLS):
            result["nextCursor"] = str(start + 2)
    elif method == "tools/call":
        answer = call(params["name"], params.get("arguments") or {})
        if answer is None:
            error = {"code": -32602, "message": f"unknown tool {params['name']}"}
            send({"jsonrpc": "2.0", "id": message["id"], "error": error})
            return
        result = answer
    else:
        send({"jsonrpc": "2.0", "id": message["id"], "error": {"code": -32601, "message": "no"}})
        return
    send({"jsonrpc": "2.0", "id": message["id"], "result": result})


def main() -> None:
    if "--exit-at-start" in sys.argv:
        sys.stderr.write("cannot start: no config\n")
        sys.exit(2)
    print("not json, a stray log line", flush=True)
    for line in sys.stdin:
        handle(json.loads(line))


if __name__ == "__main__":
    main()
