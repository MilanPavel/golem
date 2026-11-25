"""The estimate before a large batch of helpers (ADR-059, section 5; step 15.6.5, #1337).

The estimate itself is pure and tested alone. The decision is tested through a lead that
delegates: a small batch starts at once, a large one parks the lead on "start these helpers?"
with the estimate on it, and the three answers do what they say. Each is checked for a setup
with local models only and one with cloud models only, and for a mixed one, where the paid
question comes instead of the estimate.
"""

# pyright: reportPrivateUsage=false
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
from fakes import FixedFacts, model_facts
from test_helper_policy_setting import (  # pyright: ignore
    DECLINED,
    LOCAL,
    _asked,
    _Chat,
    _helper_ids,
    _result,
    _settled,  # noqa: F401  # pyright: ignore[reportUnusedImport]
    _Setup,
    _types,
)

from golem.config import AgentSettings, GolemSettings, ModelPrice, RoleSettings, RoutingSettings
from golem.sessions.helper_estimate import (
    ANSWER_TOKENS,
    DEFAULT_READ_TOKENS,
    HelperPlan,
    estimate_batch,
)
from golem.store.database import Database
from golem_protocol.events import ApprovalNeededEvent, HelperStartedEvent


@pytest.fixture
def project(tmp_path: Path) -> Path:
    root = tmp_path / "project"
    root.mkdir()
    (root / "a.py").write_text("def a():\n    return 1\n", encoding="utf-8")
    return root


PRICE = ModelPrice(input=3.0, output=15.0)
BIG = "anthropic/big"
CHEAP = "deepseek/chat"
CLOUD = _Setup(True)
NAMED_BIG = ("delegate", {"agent": "explorer", "brief": "look", "model": BIG})
PLAIN = ("delegate", {"agent": "explorer", "brief": "look"})


def _plan(read: int | None, *, price: ModelPrice | None = PRICE, local: bool = False) -> HelperPlan:
    return HelperPlan(
        model="m", brief="x" * 400, local=local, price=price, max_tokens=read
    )  # the brief is 100 tokens


# --- the estimate alone -------------------------------------------------------------------------


def test_45_cents_against_a_50_cent_limit_starts_and_60_cents_asks() -> None:
    # 100 brief tokens + 142_400 read at $3 per million, and 1_500 answer tokens at $15: $0.45.
    small = estimate_batch([_plan(142_400)])
    assert small is not None
    assert small.total_usd == pytest.approx(0.45)
    assert not small.over(0.5)
    # 192_400 read tokens: $0.60.
    large = estimate_batch([_plan(192_400)])
    assert large is not None
    assert large.total_usd == pytest.approx(0.60)
    assert large.over(0.5)


def test_a_batch_is_the_sum_of_its_helpers_and_names_the_first_model() -> None:
    first = HelperPlan("a", "x" * 400, False, PRICE, 10_000)
    second = HelperPlan("b", "x" * 400, False, PRICE, 10_000)
    both = estimate_batch([first, second])
    single = estimate_batch([first])
    assert both is not None and single is not None
    assert both.total_usd == pytest.approx(2 * single.total_usd)
    assert both.model == "a"
    assert [part.model for part in both.parts] == ["a", "b"]


def test_without_max_tokens_a_helper_reads_the_default_budget() -> None:
    plan = _plan(None)
    estimate = estimate_batch([plan])
    assert estimate is not None
    assert estimate.parts[0].tokens_in == 100 + DEFAULT_READ_TOKENS
    assert estimate.parts[0].tokens_out == ANSWER_TOKENS


def test_a_local_batch_has_no_estimate_and_no_price_is_read() -> None:
    assert estimate_batch([_plan(10_000_000, price=None, local=True)]) is None
    assert estimate_batch([]) is None


def test_a_local_helper_costs_nothing_in_a_mixed_batch() -> None:
    mixed = estimate_batch([_plan(10_000_000, local=True), _plan(1_000)])
    alone = estimate_batch([_plan(1_000)])
    assert mixed is not None and alone is not None
    assert mixed.total_usd == alone.total_usd
    assert mixed.parts[0].usd == 0.0


def test_a_paid_model_without_a_price_is_unknown_so_nothing_is_asked() -> None:
    assert estimate_batch([_plan(10_000_000, price=None)]) is None
    assert estimate_batch([_plan(1_000), _plan(1_000, price=None)]) is None


# --- through a lead -----------------------------------------------------------------------------

# deepseek/chat is $0.5 per million in and out: (1 brief token + N + 1_500) x 0.5 / 1e6.
SMALL_N = 898_499  # 900_000 tokens: $0.45
LARGE_N = 1_198_499  # 1_200_000 tokens: $0.60
# anthropic/big is $5: 120_000 tokens is $0.60.
BIG_N = 118_499


def _agents(read: int, over: float = 0.5) -> dict[str, Any]:
    return {"max_tokens": read, "estimate_over": over}


async def _needed(chat: _Chat, lead: str) -> ApprovalNeededEvent:
    events = await chat.until(lead, "approval.needed")
    return next(e for e in events if isinstance(e, ApprovalNeededEvent))


