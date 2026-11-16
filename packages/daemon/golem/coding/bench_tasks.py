"""The twelve edit tasks of ``golem coding bench``: six in Python, six in TypeScript.

Each task is a small folder, a request, and the folder after. The folder after is worked out
from a list of exact replacements, so a task that cannot be done is caught when this module
loads. Every file that exists before the request has 30 to 150 lines.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Mapping, Sequence

from golem.coding.bench import Task

Edit = tuple[str, str, str]
"""A path, the text to replace (it must occur once in the file), and its replacement."""


def _py_filler(count: int) -> str:
    return "".join(
        f'\n\ndef helper_{n}(value: int) -> int:\n    """Step {n} of the shared helpers."""\n'
        f"    return value * {n} + {n + 1}\n"
        for n in range(1, count + 1)
    )


def _ts_filler(count: int) -> str:
    return "".join(
        f"\nexport function helper{n}(value: number): number {{\n"
        f"  // Step {n} of the shared helpers.\n  return value * {n} + {n + 1};\n}}\n"
        for n in range(1, count + 1)
    )


def _tabs(text: str) -> str:
    """Two-space indentation as tabs."""
    return re.sub(r"(?m)^((?:  )+)", lambda found: "\t" * (len(found.group(1)) // 2), text)


def _same(text: str) -> str:
    return text


def _crlf(text: str) -> str:
    return text.replace("\n", "\r\n")


def _task(
    name: str,
    files: Mapping[str, str],
    request: str,
    edits: Sequence[Edit],
    new: Mapping[str, str] | None = None,
    style: Callable[[str], str] | None = None,
) -> Task:
    """A task whose ``expect`` is ``files`` with ``edits`` made and ``new`` files added."""
    shape = style or _same
    before = {path: shape(text) for path, text in files.items()}
    after = dict(before)
    for path, old, replacement in edits:
        old, replacement = shape(old), shape(replacement)
        if after[path].count(old) != 1:
            raise ValueError(f"task {name}: the text to replace is not in {path} exactly once")
        after[path] = after[path].replace(old, replacement)
    after.update({path: shape(text) for path, text in (new or {}).items()})
    return Task(name=name, files=before, request=request, expect=after)


_BILLING = '''"""Billing helpers for the shop."""

from dataclasses import dataclass

TAX_RATE = 0.2


@dataclass
class Line:
    name: str
    price: float
    quantity: int


def calc_fee(amount: float) -> float:
    """The handling fee for an amount."""
    return round(amount * 0.03, 2)


def invoice_total(lines: list[Line]) -> float:
    subtotal = sum(line.price * line.quantity for line in lines)
    return round(subtotal + calc_fee(subtotal), 2)


def refund_total(lines: list[Line]) -> float:
    subtotal = sum(line.price * line.quantity for line in lines)
    return round(subtotal - calc_fee(subtotal), 2)
''' + _py_filler(4)

_GREETING = '''"""Greetings for the welcome screen."""

DEFAULT_NAME = "friend"


def shout(text: str) -> str:
    return text.upper()


def greet(name: str) -> str:
    """Greet one person."""
    return f"Hello, {name}!"


def greet_all(names: list[str]) -> list[str]:
    return [greet(name) for name in names]
''' + _py_filler(5)

_PAGING = '''"""Paging over a list of items."""

from __future__ import annotations


def page_count(total: int, size: int) -> int:
    """How many pages hold ``total`` items, ``size`` to a page."""
    return (total + size - 1) // size


def page_slice(items: list[str], page: int, size: int) -> list[str]:
    """The items on page ``page``, counting from 0."""
    start = page * size
    return items[start : start + size + 1]


def has_next(total: int, page: int, size: int) -> bool:
    return page + 1 < page_count(total, size)
''' + _py_filler(5)

_STATS = '''"""Small numeric helpers."""

from __future__ import annotations

import math


def mean_of(values: list[float]) -> float:
    total = 0.0
    for value in values:
        total += value
    return total / len(values)


def hypot_of(x: float, y: float) -> float:
    return math.sqrt(x * x + y * y)
''' + _py_filler(5)

_NOTIFY = '''"""Deliver queued notifications."""

from __future__ import annotations

import logging

log = logging.getLogger("notify")


def deliver(queues: dict[str, list[str]], limit: int) -> int:
    sent = 0
    for name, queue in queues.items():
        if queue:
            for message in list(queue):
                if len(message) > 0:
                    if sent >= limit:
                        if name.startswith("urgent"):
                            log.warning("Queue is full, dropping the message")
                        break
                    sent += 1
                    queue.remove(message)
    return sent
''' + _py_filler(4)

_COUNTER = '''"""A counter that other parts of the app share."""

from __future__ import annotations


class Counter:
    """Counts events."""

    def __init__(self, start: int = 0) -> None:
        self.count = start

    def increment(self, by: int = 1) -> None:
        self.count += by

    def value(self) -> int:
        return self.count

    def describe(self) -> str:
        return f"Counter({self.count})"
''' + _py_filler(5)

_CONFIG_TS = """export interface Config {
  host: string;
  port: number;
  retries: number;
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const defaults = {
    host: "localhost",
    port: 8080,
    retries: 3,
  };
  if (env.HOST !== undefined) {
    defaults.host = env.HOST;
  }
  return defaults;
}
""" + _ts_filler(5)

_QUEUE_TS = """export class Queue<T> {
  private items: T[] = [];

  push(item: T): void {
    this.items.push(item);
  }

  take(): T {
    if (this.items.length === 0) {
      throw new Error("queue is empty");
    }
    return this.items.shift() as T;
  }

  size(): number {
    return this.items.length;
  }
}
""" + _ts_filler(5)

_FORMAT_TS = """export function padLeft(text: string, width: number): string {
  return text.padStart(width, " ");
}

