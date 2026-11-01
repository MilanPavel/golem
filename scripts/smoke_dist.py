#!/usr/bin/env python3
"""Start a built daemon against a stub model and check one chat.

Standard library only. ``just smoke-dist`` runs this. After one untimed start,
the fastest of five starts must open the socket within 1.5 seconds, and the
assistant's ``message.completed`` text is ``smoke-ok``.
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
import urllib.request
from collections.abc import Callable
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import cast

REPLY = "smoke-ok"
# A start takes about 0.5s on a quiet Mac. Shared CI Macs vary from 0.5s to
# 1.4s for the same build, so the budget leaves room for that and still
# catches a start that doubles.
START_LIMIT_S = 1.5
TIMED_STARTS = 5
FIRST_START_LIMIT_S = 30.0
CHAT_TIMEOUT_S = 60.0
WEB_START_LIMIT_S = 15.0
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
        # start of a fresh tree is slow. The later starts are the ones timed.
        if run_daemon(daemon, env, home, "first start", FIRST_START_LIMIT_S) is None:
            return 1

        def check_chat() -> bool:
            text = chat(sock_path, major, minor)
            if text != REPLY:
                print(f"assistant text was {text!r}", file=sys.stderr)
                return False
            print(f"chat ok: {text}")
            return True

        # A shared CI machine sometimes stalls one start, so the budget is
        # checked against the fastest of a few. Every start must still succeed.
        times: list[float] = []
        for attempt in range(1, TIMED_STARTS + 1):
            body = check_chat if attempt == 1 else None
            elapsed = run_daemon(daemon, env, home, f"start {attempt}", FIRST_START_LIMIT_S, body)
            if elapsed is None:
                return 1
            times.append(elapsed)
        if min(times) >= START_LIMIT_S:
            fastest = min(times)
            print(f"no start was under {START_LIMIT_S:g}s (fastest {fastest:.3f}s)", file=sys.stderr)
            return 1
        if not check_web(tree, env, home):
            return 1
    finally:
        server.shutdown()
    return 0


def http_get(url: str) -> tuple[int, dict[str, str], bytes]:
    with urllib.request.urlopen(url, timeout=10) as res:
        headers = {key.lower(): value for key, value in res.headers.items()}
        return res.status, headers, res.read()


def read_first_line(proc: subprocess.Popen[bytes], limit: float) -> bytes:
    """The first stdout line of ``proc``, or b"" when none comes within ``limit`` seconds."""
    assert proc.stdout is not None
    lines: queue.Queue[bytes] = queue.Queue()
    threading.Thread(target=lambda: lines.put(proc.stdout.readline()), daemon=True).start()  # type: ignore[union-attr]
    try:
        return lines.get(timeout=limit)
    except queue.Empty:
        return b""


def check_web(tree: Path, env: dict[str, str], home: Path) -> bool:
    """``golem web`` serves the embedded page, answers /healthz, and removes its run file."""
    golem = tree / "bin" / "golem"
    proc = subprocess.Popen(
        [str(golem), "web", "--json", "--port", "0"],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    ok = False
    try:
        line = read_first_line(proc, WEB_START_LIMIT_S)
        if not line:
            print(f"golem web printed nothing within {WEB_START_LIMIT_S:g}s", file=sys.stderr)
        else:
            ok = check_web_page(json.loads(line))
    except (OSError, ValueError) as exc:
        print(f"golem web check failed: {exc}", file=sys.stderr)
    finally:
        if proc.poll() is None:
            proc.send_signal(signal.SIGTERM)
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5)
    if proc.stderr is not None and not ok:
        print(proc.stderr.read().decode("utf-8", "replace"), file=sys.stderr)
    if ok and (home / "run" / "web.json").exists():
        print("golem web left run/web.json behind", file=sys.stderr)
        return False
    return ok


def check_web_page(info: object) -> bool:
    if not isinstance(info, dict):
        print(f"golem web --json printed {info!r}", file=sys.stderr)
        return False
    fields = cast(dict[str, object], info)
    port = fields.get("port")
    pid = fields.get("pid")
    if not isinstance(port, int) or not isinstance(pid, int):
        print(f"golem web --json has no port and pid: {fields!r}", file=sys.stderr)
        return False
    base = f"http://127.0.0.1:{port}"
    status, headers, body = http_get(f"{base}/")
    problems: list[str] = []
    if status != 200:
        problems.append(f"GET / was {status}")
    if not headers.get("content-type", "").startswith("text/html"):
        problems.append(f"content-type was {headers.get('content-type')!r}")
    if headers.get("cache-control") != "no-cache":
        problems.append(f"cache-control was {headers.get('cache-control')!r}")
    if "content-security-policy" not in headers:
        problems.append("no content-security-policy header")
    if b"golem web" not in body:
        problems.append("the page does not contain 'golem web'")
    _, _, health = http_get(f"{base}/healthz")
    reported = json.loads(health).get("pid")
    if reported != pid:
        problems.append(f"/healthz pid was {reported!r}, not {pid}")
    for problem in problems:
        print(f"web: {problem}", file=sys.stderr)
    if problems:
        return False
    print(f"web ok: {port}")
    return True


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
                loaded = json.loads(raw)
            except json.JSONDecodeError:
                loaded = {}
            # json.loads is Any. Only an object can carry a stream flag.
            if isinstance(loaded, dict):
                body = cast(dict[str, object], loaded)
                stream = body.get("stream", True) is not False
        payload = sse(REPLY) if stream else json.dumps(completion(REPLY)).encode()
        self.send_response(200)
        kind = "text/event-stream" if stream else "application/json"
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, format: str, *args: object) -> None:
        del format, args


def sse(text: str) -> bytes:
    # An empty dict has unknown key and value types, so name both deltas.
    delta: dict[str, str] = {"role": "assistant", "content": text}
    done: dict[str, str] = {}
    chunks: list[dict[str, object]] = [
        {
            "id": "s",
            "object": "chat.completion.chunk",
            "created": 0,
            "model": "fake",
            "choices": [{"index": 0, "delta": delta, "finish_reason": None}],
        },
        {
            "id": "s",
            "object": "chat.completion.chunk",
            "created": 0,
            "model": "fake",
            "choices": [{"index": 0, "delta": done, "finish_reason": "stop"}],
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
                return cast(dict[str, object], result)
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
        if isinstance(data, dict):
            fields = cast(dict[str, object], data)
            if fields.get("role") == "assistant":
                text = fields.get("text")
                if isinstance(text, str):
                    return text
    return None


def _keep(message: dict[str, object], events: list[dict[str, object]]) -> None:
    if message.get("method") != "event":
        return
    params = message.get("params")
    if isinstance(params, dict):
        events.append(cast(dict[str, object], params))


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
                loaded = json.loads(line)
            except json.JSONDecodeError:
                continue
            # json.loads is Any. A JSON object is a dict with string keys.
            if isinstance(loaded, dict):
                messages.put(cast(dict[str, object], loaded))


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, TimeoutError, OSError) as exc:
        print(exc, file=sys.stderr)
        raise SystemExit(1) from exc
