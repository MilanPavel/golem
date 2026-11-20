"""Read one agent file and say exactly what is wrong with it.

An agent file is ``agents/<name>.md``: frontmatter, then the prompt. It is read
the way a ``SKILL.md`` is (same frontmatter rules, same name rules), and the
problems are listed in ``errors``, never raised.

Frontmatter fields:

- ``name``: optional; the file name (without ``.md``) names the agent.
- ``description``: required; the lead model reads it to pick a type.
- ``model``: the wish, one of ``cheapest``, ``same``, ``stronger``, ``local``,
  ``budget``, ``frontier``, or a model name. Default ``cheapest``.
- ``tools``: names of golem's tools, as text or a list. Left out means none.
- ``max-calls``, ``max-seconds``, ``max-cost-usd``, ``max-answer-chars``: limits.
- ``asks``: true when the helper may ask you a question. Default false.
"""

from __future__ import annotations

import functools
import hashlib
import re
from pathlib import Path
from typing import Any, cast

from golem.agents.model import AGENT_SUFFIX, WISHES, Agent, AgentLimits
from golem.skills.parse import (
    MAX_DESCRIPTION,
    MAX_FRONTMATTER_BYTES,
    MAX_NAME,
    NAME,
    flag_field,
    frontmatter_fields,
    kb,
    split_frontmatter,
    split_tools,
    text_field,
)

MAX_FILE_BYTES = 128 << 10
"""A bigger agent file is an error: its body is a prompt, not a document."""

KNOWN = frozenset(
    {
        "name",
        "description",
        "model",
        "tools",
        "max-calls",
        "max-seconds",
        "max-cost-usd",
        "max-answer-chars",
        "asks",
    }
)

_WISH = re.compile(r"\S+")


@functools.cache
def builtin_tool_names() -> frozenset[str]:
    """The names of golem's own tools: what an agent file may list under ``tools``."""
    from golem.tools import default_registry  # here, so importing agents loads no tools

    return frozenset(default_registry().names)


def parse_agent(path: Path, *, known_tools: frozenset[str] | None = None) -> Agent:
    """Parse the agent file ``path``. Never raises for a bad file: the problems are in ``errors``.

    ``known_tools`` is the set of tool names a file may list. It defaults to
    :func:`builtin_tool_names`.
    """
    real = _real(path)
    try:
        with path.open("rb") as file:
            data = file.read(MAX_FILE_BYTES + 1)
    except OSError as error:
        return _broken(path, real, f"cannot read {path.name}: {error.strerror or error}")
    digest = hashlib.sha256(data).hexdigest()

    errors: list[str] = []
    if len(data) > MAX_FILE_BYTES:
        return _broken(
            path, real, f"{path.name} is over the {kb(MAX_FILE_BYTES)} limit", digest=digest
        )

    split = split_frontmatter(
        data[:MAX_FRONTMATTER_BYTES], complete=len(data) <= MAX_FRONTMATTER_BYTES
    )
    if isinstance(split, str):
        return _broken(path, real, split, digest=digest)
    raw, body_offset = split
    try:
        body = data[body_offset:].decode("utf-8").strip()
    except UnicodeDecodeError:
        return _broken(path, real, "the file is not UTF-8", digest=digest)
    fields = frontmatter_fields(raw, errors)

    name = _name(fields, path, errors)
    description = text_field(fields, "description", errors)
    if not description:
        errors.append("`description` is missing: the lead model needs it to pick this type")
    elif len(description) > MAX_DESCRIPTION:
        errors.append(f"`description` is {len(description)} characters, over {MAX_DESCRIPTION}")
    wish = _wish(fields, errors)
    tools = _tools(fields, known_tools or builtin_tool_names(), errors)
    limits = AgentLimits(
        max_calls=_count(fields, "max-calls", errors),
        max_seconds=_count(fields, "max-seconds", errors),
        max_cost_usd=_cost(fields, errors),
        answer_chars=_count(fields, "max-answer-chars", errors),
    )
    asks = flag_field(fields, "asks", False, errors)
    if not body:
        errors.append("the prompt is empty: write it after the frontmatter")

    return Agent(
        name=name,
        description=description or "",
        path=path,
        real_path=real,
        hash=digest,
        wish=wish,
        tools=tools,
        limits=limits,
        asks=asks,
        body=body,
        extras={key: value for key, value in fields.items() if key not in KNOWN},
        errors=tuple(errors),
    )


def _name(fields: dict[str, Any], path: Path, errors: list[str]) -> str:
    stem = path.name.removesuffix(AGENT_SUFFIX)
    given = text_field(fields, "name", errors)
    name = given or stem
    if len(name) > MAX_NAME or not NAME.fullmatch(name):
        what = "`name`" if given else "the file name"
        errors.append(
            f"{what} {name!r} must be 1-{MAX_NAME} lowercase letters, digits, "
            "and single hyphens, such as `code-reviewer`"
        )
    elif given and given != stem:
        errors.append(f"`name` is {given!r} but the file is {path.name!r}: they must match")
    return name


def _wish(fields: dict[str, Any], errors: list[str]) -> str:
    wish = text_field(fields, "model", errors)
    if wish is None:
        return "cheapest"
    if not _WISH.fullmatch(wish):
        errors.append(f"`model` {wish!r} must be one of {', '.join(WISHES)}, or a model name")
        return "cheapest"
    return wish


def _tools(fields: dict[str, Any], known: frozenset[str], errors: list[str]) -> tuple[str, ...]:
    value = fields.get("tools")
    if value is None:
        return ()
    if isinstance(value, str):
        names = split_tools(value)
    elif isinstance(value, list) and all(
        isinstance(item, str) for item in cast(list[object], value)
    ):
        names = [item.strip() for item in cast(list[str], value) if item.strip()]
    else:
        errors.append("`tools` must be text or a list of tool names")
        return ()
    unknown = [name for name in names if name not in known]
    if unknown:
        errors.append(
            "`tools` names tools golem does not have: "
            f"{', '.join(unknown)} (known: {', '.join(sorted(known))})"
        )
    return tuple(dict.fromkeys(names))


def _count(fields: dict[str, Any], key: str, errors: list[str]) -> int | None:
    value = fields.get(key)
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        errors.append(f"`{key}` must be a whole number, 1 or more")
        return None
    return value


def _cost(fields: dict[str, Any], errors: list[str]) -> float | None:
    value = fields.get("max-cost-usd")
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int | float) or value <= 0:
        errors.append("`max-cost-usd` must be a number above 0")
        return None
    return float(value)


def _real(path: Path) -> Path:
    try:
        return path.resolve()
    except (OSError, RuntimeError):  # a symlink loop
        return path


def _broken(path: Path, real: Path, error: str, *, digest: str = "") -> Agent:
    return Agent(
        name=path.name.removesuffix(AGENT_SUFFIX),
        description="",
        path=path,
        real_path=real,
        hash=digest,
        errors=(error,),
    )


__all__ = ["KNOWN", "MAX_FILE_BYTES", "builtin_tool_names", "parse_agent"]
