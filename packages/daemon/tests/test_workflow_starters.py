"""The starter workflows run through the engine with fake tools, agents and model (#1906)."""

# pyright: reportPrivateUsage=false
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import urllib.request
from collections.abc import AsyncIterator, Callable, Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast

import pytest

from golem.store.database import Database
from golem.store.workflow_runs import WorkflowRuns
from golem.workflows import starter as starters
from golem.workflows.check import check
from golem.workflows.engine import AgentStarted, WorkflowEngine
from golem.workflows.llm import LlmAnswer
from golem.workflows.registry import load_file
from golem.workflows.service import WorkflowService
from golem.workflows.starter import SOURCE, STARTERS, Starter, StarterError, add_starter
from golem.workflows.tools import ToolVerdict, WorkflowTools


def starter(name: str) -> Path:
    return SOURCE / f"{name}.py"


def _load(name: str) -> Any:
    spec = importlib.util.spec_from_file_location(f"starter_{name}", starter(name))
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Fakes:
    """A tool seam, an agent seam, a model seam and a notifier that record what they were given."""

    def __init__(self) -> None:
        self.tool_calls: list[tuple[str, dict[str, Any]]] = []
        self.tool_out: dict[str, str | Exception] = {}
        self.agents: list[tuple[str, str, str, str | None]] = []
        self.agent_out: dict[str, Any] = {}
        self.prompts: list[tuple[str, str | None]] = []
        self.llm_out: Any = None
        self.sent: list[tuple[str | None, str, str]] = []

    async def decide(self, cwd: str | None, name: str, args: Mapping[str, object]) -> ToolVerdict:
        del cwd, name, args
        return ToolVerdict("allow")

    async def call(
        self, session_id: str | None, cwd: str | None, name: str, args: Mapping[str, object]
    ) -> str:
        del session_id, cwd
        given = dict(args)
        self.tool_calls.append((name, given))
        out = self.tool_out.get(str(given.get("url") or given.get("query") or name), "")
        if isinstance(out, Exception):
            raise out
        return out

    async def agent(
        self,
        run_id: str,
        key: str,
        agent_type: str,
        brief: str,
        model: str | None,
        batch: tuple[str, int] | None,
        gets: tuple[str, ...],
        budget: float | None,
        worktree: str | None,
        started: AgentStarted,
    ) -> dict[str, Any]:
        del run_id, model, batch, gets, budget, started
        self.agents.append((key, agent_type, brief, worktree))
        return self.agent_out[key] if key in self.agent_out else self.agent_out["*"]

    async def llm(
        self, prompt: str, schema: dict[str, Any] | None, wish: str | None, folder: str | None
    ) -> LlmAnswer:
        del schema, folder
        self.prompts.append((prompt, wish))
        out = self.llm_out(prompt) if callable(self.llm_out) else self.llm_out
        return LlmAnswer(out if isinstance(out, str) else json.dumps(out), "fake", None)

    async def notify(self, title: str | None, text: str, run_id: str) -> None:
        self.sent.append((title, text, run_id))


@pytest.fixture
async def store(tmp_path: Path) -> AsyncIterator[WorkflowRuns]:
    async with Database.open(tmp_path / "golem.db") as db:
        yield WorkflowRuns(db)


@pytest.fixture
def fakes() -> Fakes:
    return Fakes()


def engine_of(store: WorkflowRuns, fakes: Fakes) -> WorkflowEngine:
    return WorkflowEngine(
        store,
        notify=fakes.notify,
        agent=fakes.agent,
        llm=fakes.llm,
        tools=cast(WorkflowTools, fakes),
    )


async def run_starter(store: WorkflowRuns, fakes: Fakes, name: str, inputs: dict[str, Any]) -> str:
    rid = await engine_of(store, fakes).start(starter(name), name, inputs)
    run = await store.get_run(rid)
    assert run is not None and run.status == "done", run
    return rid


# the files themselves


@pytest.mark.parametrize("one", STARTERS, ids=lambda s: s.id)
def test_each_starter_loads_and_checks_clean(one: Starter) -> None:
    path = starter(one.id)
    specs, error = load_file(path)
    assert error is None
    assert [s.name for s in specs] == [one.id]
    assert specs[0].trigger is None
    problems = check(path.read_text(encoding="utf-8"), None)
    assert [p for p in problems if p.severity == "error"] == []
    assert one.schedule is None


# morning_briefing: the gather functions

briefing = _load("morning_briefing")
SINCE = "2026-11-26T07:00:00+00:00"


def test_scan_log_reads_json_lines_in_the_window_and_groups_by_message(tmp_path: Path) -> None:
    rows = [
        {"ts": "2026-11-25T10:00:00+00:00", "level": "error", "message": "too old"},
        {"ts": "2026-11-26T08:00:00+00:00", "level": "error", "message": "db 12 failed"},
        {"ts": "2026-11-26T09:00:00+00:00", "level": "ERROR", "message": "db 345 failed"},
        {"ts": "2026-11-26T09:30:00+00:00", "level": "warning", "message": "slow"},
        {"ts": "2026-11-26T09:40:00+00:00", "level": "info", "message": "fine"},
    ]
    log = tmp_path / "golem.jsonl"
    log.write_text("\n".join(json.dumps(r) for r in rows) + "\n", encoding="utf-8")
    got = briefing.scan_log(str(log), SINCE)
    assert (got["errors"], got["warnings"]) == (2, 1)
    assert got["top"] == [
        {"level": "ERROR", "message": "db # failed", "count": 2},
        {"level": "WARNING", "message": "slow", "count": 1},
    ]