export function padRight(text: string, width: number): string {
  return text.padEnd(width, " ");
}

export function legacyFormat(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return rounded.toFixed(2);
}

export function formatList(items: string[]): string {
  return items.join(", ");
}
""" + _ts_filler(5)

_USER_TS = """export interface User {
  id: number;
  fullName: string;
  email: string;
}

export function makeUser(id: number, fullName: string, email: string): User {
  return { id, fullName, email };
}

export function sameUser(a: User, b: User): boolean {
  return a.id === b.id;
}
""" + _ts_filler(5)

_GREET_TS = """import type { User } from "./user.ts";

export function welcome(user: User): string {
  return `Welcome back, ${user.fullName}.`;
}

export function initials(user: User): string {
  return user.fullName
    .split(" ")
    .map((part) => part.charAt(0))
    .join("");
}

export function mailTo(user: User): string {
  return `${user.email}`;
}
""" + _ts_filler(5)

_MATH_TS = """export function add(a: number, b: number): number {
  return a + b;
}

export function subtract(a: number, b: number): number {
  return a - b;
}

export function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
""" + _ts_filler(5)

_INDEX_TS = 'export * from "./math.ts";\nexport * from "./format.ts";\n' + "".join(
    f'export * from "./part{n}.ts";\n' for n in range(1, 30)
)

_CLAMP_TS = (
    "export function clamp(value: number, min: number, max: number): number {\n"
    "  return Math.min(Math.max(value, min), max);\n}\n"
)

_HANDLERS_TS = """export interface Options {
  timeout: number;
  retries: number;
}

export async function fetchUsers(get: (url: string, options: Options) => Promise<string>) {
  const options: Options = { timeout: 5000, retries: 2 };
  const body = await get("/users", options);
  return JSON.parse(body);
}

export async function fetchOrders(get: (url: string, options: Options) => Promise<string>) {
  const options: Options = { timeout: 5000, retries: 2 };
  const body = await get("/orders", options);
  return JSON.parse(body);
}

