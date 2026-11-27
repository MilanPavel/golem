"""Live progress (3.13.6, #1929): a step's text as it comes, the usual time, and Show in Finder."""

from __future__ import annotations

import asyncio
import json
import textwrap
from collections.abc import AsyncIterator, Callable
from pathlib import Path
from typing import Any

import pytest
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage, HumanMessage

from golem.server.workflows import median_ms
from golem.store.database import Database
from golem.store.workflow_runs import WorkflowRuns
from golem.workflows import engine as engine_module
from golem.workflows.engine import WorkflowEngine
from golem.workflows.llm import LlmAnswer, _streamed  # pyright: ignore[reportPrivateUsage]

HEADER = "from golem.workflow import workflow, Run\n"


@pytest.fixture
async def store(tmp_path: Path) -> AsyncIterator[WorkflowRuns]:
    async with Database.open(tmp_path / "golem.db") as db:
        yield WorkflowRuns(db)


def write(tmp_path: Path, body: str) -> Path:
    path = tmp_path / "wf.py"
    path.write_text(HEADER + textwrap.dedent(body))
    return path


class Events:
    def __init__(self) -> None:
        self.items: list[tuple[str, dict[str, Any]]] = []

    def __call__(self, name: str, payload: dict[str, Any]) -> None:
        self.items.append((name, payload))

    def of(self, name: str) -> list[dict[str, Any]]:
        return [p for n, p in self.items if n == name]


ASK = """
    @workflow()
    async def flow(run: Run):
        return await run.llm("Write the briefing", key="write")
"""


class StreamingLlm:
    """A model that writes its answer in pieces, as WorkflowLlm does with a streaming model."""

    streams = True

    def __init__(self, pieces: list[str], seen: Callable[[], None] | None = None) -> None:
        self.pieces = pieces
        self.seen = seen

    async def __call__(
        self,
        prompt: str,
        schema: dict[str, Any] | None,
        wish: str | None,
        folder: str | None,
        progress: Callable[[str], None] | None = None,
    ) -> LlmAnswer:
        text = ""
        for piece in self.pieces:
            text += piece
            if progress is not None:
                progress(text)
            await asyncio.sleep(0)
            if self.seen is not None:
                self.seen()
        return LlmAnswer(text, "fake/stream", 0.0)


