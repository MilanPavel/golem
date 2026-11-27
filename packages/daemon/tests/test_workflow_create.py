"""A new workflow from scratch: the skeleton, a starter's text and a draft (3.13.12, #1935)."""

# pyright: reportPrivateUsage=false
from __future__ import annotations

import json
from collections.abc import AsyncIterator
from pathlib import Path
from types import SimpleNamespace
from typing import Any, cast

import pytest

from golem.server.dispatcher import RequestContext, RpcCallError
from golem.server.workflows import workflow_create, workflow_draft
from golem.store.database import Database
from golem.store.workflow_runs import WorkflowRuns
from golem.workflows.check import check
from golem.workflows.create import CreateError, Named, file_name, skeleton, suggest_free
from golem.workflows.llm import LlmAnswer
from golem.workflows.outline import outline
from golem.workflows.propose import ProposeError, build_draft_prompt, draft
from golem.workflows.service import WorkflowService
from golem.workflows.starter import SOURCE
from golem_protocol.commands import WorkflowCreateParams, WorkflowDraftParams

DRAFT = """from golem.workflow import Run, workflow


def read(path: str) -> str:
    return path


@workflow(title="Weekly invoices", description="Add up invoices.")
async def invoice_report(run: Run) -> str:
    text = await run.step("Read the files", read, "a.csv", item="a.csv")
    await run.output(text, title="Totals")
    return text
"""


class Fake:
    def __init__(self, text: str) -> None:
        self.text = text
        self.asked: list[tuple[str, str | None]] = []

    async def __call__(
        self, prompt: str, schema: dict[str, Any] | None, wish: str | None, folder: str | None
    ) -> LlmAnswer:
        del schema, folder
        self.asked.append((prompt, wish))
        return LlmAnswer(self.text, "fake/model", None)


def reply(code: str) -> str:
    return json.dumps({"kind": "change", "code": code, "note": "Reads, then adds up."})


@pytest.fixture
async def store(tmp_path: Path) -> AsyncIterator[WorkflowRuns]:
    async with Database.open(tmp_path / "golem.db") as db:
        yield WorkflowRuns(db)


def service_of(
    store: WorkflowRuns, tmp_path: Path, llm: Fake | None = None, trusted: Path | None = None
) -> WorkflowService:
    return WorkflowService(
        runs=store,
        user_dir=tmp_path / "user",
        user_file=tmp_path / "config.toml",
        trusted=lambda p: p == trusted,
        broadcast=lambda _m: None,
        llm=llm,
    )


def test_a_typed_name_becomes_a_file_name_and_a_title() -> None:
    assert file_name("Weekly invoices") == Named("weekly_invoices", "Weekly invoices")
    assert file_name("weekly_invoices") == Named("weekly_invoices", "Weekly invoices")
    assert file_name("  Check my sites -- now! ") == Named(
        "check_my_sites_now", "Check my sites -- now!"
    )


@pytest.mark.parametrize("bad", ["", "   ", "123 go", "!!!", "class", "x" * 61, "日本語"])
def test_a_name_that_cannot_be_a_file_name_is_refused_with_a_reason(bad: str) -> None:
    with pytest.raises(CreateError):
        file_name(bad)


def test_a_free_name_gets_the_next_number() -> None:
    assert suggest_free("a", ["a", "a_2"]) == "a_3"
    assert suggest_free("a", []) == "a_2"


def test_the_skeleton_has_two_steps_a_title_and_a_result_and_checks_clean() -> None:
    text = skeleton(file_name("Weekly invoices"))
    assert check(text) == []
    (found,) = outline(text)
    assert found.name == "weekly_invoices" and [s.title for s in found.steps][:2] == [
        "Gather what it works on",
        "Make the result",
    ]
    assert 'title="Weekly invoices"' in text and "run.output(" in text
    assert "trigger=" not in text and "model=" not in text


def test_a_title_with_a_quote_still_makes_a_file_that_reads() -> None:
    text = skeleton(Named("quoted", 'Say "hi"'))
    compile(text, "x", "exec")
    assert check(text) == []


async def test_an_empty_file_is_created_loaded_and_listed(
    store: WorkflowRuns, tmp_path: Path
) -> None:
    service = service_of(store, tmp_path)
    entry, named = await service.create("Weekly invoices", None, None)
    assert named.file == "weekly_invoices"
    assert entry.state == "ok" and entry.project is None and entry.name == "weekly_invoices"
    assert entry.path == tmp_path / "user" / "weekly_invoices.py"
    assert entry.spec is not None and entry.spec.title == "Weekly invoices"
    assert [e.name for e in service.registry.entries()] == ["weekly_invoices"]


async def test_a_taken_name_is_refused_with_its_path_and_a_free_name(
    store: WorkflowRuns, tmp_path: Path
) -> None:
    service = service_of(store, tmp_path)
    first, _ = await service.create("Weekly invoices", None, None)
    before = first.path.read_bytes()
    with pytest.raises(CreateError) as seen:
        await service.create("weekly_invoices", None, DRAFT)
    assert str(first.path) in str(seen.value) and "exists already" in str(seen.value)
    assert "weekly_invoices_2" in str(seen.value)
    assert first.path.read_bytes() == before


async def test_a_function_name_used_in_another_file_is_refused(
    store: WorkflowRuns, tmp_path: Path
) -> None:
    service = service_of(store, tmp_path)
    await service.create("Invoice report", None, DRAFT)
    with pytest.raises(CreateError, match="invoice_report exists already here"):
        await service.create("Other file", None, DRAFT)
    assert not (tmp_path / "user" / "other_file.py").exists()


