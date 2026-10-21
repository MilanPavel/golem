#!/usr/bin/env python3
"""Start a built daemon against a stub model and check one chat.

Standard library only. ``just smoke-dist`` runs this. After one untimed start,
the socket must appear within a second, and the assistant's
``message.completed`` text is ``smoke-ok``.
"""

from __future__ import annotations

import json
import os
import queue
import re
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
from collections.abc import Callable
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

REPLY = "smoke-ok"
START_LIMIT_S = 1.0
FIRST_START_LIMIT_S = 30.0
CHAT_TIMEOUT_S = 60.0
ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    given = sys.argv[1] if len(sys.argv) > 1 else ""
    tree = Path(given).resolve() if given else newest_tree()
    daemon = tree / "libexec" / "golem-daemon" / "golem-daemon"
    if not daemon.is_file():
        print(f"daemon executable not found: {daemon}", file=sys.stderr)
        return 1
    major, minor = protocol_version()
    server = ThreadingHTTPServer(("127.0.0.1", 0), StubHandler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, name="smoke-stub", daemon=True)
    thread.start()
    home = Path(tempfile.mkdtemp(prefix="gs", dir="/tmp"))
    (home / "run").mkdir()
    (home / "config.toml").write_text(
        "\n".join(
            [
                "session_titles = false",
                'default_model = "stub/fake"',
                "",
                "[providers.stub]",
                'kind = "openai_compat"',
                f'base_url = "http://127.0.0.1:{port}/v1"',
                'api_key_env = "GOLEM_SMOKE_KEY"',
                "",
            ]
        ),
        encoding="utf-8",
    )
    env = os.environ.copy()
    env["GOLEM_HOME"] = str(home)
    env["GOLEM_SMOKE_KEY"] = "smoke"
    env.pop("VIRTUAL_ENV", None)
    sock_path = home / "run" / "golem.sock"
    try:
        # macOS verifies each new library on its first load, so the first
        # start of a fresh tree is slow. The second start is the one timed.
        if run_daemon(daemon, env, home, "first start", FIRST_START_LIMIT_S) is None:
            return 1

        def check_chat() -> bool:
            text = chat(sock_path, major, minor)
            if text != REPLY:
                print(f"assistant text was {text!r}", file=sys.stderr)
                return False
            print(f"chat ok: {text}")
            return True

        if run_daemon(daemon, env, home, "start", START_LIMIT_S, check_chat) is None:
            return 1
    finally:
        server.shutdown()
    return 0


def run_daemon(
    daemon: Path,
    env: dict[str, str],
    home: Path,
    label: str,
    limit: float,
    body: Callable[[], bool] | None = None,
) -> float | None:
    """Start ``daemon serve``, run ``body``, then SIGTERM. Returns seconds to the socket."""
    log_path = home / "stderr.txt"
    sock_path = home / "run" / "golem.sock"
    ok = False
    elapsed = 0.0
    with log_path.open("w", encoding="utf-8") as log_file:
        started = time.perf_counter()
        proc = subprocess.Popen(
            [str(daemon), "serve"],
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=log_file,
        )
        try:
            if wait_for_socket(sock_path, proc, started, limit):
                elapsed = time.perf_counter() - started
                print(f"{label}: socket in {elapsed:.3f}s")
                ok = body() if body is not None else True
        finally:
            if proc.poll() is None:
                proc.send_signal(signal.SIGTERM)
            try:
                code = proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
                code = proc.wait(timeout=5)
    if code != 0 or not ok:
        print(log_path.read_text(encoding="utf-8"), file=sys.stderr)
        if code != 0:
            print(f"{label}: daemon exited {code}", file=sys.stderr)
        return None
    return elapsed


def newest_tree() -> Path:
    dist = ROOT / "dist"
    found = [
        path
        for path in dist.glob("golem-*")
        if (path / "libexec" / "golem-daemon" / "golem-daemon").is_file()
    ]
    if not found:
        print("no built tree under dist/; run just dist", file=sys.stderr)
        raise SystemExit(1)
    return max(found, key=lambda path: path.stat().st_mtime)


def protocol_version() -> tuple[int, int]:
    text = (ROOT / "packages" / "protocol" / "golem_protocol" / "version.py").read_text(
        encoding="utf-8"
    )
    major = re.search(r"PROTOCOL_MAJOR = (\d+)", text)
    minor = re.search(r"PROTOCOL_MINOR = (\d+)", text)
    if major is None or minor is None:
        print("could not read the protocol version", file=sys.stderr)
        raise SystemExit(1)
    return int(major.group(1)), int(minor.group(1))


