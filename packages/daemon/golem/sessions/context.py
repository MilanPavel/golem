"""What filled one model call's context, worked out from what was sent.

Pure: no I/O, no clock, no logging. Each thing sent is weighed in characters.
The weights give the shape; the tokens the provider counted give the size.
Shares are whole numbers that add up to the total exactly.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from typing import Literal, get_args

from golem.mcp.tools import server_of
from golem.tokens import CHARS_PER_TOKEN
from golem_protocol.commands import TraceContext, TraceContextItem, TraceContextPart, TraceMessage
from golem_protocol.events import PromptSectionInfo

Key = Literal["system", "tools", "user", "assistant", "tool_results"]
_KEYS: tuple[Key, ...] = get_args(Key)
_ROLE_KEY: dict[str, Key] = {"user": "user", "assistant": "assistant", "tool": "tool_results"}


def _split(total: int, weights: Sequence[int]) -> list[int]:
    """Share ``total`` in proportion to ``weights``, in whole numbers adding up to ``total``.

    The tokens left after rounding down go one each to the largest remainders,
    the earlier weight first on a tie. All weights 0 gives all shares 0.
    """
    whole = sum(weights)
    if whole == 0:
        return [0 for _ in weights]
    shares = [total * w // whole for w in weights]
    left = total - sum(shares)
    order = sorted(range(len(weights)), key=lambda i: (-(total * weights[i] % whole), i))
    for i in order[:left]:
        shares[i] += 1
    return shares


def _compact(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def _tool_name(schema: Mapping[str, object]) -> str:
    function = schema.get("function")
    if isinstance(function, dict):
        name = function.get("name")  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]
        if isinstance(name, str) and name:
            return name
    return "?"


def _message_weight(message: TraceMessage) -> int:
    weight = len(message.text)
    if message.tool_calls:
        weight += len(_compact(message.tool_calls))
    return weight


def context_breakdown(
    *,
    used: int | None,
    window: int | None,
    window_estimated: bool,
    num_ctx: int | None,
    system_prompt: str | None,
    sections: Sequence[PromptSectionInfo] | None,
    tools: Sequence[Mapping[str, object]] | None,
    messages: Sequence[TraceMessage],
) -> tuple[TraceContext, list[TraceMessage]]:
    """The context of one model call, and ``messages`` with ``tokens`` set on each.

    The parts add up to ``used`` when it is known, else to the estimate of
    four characters a token. Items add up to their part, and the messages of
    one role to theirs.
    """
    prompt_chars = 0 if system_prompt is None else len(system_prompt)
    section_list = list(sections or [])
    schemas = list(tools or [])
    tool_weights = [len(_compact(schema)) for schema in schemas]
    message_weights = [_message_weight(m) for m in messages]
    by_key: dict[Key, list[int]] = {key: [] for key in _KEYS}
    for i, message in enumerate(messages):
        by_key[_ROLE_KEY[message.role]].append(i)

    chars: dict[Key, int] = {
        "system": prompt_chars,
        "tools": sum(tool_weights),
        "user": 0,
        "assistant": 0,
        "tool_results": 0,
    }
    for key in ("user", "assistant", "tool_results"):
        chars[key] = sum(message_weights[i] for i in by_key[key])
    all_chars = sum(chars.values())
    total = used if used is not None else round(all_chars / CHARS_PER_TOKEN)
    tokens = dict(zip(_KEYS, _split(total, [chars[k] for k in _KEYS]), strict=True))

    items: dict[Key, list[TraceContextItem]] = {key: [] for key in _KEYS}
    if section_list:
        shares = _split(tokens["system"], [s.chars for s in section_list])
        items["system"] = [
            TraceContextItem(name=s.name, tokens=t)
            for s, t in zip(section_list, shares, strict=True)
        ]
    if schemas:
        shares = _split(tokens["tools"], tool_weights)
        tool_items = [
            TraceContextItem(name=name, group=server_of(name), tokens=t)
            for name, t in zip((_tool_name(s) for s in schemas), shares, strict=True)
        ]
        items["tools"] = sorted(tool_items, key=lambda item: (-item.tokens, item.name))

    sized: list[TraceMessage] = list(messages)
    for key in ("user", "assistant", "tool_results"):
        indexes = by_key[key]
        shares = _split(tokens[key], [message_weights[i] for i in indexes])
        for i, share in zip(indexes, shares, strict=True):
            sized[i] = messages[i].model_copy(update={"tokens": share})

    parts = [
        TraceContextPart(key=key, tokens=tokens[key], chars=chars[key], items=items[key])
        for key in _KEYS
    ]
    context = TraceContext(
        used=used,
        window=window,
        window_estimated=window_estimated,
        num_ctx=num_ctx,
        estimated=True,
        parts=parts,
    )
    return context, sized
