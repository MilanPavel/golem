"""Parsing one skill folder: the spec, Claude Code's fields, and every way it can be wrong."""

from __future__ import annotations

from pathlib import Path

import pytest

from golem.skills.parse import MAX_DESCRIPTION, MAX_FILE_BYTES, parse_skill, read_body

REPO_SKILLS = Path(__file__).resolve().parents[3] / ".agents" / "skills"


def _folder(tmp_path: Path, name: str, text: str | bytes) -> Path:
    folder = tmp_path / name
    folder.mkdir()
    data = text.encode() if isinstance(text, str) else text
    (folder / "SKILL.md").write_bytes(data)
    return folder


@pytest.mark.parametrize("name", ["ship", "setup"])
def test_this_repos_skills_are_valid(name: str) -> None:
    skill = parse_skill(REPO_SKILLS / name)

    assert skill.valid, skill.errors
    assert skill.name == name
    assert skill.description.startswith(("Take the local changes", "Make this golem checkout"))
    assert skill.warnings == ()
    assert skill.user_invocable
    assert skill.model_invocable
    assert len(skill.hash) == 64
    assert read_body(skill).startswith("# ")


def test_the_body_starts_after_the_frontmatter(tmp_path: Path) -> None:
    folder = _folder(
        tmp_path, "pdf", "---\nname: pdf\ndescription: Fill PDF forms.\n---\n\n# PDF\n\nStep one.\n"
    )

    skill = parse_skill(folder)

    assert skill.valid
    assert read_body(skill) == "# PDF\n\nStep one.\n"


def test_a_byte_order_mark_and_crlf_line_ends_are_fine(tmp_path: Path) -> None:
    text = "---\r\nname: pdf\r\ndescription: Fill PDF forms.\r\n---\r\nBody\r\n"
    skill = parse_skill(_folder(tmp_path, "pdf", b"\xef\xbb\xbf" + text.encode()))

    assert skill.valid, skill.errors
    assert skill.description == "Fill PDF forms."
    assert read_body(skill) == "Body\r\n"


def test_without_a_name_the_folder_names_the_skill(tmp_path: Path) -> None:
    skill = parse_skill(_folder(tmp_path, "pdf", "---\ndescription: Fill PDF forms.\n---\n"))

    assert skill.valid
    assert skill.name == "pdf"


def test_a_name_that_does_not_match_its_folder_is_an_error(tmp_path: Path) -> None:
    skill = parse_skill(_folder(tmp_path, "pdf", "---\nname: pdf-tools\ndescription: x\n---\n"))

    assert not skill.valid
    assert skill.errors == ("`name` is 'pdf-tools' but the folder is 'pdf': they must match",)


@pytest.mark.parametrize("name", ["PDF", "pdf--tools", "-pdf", "pdf_tools", "a" * 65])
def test_a_badly_formed_name_is_an_error(tmp_path: Path, name: str) -> None:
    skill = parse_skill(_folder(tmp_path, name, f"---\nname: {name}\ndescription: x\n---\n"))

    assert not skill.valid
    assert "lowercase letters, digits, and single hyphens" in skill.errors[0]


def test_a_badly_formed_folder_name_is_an_error_when_there_is_no_name(tmp_path: Path) -> None:
    skill = parse_skill(_folder(tmp_path, "My Skill", "---\ndescription: x\n---\n"))

    assert skill.errors[0].startswith("the folder name 'My Skill' must be")


def test_a_missing_description_falls_back_to_the_first_paragraph(tmp_path: Path) -> None:
    folder = _folder(
        tmp_path, "pdf", "---\nname: pdf\n---\n# PDF tools\n\nFill PDF\nforms.\n\nMore.\n"
    )

    skill = parse_skill(folder)

    assert skill.valid
    assert skill.description == "Fill PDF forms."
    assert skill.warnings == ("no `description`, so the first paragraph of the body is used",)


def test_no_description_and_no_body_is_an_error(tmp_path: Path) -> None:
    skill = parse_skill(_folder(tmp_path, "pdf", "---\nname: pdf\n---\n# Only a heading\n"))

    assert skill.errors == (
        "`description` is missing: the model needs it to know when to use the skill",
    )


def test_a_blank_description_does_not_fall_back(tmp_path: Path) -> None:
    skill = parse_skill(_folder(tmp_path, "pdf", "---\nname: pdf\ndescription: ''\n---\nBody\n"))

    assert not skill.valid


def test_a_long_description_is_an_error(tmp_path: Path) -> None:
    long = "x" * (MAX_DESCRIPTION + 1)
    skill = parse_skill(_folder(tmp_path, "pdf", f"---\ndescription: {long}\n---\n"))

    assert skill.errors == (f"`description` is {MAX_DESCRIPTION + 1} characters, over 1024",)


def test_a_file_without_frontmatter_is_read_like_claude_code_does(tmp_path: Path) -> None:
    skill = parse_skill(_folder(tmp_path, "notes", "Write release notes in the project's voice.\n"))

    assert skill.valid
    assert skill.name == "notes"
    assert skill.description == "Write release notes in the project's voice."
    assert skill.body_offset == 0