def wait_for_socket(
    path: Path, proc: subprocess.Popen[bytes], started: float, limit: float
) -> bool:
    while time.perf_counter() - started < limit:
        if path.exists():
            return True
        if proc.poll() is not None:
            print(f"daemon exited {proc.returncode} before the socket", file=sys.stderr)
            return False
        time.sleep(0.01)
    print(f"daemon socket did not appear within {limit:g}s", file=sys.stderr)
    return False


class StubHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length else b""
        stream = True
        if raw:
            try:
                body = json.loads(raw)
            except json.JSONDecodeError:
                body = {}
            stream = body.get("stream", True) is not False
        payload = sse(REPLY) if stream else json.dumps(completion(REPLY)).encode()
        self.send_response(200)
        kind = "text/event-stream" if stream else "application/json"
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, fmt: str, *args: object) -> None:
        del fmt, args


def sse(text: str) -> bytes:
    chunks = [
        {
            "id": "s",
            "object": "chat.completion.chunk",
            "created": 0,
            "model": "fake",
            "choices": [
                {"index": 0, "delta": {"role": "assistant", "content": text}, "finish_reason": None}
            ],
        },
        {
            "id": "s",
            "object": "chat.completion.chunk",
            "created": 0,
            "model": "fake",
            "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
        },
    ]
    lines = [f"data: {json.dumps(chunk)}\n\n" for chunk in chunks]
    lines.append("data: [DONE]\n\n")
    return "".join(lines).encode()


def completion(text: str) -> dict[str, object]:
    return {
        "id": "s",
        "object": "chat.completion",
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": text},
                "finish_reason": "stop",
            }
        ],
    }


def chat(sock_path: Path, major: int, minor: int) -> str:
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.connect(os.fspath(sock_path))
    messages: queue.Queue[dict[str, object]] = queue.Queue()
    reader = threading.Thread(target=_read_lines, args=(sock, messages), daemon=True)
    reader.start()
    events: list[dict[str, object]] = []
    next_id = 0

    def call(method: str, params: dict[str, object], timeout: float) -> dict[str, object]:
        nonlocal next_id
        next_id += 1
        request_id = next_id
        body = {"jsonrpc": "2.0", "method": method, "params": params, "id": request_id}
        sock.sendall(json.dumps(body).encode() + b"\n")
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                message = messages.get(timeout=0.2)
            except queue.Empty:
                continue
            if message.get("id") == request_id:
                if "error" in message:
                    raise RuntimeError(json.dumps(message["error"]))
                result = message.get("result")
                if not isinstance(result, dict):
                    raise RuntimeError(f"{method} returned {result!r}")
                return result
            _keep(message, events)
        raise TimeoutError(method)

    try:
        call("hello", {"protocol_major": major, "protocol_minor": minor, "client": "smoke"}, 5)
        created = call("session.create", {}, 5)
        session_id = created["session_id"]
        if not isinstance(session_id, str):
            raise RuntimeError(f"session id {session_id!r}")
        call("session.attach", {"session_id": session_id, "after_seq": 0}, 5)
        call("message.send", {"session_id": session_id, "text": "ping"}, CHAT_TIMEOUT_S)
        return wait_for_reply(messages, events)
    finally:
        sock.close()


def wait_for_reply(
    messages: queue.Queue[dict[str, object]],
    events: list[dict[str, object]],
) -> str:
    deadline = time.monotonic() + CHAT_TIMEOUT_S
    while time.monotonic() < deadline:
        text = _assistant_text(events)
        if text is not None:
            return text
        try:
            message = messages.get(timeout=0.2)
        except queue.Empty:
            continue
        _keep(message, events)
    raise TimeoutError("no assistant message.completed")


def _assistant_text(events: list[dict[str, object]]) -> str | None:
    for event in events:
        if event.get("type") == "run.failed":
            raise RuntimeError(json.dumps(event))
        if event.get("type") != "message.completed":
            continue
        data = event.get("data")
        if isinstance(data, dict) and data.get("role") == "assistant":
            text = data.get("text")
            if isinstance(text, str):
                return text
    return None


def _keep(message: dict[str, object], events: list[dict[str, object]]) -> None:
    if message.get("method") != "event":
        return
    params = message.get("params")
    if isinstance(params, dict):
        events.append(params)


def _read_lines(sock: socket.socket, messages: queue.Queue[dict[str, object]]) -> None:
    buf = b""
    while True:
        try:
            chunk = sock.recv(65536)
        except OSError:
            return
        if not chunk:
            return
        buf += chunk
        while b"\n" in buf:
            line, buf = buf.split(b"\n", 1)
            if not line:
                continue
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(payload, dict):
                messages.put(payload)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, TimeoutError, OSError) as exc:
        print(exc, file=sys.stderr)
        raise SystemExit(1) from exc