export async function fetchItems(get: (url: string, options: Options) => Promise<string>) {
  const options: Options = { timeout: 5000, retries: 2 };
  const body = await get("/items", options);
  return JSON.parse(body);
}
""" + _ts_filler(5)

TASKS: tuple[Task, ...] = (
    _task(
        "rename_function",
        {"billing.py": _BILLING},
        "Rename the function calc_fee to compute_fee in billing.py, "
        "and update the two places that call it.",
        [
            ("billing.py", "def calc_fee(", "def compute_fee("),
            ("billing.py", "subtotal + calc_fee(", "subtotal + compute_fee("),
            ("billing.py", "subtotal - calc_fee(", "subtotal - compute_fee("),
        ],
    ),
    _task(
        "add_parameter",
        {"greeting.py": _GREETING},
        'In greeting.py, give greet a second parameter `punctuation: str = "!"` '
        "and end the greeting with it instead of the fixed exclamation mark.",
        [
            (
                "greeting.py",
                'def greet(name: str) -> str:\n    """Greet one person."""\n'
                '    return f"Hello, {name}!"',
                'def greet(name: str, punctuation: str = "!") -> str:\n'
                '    """Greet one person."""\n    return f"Hello, {name}{punctuation}"',
            )
        ],
    ),
    _task(
        "off_by_one",
        {"paging.py": _PAGING},
        "page_slice in paging.py returns one item too many. Fix it.",
        [("paging.py", "items[start : start + size + 1]", "items[start : start + size]")],
    ),
    _task(
        "add_import",
        {"stats.py": _STATS},
        "In stats.py, make mean_of return `statistics.fmean(values)` instead of using a loop, "
        "and add `import statistics` on the line right after `import math`.",
        [
            ("stats.py", "import math\n", "import math\nimport statistics\n"),
            (
                "stats.py",
                "    total = 0.0\n    for value in values:\n        total += value\n"
                "    return total / len(values)\n",
                "    return statistics.fmean(values)\n",
            ),
        ],
    ),
    _task(
        "deep_indent",
        {"notify.py": _NOTIFY},
        "In notify.py, change the log message from 'Queue is full, dropping the message' "
        "to 'Queue is full, retrying later'.",
        [
            (
                "notify.py",
                'log.warning("Queue is full, dropping the message")',
                'log.warning("Queue is full, retrying later")',
            )
        ],
    ),
    _task(
        "add_method",
        {"counter.py": _COUNTER},
        "Add a method `reset(self) -> None` to Counter in counter.py, right after the value "
        "method, that sets the count back to 0.",
        [
            (
                "counter.py",
                "    def value(self) -> int:\n        return self.count\n",
                "    def value(self) -> int:\n        return self.count\n\n"
                "    def reset(self) -> None:\n        self.count = 0\n",
            )
        ],
    ),
    _task(
        "tabs",
        {"src/config.ts": _CONFIG_TS},
        "In src/config.ts, change the default port from 8080 to 9090. "
        "The file is indented with tabs.",
        [("src/config.ts", "port: 8080,", "port: 9090,")],
        style=_tabs,
    ),
    _task(
        "crlf",
        {"src/queue.ts": _QUEUE_TS},
        "In src/queue.ts, make take() return undefined instead of throwing when the queue "
        "is empty, and change its return type to `T | undefined`. "
        "The file has Windows line endings.",
        [
            (
                "src/queue.ts",
                "  take(): T {\n    if (this.items.length === 0) {\n"
                '      throw new Error("queue is empty");\n    }\n',
                "  take(): T | undefined {\n    if (this.items.length === 0) {\n"
                "      return undefined;\n    }\n",
            )
        ],
        style=_crlf,
    ),
    _task(
        "delete_function",
        {"src/format.ts": _FORMAT_TS},
        "Delete the function legacyFormat from src/format.ts. Nothing uses it. "
        "Leave one blank line between the functions that remain.",
        [
            (
                "src/format.ts",
                "export function legacyFormat(value: number): string {\n"
                "  const rounded = Math.round(value * 100) / 100;\n"
                "  return rounded.toFixed(2);\n}\n\n",
                "",
            )
        ],
    ),
    _task(
        "two_files",
        {"src/user.ts": _USER_TS, "src/greet.ts": _GREET_TS},
        "Rename the field fullName of User to displayName, in src/user.ts "
        "and in every place in src/greet.ts that reads it.",
        [
            ("src/user.ts", "  fullName: string;\n", "  displayName: string;\n"),
            (
                "src/user.ts",
                "id: number, fullName: string, email: string): User {\n"
                "  return { id, fullName, email };",
                "id: number, displayName: string, email: string): User {\n"
                "  return { id, displayName, email };",
            ),
            ("src/greet.ts", "${user.fullName}", "${user.displayName}"),
            ("src/greet.ts", "return user.fullName\n", "return user.displayName\n"),
        ],
    ),
    _task(
        "create_file",
        {"src/math.ts": _MATH_TS, "src/index.ts": _INDEX_TS},
        "Create src/clamp.ts with exactly this content:\n\n" + _CLAMP_TS + "\n"
        'Then add the line `export * from "./clamp.ts";` to the end of src/index.ts.',
        [
            (
                "src/index.ts",
                'export * from "./part29.ts";\n',
                'export * from "./part29.ts";\nexport * from "./clamp.ts";\n',
            )
        ],
        new={"src/clamp.ts": _CLAMP_TS},
    ),
    _task(
        "ambiguous_block",
        {"src/handlers.ts": _HANDLERS_TS},
        "In src/handlers.ts, raise the timeout in fetchOrders from 5000 to 10000. "
        "Leave fetchUsers and fetchItems as they are.",
        [
            (
                "src/handlers.ts",
                'timeout: 5000, retries: 2 };\n  const body = await get("/orders"',
                'timeout: 10000, retries: 2 };\n  const body = await get("/orders"',
            )
        ],
    ),
)