def test_bad_yaml_says_which_line(tmp_path: Path) -> None:
    text = "---\nname: pdf\ndescription: [unclosed\n---\n"
    skill = parse_skill(_folder(tmp_path, "pdf", text))

    assert not skill.valid
    assert skill.errors[0].startswith("the frontmatter is not valid YAML: line ")


def test_frontmatter_that_is_not_fields_is_an_error(tmp_path: Path) -> None:
    skill = parse_skill(_folder(tmp_path, "pdf", "---\n- one\n- two\n---\nBody\n"))

    assert "the frontmatter is not a list of `key: value` fields" in skill.errors


def test_unclosed_frontmatter_is_an_error(tmp_path: Path) -> None:
    skill = parse_skill(_folder(tmp_path, "pdf", "---\nname: pdf\ndescription: x\n"))

    assert skill.errors == ("the frontmatter has no closing `---` line",)


def test_a_two_megabyte_skill_is_listed_with_an_error(tmp_path: Path) -> None:
    body = "line of text\n" * (2 * MAX_FILE_BYTES // 13)
    skill = parse_skill(_folder(tmp_path, "huge", f"---\ndescription: Big.\n---\n{body}"))

    assert skill.name == "huge"
    assert skill.description == "Big."
    assert skill.errors == ("SKILL.md is 2.0 MB, over the 1.0 MB limit",)


def test_a_missing_skill_file_is_an_error(tmp_path: Path) -> None:
    folder = tmp_path / "empty"
    folder.mkdir()

    skill = parse_skill(folder)

    assert skill.name == "empty"
    assert skill.errors[0].startswith("cannot read SKILL.md: ")


def test_claude_code_fields(tmp_path: Path) -> None:
    text = (
        "---\n"
        "description: Fix an issue.\n"
        "argument-hint: [issue-number]\n"
        "disable-model-invocation: true\n"
        "user-invocable: false\n"
        "allowed-tools: Bash(git status *), Read, Grep\n"
        "model: claude-sonnet\n"
        "---\n"
    )
    skill = parse_skill(_folder(tmp_path, "fix-issue", text))

    assert skill.valid, skill.errors
    assert skill.argument_hint == "[issue-number]"
    assert not skill.model_invocable
    assert not skill.user_invocable
    assert skill.allowed_tools == ("Bash(git status *)", "Read", "Grep")
    assert skill.model == "claude-sonnet"


def test_allowed_tools_as_a_yaml_list(tmp_path: Path) -> None:
    text = "---\ndescription: x\nallowed-tools:\n  - Read\n  - Bash(git diff:*)\n---\n"
    skill = parse_skill(_folder(tmp_path, "diff", text))

    assert skill.allowed_tools == ("Read", "Bash(git diff:*)")


@pytest.mark.parametrize(
    ("field", "value", "error"),
    [
        ("user-invocable", "'yes'", "`user-invocable` must be true or false"),
        ("disable-model-invocation", "1", "`disable-model-invocation` must be true or false"),
        ("allowed-tools", "{read: true}", "`allowed-tools` must be text or a list of tool names"),
        ("model", "[a, b]", "`model` must be text"),
        ("name", "42", "`name` must be text"),
    ],
)
def test_a_field_of_the_wrong_type_is_an_error(
    tmp_path: Path, field: str, value: str, error: str
) -> None:
    skill = parse_skill(_folder(tmp_path, "pdf", f"---\ndescription: x\n{field}: {value}\n---\n"))

    assert error in skill.errors


def test_unsupported_fields_warn_and_unknown_fields_are_kept(tmp_path: Path) -> None:
    text = "---\ndescription: x\ncontext: fork\nhooks: {}\nlicense: MIT\nmetadata: {a: 1}\n---\n"
    skill = parse_skill(_folder(tmp_path, "pdf", text))

    assert skill.valid
    assert skill.warnings == (
        "`context` is not supported yet, so it is ignored",
        "`hooks` is not supported yet, so it is ignored",
    )
    assert skill.extras == {"context": "fork", "hooks": {}, "license": "MIT", "metadata": {"a": 1}}


def test_a_symlinked_folder_keeps_both_paths(tmp_path: Path) -> None:
    target = _folder(tmp_path, "pdf", "---\ndescription: x\n---\n")
    (tmp_path / "linked").mkdir()
    link = tmp_path / "linked" / "pdf"
    link.symlink_to(target)

    skill = parse_skill(link)

    assert skill.valid
    assert skill.path == link
    assert skill.real_path == target.resolve()


def test_the_hash_changes_with_the_file(tmp_path: Path) -> None:
    folder = _folder(tmp_path, "pdf", "---\ndescription: x\n---\nOne\n")
    before = parse_skill(folder).hash
    (folder / "SKILL.md").write_text("---\ndescription: x\n---\nTwo\n")

    assert parse_skill(folder).hash != before
