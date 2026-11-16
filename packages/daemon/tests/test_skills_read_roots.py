"""The folder of a skill the session ran is a read root: read, never written."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from pathlib import Path

import pytest
from fakes import ToolCallingChatModel
from langchain_core.messages import ToolMessage
from langgraph.checkpoint.memory import InMemorySaver

from golem.config import ShellSettings, SkillSettings
from golem.graphs.chat import open_chat
from golem.graphs.state import add_folders
from golem.models.router import ModelRouter
from golem.sessions.bus import EventBus
from golem.sessions.log import SessionLog
from golem.sessions.manager import SessionManager
from golem.skills.registry import SkillRegistry
from golem.store.database import Database
from golem.store.events import EventLog
from golem.store.records import RunRecords, SessionRecords
from golem.tools import default_registry, sandbox
from golem.tools.fs import (
    GlobArgs,
    GrepArgs,
    ListDirArgs,
    ReadFileArgs,
    glob_files,
    grep,
    list_dir,
    read_file,
)
from golem.tools.paths import NO_FOLDER, Readable
from golem.tools.registry import ToolContext, ToolError
from golem_protocol.events import SkillCall

needs_sandbox = pytest.mark.skipif(not sandbox.available(), reason="needs macOS sandbox-exec")


@pytest.fixture
def project(tmp_path: Path) -> Path:
    root = tmp_path / "project"
    root.mkdir()
    (root / "a.txt").write_text("project file\n", encoding="utf-8")
    return root


@pytest.fixture
def skill(tmp_path: Path) -> Path:
    folder = tmp_path / "skills" / "ship"
    (folder / "references").mkdir(parents=True)
    (folder / "scripts").mkdir()
    (folder / "SKILL.md").write_text(
        "---\nname: ship\ndescription: Ship.\n---\nRead ${GOLEM_SKILL_DIR}/references/x.md\n",
        encoding="utf-8",
    )
    (folder / "references" / "x.md").write_text("the rules\n", encoding="utf-8")
    (folder / "scripts" / "x.sh").write_text("echo from the script\n", encoding="utf-8")
    return folder


def test_a_skill_file_is_read_by_its_absolute_path(project: Path, skill: Path) -> None:
    where = Readable(root=project.resolve(), skills=(skill.resolve(),))
    result = read_file(where, ReadFileArgs(path=str(skill / "references" / "x.md")))
    assert result.output == "     1|the rules"
    assert read_file(where, ReadFileArgs(path="a.txt")).output == "     1|project file"


def test_list_glob_and_grep_work_in_a_skill_folder(project: Path, skill: Path) -> None:
    where = Readable(root=project.resolve(), skills=(skill.resolve(),))
    assert list_dir(where, ListDirArgs(path=str(skill))).output == "SKILL.md\nreferences/\nscripts/"
    found = glob_files(where, GlobArgs(pattern="**/*.md", path=str(skill))).output
    assert found.splitlines() == [
        (skill / "SKILL.md").resolve().as_posix(),
        (skill / "references" / "x.md").resolve().as_posix(),
    ]
    hits = grep(where, GrepArgs(pattern="rules", path=str(skill))).output
    assert hits == f"{(skill / 'references' / 'x.md').resolve().as_posix()}:1: the rules"


@pytest.mark.parametrize("name", ["outside.txt", "skills/other/SKILL.md"])
def test_a_path_outside_the_project_and_the_skill_is_refused(
    project: Path, skill: Path, tmp_path: Path, name: str
) -> None:
    target = tmp_path / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("secret\n", encoding="utf-8")
    where = Readable(root=project.resolve(), skills=(skill.resolve(),))
    with pytest.raises(ToolError, match="outside the project folder"):
        read_file(where, ReadFileArgs(path=str(target)))
    with pytest.raises(ToolError, match="outside the project folder"):
        read_file(where, ReadFileArgs(path=f"{skill}/../other/SKILL.md"))


def test_a_skill_folder_is_not_readable_before_the_session_runs_it(
    project: Path, skill: Path
) -> None:
    where = Readable(root=project.resolve())
    with pytest.raises(ToolError, match="outside the project folder"):
        read_file(where, ReadFileArgs(path=str(skill / "SKILL.md")))


def test_a_session_without_a_folder_reads_only_absolute_skill_paths(skill: Path) -> None:
    where = Readable(root=None, skills=(skill.resolve(),))
    assert read_file(where, ReadFileArgs(path=str(skill / "SKILL.md"))).summary == "5 lines"
    with pytest.raises(ToolError) as refused:
        read_file(where, ReadFileArgs(path="SKILL.md"))
    assert str(refused.value) == NO_FOLDER


def test_golem_home_stays_unreadable_but_its_skills_folder_reads(tmp_path: Path) -> None:
    home = tmp_path / "home"
    golem_skill = home / ".golem" / "skills" / "notes"
    golem_skill.mkdir(parents=True)
    (golem_skill / "SKILL.md").write_text("notes\n", encoding="utf-8")
    (home / ".golem" / "golem.db").write_text("db\n", encoding="utf-8")
    (home / ".ssh").mkdir()
    (home / ".ssh" / "id_rsa").write_text("PRIVATE\n", encoding="utf-8")
    # A skill folder that is a link into a credentials folder reads nothing there.
    linked = tmp_path / "skills" / "evil"
    linked.parent.mkdir(parents=True)
    linked.symlink_to(home / ".ssh")
    where = Readable(root=None, skills=(golem_skill.resolve(), linked.resolve()), home=home)

    assert read_file(where, ReadFileArgs(path=str(golem_skill / "SKILL.md"))).summary == "1 line"
    with pytest.raises(ToolError, match="outside every folder"):
        read_file(where, ReadFileArgs(path=str(home / ".golem" / "golem.db")))
    with pytest.raises(ToolError, match="holds credentials"):
        read_file(where, ReadFileArgs(path=str(linked / "id_rsa")))


async def test_the_write_tools_never_write_into_a_skill_folder(project: Path, skill: Path) -> None:
    ctx = ToolContext(root=project, read_roots=(skill,))
    target = skill / "references" / "x.md"
    with pytest.raises(ToolError, match="outside the project folder"):
        await default_registry().call("write_file", {"path": str(target), "content": "x"}, ctx)
    assert target.read_text(encoding="utf-8") == "the rules\n"


def test_folders_are_added_once_and_kept_in_order() -> None:
    assert add_folders(None, ["/a"]) == ["/a"]
    assert add_folders(["/a", "/b"], ["/b", "/c"]) == ["/a", "/b", "/c"]
    assert add_folders(["/a"], None) == ["/a"]


def test_the_profile_lets_commands_read_golem_skills_only(tmp_path: Path) -> None:
    home = tmp_path / "home"
    text = sandbox.profile(tmp_path, ShellSettings(), home=home)
    deny = text.index("(deny file-read*")
    allow = text.index("(allow file-read*")
    assert deny < allow, "the later rule wins, so the allow must come after the deny"
    assert f'(subpath "{(home / ".golem").resolve()}")' in text[deny:allow]
    assert text[allow:].count("(subpath ") == 1
    assert f'(subpath "{(home / ".golem" / "skills").resolve()}")' in text[allow:]


@needs_sandbox
async def test_a_command_runs_a_golem_skill_script_but_not_golem_db(
    tmp_path: Path, short_home: Path
) -> None:
    # The home is outside the temp folders, which commands may write to.
    home = short_home
    scripts = home / ".golem" / "skills" / "ship" / "scripts"
    scripts.mkdir(parents=True)
    (scripts / "x.sh").write_text("echo from the script\n", encoding="utf-8")
    (home / ".golem" / "golem.db").write_text("DATABASE\n", encoding="utf-8")
    root = tmp_path / "project"
    root.mkdir()

    async def run(command: str) -> sandbox.Finished:
        return await sandbox.run(
            ["/bin/sh", "-c", command], root=root, settings=ShellSettings(), timeout=10, home=home
        )

    ran = await run(f"sh {scripts}/x.sh")
    assert (ran.exit_code, ran.output) == (0, "from the script\n")
    db = await run(f"cat {home}/.golem/golem.db")
    assert db.exit_code != 0
    assert "DATABASE" not in db.output
    wrote = await run(f"echo x > {scripts}/new.sh")
    assert wrote.exit_code != 0
    assert not (scripts / "new.sh").exists()


async def _until(check: Callable[[], Awaitable[bool]], timeout: float = 3) -> None:
    async with asyncio.timeout(timeout):
        while not await check():
            await asyncio.sleep(0.01)


async def test_an_invoked_skill_reads_its_own_reference_file(
    database: Database, project: Path, skill: Path, tmp_path: Path
) -> None:
    reference = str(skill / "references" / "x.md")
    model = ToolCallingChatModel(
        replies=[
            [("read_file", {"path": reference})],
            "Read.",
            [("read_file", {"path": reference})],
            "Again.",
        ]
    )
    events = EventLog(database)
    records = SessionRecords(database)
    runs = RunRecords(database)
    registry = SkillRegistry(
        SkillSettings(), golem_skills=skill.parent, user_home=tmp_path / "home"
    )
    manager = SessionManager(
        open_chat(ModelRouter(model=model), InMemorySaver()),
        SessionLog(events, EventBus(), records),
        records,
        runs,
        skills=registry,
    )
    session_id = await manager.create(None, cwd=str(project))

    async def finished(run_id: str) -> None:
        async def done() -> bool:
            run = await runs.get(run_id)
            return run is not None and run.status != "running"

        await _until(done)

    await finished(
        await manager.send(session_id, "/ship", cwd=str(project), skill=SkillCall(name="ship"))
    )
    # A later plain turn still reads the folder: the session ran the skill.
    await finished(await manager.send(session_id, "read it again", cwd=str(project)))
    await manager.cancel_all()

    results = [
        message.text
        for history in (model.seen[1], model.seen[3])
        for message in history[-1:]
        if isinstance(message, ToolMessage)
    ]
    assert results == ["     1|the rules", "     1|the rules"]


def _home_with_secrets(tmp_path: Path) -> Path:
    home = tmp_path.resolve()
    (home / ".aws").mkdir()
    (home / ".aws" / "config").write_text("key=SECRETVALUE\n")
    (home / ".netrc").write_text("password SECRETVALUE\n")
    (home / ".golem" / "skills" / "x").mkdir(parents=True)
    (home / ".golem" / "skills" / "x" / "SKILL.md").write_text("SECRETVALUE skill\n")
    (home / "notes.txt").write_text("SECRETVALUE note\n")
    return home


def test_session_folder_home_refuses_credential_files(tmp_path: Path) -> None:
    home = _home_with_secrets(tmp_path)
    where = Readable(root=home, home=home)
    for name in (".aws/config", ".netrc"):
        with pytest.raises(ToolError, match="holds credentials"):
            read_file(where, ReadFileArgs(path=name))
    with pytest.raises(ToolError, match="holds credentials"):
        list_dir(where, ListDirArgs(path=".aws"))
    assert "SECRETVALUE" in read_file(where, ReadFileArgs(path="notes.txt")).output
    assert "SECRETVALUE" in read_file(where, ReadFileArgs(path=".golem/skills/x/SKILL.md")).output


def test_session_folder_home_hides_credentials_from_walks(tmp_path: Path) -> None:
    home = _home_with_secrets(tmp_path)
    where = Readable(root=home, home=home)
    found = glob_files(where, GlobArgs(pattern="**/*", path=".")).output
    assert "config" not in found.split() and ".netrc" not in found
    assert "notes.txt" in found and ".golem/skills/x/SKILL.md" in found
    hits = grep(where, GrepArgs(pattern="SECRETVALUE", path=".")).output
    assert ".aws" not in hits and ".netrc" not in hits
    assert "notes.txt" in hits and "SKILL.md" in hits
    listing = list_dir(where, ListDirArgs(path=".")).output.split("\n")
    assert ".aws/" not in listing and ".netrc" not in listing and "notes.txt" in listing


def test_client_file_methods_refuse_credentials(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from golem.coding.files import list_paths, read_text

    home = _home_with_secrets(tmp_path)
    monkeypatch.setenv("HOME", str(home))
    for name in (".aws/config", ".netrc"):
        with pytest.raises(ToolError, match="holds credentials"):
            read_text(home, name)
    shown = list_paths(home, "", 100).paths
    assert "notes.txt" in shown and ".golem/skills/x/SKILL.md" in shown
    assert not any(".aws" in p or ".netrc" in p for p in shown)
