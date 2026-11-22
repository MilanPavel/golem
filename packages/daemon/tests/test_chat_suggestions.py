"""``chat.suggestions``: instruction lines suggested from your chats and memory."""

# pyright: reportPrivateUsage=false
from __future__ import annotations

import json
from collections.abc import AsyncIterator, Mapping
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fakes import ScriptedChatModel
from langchain_core.language_models import BaseChatModel
from test_server import HELLO, RpcClient, rpc_result, start_daemon, stop_daemon

from golem.config import GolemSettings
from golem.models.router import ModelRouter
from golem.sessions.drafts import ModelDrafts
from golem.sessions.suggestions import ChatSuggestions, parse_suggestions
from golem.store.database import Database
from golem.store.suggestions import SuggestionStore

NOW = datetime(2026, 11, 22, 12, 0, tzinfo=UTC)
REPLY = json.dumps(
    [
        {
            "line": "Keep answers short.",
            "reason": "You said “shorter” in 4 chats.",
            "source": "chats",
        },
        {
            "line": "Use bullet points.",
            "reason": "From memory: “Prefers bullets.”",
            "source": "memory",
        },
        {"line": "Be warm.", "reason": "You said “warmer” twice.", "source": "chats"},
    ]
)


class _Router(ModelRouter):
    def __init__(self, settings: GolemSettings, model: ScriptedChatModel) -> None:
        super().__init__(settings)
        self.fake = model
        self.asked_local_only: list[bool] = []

    def chat_model(
        self,
        profile: str,
        overrides: Mapping[str, float | str] | None = None,
        *,
        local_only: bool = False,
    ) -> BaseChatModel:
        self.asked_local_only.append(local_only)
        if local_only:
            self.ensure_local(profile)
        return self.fake


def _drafts(model: ScriptedChatModel, default: str) -> tuple[ModelDrafts, _Router]:
    router = _Router(GolemSettings.model_validate({"default_model": default}), model)
    drafts = ModelDrafts(router)
    drafts.bind(lambda ref: "local" if ref.startswith("ollama/") else "frontier", list)
    return drafts, router


class _Clock:
    def __init__(self) -> None:
        self.now = NOW

    def __call__(self) -> datetime:
        return self.now


@pytest.fixture
async def store(tmp_path: Path) -> AsyncIterator[SuggestionStore]:
    async with Database.open(tmp_path / "g.db") as database:
        async with database.transaction() as tx:
            await tx.execute(
                "INSERT INTO sessions (session_id, model_profile, created_at, updated_at)"
                " VALUES ('s1', 'm', ?, ?)",
                (NOW.isoformat(), NOW.isoformat()),
            )
            for seq, text in enumerate(["shorter please", "x" * 201, "tl;dr"], start=1):
                await tx.execute(
                    "INSERT INTO events (session_id, seq, ts, type, message_id, data)"
                    " VALUES ('s1', ?, ?, 'message.completed', ?, ?)",
                    (
                        seq,
                        (NOW - timedelta(days=1)).isoformat(),
                        f"m{seq}",
                        json.dumps({"message_id": f"m{seq}", "role": "user", "text": text}),
                    ),
                )
        yield SuggestionStore(database)


async def _lines() -> list[str]:
    return ["be  WARM."]


def test_the_reply_keeps_valid_entries_and_at_most_five() -> None:
    reply = json.dumps(
        [{"line": f"l{n}", "reason": "r", "source": "chats"} for n in range(7)]
        + [{"line": "no source", "reason": "r"}]
    )
    assert len(parse_suggestions(f"Here you go: {reply}")) == 5
    assert parse_suggestions("nothing") == []


async def test_suggestions_come_with_reasons_and_existing_and_dismissed_lines_are_left_out(
    store: SuggestionStore,
) -> None:
    model = ScriptedChatModel(replies=[REPLY])
    drafts, router = _drafts(model, "ollama/qwen")
    service = ChatSuggestions(drafts, store, _lines, clock=_Clock())
    first = await service.get()
    assert first.suggestions == [] and first.updated is None and not first.needs_local_model
    await service.idle()
    got = await service.get()
    assert [s.line for s in got.suggestions] == ["Keep answers short.", "Use bullet points."]
    assert got.suggestions[0].reason.startswith("You said")
    assert got.suggestions[1].source == "memory"
    assert got.updated == NOW.isoformat()
    prompt = model.seen[0][1]
    assert "shorter please" in prompt and "tl;dr" in prompt and "xxxx" not in prompt
    assert router.asked_local_only == [True]
    await service.dismiss("keep ANSWERS short.")
    again = await service.get()
    assert [s.line for s in again.suggestions] == ["Use bullet points."]
    await service.idle()
    assert len(model.seen) == 1


async def test_a_second_call_within_a_day_does_not_run_the_job_and_a_day_later_does(
    store: SuggestionStore,
) -> None:
    model = ScriptedChatModel(replies=[REPLY, REPLY])
    drafts, _router = _drafts(model, "ollama/qwen")
    clock = _Clock()
    service = ChatSuggestions(drafts, store, _lines, clock=clock)
    await service.get()
    await service.idle()
    clock.now = NOW + timedelta(hours=23)
    await service.get()
    await service.idle()
    assert len(model.seen) == 1
    clock.now = NOW + timedelta(hours=25)
    answer = await service.get()
    assert answer.suggestions
    await service.idle()
    assert len(model.seen) == 2


async def test_without_a_local_model_there_are_no_suggestions_and_no_model_call(
    store: SuggestionStore,
) -> None:
    model = ScriptedChatModel(replies=[REPLY])
    drafts, router = _drafts(model, "openai/gpt-5")
    service = ChatSuggestions(drafts, store, _lines, clock=_Clock())
    got = await service.get()
    await service.idle()
    assert got.needs_local_model and got.suggestions == []
    assert model.seen == [] and router.asked_local_only == []


async def test_an_unusable_reply_keeps_an_empty_result_for_the_day(store: SuggestionStore) -> None:
    model = ScriptedChatModel(replies=["not json", REPLY])
    drafts, _router = _drafts(model, "ollama/qwen")
    clock = _Clock()
    service = ChatSuggestions(drafts, store, _lines, clock=clock)
    await service.get()
    await service.idle()
    got = await service.get()
    assert got.updated == NOW.isoformat() and got.suggestions == []
    await service.idle()
    assert len(model.seen) == 1


async def test_the_rpc_returns_what_is_kept_and_dismiss_is_saved(short_home: Path) -> None:
    router = ModelRouter(model=ScriptedChatModel(replies=["done"]))
    app, task = await start_daemon(short_home, router=router)
    client = await RpcClient.connect(app.paths.socket_path)
    try:
        await client.call("hello", HELLO)
        got = rpc_result(await client.call("chat.suggestions", {}))
        assert got == {"suggestions": [], "updated": None, "needs_local_model": True}
        done = rpc_result(await client.call("chat.suggestion_dismiss", {"line": "Be warm."}))
        assert done == {"ok": True}
        assert app.state.suggestions is not None
        assert await app.state.suggestions._store.dismissed() == {"be warm."}
    finally:
        await client.close()
        await stop_daemon(app, task)