async def test_cloud_45_cents_against_a_50_cent_limit_starts_at_once(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _Chat(
        database,
        [[PLAIN], "found", "done"],
        project,
        tmp_path,
        setup=CLOUD,
        agents_extra=_agents(SMALL_N),
    )
    lead, run_id = await chat.start()
    events = await chat.finished(run_id)

    assert "approval.needed" not in _types(events)
    assert len(_helper_ids(await chat.stored(lead))) == 1
    assert _result(events) == "found"


async def test_cloud_60_cents_against_a_50_cent_limit_asks_with_the_whole_estimate(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _Chat(
        database,
        [[PLAIN], "found", "done"],
        project,
        tmp_path,
        setup=CLOUD,
        agents_extra=_agents(LARGE_N),
    )
    lead, run_id = await chat.start()
    call_id = await _asked(chat, lead)

    assert _helper_ids(await chat.stored(lead)) == []  # nothing started before the answer
    needed = await _needed(chat, lead)
    assert needed.data.estimate_usd == pytest.approx(0.6)
    assert needed.data.allowed_usd == 1.0
    assert needed.data.ask_over_usd == 0.5
    assert needed.data.model == CHEAP
    assert needed.data.cheaper_model is None  # it is the cheapest already
    row = await chat.summary(lead)
    (item,) = row.pending_items
    assert (item.kind, item.call_id, item.helper_count) == ("batch", call_id, 1)
    assert item.estimate_usd == pytest.approx(0.6)
    assert (item.allowed_usd, item.ask_over_usd, item.model) == (1.0, 0.5, CHEAP)
    assert item.cheaper_model is None

    assert await chat.manager.respond_helpers(lead, call_id, True) == run_id
    events = await chat.finished(run_id)
    assert _result(events) == "found"
    assert len(_helper_ids(await chat.stored(lead))) == 1


async def test_cloud_a_cheaper_model_starts_every_helper_on_it(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _Chat(
        database,
        [[NAMED_BIG], "found", "done"],
        project,
        tmp_path,
        setup=CLOUD,
        agents_extra=_agents(BIG_N),
    )
    lead, run_id = await chat.start()
    call_id = await _asked(chat, lead)
    needed = await _needed(chat, lead)
    assert needed.data.estimate_usd == pytest.approx(0.6)
    assert (needed.data.model, needed.data.cheaper_model) == (BIG, CHEAP)

    await chat.manager.respond_helpers(lead, call_id, True, cheaper=True)
    events = await chat.finished(run_id)
    started = [e for e in await chat.stored(lead) if isinstance(e, HelperStartedEvent)]
    assert [e.data.model for e in started] == [CHEAP]
    assert _result(events) == "found"


async def test_cloud_start_runs_on_the_planned_model(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _Chat(
        database,
        [[NAMED_BIG], "found", "done"],
        project,
        tmp_path,
        setup=CLOUD,
        agents_extra=_agents(BIG_N),
    )
    lead, run_id = await chat.start()
    call_id = await _asked(chat, lead)
    await chat.manager.respond_helpers(lead, call_id, True)
    await chat.finished(run_id)
    started = [e for e in await chat.stored(lead) if isinstance(e, HelperStartedEvent)]
    assert [e.data.model for e in started] == [BIG]


async def test_cloud_do_it_in_the_chat_tells_the_model_and_starts_nothing(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _Chat(
        database,
        [[PLAIN], "I read it myself."],
        project,
        tmp_path,
        setup=CLOUD,
        agents_extra=_agents(LARGE_N),
    )
    lead, run_id = await chat.start()
    call_id = await _asked(chat, lead)

    await chat.manager.respond_helpers(lead, call_id, False)
    events = await chat.finished(run_id)

    assert _helper_ids(await chat.stored(lead)) == []
    assert DECLINED in _result(events)


async def test_ask_first_with_a_small_cloud_batch_shows_the_estimate_too(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _Chat(
        database,
        [[PLAIN], "found", "done"],
        project,
        tmp_path,
        setup=CLOUD,
        use_helpers="ask",
        agents_extra=_agents(SMALL_N),
    )
    lead, _run = await chat.start()
    await _asked(chat, lead)
    needed = await _needed(chat, lead)
    assert needed.data.estimate_usd == pytest.approx(0.45)


async def test_local_only_has_no_estimate_no_price_and_no_question(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _Chat(
        database,
        [[PLAIN], "found", "done"],
        project,
        tmp_path,
        setup=LOCAL,
        agents_extra={"max_tokens": 10_000_000, "estimate_over": 0.0},
    )
    chat.manager.facts = FixedFacts(
        model_facts("ollama/qwen3:8b", "local"), model_facts("ollama/gemma3:12b", "local")
    )
    lead, run_id = await chat.start()
    events = await chat.finished(run_id)

    assert "approval.needed" not in _types(events)
    assert len(_helper_ids(await chat.stored(lead))) == 1


@dataclass(frozen=True, slots=True)
class _Mixed(_Setup):
    """A local lead in a folder that may use hosted models, with a hosted model to wish for."""

    def settings(self, project: Path, agents: AgentSettings) -> GolemSettings:
        del project
        return GolemSettings(
            default_model="ollama/qwen3:8b",
            routing=RoutingSettings(roles=RoleSettings(explore=BIG)),
            agents=agents,
        )


async def test_mixed_asks_the_paid_question_and_not_the_estimate(
    database: Database, project: Path, tmp_path: Path
) -> None:
    chat = _Chat(
        database,
        [[NAMED_BIG], "found", "done"],
        project,
        tmp_path,
        setup=_Mixed(False),
        agents_extra=_agents(LARGE_N * 4),
    )
    chat.manager.facts = FixedFacts(
        model_facts("ollama/qwen3:8b", "local"),
        model_facts(CHEAP, "budget", price=0.5),
        model_facts(BIG, "frontier", price=5.0),
    )
    lead, _run = await chat.start()
    stored = await chat.until(lead, "helper.started")
    (helper,) = _helper_ids(stored)
    await chat.until(helper, "route.consent.needed")  # the helper's own paid question

    assert "approval.needed" not in _types(await chat.stored(lead))  # no estimate on top of it
