"""Downloads and removals through a fake Ollama and a fake registry."""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator, Callable
from pathlib import Path
from typing import cast

import httpx
import pytest
from pydantic import BaseModel
from test_server import HELLO, RpcClient, error_code, rpc_result, start_daemon, stop_daemon

from golem.config import GolemSettings
from golem.models import registry
from golem.models.catalog_check import next_versions
from golem.models.discovery import ModelDiscovery
from golem.models.pulls import PullError, PullManager
from golem.models.router import ModelRouter
from golem.server.dispatcher import MODEL_PULL_FAILED

TAGS: dict[str, object] = {
    "models": [
        {"name": "qwen3:8b", "size": 5_200_000_000, "details": {}, "capabilities": ["tools"]}
    ]
}
MANIFEST = {"layers": [{"size": 3_000_000_000}, {"size": 300_000_000}]}

Lines = Callable[[], AsyncIterator[bytes]]


def _lines(
    items: list[dict[str, object]], gate: asyncio.Event | None = None, after: int = 1
) -> Lines:
    async def stream() -> AsyncIterator[bytes]:
        for index, item in enumerate(items):
            if gate is not None and index == after:
                await gate.wait()
            yield (json.dumps(item) + "\n").encode()

    return stream


PULL_OK: list[dict[str, object]] = [
    {"status": "pulling manifest"},
    {"status": "pulling aaa", "digest": "sha256:aaa", "total": 300, "completed": 0},
    {"status": "pulling aaa", "digest": "sha256:aaa", "total": 300, "completed": 300},
    {"status": "pulling bbb", "digest": "sha256:bbb", "total": 100, "completed": 50},
    {"status": "pulling bbb", "digest": "sha256:bbb", "total": 100, "completed": 100},
    {"status": "verifying sha256 digest"},
    {"status": "writing manifest"},
    {"status": "success"},
]


class FakeOllama:
    def __init__(self, pull: Lines | None = None) -> None:
        self.pull = pull or _lines(PULL_OK)
        self.up = True
        self.manifest_status = 200
        self.pulled: list[object] = []
        self.deleted: list[object] = []

    async def __call__(self, request: httpx.Request) -> httpx.Response:
        if request.url.host == "registry.ollama.ai":
            if self.manifest_status != 200:
                return httpx.Response(self.manifest_status)
            return httpx.Response(200, json=MANIFEST)
        if not self.up:
            raise httpx.ConnectError("refused", request=request)
        if request.url.path == "/api/tags":
            return httpx.Response(200, json=TAGS)
        if request.url.path == "/api/pull":
            self.pulled.append(json.loads(request.content))
            return httpx.Response(200, content=self.pull())
        if request.url.path == "/api/delete":
            body = json.loads(request.content)
            self.deleted.append(body)
            return httpx.Response(200 if body["model"] == "qwen3:8b" else 404, json={})
        return httpx.Response(404)


def _manager(
    fake: FakeOllama, sent: list[BaseModel], tmp_path: Path, *, installed: bool = True
) -> PullManager:
    return PullManager(
        ModelRouter(GolemSettings()),
        transport=httpx.MockTransport(fake),
        broadcast=sent.append,
        ram_gb=36.0,
        models_dir=tmp_path,
        clock=lambda: 0.0,
        ollama_installed=lambda: installed,
    )


async def _until_done(manager: PullManager, ref: str) -> None:
    for _ in range(200):
        if ref not in manager.pulling():
            return
        await asyncio.sleep(0.01)
    raise AssertionError("the pull did not end")


def _dumped(sent: list[BaseModel]) -> list[dict[str, object]]:
    return [cast(dict[str, object], json.loads(item.model_dump_json())) for item in sent]


async def test_a_pull_sums_its_layers_and_says_when_it_is_done(tmp_path: Path) -> None:
    fake = FakeOllama()
    sent: list[BaseModel] = []
    manager = _manager(fake, sent, tmp_path)
    ref, started = await manager.start("qwen3:30b-a3b")
    assert (ref, started) == ("ollama/qwen3:30b-a3b", True)
    await _until_done(manager, ref)
    notes = _dumped(sent)
    progress = [n["params"] for n in notes if n["method"] == "model.pull.progress"]
    assert fake.pulled == [{"model": "qwen3:30b-a3b", "stream": True}]
    shares = [cast(dict[str, object], p)["progress"] for p in progress]
    assert shares[0] is None and 0.875 in shares and shares[-1] == 1.0
    assert notes[-1] == {
        "jsonrpc": "2.0",
        "method": "model.pull.done",
        "params": {"ref": "ollama/qwen3:30b-a3b", "ok": True, "error": None},
    }
    await manager.aclose()


