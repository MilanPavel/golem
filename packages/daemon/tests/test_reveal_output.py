"""Show in Finder for a file a run marked with ``run.output`` (3.13.6, #1929).

``fs.reveal`` takes the run and the output; Finder is never opened, `open` is stubbed."""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from test_server import HELLO, RpcClient, error_code, rpc_result, start_daemon, stop_daemon

from golem.secrets import MemorySecrets
from golem.server.dispatcher import INVALID_PARAMS


def _as_platform(monkeypatch: pytest.MonkeyPatch, platform: str) -> None:
    monkeypatch.setattr("golem.folders.sys", SimpleNamespace(platform=platform))


def _stub_open(monkeypatch: pytest.MonkeyPatch, code: int = 0) -> list[str]:
    opened: list[str] = []

    async def fake(path: str, *, select: bool = False) -> int:
        opened.append(f"-R {path}" if select else path)
        return code

    monkeypatch.setattr("golem.folders._run_open", fake)
    return opened


async def test_reveal_shows_a_file_a_run_marked_and_refuses_any_other(
    short_home: Path, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    fake_home = (tmp_path / "me").resolve()
    (fake_home / "briefings").mkdir(parents=True)
    (fake_home / ".golem").mkdir()
    marked = fake_home / "briefings" / "today.md"
    marked.write_text("x")
    unmarked = fake_home / "briefings" / "other.md"
    unmarked.write_text("x")
    private = fake_home / ".golem" / "secret.md"
    private.write_text("x")
    monkeypatch.setattr(Path, "home", lambda: fake_home)
    _as_platform(monkeypatch, "darwin")
    opened = _stub_open(monkeypatch)
    app, task = await start_daemon(short_home, secrets=MemorySecrets())
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        workflows = app.state.workflows
        assert workflows is not None
        run_id = await workflows.runs.create_run("w", "flow", "/w.py", "2026-11-27T08:00:00+00:00")
        for position, value in enumerate([str(marked), "just text", str(private)]):
            await workflows.runs.add_output(run_id, position, None, json.dumps(value), None)

        async def reveal(
            path: str, index: int | None = 0, run: str | None = run_id
        ) -> dict[str, object]:
            params: dict[str, object] = {"path": path}
            if run is not None:
                params["workflow_run_id"] = run
            if index is not None:
                params["output_index"] = index
            return await client.call("fs.reveal", params)

        assert rpc_result(await reveal(str(marked))) == {}
        assert opened == [f"-R {marked}"]
        # Refused: an unmarked path, a value that is no path, a private folder, unknown ids.
        assert error_code(await reveal(str(unmarked))) == INVALID_PARAMS
        assert error_code(await reveal("just text", 1)) == INVALID_PARAMS
        assert error_code(await reveal(str(private), 2)) == INVALID_PARAMS
        assert error_code(await reveal(str(marked), 9)) == INVALID_PARAMS
        assert error_code(await reveal(str(marked), 0, "wr_nope")) == INVALID_PARAMS
        assert error_code(await reveal(str(marked), None)) == INVALID_PARAMS
        # Without the run, the file is refused as before.
        assert error_code(await client.call("fs.reveal", {"path": str(marked)})) == INVALID_PARAMS
        assert opened == [f"-R {marked}"]
    finally:
        await client.close()
        await stop_daemon(app, task)
