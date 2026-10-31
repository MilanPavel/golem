"""A skill body is filled in with its arguments, the skill folder, and the session ID."""

from __future__ import annotations

from pathlib import Path

import pytest

from golem.skills.expand import expand, split_arguments

DIR = Path("/skills/ship")
SESSION = "s-123"


@pytest.mark.parametrize(
    ("body", "args", "expected"),
    [
        ("Fix: $ARGUMENTS", "the mcp restart", "Fix: the mcp restart"),
        ("Fix: $ARGUMENTS", "  padded  ", "Fix: padded"),
        ("$ARGUMENTS[0] then $ARGUMENTS[1]", "a b", "a then b"),
        ("$0 then $1", "a b", "a then b"),
        ("first=$0 all=$ARGUMENTS", 'a "two words"', 'first=a all=a "two words"'),
        ("second=$1", 'a "two words"', "second=two words"),
        ("second=$1", "a 'single quoted'", "second=single quoted"),
        ("missing=[$2] [$ARGUMENTS[5]]", "a b", "missing=[] []"),
        ("ten=$10", " ".join(str(n) for n in range(11)), "ten=10"),
        ("unbalanced=$1", 'a "b c', 'unbalanced="b'),
        ("Dir ${CLAUDE_SKILL_DIR}/scripts", "", "Dir /skills/ship/scripts"),
        ("Dir ${GOLEM_SKILL_DIR}/scripts", "", "Dir /skills/ship/scripts"),
        ("Session ${CLAUDE_SESSION_ID}", "", "Session s-123"),
        ("Session ${GOLEM_SESSION_ID}", "", "Session s-123"),
        ("Literal \\$ARGUMENTS and \\$0", "", "Literal $ARGUMENTS and $0"),
        ("Cost \\$5, args $ARGUMENTS", "x", "Cost $5, args x"),
        ("$ARGUMENTSX stays", "", "$ARGUMENTSX stays"),
        ("$HOME and ${OTHER} stay", "", "$HOME and ${OTHER} stay"),
        ("No args: [$ARGUMENTS]", "", "No args: []"),
        ("Plain body\n", "", "Plain body\n"),
        ("Status: !`git status $0` for $0", "x", "Status: !`git status $0` for x"),
    ],
)
def test_expand(body: str, args: str, expected: str) -> None:
    assert expand(body, args, skill_dir=DIR, session_id=SESSION) == expected


@pytest.mark.parametrize(
    ("body", "args", "expected"),
    [
        ("Open a PR.\n", "fix the mcp", "Open a PR.\n\nARGUMENTS: fix the mcp\n"),
        ("Open a PR.\n\n\n", "x", "Open a PR.\n\nARGUMENTS: x\n"),
        ("", "x", "ARGUMENTS: x\n"),
        ("Escaped \\$ARGUMENTS only", "x", "Escaped $ARGUMENTS only\n\nARGUMENTS: x\n"),
        ("Dir ${CLAUDE_SKILL_DIR}", "x", "Dir /skills/ship\n\nARGUMENTS: x\n"),
        ("!`echo $ARGUMENTS`", "x", "!`echo $ARGUMENTS`\n\nARGUMENTS: x\n"),
    ],
)
def test_arguments_are_appended_when_unused(body: str, args: str, expected: str) -> None:
    assert expand(body, args, skill_dir=DIR, session_id=SESSION) == expected


@pytest.mark.parametrize("body", ["Use $0", "Use $ARGUMENTS[0]", "Use $ARGUMENTS"])
def test_any_argument_form_counts_as_used(body: str) -> None:
    assert "ARGUMENTS:" not in expand(body, "x", skill_dir=DIR, session_id=SESSION)


def test_split_arguments() -> None:
    assert split_arguments('a "b c" d') == ["a", "b c", "d"]
    assert split_arguments('a "b c') == ["a", '"b', "c"]
    assert split_arguments("") == []