async def test_code_the_check_refuses_is_not_written(store: WorkflowRuns, tmp_path: Path) -> None:
    service = service_of(store, tmp_path)
    bad = DRAFT.replace('await run.output(text, title="Totals")', "await run.fly(text)")
    with pytest.raises(CreateError, match="not created: line"):
        await service.create("Flies", None, bad)
    with pytest.raises(CreateError, match="no @workflow"):
        await service.create("Nothing", None, "x = 1\n")
    assert not list((tmp_path / "user").glob("*.py"))


async def test_a_starters_text_is_created_under_a_new_name(
    store: WorkflowRuns, tmp_path: Path
) -> None:
    service = service_of(store, tmp_path)
    text = (SOURCE / "morning_briefing.py").read_text(encoding="utf-8")
    entry, _ = await service.create("My briefing", None, text)
    assert entry.state == "ok" and entry.path.name == "my_briefing.py"
    assert entry.name == "morning_briefing"


async def test_a_trusted_project_gets_the_file_in_its_workflows_folder(
    store: WorkflowRuns, tmp_path: Path
) -> None:
    project = tmp_path / "proj"
    project.mkdir()
    service = service_of(store, tmp_path, trusted=project)
    entry, _ = await service.create("Project flow", project, None)
    assert entry.project == project and entry.path == project / "workflows" / "project_flow.py"
    assert entry.state == "ok"


async def test_an_untrusted_folder_is_refused_with_the_reason(
    store: WorkflowRuns, tmp_path: Path
) -> None:
    service = service_of(store, tmp_path)
    other = tmp_path / "other"
    other.mkdir()
    with pytest.raises(CreateError, match="not trusted"):
        await service.create("Nope", other, None)
    assert not (other / "workflows").exists()


async def test_a_draft_is_one_call_named_and_checked_and_not_saved(
    store: WorkflowRuns, tmp_path: Path
) -> None:
    llm = Fake(reply(DRAFT))
    service = service_of(store, tmp_path, llm)
    made = await service.draft_code("Weekly invoices", "add up my invoices", None, None)
    assert len(llm.asked) == 1 and llm.asked[0][1] is None  # golem's default model
    assert made.model == "fake/model" and made.problems == []
    # The function is called what the name says, so the file and the function agree.
    assert "async def weekly_invoices(" in made.code and "invoice_report" not in made.code
    assert "model=" not in made.code and "trigger=" not in made.code
    assert not (tmp_path / "user").exists()


async def test_a_picked_model_writes_the_draft_and_is_its_model() -> None:
    llm = Fake(reply(DRAFT))
    made = await draft(
        llm=llm,
        folder=None,
        ask="add up invoices",
        function="weekly_invoices",
        title="Weekly invoices",
        check=lambda text: check(text),
        model="work-model",
    )
    assert llm.asked[0][1] == "work-model"
    assert (
        '@workflow(title="Weekly invoices", description="Add up invoices.", model="work-model")'
        in made.code
    )
    assert 'model="work-model"' in llm.asked[0][0]


async def test_a_model_the_model_wrote_is_removed_when_none_was_picked() -> None:
    wished = DRAFT.replace('description="Add up invoices."', 'description="x", model="stronger"')
    made = await draft(
        llm=Fake(reply(wished)),
        folder=None,
        ask="x",
        function="invoice_report",
        title="T",
        check=lambda text: check(text),
    )
    assert "model=" not in made.code


async def test_a_draft_that_is_no_workflow_or_no_ask_is_an_error() -> None:
    for text in ('{"kind": "answer", "answer": "no"}', '{"note": "n"}', "[]", "not json"):
        with pytest.raises(ProposeError):
            await draft(
                llm=Fake(text),
                folder=None,
                ask="x",
                function="f",
                title="F",
                check=lambda t: check(t),
            )
    with pytest.raises(ProposeError, match="say what"):
        await draft(llm=Fake("{}"), folder=None, ask=" ", function="f", title="F", check=check)
    with pytest.raises(ProposeError, match="no model"):
        await draft(llm=None, folder=None, ask="x", function="f", title="F", check=check)


def test_the_draft_prompt_states_todays_api_rules() -> None:
    text = build_draft_prompt("do it", "flow", "Flow", {}, None)
    for needle in ("title=", "item=", "run.output", "Do not write trigger=", "wish words"):
        assert needle in text
    assert "did not pick a model" in text and "do it" in text


async def test_the_handlers_create_and_draft_over_the_service(
    store: WorkflowRuns, tmp_path: Path
) -> None:
    service = service_of(store, tmp_path, Fake(reply(DRAFT)))
    ctx = cast(RequestContext, SimpleNamespace(state=SimpleNamespace(workflows=service)))
    drafted = await workflow_draft(
        ctx, WorkflowDraftParams(name="Weekly invoices", ask="add up my invoices")
    )
    assert [s.title for s in drafted.steps] == ["Read the files"] and drafted.model == "fake/model"
    made = await workflow_create(
        ctx, WorkflowCreateParams(name="Weekly invoices", code=drafted.code)
    )
    assert made.workflow.state == "ok" and made.workflow.name == "weekly_invoices"
    assert made.code == drafted.code and made.code_hash and made.problems == []
    with pytest.raises(RpcCallError, match="exists already"):
        await workflow_create(ctx, WorkflowCreateParams(name="weekly_invoices"))
    with pytest.raises(RpcCallError, match="absolute"):
        await workflow_create(ctx, WorkflowCreateParams(name="x", folder="rel"))
    with pytest.raises(RpcCallError, match="needs letters"):
        await workflow_create(ctx, WorkflowCreateParams(name="!!!"))
