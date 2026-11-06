"""Check a whole ``config.toml`` text before it is written.

The browser's editor and the terminal's both go through this. It finds, with
a line number when it can: TOML that does not parse, settings that do not
validate, a change inside a protected section (browser only), a server that
names another server's secret, and a changed server address whose stored
secret was not sent again (ADR-037).
"""

from __future__ import annotations

import re
import tomllib
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any, cast

from pydantic import TypeAdapter, ValidationError

from golem.config import (
    PROTECTED_SETTINGS,
    PROTECTED_SKILL_SETTINGS,
    GolemSettings,
    McpServers,
    McpServerSettings,
)

READ_AT_START = frozenset(
    {
        "providers",
        "models",
        "ollama",
        "web",
        "log_level",
        "model_provider",
        "model_name",
        "model_profile",
        "model_base_url",
    }
)
"""Top-level sections the daemon reads only when it starts."""

ADDRESS_FIELDS = ("url", "command", "args", "cwd")
_MCP: TypeAdapter[McpServers] = TypeAdapter(McpServers)
_DECODE_AT = re.compile(r"\(at line (\d+), column (\d+)\)")


@dataclass(frozen=True, slots=True)
class Issue:
    """One problem in a config text. ``line`` and ``column`` count from 1."""

    message: str
    line: int | None = None
    column: int | None = None
    path: str | None = None


@dataclass(frozen=True, slots=True)
class Checked:
    """The result of :func:`check_text`: the problems, and what needs a restart."""

    issues: list[Issue]
    restart_needed: list[str]


Stored = Callable[[str], bool]
"""Whether the secret store has ``mcp/<name>``."""


def check_text(
    text: str,
    current: str,
    *,
    project: bool = False,
    protected: bool = True,
    stored: Stored = lambda _ref: False,
) -> Checked:
    """Check ``text``, which is to replace ``current``.

    ``protected`` refuses a change in the protected sections. ``project`` checks
    a project's file, which holds ``[mcp.*]`` tables and nothing else.
    """
    try:
        data = tomllib.loads(text)
    except tomllib.TOMLDecodeError as exc:
        found = _DECODE_AT.search(str(exc))
        line, column = (int(found.group(1)), int(found.group(2))) if found else (None, None)
        return Checked([Issue(_strip_position(str(exc)), line, column)], [])
    issues = _project_issues(text, data) if project else _settings_issues(text, data)
    old = _loads(current)
    issues += _mcp_issues(text, data, old, stored)
    if protected and not project:
        issues += _protected_issues(text, data, old)
    restart = [] if project else _restart_needed(data, old)
    return Checked(_unique(issues), restart)


def _strip_position(message: str) -> str:
    return _DECODE_AT.sub("", message).strip()


def _loads(text: str) -> dict[str, Any]:
    try:
        return tomllib.loads(text)
    except tomllib.TOMLDecodeError:
        return {}


def _settings_issues(text: str, data: dict[str, Any]) -> list[Issue]:
    try:
        # Validated as data, so no environment variable and no other file changes the verdict.
        GolemSettings.model_validate(data)
    except ValidationError as exc:
        return _from_validation(text, exc)
    return []


def _project_issues(text: str, data: dict[str, Any]) -> list[Issue]:
    issues = [
        Issue(
            f"{key} is not allowed in a project config.toml: it holds only [mcp.*] tables",
            _line_of(text, [key]),
            path=key,
        )
        for key in data
        if key != "mcp"
    ]
    try:
        _MCP.validate_python(data.get("mcp", {}))
    except ValidationError as exc:
        issues += _from_validation(text, exc, prefix=["mcp"])
    return issues


def _from_validation(
    text: str, exc: ValidationError, prefix: list[str] | None = None
) -> list[Issue]:
    issues: list[Issue] = []
    for error in exc.errors():
        loc = [*(prefix or []), *(str(part) for part in error["loc"])]
        message = re.sub(r"^Value error, ", "", error["msg"])
        if error["type"] == "extra_forbidden":
            message = "unknown setting"
        line = _line_of(text, loc)
        issues.append(Issue(message, line, path=".".join(loc) or None))
    return issues