def test_scan_log_reads_plain_text_and_skips_a_log_untouched_since(tmp_path: Path) -> None:
    log = tmp_path / "app.log"
    log.write_text("ok\nWARNING disk 91% full\nERROR boom\nTraceback (most recent)\n")
    got = briefing.scan_log(str(log), SINCE)
    assert (got["errors"], got["warnings"]) == (2, 1)
    old = briefing.scan_log(str(log), "2999-01-01T00:00:00+00:00")
    assert old == {"log": str(log), "warnings": 0, "errors": 0, "top": []}


def test_scan_log_returns_the_error_of_a_log_it_cannot_read(tmp_path: Path) -> None:
    got = briefing.scan_log(str(tmp_path / "missing.log"), SINCE)
    assert "error" in got and "missing.log" in got["error"]


RSS = b"""<rss><channel>
<item><title>New one</title><link>https://a.example/1</link>
<pubDate>Thu, 26 Nov 2026 09:00:00 +0000</pubDate></item>
<item><title>Old one</title><link>https://a.example/0</link>
<pubDate>Mon, 01 Jan 2024 09:00:00 +0000</pubDate></item>
</channel></rss>"""
ATOM = b"""<feed xmlns="http://www.w3.org/2005/Atom">
<entry><title>Atom new</title><link href="https://b.example/1"/>
<updated>2026-11-26T10:00:00Z</updated></entry></feed>"""


class Answer:
    def __init__(self, body: bytes) -> None:
        self.body = body

    def __enter__(self) -> Answer:
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def read(self) -> bytes:
        return self.body


