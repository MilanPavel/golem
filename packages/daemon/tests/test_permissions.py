"""The permission engine: rule matching, order, and where rules come from."""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from pydantic import BaseModel

from golem.config import PolicyRule, RuleAction
from golem.permissions.engine import DEFAULT_SOURCE, Call, Rule, check, default_rules, path_pattern
from golem.permissions.policy import UNTRUSTED, Policy, describe, explain
from golem.tools import default_registry
from golem.tools.fs import READ_ONLY_TOOLS
from golem.tools.registry import Tool, ToolContext, ToolRegistry, ToolResult

HOME = Path("/Users/me")
ROOT = Path("/Users/me/code/app")


def _rule(action: RuleAction, **fields: str) -> Rule:
    return Rule(PolicyRule(action=action, **fields), "test")  # type: ignore[arg-type]


def _call(tool: str, *, subject: str | None = None, path: str | None = None) -> Call:
    return Call(tool=tool, subject=subject, path=None if path is None else Path(path), root=ROOT)


@pytest.mark.parametrize(
    ("rule", "call", "hit"),
    [
        (_rule("allow", tool="*"), _call("shell"), True),
        (_rule("allow", tool="read_*"), _call("read_file"), True),
        (_rule("allow", tool="read_*"), _call("write_file"), False),
        (
            _rule("allow", tool="shell", match="git status|git diff*|ls*"),
            _call("shell", subject="git diff --stat"),
            True,
        ),
        (
            _rule("allow", tool="shell", match="git status|git diff*|ls*"),
            _call("shell", subject="ls -la"),
            True,
        ),
        (
            _rule("allow", tool="shell", match="git status|git diff*|ls*"),
            _call("shell", subject="git push"),
            False,
        ),
        (_rule("allow", tool="shell", match="git status"), _call("shell"), False),
        (_rule("ask", path="~/code/**"), _call("write_file", path="/Users/me/code/app/a.py"), True),
        (_rule("ask", path="~/code/**"), _call("write_file", path="/Users/me/code"), True),
        (_rule("ask", path="~/code/**"), _call("write_file", path="/Users/me/notes.md"), False),
        (_rule("ask", path="~/code/*"), _call("write_file", path="/Users/me/code/app/a.py"), False),
        (
            _rule("deny", path="secrets/**"),
            _call("read_file", path="/Users/me/code/app/secrets/k"),
            True,
        ),
        (_rule("deny", path="**/*.env"), _call("read_file", path="/Users/me/code/app/.env"), True),
        (
            _rule("deny", path="**/.env"),
            _call("read_file", path="/Users/me/code/app/sub/.env"),
            True,
        ),
        (_rule("deny", path="**/.env"), _call("read_file", path="/Users/me/code/app/.env"), True),
        (_rule("deny", path="*.md"), _call("read_file", path="/Users/me/code/app/README.md"), True),
        (
            _rule("deny", path="*.md"),
            _call("read_file", path="/Users/me/code/app/docs/a.md"),
            False,
        ),
        (_rule("deny", path="a.py"), _call("read_file"), False),
        (
            _rule("deny", tool="grep", match="*password*"),
            _call("grep", subject="find password here"),
            True,
        ),
    ],
)
def test_rule_matching(rule: Rule, call: Call, hit: bool) -> None:
    decision = check(call, [rule], home=HOME)
    assert (decision.source == "test") is hit


def test_the_first_matching_rule_wins() -> None:
    rules = [
        _rule("deny", tool="read_file", path="secrets/**"),
        _rule("allow", tool="read_file"),
        *default_rules(["read_file"]),
    ]
    secret = check(_call("read_file", path="/Users/me/code/app/secrets/k"), rules, home=HOME)
    plain = check(_call("read_file", path="/Users/me/code/app/a.py"), rules, home=HOME)
    assert (secret.action, plain.action) == ("deny", "allow")


def test_defaults_allow_read_only_tools_and_ask_for_the_rest() -> None:
    rules = default_rules(["read_file", "grep"])
    assert check(_call("grep"), rules, home=HOME).action == "allow"
    shell = check(_call("shell"), rules, home=HOME)
    assert (shell.action, shell.source) == ("ask", DEFAULT_SOURCE)
    assert check(_call("shell"), [], home=HOME).action == "ask"


def test_an_ignored_rule_never_matches() -> None:
    ignored = Rule(PolicyRule(tool="*", action="allow"), "project", UNTRUSTED)
    assert check(_call("shell"), [ignored, *default_rules([])], home=HOME).action == "ask"


def test_a_relative_path_glob_needs_a_session_folder() -> None:
    assert path_pattern("src/**", root=None, home=HOME) is None
    assert path_pattern("/abs/**", root=None, home=HOME) is not None


