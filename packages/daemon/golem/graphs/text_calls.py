"""Tool calls a model wrote as text.

Some models (Qwen's coder line on Ollama) write a call as markup in the reply
instead of a real tool call. Ollama only reads such a call after the model's
opening ``<tool_call>`` token, so a reply that leaves it out comes back as plain
text with no tool calls. :func:`recover` turns well-formed markup for an offered
tool back into calls. It is strict: a reply is recovered whole or not at all.
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping
from typing import cast

from langchain_core.messages.tool import ToolCall

from golem.sessions.ids import new_id

_PARAMETER = r"<parameter=([^>\s]+)>(.*?)</parameter>\s*"
_BLOCK = re.compile(
    r"(?:<tool_call>\s*)?<function=([^>\s]+)>\s*((?:" + _PARAMETER + r")*)</function>\s*"
    r"(?:</tool_call>\s*)?",
    re.DOTALL,
)
_PARAMETERS = re.compile(_PARAMETER, re.DOTALL)


def recover(text: str, schemas: list[dict[str, object]]) -> tuple[str, list[ToolCall]] | None:
    """The calls written as text in ``text``, and ``text`` without them.

    ``schemas`` are the tool schemas offered to the model. Returns None, and
    the reply stays as it is, when ``text`` has no call, or when any block names
    a tool that was not offered, a key the tool does not have, a value that is
    not valid JSON for a non-string key, or is not closed.
    """
    offered = _offered(schemas)
    calls: list[ToolCall] = []
    kept: list[str] = []
    end = 0
    for block in _BLOCK.finditer(text):
        properties = offered.get(block.group(1))
        if properties is None:
            return None
        args = _args(block.group(2), properties)
        if args is None:
            return None
        calls.append(ToolCall(name=block.group(1), args=args, id=new_id("c")))
        kept.append(text[end : block.start()])
        end = block.end()
    kept.append(text[end:])
    rest = "".join(kept)
    if not calls or "<function=" in rest:
        return None
    return rest.rstrip(), calls


def _args(body: str, properties: Mapping[str, object]) -> dict[str, object] | None:
    args: dict[str, object] = {}
    for key, raw in _PARAMETERS.findall(body):
        spec = properties.get(key)
        if spec is None:
            return None
        value = raw.removeprefix("\n").removesuffix("\n")
        kinds = _types(spec)
        if not kinds or "string" in kinds:
            args[key] = value
            continue
        try:
            args[key] = cast(object, json.loads(value))
        except ValueError:
            return None
    return args


def _types(spec: object) -> set[str]:
    """The JSON types a property allows, from ``type`` or its ``anyOf``/``oneOf`` branches.

    ``null`` is left out, so an optional integer reads as an integer. An empty
    set means the schema does not say, and the value is kept as text.
    """
    if not isinstance(spec, dict):
        return set()
    spec = cast(dict[str, object], spec)
    kind = spec.get("type")
    found: set[str] = set()
    if isinstance(kind, str):
        found.add(kind)
    elif isinstance(kind, list):
        found.update(k for k in cast(list[object], kind) if isinstance(k, str))
    for union in ("anyOf", "oneOf"):
        branches = spec.get(union)
        if isinstance(branches, list):
            for branch in cast(list[object], branches):
                found |= _types(branch)
    found.discard("null")
    return found


def _offered(schemas: list[dict[str, object]]) -> dict[str, Mapping[str, object]]:
    """The property schemas of each offered tool, by tool name."""
    offered: dict[str, Mapping[str, object]] = {}
    for schema in schemas:
        function = schema.get("function")
        if not isinstance(function, dict):
            continue
        function = cast(dict[str, object], function)
        name = function.get("name")
        parameters = function.get("parameters")
        if not isinstance(name, str) or not isinstance(parameters, dict):
            continue
        properties = cast(dict[str, object], parameters).get("properties", {})
        offered[name] = (
            cast(Mapping[str, object], properties) if isinstance(properties, dict) else {}
        )
    return offered