def _line_of(text: str, loc: list[str]) -> int | None:
    """The line for setting ``loc``, best effort: its key, else its table's header."""
    lines = text.splitlines()
    headers = [(index, _header(line)) for index, line in enumerate(lines)]
    best: tuple[int, int] | None = None  # (index, number of loc parts the header covers)
    for index, header in headers:
        if header is None:
            continue
        covers = _common(header, loc)
        if covers == len(header) and (best is None or covers >= best[1]):
            best = (index, covers)
    start, covered = (best[0] + 1, best[1]) if best else (0, 0)
    if covered < len(loc):
        key = loc[covered]
        for index in range(start, len(lines)):
            if _header(lines[index]) is not None and index != start - 1:
                break
            if re.match(rf"\s*{re.escape(key)}\s*=", lines[index]) or re.search(
                rf"[{{,]\s*{re.escape(key)}\s*=", lines[index]
            ):
                return index + 1
    if best is not None:
        return best[0] + 1
    for index, header in headers:
        if header is not None and header[: len(loc)] == loc:
            return index + 1
    for index, line in enumerate(lines):
        if re.match(rf"\s*{re.escape(loc[0])}\s*=", line) if loc else False:
            return index + 1
    return None


def _header(line: str) -> list[str] | None:
    found = re.match(r"^\s*\[\[?\s*([^\[\]]+?)\s*\]\]?\s*(#.*)?$", line)
    if found is None:
        return None
    return [part.strip().strip("\"'") for part in found.group(1).split(".")]


def _common(header: list[str], loc: list[str]) -> int:
    count = 0
    for left, right in zip(header, loc, strict=False):
        if left != right:
            break
        count += 1
    return count


def _servers(data: Mapping[str, Any]) -> dict[str, Mapping[str, Any]]:
    mcp = data.get("mcp")
    if not isinstance(mcp, dict):
        return {}
    return {
        name: cast(Mapping[str, Any], table)
        for name, table in cast(dict[str, object], mcp).items()
        if isinstance(table, dict)
    }


def _mcp_issues(
    text: str, data: dict[str, Any], old: dict[str, Any], stored: Stored
) -> list[Issue]:
    """A changed server names only its own secrets, and a redirected one needs them sent again."""
    issues: list[Issue] = []
    before = _servers(old)
    for name, table in _servers(data).items():
        if before.get(name) == table:
            continue
        try:
            settings = McpServerSettings.model_validate(table)
        except ValidationError:
            continue  # reported with the others
        line = _line_of(text, ["mcp", name])
        path = f"mcp.{name}"
        for ref in settings.secrets:
            if not owns(name, ref):
                issues.append(
                    Issue(
                        f"{name} may name only its own secrets, mcp/{name} or mcp/{name}-…, "
                        f"not {ref}",
                        line,
                        path=path,
                    )
                )
        previous = before.get(name)
        if previous is not None and _moved(previous, table):
            for ref in settings.secrets:
                if stored(ref):
                    issues.append(
                        Issue(
                            f"{name} changed where it runs or connects and names the stored "
                            f"secret {ref}: edit it in its form and send the secret again",
                            line,
                            path=path,
                        )
                    )
                    break
    return issues


def owns(name: str, ref: str) -> bool:
    """Whether server ``name`` may name secret ``ref``: ``mcp/<name>`` or ``mcp/<name>-…``."""
    return ref == f"mcp/{name}" or ref.startswith(f"mcp/{name}-")


def _moved(before: Mapping[str, Any], after: Mapping[str, Any]) -> bool:
    return any(before.get(field) != after.get(field) for field in ADDRESS_FIELDS)


def _protected_issues(text: str, data: dict[str, Any], old: dict[str, Any]) -> list[Issue]:
    issues: list[Issue] = []
    for key in sorted(PROTECTED_SETTINGS):
        if data.get(key) != old.get(key):
            issues.append(_refused(text, key))
    skills, was = data.get("skills"), old.get("skills")
    new_skills = cast(dict[str, Any], skills) if isinstance(skills, dict) else {}
    old_skills = cast(dict[str, Any], was) if isinstance(was, dict) else {}
    for key in sorted(PROTECTED_SKILL_SETTINGS):
        if new_skills.get(key) != old_skills.get(key):
            issues.append(_refused(text, f"skills.{key}"))
    return issues


def _refused(text: str, path: str) -> Issue:
    return Issue(
        f"{path} can't be changed from a browser: it decides where a key goes or what golem "
        "trusts. Change it in a terminal",
        _line_of(text, path.split(".")),
        path=path,
    )


def _restart_needed(data: dict[str, Any], old: dict[str, Any]) -> list[str]:
    return sorted(key for key in READ_AT_START if data.get(key) != old.get(key))


def _unique(issues: list[Issue]) -> list[Issue]:
    seen: set[Issue] = set()
    unique: list[Issue] = []
    for issue in issues:
        if issue not in seen:
            seen.add(issue)
            unique.append(issue)
    return unique


__all__ = ["ADDRESS_FIELDS", "READ_AT_START", "Checked", "Issue", "check_text", "owns"]
