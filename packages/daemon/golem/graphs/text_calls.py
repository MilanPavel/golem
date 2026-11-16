"""Tool calls a model wrote as text.

Some models (Qwen's coder line on Ollama) write a call as markup in the reply
instead of a real tool call. Ollama only reads such a call after the model's
opening ``<tool_call>`` token, so a reply that leaves it out comes back as plain
text with no tool calls. :func:`recover` turns well-formed markup for an offered
tool back into calls. It is strict: a reply is recovered whole or not at all.

Small Llama models write the JSON form instead, a reply that is nothing but call
objects. :func:`recover_json` reads that form the same strict way.
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping
from typing import Literal, cast

from langchain_core.messages.tool import ToolCall

from golem.sessions.ids import new_id

_PARAMETER = r"<parameter=([^>\s]+)>(.*?)</parameter>\s*"
_BLOCK = re.compile(
    r"(?:<tool_call>\s*)?<function=([^>\s]+)>\s*((?:" + _PARAMETER + r")*)</function>\s*"
    r"(?:</tool_call>\s*)?",
    re.DOTALL,
)
_PARAMETERS = re.compile(_PARAMETER, re.DOTALL)
_FENCE = re.compile(r"```[A-Za-z]*[ \t]*\n?(.*?)\s*```", re.DOTALL)

# A reply that opens like a call object: broken JSON after this is a call that cannot be read.
_CALL_START = re.compile(
    r'\{\s*"(?:type"\s*:\s*"function"|function"\s*:\s*\{|name"\s*:\s*"[^"]*"\s*,\s*"(?:parameters|arguments)")'
)
MAX_MISSING_BRACES = 3

Unread = Literal["unread"]
"""The reply is shaped like a call, but its tool or a key is not offered."""


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


def recover_json(text: str, schemas: list[dict[str, object]]) -> list[ToolCall] | Unread | None:
    """The calls a reply wrote as JSON objects, ``"unread"``, or None for no call.

    The whole reply, after trimming and removing one code fence, must be one
    object or several in a row, each shaped like ``{"type": "function",
    "function": {"name": …, "parameters": {…}}}`` or ``{"name": …, "parameters":
    {…}}``; ``arguments`` means ``parameters`` and may be a JSON string. Any
    other reply is no call. Calls are recovered whole: when one names a tool
    that was not offered or a key the tool does not have, the result is
    ``"unread"``. A reply that leaves out its last closing braces is read with
    them added; one that opens like a call but is broken JSON is ``"unread"``.
    """
    body = _unfenced(text)
    objects = _objects(body) or _closed(body)
    if not objects:
        return "unread" if _CALL_START.match(body) and _broken(body) else None
    shaped: list[tuple[str, object]] = []
    for obj in objects:
        found = _shaped(obj)
        if found is None:
            return None
        shaped.append(found)
    offered = _offered(schemas)
    calls: list[ToolCall] = []
    for name, raw in shaped:
        properties = offered.get(name)
        if isinstance(raw, str):
            try:
                raw = cast(object, json.loads(raw))
            except ValueError:
                return "unread"
        if properties is None or not isinstance(raw, dict):
            return "unread"
        args = cast(dict[str, object], raw)
        if any(key not in properties for key in args):
            return "unread"
        calls.append(ToolCall(name=name, args=args, id=new_id("c")))
    return calls


_LINE_START = re.compile(r"^[ \t]*(?:```[A-Za-z]*[ \t]*\n[ \t]*)?(?=\{)", re.MULTILINE)
_ENVELOPE = frozenset({"type", "function", "name", "parameters", "arguments"})


def recover_json_tail(
    text: str, schemas: list[dict[str, object]]
) -> tuple[str, list[ToolCall]] | Unread | None:
    """Like :func:`recover_json`, for a reply that says something first and then writes the call.

    Small models often write a sentence ("I will use the delegate function.") and then the
    call object on its own line. The call must start a line and run to the end of the reply.
    Returns the words before it and the calls, ``"unread"``, or None for no call.
    """
    whole = recover_json(text, schemas)
    if isinstance(whole, list):
        return "", whole
    if whole is not None:
        return whole
    for start in _LINE_START.finditer(text):
        if start.start() == 0 and not text[: start.end()].strip():
            continue  # the whole reply: read above
        tail = text[start.start() :]
        if not _CALL_START.match(_unfenced(tail)):
            continue
        found = recover_json(tail, schemas)
        if isinstance(found, list):
            return text[: start.start()].rstrip(), found
        if found is not None:
            return found
    return None


def unwrapped(
    name: str, args: Mapping[str, object], schemas: list[dict[str, object]]
) -> dict[str, object] | None:
    """The real arguments of a call whose arguments are a whole call object, else None.

    A small model sometimes makes a real tool call but puts the call's envelope inside it:
    ``{"type": "function", "function": "delegate", "parameters": {…}}``. When the tool has
    no such keys of its own and the inner object fits the tool, the inner object is meant.
    """
    properties = _offered(schemas).get(name)
    if properties is None or not args or not set(args) <= _ENVELOPE:
        return None
    if any(key in properties for key in args):
        return None
    inner = args.get("parameters", args.get("arguments"))
    if isinstance(inner, str):
        try:
            inner = cast(object, json.loads(inner))
        except ValueError:
            return None
    if not isinstance(inner, dict):
        return None
    found = cast(dict[str, object], inner)
    return found if all(key in properties for key in found) else None


def _unfenced(text: str) -> str:
    text = text.strip()
    fence = _FENCE.fullmatch(text)
    return fence.group(1) if fence else text


def _objects(text: str) -> list[dict[str, object]]:
    """The JSON objects ``text`` is made of, or none when it holds anything else."""
    decoder = json.JSONDecoder()
    objects: list[dict[str, object]] = []
    at = 0
    while at < len(text):
        if text[at].isspace():
            at += 1
            continue
        try:
            value, at = cast(tuple[object, int], decoder.raw_decode(text, at))
        except ValueError:
            return []
        if not isinstance(value, dict):
            return []
        objects.append(cast(dict[str, object], value))
    return objects


def _broken(text: str) -> bool:
    """Whether ``text`` does not even start with one whole JSON value."""
    try:
        json.JSONDecoder().raw_decode(text)
    except ValueError:
        return True
    return False


def _closed(text: str) -> list[dict[str, object]]:
    """``text`` read with its missing closing braces added, for a reply that stops early.

    Small models often leave out the last brace or two of a call. Up to three are added.
    """
    for missing in range(1, MAX_MISSING_BRACES + 1):
        objects = _objects(text + "}" * missing)
        if objects:
            return objects
    # Or one or two too many.
    for extra in range(1, MAX_MISSING_BRACES + 1):
        if not text.endswith("}" * extra):
            break
        objects = _objects(text[:-extra])
        if objects:
            return objects
    return []


def _shaped(obj: dict[str, object]) -> tuple[str, object] | None:
    """The tool name and raw arguments of a call-shaped object, else None."""
    if "function" in obj:
        inner = obj["function"]
        if set(obj) != {"type", "function"} or obj["type"] != "function":
            return None
        if not isinstance(inner, dict):
            return None
        obj = cast(dict[str, object], inner)
    name = obj.get("name")
    keys = set(obj) - {"name"}
    if not isinstance(name, str) or len(keys) != 1 or not keys <= {"parameters", "arguments"}:
        return None
    return name, obj[keys.pop()]


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
