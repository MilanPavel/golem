"""Ask a chat model for an answer in a given shape.

Keep the schema small. For a local model the schema goes to the server as its
output format, and a large one makes a small model slower.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from collections.abc import Sequence

import httpx
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from pydantic import BaseModel, ValidationError

from golem.models.errors import ModelUnreachable

log = logging.getLogger(__name__)

_FENCE = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL | re.IGNORECASE)
_NOT_RETRIED = (ConnectionError, httpx.TransportError, ModelUnreachable, asyncio.CancelledError)


class StructuredError(Exception):
    """A model did not return the shape asked for. ``raw`` is its last answer."""

    def __init__(self, message: str, raw: str = "") -> None:
        super().__init__(message)
        self.raw = raw


def extract_json(text: str) -> object | None:
    """The JSON object inside ``text``, or None when there is none."""
    fenced = _FENCE.search(text)
    if fenced:
        text = fenced.group(1)
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        return json.loads(text[start : end + 1])
    except ValueError:
        return None


def _problems(error: ValidationError) -> str:
    parts = [
        f"{'.'.join(str(p) for p in item['loc']) or 'answer'}: {item['msg']}"
        for item in error.errors()[:3]
    ]
    return "; ".join(parts)


def _text(message: BaseMessage) -> str:
    return message.text


async def _ask_native[T: BaseModel](
    model: BaseChatModel, schema: type[T], messages: list[BaseMessage]
) -> tuple[T | None, str, str | None]:
    """Returns (value, raw answer, problem). Raises NotImplementedError if unsupported."""
    result = await model.with_structured_output(schema).ainvoke(messages)
    if isinstance(result, schema):
        return result, result.model_dump_json(), None
    if isinstance(result, dict):
        raw = json.dumps(result, default=str)
        try:
            return schema.model_validate(result), raw, None
        except ValidationError as exc:
            return None, raw, _problems(exc)
    return None, str(result), "no JSON object in the answer"


async def _ask_text[T: BaseModel](
    model: BaseChatModel, schema: type[T], messages: list[BaseMessage]
) -> tuple[T | None, str, str | None]:
    ask = SystemMessage(
        "Reply with one JSON object that matches this JSON schema, and nothing else: "
        + json.dumps(schema.model_json_schema())
    )
    reply = await model.ainvoke([*messages, ask])
    raw = _text(reply)
    data = extract_json(raw)
    if data is None:
        return None, raw, "no JSON object in the answer"
    try:
        return schema.model_validate(data), raw, None
    except ValidationError as exc:
        return None, raw, _problems(exc)


async def _attempts[T: BaseModel](
    model: BaseChatModel, schema: type[T], messages: Sequence[BaseMessage], retries: int
) -> T:
    history = list(messages)
    native = True
    raw = ""
    problem = ""
    for attempt in range(retries + 1):
        value: T | None = None
        try:
            if native:
                try:
                    value, raw, found = await _ask_native(model, schema, history)
                except NotImplementedError:
                    native = False
                    value, raw, found = await _ask_text(model, schema, history)
            else:
                value, raw, found = await _ask_text(model, schema, history)
        except _NOT_RETRIED:
            raise
        except Exception as exc:
            if isinstance(exc, ValidationError):
                found = _problems(exc)
            else:
                found = f"{type(exc).__name__}: {exc}"
        if value is not None:
            return value
        problem = found or "no answer"
        if attempt < retries:
            log.info("retrying a structured answer from %s: %s", type(model).__name__, problem)
            history = [
                *history,
                AIMessage(raw),
                HumanMessage(
                    f"That did not match the schema: {problem}. Reply with the JSON object only."
                ),
            ]
    raise StructuredError(
        f"{type(model).__name__} did not return the shape asked for: {problem}", raw
    )


async def structured[T: BaseModel](
    model: BaseChatModel,
    schema: type[T],
    messages: Sequence[BaseMessage],
    *,
    retries: int = 1,
    timeout: float | None = None,
) -> T:
    """Ask ``model`` for a ``schema`` instance.

    Uses the model's own structured output when its class has one, else asks for
    JSON in a system message and parses the text. Retries up to ``retries`` times
    with the bad answer and the problems, then raises ``StructuredError``.
    Connection errors, cancellation and a timeout pass through.
    """
    async with asyncio.timeout(timeout):
        return await _attempts(model, schema, messages, retries)
