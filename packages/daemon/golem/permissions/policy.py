"""Where the rules come from, and one call to check a tool call against them.

Order, first match wins:

1. ``<session folder>/.golem/policy.toml``, the project's rules. Its
   ``allow`` rules count only when the folder is in ``trusted_projects``,
   so a cloned repository cannot allow itself anything. Its ``ask`` and
   ``deny`` rules always apply.
2. ``[[rule]]`` in the user's ``config.toml``.
3. The built-in defaults: read-only tools are allowed, the rest asks.

Each file is read again when it changes. A user file that stops validating
keeps its last good rules. A project file that does not validate makes every
call in that folder ask, so a broken deny rule never turns into an allow.
"""

from __future__ import annotations

import logging
import tomllib
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from golem.config import PolicyRule, RuleAction, ShellSettings
from golem.config_edit import add_rule, remove_rule, set_rule_action
from golem.permissions.engine import (
    Call,
    Decision,
    Rule,
    check,
    default_rules,
    exact_match,
)
from golem.tools.registry import ToolRegistry

log = logging.getLogger("golem.permissions")

PROJECT_POLICY = Path(".golem") / "policy.toml"
UNTRUSTED = "the project is not in trusted_projects"


class _UserFile(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)

    rule: list[PolicyRule] = Field(default_factory=list[PolicyRule])
    trusted_projects: list[str] = Field(default_factory=list[str])
    shell: ShellSettings = Field(default_factory=ShellSettings)