def test_read_feed_parses_rss_and_atom_and_keeps_only_new_items(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    bodies = {"https://a.example/rss": RSS, "https://b.example/atom": ATOM}

    def fake_urlopen(request: Any, timeout: float) -> Answer:
        del timeout
        return Answer(bodies[request.full_url])

    monkeypatch.setattr(briefing.urllib.request, "urlopen", fake_urlopen)
    rss = briefing.read_feed("https://a.example/rss", SINCE)
    assert rss["items"] == [
        {"title": "New one", "link": "https://a.example/1", "date": "2026-11-26T09:00:00+00:00"}
    ]
    atom = briefing.read_feed("https://b.example/atom", SINCE)
    assert atom["items"] == [
        {"title": "Atom new", "link": "https://b.example/1", "date": "2026-11-26T10:00:00+00:00"}
    ]


def test_read_feed_says_why_when_it_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    def down(request: Any, timeout: float) -> Answer:
        del request, timeout
        raise OSError("network is down")

    monkeypatch.setattr(briefing.urllib.request, "urlopen", down)
    assert briefing.read_feed("https://a.example/rss", SINCE) == {
        "feed": "https://a.example/rss",
        "error": "network is down",
    }

    def garbage(request: Any, timeout: float) -> Answer:
        del request, timeout
        return Answer(b"<nope")

    monkeypatch.setattr(briefing.urllib.request, "urlopen", garbage)
    assert "error" in briefing.read_feed("https://a.example/rss", SINCE)


def _git(folder: Path, *args: str) -> None:
    env = {
        **os.environ,
        "GIT_AUTHOR_NAME": "A",
        "GIT_AUTHOR_EMAIL": "a@x",
        "GIT_COMMITTER_NAME": "A",
        "GIT_COMMITTER_EMAIL": "a@x",
    }
    subprocess.run(["git", "-C", str(folder), *args], check=True, capture_output=True, env=env)


def test_scan_project_reports_commits_branch_and_uncommitted_files(tmp_path: Path) -> None:
    _git(tmp_path, "init", "-q", "-b", "work")
    (tmp_path / "a.txt").write_text("a")
    _git(tmp_path, "add", ".")
    _git(tmp_path, "commit", "-q", "-m", "first change")
    (tmp_path / "b.txt").write_text("b")
    got = briefing.scan_project(str(tmp_path), "2000-01-01T00:00:00+00:00")
    assert got["branch"] == "work" and got["uncommitted"] == 1
    assert len(got["commits"]) == 1 and got["commits"][0].endswith("A: first change")
    assert got["unpushed"] is None


def test_scan_project_names_a_folder_that_is_not_git(tmp_path: Path) -> None:
    assert briefing.scan_project(str(tmp_path), SINCE) == {
        "folder": str(tmp_path),
        "error": "not a git folder",
    }


# morning_briefing: the whole workflow


async def test_the_briefing_is_saved_and_notified_and_a_failing_feed_does_not_fail_it(
    store: WorkflowRuns, fakes: Fakes, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    home = tmp_path / "home"
    (home / ".golem" / "logs").mkdir(parents=True)
    now = datetime.now(UTC).isoformat()
    (home / ".golem" / "logs" / "golem.jsonl").write_text(
        json.dumps({"ts": now, "level": "error", "message": "boom"}) + "\n", encoding="utf-8"
    )
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-q", "-b", "main")
    (home / ".golem" / "config.toml").write_text(f'trusted_projects = ["{repo}"]\n')
    monkeypatch.setenv("HOME", str(home))

    def down(request: Any, timeout: float) -> Answer:
        del request, timeout
        raise OSError("network is down")

    monkeypatch.setattr(urllib.request, "urlopen", down)
    fakes.llm_out = "Needs you: boom in the log."
    rid = await run_starter(store, fakes, "morning_briefing", {})
    [(prompt, wish)] = fakes.prompts
    assert wish == "cheapest"
    assert "boom" in prompt and "network is down" in prompt and str(repo) in prompt
    saved = sorted((home / ".golem" / "briefings").glob("*.md"))
    assert len(saved) == 1
    assert saved[0].read_text(encoding="utf-8") == "Needs you: boom in the log.\n"
    [(title, text, run_id)] = fakes.sent
    assert title is not None and title.startswith("Morning briefing, ") and run_id == rid
    assert text.startswith("Needs you: boom") and str(saved[0]) in text


# add_starter


@pytest.fixture
def project_starter(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> str:
    """A starter that needs a project folder: none ships yet, so the tests make one."""
    source = tmp_path / "starters"
    source.mkdir()
    (source / "demo.py").write_text("# demo\n", encoding="utf-8")
    (source / "morning_briefing.py").write_bytes(starter("morning_briefing").read_bytes())
    monkeypatch.setattr(starters, "SOURCE", source)
    monkeypatch.setattr(starters, "STARTERS", (*STARTERS, Starter("demo", "Demo", "A demo.", True)))
    return "demo"


def trusted_only(*folders: Path) -> Callable[[Path], bool]:
    return lambda p: p in folders


def test_a_user_starter_goes_in_the_user_folder(tmp_path: Path) -> None:
    user = tmp_path / "user" / "workflows"
    path = add_starter("morning_briefing", None, user_dir=user, trusted=trusted_only())
    assert path == user / "morning_briefing.py"
    assert path.read_bytes() == starter("morning_briefing").read_bytes()
    assert list(user.iterdir()) == [path]


def test_a_project_starter_goes_in_a_trusted_folder(tmp_path: Path, project_starter: str) -> None:
    project = tmp_path / "proj"
    path = add_starter(
        project_starter, project, user_dir=tmp_path / "u", trusted=trusted_only(project)
    )
    assert path == project / "workflows" / "demo.py"
    assert path.read_text(encoding="utf-8") == "# demo\n"


def test_an_untrusted_folder_is_refused_and_says_how_to_trust_it(
    tmp_path: Path, project_starter: str
) -> None:
    project = tmp_path / "proj"
    with pytest.raises(StarterError, match="trusted_projects"):
        add_starter(project_starter, project, user_dir=tmp_path / "u", trusted=trusted_only())
    assert not (project / "workflows").exists()


def test_an_existing_file_is_refused_and_named(tmp_path: Path) -> None:
    user = tmp_path / "workflows"
    user.mkdir()
    (user / "morning_briefing.py").write_text("mine", encoding="utf-8")
    with pytest.raises(StarterError, match=r"morning_briefing\.py"):
        add_starter("morning_briefing", None, user_dir=user, trusted=trusted_only())
    assert (user / "morning_briefing.py").read_text(encoding="utf-8") == "mine"
    assert [p.name for p in user.iterdir()] == ["morning_briefing.py"]


def test_an_unknown_id_and_a_missing_folder_are_refused(
    tmp_path: Path, project_starter: str
) -> None:
    with pytest.raises(StarterError, match="no starter 'nope'"):
        add_starter("nope", None, user_dir=tmp_path, trusted=trusted_only())
    with pytest.raises(StarterError, match="project folder"):
        add_starter(project_starter, None, user_dir=tmp_path, trusted=trusted_only())


def test_a_starter_that_needs_no_folder_ignores_one(tmp_path: Path) -> None:
    path = add_starter(
        "morning_briefing", tmp_path / "proj", user_dir=tmp_path / "u", trusted=trusted_only()
    )
    assert path.parent == tmp_path / "u"


async def test_the_service_adds_a_starter_and_lists_it(
    store: WorkflowRuns, tmp_path: Path, project_starter: str
) -> None:
    project = tmp_path / "proj"
    project.mkdir()
    service = WorkflowService(
        runs=store,
        user_dir=tmp_path / "user",
        user_file=tmp_path / "config.toml",
        trusted=lambda p: p == project,
        broadcast=lambda _m: None,
    )
    entry = await service.add_starter(project_starter, project)
    assert (entry.name, entry.project) == ("demo", project)
    user = await service.add_starter("morning_briefing", None)
    assert user.project is None and user.state == "ok"
    with pytest.raises(StarterError, match="exists already"):
        await service.add_starter(project_starter, project)
