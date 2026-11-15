"""Read a string field out of tool-call arguments that are still being written.

A model streams the arguments of a call as JSON text, a few characters at a time.
``json.loads`` fails until the last brace, so this reads the text as far as it goes.
"""

from __future__ import annotations

_ESCAPES = {'"': '"', "\\": "\\", "/": "/", "b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t"}


def partial_string(json_text: str, key: str) -> str | None:
    """The value of the top-level string field ``key`` in a JSON object cut off anywhere.

    None when the field has not started: it is missing, its key is cut off, or its value is
    not a string. A value cut off in the middle comes back as far as it got.
    """
    found = partial_field(json_text, key)
    return None if found is None else found[0]


def partial_field(json_text: str, key: str) -> tuple[str, bool] | None:
    """:func:`partial_string` with a flag that says whether the closing quote was seen."""
    depth = 0
    last = ""
    index = 0
    size = len(json_text)
    while index < size:
        char = json_text[index]
        if char == '"':
            text, index, closed = _read(json_text, index + 1)
            if depth == 1 and last in ("{", ",") and closed and text == key:
                return _value(json_text, index)
            last = '"'
            continue
        if char in "{[":
            depth += 1
        elif char in "}]":
            depth -= 1
        if not char.isspace():
            last = char
        index += 1
    return None


def _value(text: str, index: int) -> tuple[str, bool] | None:
    """The string after the colon that follows a key, or None when it has not started."""
    size = len(text)
    while index < size and text[index].isspace():
        index += 1
    if index >= size or text[index] != ":":
        return None
    index += 1
    while index < size and text[index].isspace():
        index += 1
    if index >= size or text[index] != '"':
        return None
    value, _, closed = _read(text, index + 1)
    return value, closed


def _read(text: str, index: int) -> tuple[str, int, bool]:
    """Decode a string from ``index``, just after its opening quote.

    Returns the text, the index after the closing quote (or the end), and whether the
    quote was seen. An escape cut off at the end is dropped.
    """
    out: list[str] = []
    size = len(text)
    while index < size:
        char = text[index]
        if char == '"':
            return "".join(out), index + 1, True
        if char != "\\":
            out.append(char)
            index += 1
            continue
        if index + 1 >= size:
            break
        code = text[index + 1]
        if code != "u":
            out.append(_ESCAPES.get(code, code))
            index += 2
            continue
        point = _unit(text, index)
        if point is None:
            break
        index += 6
        if 0xD800 <= point < 0xDC00:
            # A high surrogate needs its low half. Without the rest of it, stop here.
            if size - index < 6 and "\\u".startswith(text[index:][:2]):
                break
            low = _unit(text, index)
            if low is None or not 0xDC00 <= low < 0xE000:
                continue
            point = 0x10000 + ((point - 0xD800) << 10) + (low - 0xDC00)
            index += 6
        if not 0xD800 <= point < 0xE000:
            out.append(chr(point))
    return "".join(out), size, False


def _unit(text: str, index: int) -> int | None:
    """The code unit of the ``\\uXXXX`` escape at ``index``, or None when it is not whole."""
    if text[index : index + 2] != "\\u":
        return None
    digits = text[index + 2 : index + 6]
    if len(digits) < 4:
        return None
    try:
        return int(digits, 16)
    except ValueError:
        return None
