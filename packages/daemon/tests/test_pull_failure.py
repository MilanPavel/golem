"""A failed download: plain words, the parts it leaves behind, and their removal."""

# pyright: reportPrivateUsage=false

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import cast

import httpx
import pytest
from pydantic import BaseModel
from test_pulls import (
    FakeOllama,
    _dumped,
    _lines,
    _manager,
    _until_done,
)
from test_server import HELLO, RpcClient, rpc_result, start_daemon, stop_daemon

from golem.config import GolemSettings
from golem.models.pulls import PullManager, plain_error
from golem.models.router import ModelRouter

REF = "ollama/hf.co/unsloth/Qwen3.8-27B-GGUF:Q4_K_S"
NAME = "hf.co/unsloth/Qwen3.8-27B-GGUF:Q4_K_S"
PLAIN = "Hugging Face is missing a file for this model. Try another repo or the Ollama library."
BIG = "a" * 64
SMALL = "b" * 64
OTHER = "c" * 64
USED = "d" * 64


def _stream(error: str = "file does not exist") -> list[dict[str, object]]:
    return [
        {"status": "pulling manifest"},
        {
            "status": f"pulling {BIG[:12]}",
            "digest": f"sha256:{BIG}",
            "total": 120_000_000,
            "completed": 120_000_000,
        },
        {
            "status": f"pulling {SMALL[:12]}",
            "digest": f"sha256:{SMALL}",
            "total": 50,
            "completed": 50,
        },
        {
            "status": f"pulling {USED[:12]}",
            "digest": f"sha256:{USED}",
            "total": 40,
            "completed": 40,
        },
        {"error": error},
    ]


def _blob(models: Path, name: str, size: int) -> Path:
    blobs = models / "blobs"
    blobs.mkdir(parents=True, exist_ok=True)
    path = blobs / name
    with path.open("wb") as handle:
        handle.truncate(size)
    return path


def _manifest(models: Path, *digests: str) -> None:
    folder = models / "manifests" / "registry.ollama.ai" / "library" / "other"
    folder.mkdir(parents=True, exist_ok=True)
    layers = [{"digest": f"sha256:{digest}", "size": 1} for digest in digests]
    (folder / "latest").write_text(
        json.dumps({"config": {"digest": f"sha256:{OTHER}"}, "layers": layers})
    )


@pytest.mark.parametrize(
    ("model", "raw", "error", "detail"),
    [
        ("hf.co/u/r:Q4_K_M", "file does not exist", PLAIN, "file does not exist"),
        ("hf.co/u/r:Q4_K_M", "File does not exist.", PLAIN, "File does not exist."),
        ("qwen3:8b", "file does not exist", "file does not exist", None),
        ("hf.co/u/r:Q4_K_M", "no space left on device", "no space left on device", None),
    ],
)
def test_plain_error_maps_known_cases_and_passes_the_rest(
    model: str, raw: str, error: str, detail: str | None
) -> None:
    assert plain_error(model, raw) == (error, detail)


async def test_a_failed_hf_pull_says_why_and_counts_what_it_left(tmp_path: Path) -> None:
    _blob(tmp_path, f"sha256-{BIG}", 120_000_000)
    _blob(tmp_path, f"sha256-{SMALL}-partial-0", 10)
    _blob(tmp_path, f"sha256-{USED}", 40)
    _manifest(tmp_path, USED)
    sent: list[BaseModel] = []
    manager = _manager(FakeOllama(pull=_lines(_stream())), sent, tmp_path)
    ref, _ = await manager.start(NAME)
    assert ref == REF
    await _until_done(manager, ref)
    done = cast(dict[str, object], _dumped(sent)[-1]["params"])
    assert done["ok"] is False
    assert done["error"] == PLAIN
    assert done["detail"] == "file does not exist"
    assert done["leftover_gb"] == 0.12


