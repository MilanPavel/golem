"""The Ollama options a person can tune, with a range and an explanation for each.

``OPTIONS`` is the one table. A client draws a slider from the range and the
step, and the explanations teach what the option does. A model's own defaults
come from ``/api/show`` ``parameters``, a text with one ``name value`` pair per
line. Where the model says nothing, Ollama's default is the value.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal, cast

import httpx

OptionKind = Literal["float", "int", "duration"]

_TIMEOUT = 5.0


@dataclass(frozen=True, slots=True)
class OptionSpec:
    """One option: what it is called, what it may be, and what it does."""

    name: str
    label: str
    kind: OptionKind
    minimum: float
    maximum: float
    step: float
    # Ollama's own default. None when Ollama has no fixed one (a random seed).
    default: float | str | None
    short: str
    long: str


OPTIONS: tuple[OptionSpec, ...] = (
    OptionSpec(
        name="temperature",
        label="Temperature",
        kind="float",
        minimum=0.0,
        maximum=2.0,
        step=0.05,
        default=0.8,
        short="How adventurous each next word is.",
        long=(
            "Low gives nearly the same answer every time, which suits code and facts. "
            "High gives more variety, which suits stories and ideas, and more mistakes."
        ),
    ),
    OptionSpec(
        name="top_p",
        label="Top P",
        kind="float",
        minimum=0.0,
        maximum=1.0,
        step=0.01,
        default=0.9,
        short="Keeps only the likeliest words that add up to this share.",
        long=(
            "At 0.9 the model picks from the smallest set of words that together hold 90% of "
            "the chance. Lower is more focused, 1.0 turns the limit off."
        ),
    ),
    OptionSpec(
        name="top_k",
        label="Top K",
        kind="int",
        minimum=0,
        maximum=200,
        step=1,
        default=40,
        short="Picks from only this many likeliest words.",
        long=(
            "A small number keeps the answer safe and plain. A large number lets rarer words "
            "in. 0 turns the limit off in most models."
        ),
    ),
    OptionSpec(
        name="min_p",
        label="Min P",
        kind="float",
        minimum=0.0,
        maximum=1.0,
        step=0.01,
        default=0.0,
        short="Drops words far less likely than the best one.",
        long=(
            "A word must be at least this fraction as likely as the top word to stay. 0.05 cuts "
            "the odd words and still leaves room for variety. 0 turns it off."
        ),
    ),
    OptionSpec(
        name="repeat_penalty",
        label="Repeat penalty",
        kind="float",
        minimum=0.5,
        maximum=2.0,
        step=0.05,
        default=1.1,
        short="How strongly the model avoids repeating itself.",
        long=(
            "Above 1 makes words it used recently less likely, which stops loops. Too high "
            "makes the text strange. 1.0 turns it off."
        ),
    ),
    OptionSpec(
        name="num_ctx",
        label="Context size",
        kind="int",
        minimum=512,
        maximum=262144,
        step=512,
        default=4096,
        short="How many tokens the model can keep in mind.",
        long=(
            "The prompt, the history, and the answer all have to fit. A larger window remembers "
            "more of a long chat and costs memory. The memory shown is about right for a mid-size "
            "model, not exact. Past the window the oldest text is dropped."
        ),
    ),
    OptionSpec(
        name="num_predict",
        label="Answer length",
        kind="int",
        minimum=-2,
        maximum=32768,
        step=1,
        default=-1,
        short="The most tokens one answer may have.",
        long=(
            "-1 lets the model run until it is done. -2 fills the context window. A number "
            "cuts the answer off there, which caps the time and the cost."
        ),
    ),
    OptionSpec(
        name="seed",
        label="Seed",
        kind="int",
        minimum=0,
        maximum=2**31 - 1,
        step=1,
        default=None,
        short="A number that makes the answer repeatable.",
        long=(
            "With the same seed, the same prompt, and a temperature, the model gives the same "
            "answer. Left empty, each answer starts from a fresh random number."
        ),
    ),
    OptionSpec(
        name="keep_alive",
        label="Keep loaded",
        kind="duration",
        minimum=-1,
        maximum=86400,
        step=60,
        default="5m",
        short="How long the model stays in memory after its last answer.",
        long=(
            "A loaded model answers at once but holds its memory. A short time frees memory "
            "sooner. -1 keeps it loaded until Ollama stops, and 0 unloads it right away."
        ),
    ),
)

_BY_NAME = {spec.name: spec for spec in OPTIONS}


def spec(name: str) -> OptionSpec | None:
    """The table row for ``name``, or None when it is not a tunable option."""
    return _BY_NAME.get(name)


_DURATION = re.compile(r"^-?\d+(\.\d+)?(ms|s|m|h)?$")


def validate(name: str, value: object) -> float | str:
    """Check ``value`` against the table and return it. Raises ``ValueError`` when it is no good."""
    row = _BY_NAME.get(name)
    if row is None:
        raise ValueError(f"{name} is not an option golem can tune")
    if row.kind == "duration":
        if isinstance(value, bool) or not isinstance(value, (int, str)):
            raise ValueError(f"{name} is a time such as 5m, or -1")
        text = str(value)
        if _DURATION.match(text) is None:
            raise ValueError(f"{name} is a time such as 5m, or -1, not {text!r}")
        return value
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} is a number")
    if row.kind == "int" and value != int(value):
        raise ValueError(f"{name} is a whole number")
    if not row.minimum <= value <= row.maximum:
        raise ValueError(f"{name} is between {row.minimum:g} and {row.maximum:g}")
    return int(value) if row.kind == "int" else value


def parse_parameters(text: str) -> dict[str, float | str]:
    """Read the ``parameters`` text of ``/api/show`` into the options it sets.

    Each line is a name and a value, as in ``temperature 0.6``. A name that is
    not in the table is dropped, as is a line without a usable value. When a
    name repeats, the last line wins.
    """
    found: dict[str, float | str] = {}
    for line in text.splitlines():
        parts = line.split(None, 1)
        if len(parts) != 2:
            continue
        name, raw = parts[0], parts[1].strip().strip('"')
        row = _BY_NAME.get(name)
        if row is None:
            continue
        value = _coerce(row, raw)
        if value is not None:
            found[name] = value
    return found


def defaults(model_parameters: Mapping[str, float | str] | None = None) -> dict[str, float | str]:
    """The value of each option with no setting made: the model's, else Ollama's.

    An option with neither, such as the seed, is left out.
    """
    own = model_parameters or {}
    values: dict[str, float | str] = {}
    for row in OPTIONS:
        if row.name in own:
            values[row.name] = own[row.name]
        elif row.default is not None:
            values[row.name] = row.default
    return values


def _coerce(row: OptionSpec, raw: str) -> float | str | None:
    if row.kind == "duration":
        return raw or None
    try:
        number = float(raw)
    except ValueError:
        return None
    return int(number) if row.kind == "int" else number


async def model_parameters(
    client: httpx.AsyncClient, base_url: str, name: str
) -> dict[str, float | str]:
    """The options the model itself sets, from ``/api/show``. Empty when Ollama does not say."""
    try:
        response = await client.post(f"{base_url}/api/show", json={"model": name}, timeout=_TIMEOUT)
        response.raise_for_status()
        body = response.json()
    except (httpx.HTTPError, ValueError):
        return {}
    parameters: object = (
        cast(dict[str, object], body).get("parameters") if isinstance(body, dict) else None
    )
    return parse_parameters(parameters) if isinstance(parameters, str) else {}