def test_the_path_glob_prefix_is_resolved(tmp_path: Path) -> None:
    real = tmp_path / "real"
    (real / "src").mkdir(parents=True)
    link = tmp_path / "link"
    link.symlink_to(real)
    pattern = path_pattern(f"{link}/src/*", root=None, home=HOME)
    assert pattern is not None
    assert pattern.fullmatch((real / "src" / "a.py").resolve().as_posix())


def test_describe_reads_the_tools_path_and_subject(tmp_path: Path) -> None:
    registry = default_registry()
    call = describe(registry, "grep", {"pattern": "TODO", "path": "src"}, tmp_path)
    assert (call.subject, call.path) == ("TODO", (tmp_path / "src").resolve())
    listed = describe(registry, "list_dir", {}, tmp_path)
    assert listed.path == tmp_path.resolve()
    unknown = describe(registry, "shell", {"command": "ls"}, tmp_path)
    assert (unknown.subject, unknown.path) == (None, None)


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    stat = path.stat()
    os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns + 1_000_000))


@pytest.fixture
def project(tmp_path: Path) -> Path:
    root = tmp_path / "project"
    root.mkdir()
    return root


def test_project_rules_come_before_user_rules(tmp_path: Path, project: Path) -> None:
    user = tmp_path / "config.toml"
    _write(user, '[[rule]]\ntool = "read_file"\naction = "deny"\n')
    _write(
        project / ".golem" / "policy.toml",
        '[[rule]]\ntool = "read_file"\npath = "docs/**"\naction = "ask"\n',
    )
    policy = Policy(user, home=tmp_path)
    registry = default_registry()
    sources = [rule.source for rule in policy.rules(project, registry)]
    assert sources[:2] == ["~/project/.golem/policy.toml rule 1", "~/config.toml rule 1"]
    assert sources[-1] == DEFAULT_SOURCE
    docs = policy.check(registry, "read_file", {"path": "docs/a.md"}, project)
    other = policy.check(registry, "read_file", {"path": "a.md"}, project)
    assert (docs.action, other.action) == ("ask", "deny")


def test_a_project_cannot_allow_itself_anything_until_trusted(
    tmp_path: Path, project: Path
) -> None:
    user = tmp_path / "config.toml"
    _write(user, "")
    _write(
        project / ".golem" / "policy.toml",
        '[[rule]]\ntool = "*"\naction = "allow"\n\n[[rule]]\ntool = "grep"\naction = "deny"\n',
    )
    registry = _registry_with_shell()
    policy = Policy(user, home=tmp_path)
    assert policy.check(registry, "shell", {"command": "rm -rf /"}, project).action == "ask"
    assert policy.check(registry, "grep", {"pattern": "x"}, project).action == "deny"
    ignored = [rule for rule in policy.rules(project, registry) if rule.ignored is not None]
    assert [rule.ignored for rule in ignored] == [UNTRUSTED]

    _write(user, f'trusted_projects = ["{project}"]\n')
    assert policy.trusted(project)
    assert policy.check(registry, "shell", {"command": "ls"}, project).action == "allow"


def test_an_invalid_project_policy_asks_for_everything(tmp_path: Path, project: Path) -> None:
    _write(project / ".golem" / "policy.toml", '[[rule]]\ntool = "read_file"\naction = "maybe"\n')
    policy = Policy(None, home=tmp_path)
    decision = policy.check(default_registry(), "read_file", {"path": "a"}, project)
    assert decision.action == "ask"
    assert decision.source.endswith("policy.toml (invalid)")


def test_a_broken_user_config_keeps_its_last_good_rules(tmp_path: Path, project: Path) -> None:
    user = tmp_path / "config.toml"
    _write(user, '[[rule]]\ntool = "grep"\naction = "deny"\n')
    policy = Policy(user, home=tmp_path)
    registry = default_registry()
    assert policy.check(registry, "grep", {"pattern": "x"}, project).action == "deny"
    _write(user, "[[rule]\nbroken")
    assert policy.check(registry, "grep", {"pattern": "x"}, project).action == "deny"
    _write(user, "")
    assert policy.check(registry, "grep", {"pattern": "x"}, project).action == "allow"


def test_the_model_hears_why_a_call_did_not_run() -> None:
    deny = check(_call("shell"), [_rule("deny", tool="shell")], home=HOME)
    assert explain(deny, "shell") == "shell is denied by test"
    ask = check(_call("shell"), [], home=HOME)
    assert explain(ask, "shell") == "shell needs the user's approval (built-in default)"


class _ShellArgs(BaseModel):
    command: str


async def _never(args: _ShellArgs, ctx: ToolContext) -> ToolResult:
    del args, ctx
    raise AssertionError("a refused call must not run")


def _registry_with_shell() -> ToolRegistry:
    shell = Tool(name="shell", description="", args=_ShellArgs, run=_never, match_arg="command")
    return ToolRegistry([*READ_ONLY_TOOLS, shell])
