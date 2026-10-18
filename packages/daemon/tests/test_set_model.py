"""``session.set_model``, ``model.selected``, and ``model.set_default``."""

from __future__ import annotations

import sqlite3
import tomllib
from pathlib import Path
from typing import cast

from fakes import ScriptedChatModel
from langchain_core.language_models import BaseChatModel
from test_server import HELLO, RpcClient, error_code, rpc_result, start_daemon, stop_daemon

from golem.config import GolemSettings, ModelSettings, load_settings
from golem.config_edit import set_default_model
from golem.models.router import ModelConfigError, ModelRouter
from golem.server.dispatcher import MODEL_NOT_CONFIGURED, SESSION_NOT_FOUND


class _TwoModels(ModelRouter):
    """Real name resolution, scripted chat models."""

    def __init__(self, settings: GolemSettings, models: dict[str, BaseChatModel]) -> None:
        super().__init__(settings)
        self.models = models

    def chat_model(self, profile: str) -> BaseChatModel:
        ref = self.resolve(profile).ref
        model = self.models.get(ref)
        if model is None:
            raise ModelConfigError(f"needs key: /login {ref.partition('/')[0]}")
        return model


SETTINGS = GolemSettings(
    default_model="local",
    models={
        "local": ModelSettings(model="ollama/qwen3:8b"),
        "remote": ModelSettings(model="anthropic/claude-test"),
    },
)


def _record(value: object) -> dict[str, object]:
    assert isinstance(value, dict)
    return cast(dict[str, object], value)


async def _open(client: RpcClient) -> str:
    created = rpc_result(await client.call("session.create", {}))
    session_id = cast(str, created["session_id"])
    rpc_result(await client.call("session.attach", {"session_id": session_id, "after_seq": 0}))
    return session_id


async def _say(client: RpcClient, session_id: str, text: str) -> None:
    client.events[:] = [event for event in client.events if _type(event) != "run.completed"]
    rpc_result(await client.call("message.send", {"session_id": session_id, "text": text}))
    await client.wait_for_event("run.completed")


def _type(event: dict[str, object]) -> object:
    params: object = event.get("params")
    return _record(params).get("type") if params is not None else None


async def test_switching_models_mid_session_keeps_one_conversation(short_home: Path) -> None:
    local = ScriptedChatModel(replies=["from local"])
    remote = ScriptedChatModel(replies=["from remote"])
    router = _TwoModels(SETTINGS, {"ollama/qwen3:8b": local, "anthropic/claude-test": remote})
    app, task = await start_daemon(short_home, router=router)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        session_id = await _open(client)
        await _say(client, session_id, "first")
        switched = rpc_result(
            await client.call("session.set_model", {"session_id": session_id, "model": "remote"})
        )
        assert switched == {
            "session_id": session_id,
            "model_profile": "remote",
            "model_provider": "anthropic",
            "model_name": "claude-test",
        }
        selected = await client.wait_for_event("model.selected")
        data = _record(_record(selected["params"])["data"])
        assert data == {
            "model_profile": "remote",
            "model_provider": "anthropic",
            "model_name": "claude-test",
            "reason": "user",
        }
        await _say(client, session_id, "second")
        assert remote.seen == [["first", "from local", "second"]]
        assert len(local.seen) == 1
    finally:
        await client.close()
        await stop_daemon(app, task)
    with sqlite3.connect(app.paths.database_file) as db:
        row = db.execute(
            "SELECT model_profile FROM sessions WHERE session_id = ?", (session_id,)
        ).fetchone()
    assert row == ("remote",)


async def test_the_switch_survives_a_restart(short_home: Path) -> None:
    router = _TwoModels(
        SETTINGS,
        {
            "ollama/qwen3:8b": ScriptedChatModel(replies=[]),
            "anthropic/claude-test": ScriptedChatModel(replies=["after restart"]),
        },
    )
    app, task = await start_daemon(short_home, router=router)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        session_id = await _open(client)
        rpc_result(
            await client.call("session.set_model", {"session_id": session_id, "model": "remote"})
        )
    finally:
        await client.close()
        await stop_daemon(app, task)
    app, task = await start_daemon(short_home, router=router)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        rpc_result(await client.call("session.attach", {"session_id": session_id, "after_seq": 0}))
        await _say(client, session_id, "hi")
        texts = [
            _record(_record(e["params"])["data"]).get("text")
            for e in client.events
            if _type(e) == "message.completed"
        ]
        assert "after restart" in texts
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_a_model_that_cannot_run_is_refused(short_home: Path) -> None:
    router = _TwoModels(SETTINGS, {"ollama/qwen3:8b": ScriptedChatModel(replies=[])})
    app, task = await start_daemon(short_home, router=router)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        session_id = await _open(client)
        for model in ("remote", "nowhere", "nobody/model"):
            failed = await client.call(
                "session.set_model", {"session_id": session_id, "model": model}
            )
            assert error_code(failed) == MODEL_NOT_CONFIGURED
        missing = await client.call(
            "session.set_model", {"session_id": "s_missing", "model": "local"}
        )
        assert error_code(missing) == SESSION_NOT_FOUND
        assert "model.selected" not in [_type(e) for e in client.events]
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_choosing_the_current_model_stores_nothing(short_home: Path) -> None:
    router = _TwoModels(SETTINGS, {"ollama/qwen3:8b": ScriptedChatModel(replies=[])})
    app, task = await start_daemon(short_home, router=router)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        session_id = await _open(client)
        rpc_result(
            await client.call("session.set_model", {"session_id": session_id, "model": "local"})
        )
        assert "model.selected" not in [_type(e) for e in client.events]
    finally:
        await client.close()
        await stop_daemon(app, task)


async def test_set_default_writes_config_and_new_sessions_use_it(short_home: Path) -> None:
    config = short_home / "config.toml"
    config.write_text('# mine\n[models.local]\nmodel = "ollama/qwen3:8b"  # keep\n', "utf-8")
    settings = load_settings(home=short_home, project_dir=short_home)
    router = ModelRouter(settings, home=short_home)
    app, task = await start_daemon(short_home, router=router)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        stored = rpc_result(await client.call("model.set_default", {"model": "local"}))
        assert stored == {"default": "local"}
        text = config.read_text("utf-8")
        assert "# mine" in text and "# keep" in text
        assert tomllib.loads(text)["default_model"] == "local"
        status = rpc_result(await client.call("daemon.status"))
        assert status["model_profile"] == "local"
        assert status["model_name"] == "qwen3:8b"
        failed = await client.call("model.set_default", {"model": "nowhere"})
        assert error_code(failed) == MODEL_NOT_CONFIGURED
        assert tomllib.loads(config.read_text("utf-8"))["default_model"] == "local"
    finally:
        await client.close()
        await stop_daemon(app, task)


def test_set_default_model_creates_and_updates_the_file(tmp_path: Path) -> None:
    config = tmp_path / "home" / "config.toml"
    set_default_model(config, "ollama/qwen3:8b")
    assert tomllib.loads(config.read_text("utf-8")) == {"default_model": "ollama/qwen3:8b"}
    config.write_text(config.read_text("utf-8") + '\n[models.x]\nmodel = "a/b"\n', "utf-8")
    config.chmod(0o600)
    set_default_model(config, "x")
    parsed = tomllib.loads(config.read_text("utf-8"))
    assert parsed["default_model"] == "x"
    assert parsed["models"] == {"x": {"model": "a/b"}}
    assert config.stat().st_mode & 0o777 == 0o600