class _ProjectFile(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    rule: list[PolicyRule] = Field(default_factory=list[PolicyRule])


@dataclass(frozen=True, slots=True)
class _Stamp:
    mtime_ns: int
    size: int


class Policy:
    """Rules for the session folder ``root``, from the project, the user, and the defaults."""

    def __init__(self, user_config: Path | None, *, home: Path | None = None) -> None:
        self._user_config = user_config
        self.home = (home if home is not None else Path.home()).resolve()
        self._user: _UserFile = _UserFile()
        self._user_stamp: _Stamp | None = None
        self._projects: dict[Path, tuple[_Stamp | None, list[Rule]]] = {}

    def rules(self, root: Path | None, registry: ToolRegistry) -> list[Rule]:
        """Every rule for a call in ``root``, in the order they are checked."""
        user = self._load_user()
        found: list[Rule] = []
        if root is not None:
            found.extend(self._project_rules(root.resolve(), user))
        label = self._label(self._user_config) if self._user_config is not None else "config.toml"
        found.extend(
            Rule(rule, f"{label} rule {index}", file="user", index=index)
            for index, rule in enumerate(user.rule, start=1)
        )
        found.extend(default_rules(registry.read_only()))
        return found

    def check(
        self,
        registry: ToolRegistry,
        name: str,
        args: Mapping[str, object],
        root: Path | None,
    ) -> Decision:
        """The decision for tool ``name`` called with ``args`` in ``root``."""
        call = describe(registry, name, args, root)
        return check(call, self.rules(root, registry), home=self.home)

    def shell(self) -> ShellSettings:
        """The user's ``[shell]`` settings. A project file cannot change them."""
        return self._load_user().shell

    def file(self, target: Literal["user", "project"], root: Path | None) -> Path:
        """The file rules for ``target`` are written to. ``project`` needs ``root``."""
        if target == "user":
            if self._user_config is None:
                raise ValueError("this daemon has no config file")
            return self._user_config
        if root is None:
            raise ValueError("project rules need a session folder")
        return root.resolve() / PROJECT_POLICY

    def remember(
        self,
        registry: ToolRegistry,
        name: str,
        args: Mapping[str, object],
        root: Path | None,
        target: Literal["user", "project"] = "user",
    ) -> str:
        """Write an ``allow`` rule for exactly this call, first in ``target``.

        Returns the new rule's source.
        """
        path = self.file(target, root)
        add_rule(path, rule_for(registry, name, args, root))
        return f"{self._label(path)} rule 1"

    def edit(
        self,
        target: Literal["user", "project"],
        root: Path | None,
        index: int,
        action: RuleAction | None,
    ) -> None:
        """Set rule ``index``'s action, or delete it when ``action`` is None."""
        path = self.file(target, root)
        if action is None:
            remove_rule(path, index)
        else:
            set_rule_action(path, index, action)

    def trusted(self, root: Path) -> bool:
        return root.resolve() in self._trusted(self._load_user())

    def _project_rules(self, root: Path, user: _UserFile) -> list[Rule]:
        path = root / PROJECT_POLICY
        stamp = _stamp(path)
        cached = self._projects.get(root)
        if cached is not None and cached[0] == stamp:
            rules = cached[1]
        else:
            rules = self._read_project(path, stamp)
            self._projects[root] = (stamp, rules)
        if root in self._trusted(user):
            return rules
        return [
            Rule(rule.rule, rule.source, UNTRUSTED, rule.file, rule.index)
            if rule.rule.action == "allow"
            else rule
            for rule in rules
        ]

    def _read_project(self, path: Path, stamp: _Stamp | None) -> list[Rule]:
        if stamp is None:
            return []
        label = self._label(path)
        try:
            parsed = _ProjectFile.model_validate(tomllib.loads(path.read_text(encoding="utf-8")))
        except (OSError, tomllib.TOMLDecodeError, ValidationError) as exc:
            log.warning("ignoring the rules in %s: %s", path, _first_line(exc))
            return [Rule(PolicyRule(tool="*", action="ask"), f"{label} (invalid)")]
        return [
            Rule(rule, f"{label} rule {index}", file="project", index=index)
            for index, rule in enumerate(parsed.rule, start=1)
        ]

    def _load_user(self) -> _UserFile:
        if self._user_config is None:
            return self._user
        stamp = _stamp(self._user_config)
        if stamp == self._user_stamp:
            return self._user
        self._user_stamp = stamp
        if stamp is None:
            self._user = _UserFile()
            return self._user
        try:
            raw = tomllib.loads(self._user_config.read_text(encoding="utf-8"))
            self._user = _UserFile.model_validate(raw)
        except (OSError, tomllib.TOMLDecodeError, ValidationError) as exc:
            log.warning(
                "keeping the last good rules; %s does not validate: %s",
                self._user_config,
                _first_line(exc),
            )
        return self._user

    def _trusted(self, user: _UserFile) -> set[Path]:
        trusted: set[Path] = set()
        for raw in user.trusted_projects:
            path = Path(raw).expanduser()
            if path.is_absolute():
                trusted.add(path.resolve())
        return trusted

    def _label(self, path: Path) -> str:
        try:
            return f"~/{path.resolve().relative_to(self.home).as_posix()}"
        except ValueError:
            return path.as_posix()


def rule_for(
    registry: ToolRegistry, name: str, args: Mapping[str, object], root: Path | None
) -> PolicyRule:
    """An ``allow`` rule that covers this call: its exact subject, else its exact path.

    A tool whose subject is not an argument of its own, such as a file
    tool's path relative to the folder, gets the exact path instead.
    """
    call = describe(registry, name, args, root)
    tool = registry.get(name)
    by_match = tool is None or tool.match_arg is not None or tool.path_arg is None
    if call.subject and by_match:
        return PolicyRule(tool=name, match=exact_match(call.subject), action="allow")
    if call.path is not None:
        return PolicyRule(tool=name, path=call.path.as_posix(), action="allow")
    return PolicyRule(tool=name, action="allow")


def describe(
    registry: ToolRegistry, name: str, args: Mapping[str, object], root: Path | None
) -> Call:
    """What the rules see of a call: its subject and the path it touches."""
    tool = registry.get(name)
    if tool is None:
        return Call(tool=name, root=root)
    subject: str | None = None
    if tool.subject is not None:
        subject = tool.subject(args, root)
    elif tool.match_arg is not None:
        raw = args.get(tool.match_arg)
        subject = raw if isinstance(raw, str) else None
    path: Path | None = None
    if tool.path_arg is not None:
        raw = args.get(tool.path_arg)
        path = _resolve(raw if isinstance(raw, str) else "", root)
    return Call(tool=name, subject=subject, path=path, root=root)


def explain(decision: Decision, name: str) -> str:
    """What the model reads when a rule keeps a call from running."""
    if decision.action == "deny":
        return f"{name} is denied by {decision.source}"
    return f"{name} needs the user's approval ({decision.source})"


def _resolve(raw: str, root: Path | None) -> Path | None:
    try:
        path = Path(raw).expanduser() if raw.strip() else Path()
        if not path.is_absolute():
            if root is None:
                return None
            path = root / path
        return path.resolve()
    except (OSError, RuntimeError, ValueError):
        return None


def _stamp(path: Path) -> _Stamp | None:
    try:
        stat = path.stat()
    except OSError:
        return None
    return _Stamp(stat.st_mtime_ns, stat.st_size)


def _first_line(exc: Exception) -> str:
    return str(exc).strip().splitlines()[0] if str(exc).strip() else type(exc).__name__


__all__ = ["PROJECT_POLICY", "UNTRUSTED", "Policy", "describe", "explain", "rule_for"]