async def test_progress_is_sent_a_few_times_a_second(tmp_path: Path) -> None:
    items: list[dict[str, object]] = [
        {"status": "pulling aaa", "digest": "sha256:aaa", "total": 100, "completed": step}
        for step in range(100)
    ]
    fake = FakeOllama(_lines([*items, {"status": "success"}]))
    sent: list[BaseModel] = []
    now = [0.0]
    manager = PullManager(
        ModelRouter(GolemSettings()),
        transport=httpx.MockTransport(fake),
        broadcast=sent.append,
        models_dir=tmp_path,
        clock=lambda: now[0],
    )
    ref, _ = await manager.start("tiny:1b")
    await _until_done(manager, ref)
    progress = [n for n in _dumped(sent) if n["method"] == "model.pull.progress"]
    assert len(progress) == 2
    await manager.aclose()


async def test_an_ollama_error_ends_the_pull(tmp_path: Path) -> None:
    fake = FakeOllama(_lines([{"status": "pulling manifest"}, {"error": "file does not exist"}]))
    sent: list[BaseModel] = []
    manager = _manager(fake, sent, tmp_path)
    ref, _ = await manager.start("qwen3:30b-a3b")
    await _until_done(manager, ref)
    done = _dumped(sent)[-1]["params"]
    assert done == {"ref": ref, "ok": False, "error": "file does not exist"}
    await manager.aclose()


async def test_cancel_stops_the_pull_and_says_so(tmp_path: Path) -> None:
    gate = asyncio.Event()
    fake = FakeOllama(_lines(PULL_OK, gate=gate, after=2))
    sent: list[BaseModel] = []
    manager = _manager(fake, sent, tmp_path)
    ref, _ = await manager.start("qwen3:30b-a3b")
    for _ in range(100):
        if manager.pulling().get(ref) is not None:
            break
        await asyncio.sleep(0.01)
    assert manager.pulling() == {ref: 0.0}
    again = await manager.start("ollama/qwen3:30b-a3b")
    assert again == (ref, False)
    assert await manager.cancel(ref) == (ref, True)
    assert manager.pulling() == {}
    assert _dumped(sent)[-1]["params"] == {"ref": ref, "ok": False, "error": "cancelled"}
    assert await manager.cancel(ref) == (ref, False)
    await manager.aclose()


async def test_a_pull_that_cannot_start_says_why(tmp_path: Path) -> None:
    fake = FakeOllama()
    manager = _manager(fake, [], tmp_path)
    fake.manifest_status = 404
    with pytest.raises(PullError, match="no model named nothing:1b"):
        await manager.start("nothing:1b")
    fake.manifest_status = 200
    fake.up = False
    with pytest.raises(PullError, match="not running: run ollama serve"):
        await manager.start("qwen3:30b-a3b")
    missing = _manager(fake, [], tmp_path, installed=False)
    with pytest.raises(PullError, match="not installed: run brew install ollama"):
        await missing.start("qwen3:30b-a3b")
    with pytest.raises(PullError, match="only Ollama models"):
        await manager.start("anthropic/claude-x")
    await manager.aclose()
    await missing.aclose()