async def test_a_model_answer_goes_out_as_it_is_written(
    store: WorkflowRuns, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(engine_module, "PROGRESS_INTERVAL", 0.0)
    events = Events()
    kept: list[str | None] = []
    llm: StreamingLlm

    def peek() -> None:
        # What a client that opens the run midway would read from workflow.status.
        kept.append(engine.progress_of(run_id_box[0], "write"))

    run_id_box = [""]
    llm = StreamingLlm(["Good ", "morning, ", "Milan."], peek)
    engine = WorkflowEngine(store, events, llm=llm)
    original = events.__call__

    def watch(name: str, payload: dict[str, Any]) -> None:
        run_id_box[0] = str(payload["workflow_run_id"])
        original(name, payload)

    engine._emit = watch  # pyright: ignore[reportPrivateUsage]
    run_id = await engine.start(write(tmp_path, ASK), "flow", {})
    sent = events.of("workflow.step.progress")
    assert [p["text"] for p in sent] == [
        "Good ",
        "Good morning, ",
        "Good morning, Milan.",
        "Good morning, Milan.",
    ]
    assert [p["done"] for p in sent] == [False, False, False, True]
    assert all(p["key"] == "write" and p["workflow_run_id"] == run_id for p in sent)
    assert kept == ["Good ", "Good morning, ", "Good morning, Milan."]
    # It ends with the step: nothing is kept, and nothing is saved.
    assert engine.progress_of(run_id, "write") is None
    step = await store.get_step(run_id, "write")
    assert step is not None and json.loads(step.result_json or "null") == "Good morning, Milan."


async def test_progress_goes_out_at_most_four_times_a_second_and_ends_with_the_last_text(
    store: WorkflowRuns, tmp_path: Path
) -> None:
    events = Events()
    llm = StreamingLlm([f"{n} " for n in range(50)])
    run_id = await WorkflowEngine(store, events, llm=llm).start(write(tmp_path, ASK), "flow", {})
    sent = events.of("workflow.step.progress")
    assert 1 <= len(sent) <= 3
    assert sent[-1]["done"] is True and sent[-1]["text"].endswith("49 ")
    assert (await store.get_run(run_id)) is not None


async def test_a_model_that_cannot_stream_sends_nothing(
    store: WorkflowRuns, tmp_path: Path
) -> None:
    events = Events()

    async def plain(prompt: str, schema: Any, wish: Any, folder: Any) -> LlmAnswer:
        return LlmAnswer("All quiet.", "fake/plain", None)

    run_id = await WorkflowEngine(store, events, llm=plain).start(write(tmp_path, ASK), "flow", {})
    assert events.of("workflow.step.progress") == []
    run = await store.get_run(run_id)
    assert run is not None and run.status == "done"


async def test_a_workflow_that_sends_no_progress_changes_nothing(
    store: WorkflowRuns, tmp_path: Path
) -> None:
    events = Events()
    path = write(
        tmp_path,
        """
        @workflow()
        async def flow(run: Run):
            return await run.step("one", lambda: 1)
        """,
    )
    await WorkflowEngine(store, events).start(path, "flow", {})
    assert events.of("workflow.step.progress") == []
    assert [n for n, _ in events.items] == [
        "workflow.run.started",
        "workflow.step.started",
        "workflow.step.done",
        "workflow.run.done",
    ]


async def test_run_progress_in_a_plain_step_sends_the_same_event(
    store: WorkflowRuns, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(engine_module, "PROGRESS_INTERVAL", 0.0)
    events = Events()
    path = write(
        tmp_path,
        """
        def count(run):
            for n in range(1, 4):
                run.progress(f"{n} of 3")
            return 3

        @workflow()
        async def flow(run: Run):
            run.progress("outside a step does nothing")
            return await run.step("Count", count, run)
        """,
    )
    await WorkflowEngine(store, events).start(path, "flow", {})
    sent = events.of("workflow.step.progress")
    assert [p["text"] for p in sent] == ["1 of 3", "2 of 3", "3 of 3", "3 of 3"]
    assert [p["key"] for p in sent] == ["Count"] * 4
    assert sent[-1]["done"] is True


async def test_a_streaming_chat_model_gives_the_text_so_far_and_holds_the_first_chunk() -> None:
    model = GenericFakeChatModel(messages=iter([AIMessage(content="Good morning, Milan.")]))
    texts: list[str] = []
    answer = await _streamed(model, [HumanMessage(content="hi")], texts.append)  # pyright: ignore[reportArgumentType]
    assert answer.text == "Good morning, Milan."
    assert texts and texts[-1] == "Good morning, Milan." and texts[0] != texts[-1]

    class OnePiece(GenericFakeChatModel):
        async def astream(self, *args: Any, **kwargs: Any) -> Any:  # type: ignore[override]
            from langchain_core.messages import AIMessageChunk

            yield AIMessageChunk(content="All of it.")

    quiet: list[str] = []
    one = await _streamed(OnePiece(messages=iter([])), [HumanMessage(content="hi")], quiet.append)  # pyright: ignore[reportArgumentType]
    assert one.text == "All of it." and quiet == []


def test_the_usual_time_is_the_median_of_the_runs_and_needs_two() -> None:
    assert median_ms([]) is None
    assert median_ms([4000]) is None
    assert median_ms([4000, 6000]) == 5000
    assert median_ms([9000, 1000, 5000, 3000, 7000]) == 5000


async def test_the_last_five_done_runs_of_a_workflow_give_their_times(store: WorkflowRuns) -> None:
    async def finish(workflow_id: str, start: int, seconds: int, status: str = "done") -> None:
        run_id = await store.create_run(workflow_id, "flow", "/w.py", "2026-11-27T08:00:00+00:00")
        started = f"2026-11-27T08:{start:02d}:00+00:00"
        finished = f"2026-11-27T08:{start:02d}:{seconds:02d}+00:00"
        await store.set_run_status(run_id, "running", started)
        await store.set_run_status(run_id, status, finished)

    assert await store.recent_durations_ms("w", 5) == []
    await finish("w", 1, 10)
    assert median_ms(await store.recent_durations_ms("w", 5)) is None
    await finish("w", 2, 20)
    await finish("w", 3, 30, "failed")
    await finish("other", 4, 59)
    assert median_ms(await store.recent_durations_ms("w", 5)) == 15000
    for n in range(4, 10):
        await finish("w", n, 40)
    spans = await store.recent_durations_ms("w", 5)
    assert spans == [40000] * 5 and median_ms(spans) == 40000