async def test_a_small_leftover_is_not_reported_and_a_good_pull_has_none(tmp_path: Path) -> None:
    _blob(tmp_path, f"sha256-{SMALL}", 50)
    sent: list[BaseModel] = []
    manager = _manager(FakeOllama(pull=_lines(_stream("no space left on device"))), sent, tmp_path)
    ref, _ = await manager.start(NAME)
    await _until_done(manager, ref)
    done = cast(dict[str, object], _dumped(sent)[-1]["params"])
    assert done["error"] == "no space left on device"
    assert done["detail"] is None
    assert done["leftover_gb"] is None
    assert manager.cleanup(NAME) == (REF, 0.0)


async def test_cleanup_removes_only_remembered_unreferenced_parts(tmp_path: Path) -> None:
    big = _blob(tmp_path, f"sha256-{BIG}", 120_000_000)
    part = _blob(tmp_path, f"sha256-{SMALL}-partial-0", 10)
    used = _blob(tmp_path, f"sha256-{USED}", 40)
    stranger = _blob(tmp_path, f"sha256-{OTHER}", 10)
    _manifest(tmp_path, USED)
    sent: list[BaseModel] = []
    manager = _manager(FakeOllama(pull=_lines(_stream())), sent, tmp_path)
    ref, _ = await manager.start(NAME)
    await _until_done(manager, ref)
    # A manifest written after the failure now names the big part: it stays.
    _manifest(tmp_path, USED, BIG)
    assert manager.cleanup(NAME) == (REF, 0.0)
    assert big.exists() and used.exists() and stranger.exists() and part.exists() is False
    # The list is spent: a second call has nothing to do.
    assert manager.cleanup(NAME) == (REF, 0.0)


async def test_cleanup_frees_the_big_part_and_spares_the_rest(tmp_path: Path) -> None:
    big = _blob(tmp_path, f"sha256-{BIG}", 120_000_000)
    used = _blob(tmp_path, f"sha256-{USED}", 40)
    stranger = _blob(tmp_path, f"sha256-{OTHER}", 10)
    _manifest(tmp_path, USED)
    sent: list[BaseModel] = []
    manager = _manager(FakeOllama(pull=_lines(_stream())), sent, tmp_path)
    ref, _ = await manager.start(NAME)
    await _until_done(manager, ref)
    assert manager.cleanup(NAME) == (REF, 0.12)
    assert not big.exists()
    assert used.exists() and stranger.exists()


async def test_a_new_pull_forgets_the_list_and_a_stop_leaves_none(tmp_path: Path) -> None:
    big = _blob(tmp_path, f"sha256-{BIG}", 120_000_000)
    sent: list[BaseModel] = []
    fake = FakeOllama(pull=_lines(_stream()))
    manager = _manager(fake, sent, tmp_path)
    ref, _ = await manager.start(NAME)
    await _until_done(manager, ref)
    fake.pull = _lines([{"status": "pulling manifest"}, {"status": "success"}])
    await manager.start(NAME)
    await _until_done(manager, ref)
    assert manager.cleanup(NAME) == (REF, 0.0)
    assert big.exists()


async def test_cleanup_over_the_socket(short_home: Path) -> None:
    models = short_home / "models"
    part = _blob(models, f"sha256-{BIG}", 120_000_000)
    transport = httpx.MockTransport(FakeOllama(pull=_lines(_stream())))
    app, task = await start_daemon(
        short_home,
        router=ModelRouter(GolemSettings()),
        pulls=lambda routed, ram: PullManager(
            routed, transport=transport, ram_gb=ram, models_dir=models, clock=lambda: 0.0
        ),
    )
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        started = rpc_result(await client.call("model.pull", {"name": NAME}))
        assert started["ref"] == REF
        pulls = app.state.pulls
        assert pulls is not None
        for _ in range(200):
            if REF not in pulls.pulling():
                break
            await asyncio.sleep(0.01)
        freed = rpc_result(await client.call("model.pull_cleanup", {"ref": REF}))
        assert freed == {"ref": REF, "freed_gb": 0.12}
        assert not part.exists()
    finally:
        await client.close()
        await stop_daemon(app, task)
