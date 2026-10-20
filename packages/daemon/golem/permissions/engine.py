"""Decide whether one tool call may run. Pure: no files, no clock, no I/O.

Rules are checked in order and the first one that matches decides. The
caller puts project rules first, then the user's, then the built-in
defaults, which end with ``tool = "*"``, ``action = "ask"``.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from fnmatch import fnmatchcase
from pathlib import Path
from typing import Literal

from golem.config import PolicyRule, RuleAction

DEFAULT_SOURCE = "built-in default"


RuleFile = Literal["user", "project", "default"]

Allowance = tuple[str, str | None]
"""A tool allowed for the rest of a session, and the subject it is allowed with.

A null subject allows every call of the tool, as for tools that have no subject.
"""


def session_allows(allowed: Iterable[Allowance], tool: str, subject: str | None) -> bool:
    keys = set(allowed)
    return (tool, None) in keys or (subject is not None and (tool, subject) in keys)


@dataclass(frozen=True, slots=True)
class Rule:
    """A rule and where it came from. An ``ignored`` rule is listed and never matches.

    ``file`` and ``index`` (from 1) say which ``[[rule]]`` to edit. Defaults have no index.
    """

    rule: PolicyRule
    source: str
    ignored: str | None = None
    file: RuleFile = "default"
    index: int | None = None


@dataclass(frozen=True, slots=True)
class Call:
    """What a rule can see of one tool call.

    ``subject`` is the value of the tool's ``match_arg``, and ``path`` the
    resolved path of its ``path_arg``. ``root`` is the session folder, which
    relative ``path`` globs are relative to.
    """

    tool: str
    subject: str | None = None
    path: Path | None = None
    root: Path | None = None


@dataclass(frozen=True, slots=True)
class Decision:
    action: RuleAction
    source: str

    @property
    def allowed(self) -> bool:
        return self.action == "allow"


def default_rules(read_only: Iterable[str]) -> list[Rule]:
    """Read-only tools run without asking. Anything else asks."""
    rules = [Rule(PolicyRule(tool=name, action="allow"), DEFAULT_SOURCE) for name in read_only]
    rules.append(Rule(PolicyRule(tool="*", action="ask"), DEFAULT_SOURCE))
    return rules


def check(call: Call, rules: Sequence[Rule], *, home: Path) -> Decision:
    """The first rule that matches ``call`` decides. With none, the call asks."""
    for rule in rules:
        if rule.ignored is None and matches(rule.rule, call, home=home):
            return Decision(rule.rule.action, rule.source)
    return Decision("ask", DEFAULT_SOURCE)


def matches(rule: PolicyRule, call: Call, *, home: Path) -> bool:
    if not fnmatchcase(call.tool, rule.tool):
        return False
    if rule.match is not None:
        if call.subject is None:
            return False
        if not any(fnmatchcase(call.subject, part) for part in alternatives(rule.match) if part):
            return False
    if rule.path is not None:
        if call.path is None:
            return False
        pattern = path_pattern(rule.path, root=call.root, home=home)
        if pattern is None or pattern.fullmatch(call.path.as_posix()) is None:
            return False
    return True


def alternatives(match: str) -> list[str]:
    """``match`` split on ``|``. ``\\|`` is a literal bar, as in a piped command."""
    return [part.strip().replace("\\|", "|") for part in re.split(r"(?<!\\)\|", match)]


def exact_match(subject: str) -> str:
    """A ``match`` glob that matches ``subject`` and nothing else."""
    escaped = re.sub(r"([*?\[])", r"[\1]", subject)
    return escaped.replace("|", "\\|")


def path_pattern(glob: str, *, root: Path | None, home: Path) -> re.Pattern[str] | None:
    """A regex for ``glob`` as an absolute path, or None when it cannot apply.

    ``~`` is ``home``. A relative glob needs ``root``. The part before the
    first wildcard is resolved, so a symlinked folder matches the real path
    the call resolves to. ``dir/**`` also matches ``dir`` itself.
    """
    text = glob.strip()
    if text == "~" or text.startswith("~/"):
        text = home.as_posix() + text[1:]
    if not text.startswith("/"):
        if root is None:
            return None
        text = f"{root.as_posix().rstrip('/')}/{text}"
    parts = text.split("/")
    first = next((i for i, part in enumerate(parts) if "*" in part or "?" in part), len(parts))
    prefix = Path("/".join(parts[:first]) or "/").resolve().as_posix()
    rest = "/".join(parts[first:])
    if rest == "":
        return re.compile(re.escape(prefix))
    base = re.escape(prefix.rstrip("/"))
    if rest == "**":
        return re.compile(f"{base}(?:/.*)?")
    return re.compile(f"{base}/{_glob(rest)}")


def _glob(text: str) -> str:
    out: list[str] = []
    index = 0
    while index < len(text):
        if text.startswith("**/", index):
            out.append("(?:.*/)?")
            index += 3
        elif text.startswith("**", index):
            out.append(".*")
            index += 2
        elif text[index] == "*":
            out.append("[^/]*")
            index += 1
        elif text[index] == "?":
            out.append("[^/]")
            index += 1
        else:
            out.append(re.escape(text[index]))
            index += 1
    return "".join(out)


__all__ = [
    "DEFAULT_SOURCE",
    "Allowance",
    "Call",
    "Decision",
    "Rule",
    "RuleFile",
    "alternatives",
    "check",
    "default_rules",
    "exact_match",
    "matches",
    "path_pattern",
    "session_allows",
]
