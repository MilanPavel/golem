"""Read-only file tools and the folder guard."""

from __future__ import annotations

from pathlib import Path

import pytest

from golem.tools import default_registry
from golem.tools.fs import ReadFileArgs
from golem.tools.paths import NO_FOLDER, inside
from golem.tools.registry import (
    MAX_OUTPUT_CHARS,
    Tool,
    ToolContext,
    ToolError,
    ToolRegistry,
    ToolResult,
)


@pytest.fixture
def project(tmp_path: Path) -> Path:
    root = tmp_path / "project"
    (root / "src").mkdir(parents=True)
    (root / "src" / "a.py").write_text("import os\nprint('hello')\n", encoding="utf-8")
    (root / "src" / "b.ts").write_text("const hello = 1;\n", encoding="utf-8")
    (root / "node_modules" / "dep").mkdir(parents=True)
    (root / "node_modules" / "dep" / "x.py").write_text("hello\n", encoding="utf-8")
    (root / "README.md").write_text("# hi\n", encoding="utf-8")
    return root


async def _call(root: Path | None, name: str, **args: object) -> ToolResult:
    return await default_registry().call(name, args, ToolContext(root=root))


@pytest.mark.parametrize(
    "path",
    ["/etc/hosts", "../outside.txt", "src/../../outside.txt", "~/.ssh/id_rsa"],
)
def test_paths_outside_the_folder_are_refused(project: Path, path: str) -> None:
    with pytest.raises(ToolError, match="outside the project folder"):
        inside(project, path)


def test_paths_inside_the_folder_resolve(project: Path) -> None:
    assert inside(project, "src/a.py") == (project / "src" / "a.py").resolve()
    assert inside(project, ".") == project.resolve()
    assert inside(project, str(project / "README.md")) == (project / "README.md").resolve()


def test_a_symlink_out_of_the_folder_is_refused(project: Path, tmp_path: Path) -> None:
    secret = tmp_path / "secret.txt"
    secret.write_text("key\n", encoding="utf-8")
    (project / "link.txt").symlink_to(secret)
    with pytest.raises(ToolError, match="outside"):
        inside(project, "link.txt")


async def test_read_file_numbers_lines(project: Path) -> None:
    result = await _call(project, "read_file", path="src/a.py")
    assert result.output == "     1|import os\n     2|print('hello')"
    assert result.summary == "2 lines"
    part = await _call(project, "read_file", path="src/a.py", offset=2, limit=1)
    assert part.output == "     2|print('hello')"
    assert part.summary == "lines 2-2 of 2"


async def test_read_file_refuses_etc_hosts(project: Path) -> None:
    with pytest.raises(ToolError, match="outside"):
        await _call(project, "read_file", path="/etc/hosts")


async def test_read_file_refuses_binary_and_missing(project: Path) -> None:
    (project / "blob.bin").write_bytes(b"\x00\x01\x02")
    with pytest.raises(ToolError, match="binary"):
        await _call(project, "read_file", path="blob.bin")
    with pytest.raises(ToolError, match="not a file"):
        await _call(project, "read_file", path="nope.txt")


async def test_list_dir_marks_folders(project: Path) -> None:
    result = await _call(project, "list_dir")
    assert result.output.splitlines() == ["README.md", "node_modules/", "src/"]
    assert result.summary == "3 entries"


async def test_glob_skips_dependency_folders(project: Path) -> None:
    result = await _call(project, "glob", pattern="**/*.py")
    assert result.output == "src/a.py"
    assert result.summary == "1 file"
    with pytest.raises(ToolError):
        await _call(project, "glob", pattern="../*")


async def test_grep_finds_lines_with_paths(project: Path) -> None:
    result = await _call(project, "grep", pattern="hello")
    assert result.output.splitlines() == [
        "src/a.py:2: print('hello')",
        "src/b.ts:1: const hello = 1;",
    ]
    assert result.summary == "2 matches in 2 files"
    only_ts = await _call(project, "grep", pattern="HELLO", include="*.ts", ignore_case=True)
    assert only_ts.summary == "1 match in 1 file"
    with pytest.raises(ToolError, match="regular expression"):
        await _call(project, "grep", pattern="(")


async def test_grep_does_not_follow_a_symlink_out(project: Path, tmp_path: Path) -> None:
    secret = tmp_path / "secret.txt"
    secret.write_text("hello secret\n", encoding="utf-8")
    (project / "src" / "link.txt").symlink_to(secret)
    result = await _call(project, "grep", pattern="secret")
    assert result.summary == "no matches"


async def test_a_session_without_a_folder_has_no_file_access() -> None:
    with pytest.raises(ToolError) as caught:
        await _call(None, "read_file", path="a.txt")
    assert str(caught.value) == NO_FOLDER


async def test_bad_arguments_and_unknown_tools_explain_themselves(project: Path) -> None:
    with pytest.raises(ToolError, match="invalid arguments for read_file: path"):
        await _call(project, "read_file")
    with pytest.raises(ToolError, match="unknown tool 'write_file'"):
        await _call(project, "write_file", path="a")


async def test_long_output_is_cut_for_the_model() -> None:
    async def run(args: ReadFileArgs, ctx: ToolContext) -> ToolResult:
        del args, ctx
        return ToolResult(output="x" * (MAX_OUTPUT_CHARS + 10), summary="big")

    registry = ToolRegistry([Tool(name="big", description="", args=ReadFileArgs, run=run)])
    result = await registry.call("big", {"path": "a"}, ToolContext(root=None))
    assert result.output.endswith(f"[output cut at {MAX_OUTPUT_CHARS} characters]")


def test_schemas_use_the_function_format() -> None:
    schemas = default_registry().schemas()
    names = [schema["function"]["name"] for schema in schemas]  # type: ignore[index]
    assert names == ["read_file", "list_dir", "glob", "grep"]
    first = schemas[0]["function"]  # type: ignore[index]
    assert first["parameters"]["required"] == ["path"]  # type: ignore[index]


async def test_an_empty_path_is_the_project_folder(project: Path) -> None:
    listed = await _call(project, "list_dir", path="")
    assert listed.summary == "3 entries"
    found = await _call(project, "grep", pattern="hello", path="")
    assert found.summary == "2 matches in 2 files"