async def test_a_full_disk_refuses_the_pull(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    class Usage:
        free = 2_000_000_000

    def usage(_path: object) -> Usage:
        return Usage()

    monkeypatch.setattr("golem.models.pulls.shutil.disk_usage", usage)
    manager = _manager(FakeOllama(), [], tmp_path)
    with pytest.raises(PullError, match=r"not enough disk space: 2.0 GB free, 3.3 GB needed"):
        await manager.start("qwen3:30b-a3b")
    await manager.aclose()


async def test_probe_reports_size_fit_disk_and_installed(tmp_path: Path) -> None:
    manager = _manager(FakeOllama(), [], tmp_path)
    probe = await manager.probe("qwen3:8b")
    assert (probe.ref, probe.installed, probe.exists, probe.size_gb, probe.fit) == (
        "ollama/qwen3:8b",
        True,
        True,
        3.3,
        "fits",
    )
    assert probe.disk_free_gb is not None and probe.disk_free_gb > 0
    await manager.aclose()


async def test_delete_removes_an_installed_model(tmp_path: Path) -> None:
    fake = FakeOllama()
    manager = _manager(fake, [], tmp_path)
    assert await manager.delete("ollama/qwen3:8b") == ("ollama/qwen3:8b", True)
    assert await manager.delete("gone:1b") == ("ollama/gone:1b", False)
    assert fake.deleted == [{"model": "qwen3:8b"}, {"model": "gone:1b"}]
    await manager.aclose()


@pytest.mark.parametrize(
    ("name", "repository", "tag"),
    [
        ("qwen3:8b", "library/qwen3", "8b"),
        ("ollama/qwen3", "library/qwen3", "latest"),
        ("someone/model:q4", "someone/model", "q4"),
    ],
)
def test_parse_name(name: str, repository: str, tag: str) -> None:
    parsed = registry.parse_name(name)
    assert parsed is not None
    assert (parsed.repository, parsed.tag) == (repository, tag)


@pytest.mark.parametrize(
    ("family", "expected"),
    [
        ("qwen3.8", ["qwen3.9", "qwen4"]),
        ("gemma4", ["gemma4.1", "gemma5"]),
        ("qwen3-coder", ["qwen3.1-coder", "qwen4-coder"]),
        ("llama3.2", ["llama3.3", "llama4"]),
        ("devstral", []),
        ("gpt-oss", []),
    ],
)
def test_next_versions(family: str, expected: list[str]) -> None:
    assert next_versions(family) == expected


@pytest.mark.parametrize("name", ["hf.co/user/model", "hf.co/model", "", "a b"])
def test_parse_name_rejects_what_is_not_the_library(name: str) -> None:
    assert registry.parse_name(name) is None


async def test_a_pull_shows_in_model_list_and_over_the_socket(short_home: Path) -> None:
    gate = asyncio.Event()
    fake = FakeOllama(_lines(PULL_OK, gate=gate, after=2))
    transport = httpx.MockTransport(fake)
    router = ModelRouter(GolemSettings())
    app, task = await start_daemon(
        short_home,
        router=router,
        discovery=lambda routed: ModelDiscovery(
            routed, None, transport=transport, ram_gb=36.0, catalog=[], fetch_prices=False
        ),
        pulls=lambda routed, ram: PullManager(
            routed, transport=transport, ram_gb=ram, models_dir=short_home, clock=lambda: 0.0
        ),
    )
    client = await RpcClient.connect(app.paths.socket_path)
    other = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        await other.call("hello", HELLO)
        started = rpc_result(await client.call("model.pull", {"name": "qwen3:30b-a3b"}))
        assert started == {"ref": "ollama/qwen3:30b-a3b", "started": True}
        pulling: dict[str, object] = {}
        for _ in range(100):
            listed = rpc_result(await client.call("model.list", {}))
            models = {
                cast(str, m["ref"]): m for m in cast(list[dict[str, object]], listed["models"])
            }
            pulling = models.get("ollama/qwen3:30b-a3b", {})
            if pulling.get("progress") is not None:
                break
            await asyncio.sleep(0.01)
        assert (pulling["status"], pulling["progress"]) == ("pulling", 0.0)
        gate.set()
        for _ in range(100):
            await other.take_events()
            if any(n["method"] == "model.pull.done" for n in other.notices):
                break
            await asyncio.sleep(0.01)
        methods = [n["method"] for n in other.notices]
        assert "model.pull.progress" in methods and methods[-1] == "model.pull.done"
        failed = await client.call("model.pull", {"name": "anthropic/claude-x"})
        assert error_code(failed) == MODEL_PULL_FAILED
        removed = rpc_result(await client.call("model.delete", {"name": "qwen3:8b"}))
        assert removed == {"ref": "ollama/qwen3:8b", "deleted": True}
        probe = rpc_result(await client.call("model.probe", {"name": "qwen3:30b-a3b"}))
        assert probe["size_gb"] == 3.3 and probe["installed"] is False
    finally:
        await client.close()
        await other.close()
        await stop_daemon(app, task)
