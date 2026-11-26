"""The prompt that drafts the notes of a data source, and what is made of the reply.

Pure: no model, no file. Column names, types and row counts go to any model. A date column's
range and the sample rows are values, so they go only where ``may_use_rows`` allows for the
model that drafts.
"""

from __future__ import annotations

import re

from golem.data.notes import MAX_BYTES
from golem.data.privacy import may_use_rows
from golem.data.sources import Description
from golem.data.tools import count, render_table
from golem.memory.privacy import ChatPrivacy, Target

SAMPLE_ROWS = 20
"""Sample rows of each table the draft reads, where the rows may go to the model."""
UNUSABLE = "golem couldn't draft notes from that. Try again, or write them yourself."

INSTRUCTION = (
    "You write the notes file of a data source. A model reads these notes before it writes"
    " SQL, so they say what the column names alone cannot. Reply with Markdown only, no code"
    " fence: a heading `# <name of the source>`, one line on what the source is, then for each"
    " table a short list of the columns whose meaning is not obvious (units, signs, codes,"
    " what a flag means, which column joins to which). Leave out columns that say what they"
    " are. Say 'probably' where you are guessing. If current notes are given, keep what is"
    " right and fix the rest. Keep it short."
)

_FENCE = re.compile(r"^\s*```[a-z]*\s*\n(.*?)\n```\s*$", re.DOTALL)
_DATE_TYPE = re.compile(r"^(DATE|TIMESTAMP)", re.IGNORECASE)


def rows_allowed(found: Description, *, local: bool) -> bool:
    """Whether the rows of the source may go to a drafting model that is ``local`` or hosted."""
    return may_use_rows(found.source.privacy, ChatPrivacy(), Target(local=local)).allowed


def build_prompt(found: Description, *, local: bool) -> str:
    """The text the drafting model reads: the schema, the rows when allowed, the current notes."""
    shown = rows_allowed(found, local=local)
    lines = [f"Source: {found.source.name} ({found.source.kind})"]
    for table in found.tables:
        lines += ["", f"Table {table.name}, {count(table.rows, 'row')}"]
        for column in table.columns:
            span = ""
            if shown and _DATE_TYPE.match(column.type) and column.min and column.max:
                span = f"  from {column.min} to {column.max}"
            lines.append(f"  {column.name}  {column.type}{span}")
    if shown:
        for name, rows in found.sample.items():
            columns = [c.name for t in found.tables if t.name == name for c in t.columns]
            if columns and rows:
                lines += ["", f"Sample rows of {name}:", render_table(columns, rows[:SAMPLE_ROWS])]
    else:
        lines += ["", "No sample rows: the rows of this source are not shown to this model."]
    if found.notes and found.notes.strip():
        lines += ["", "Current notes:", found.notes.strip()]
    return "\n".join(lines)


def clean(reply: str) -> str:
    """The proposal in ``reply``: no code fence around it, at most 16 KB. Empty if none."""
    text = reply.strip()
    fenced = _FENCE.match(text)
    if fenced is not None:
        text = fenced.group(1).strip()
    return text.encode("utf-8")[:MAX_BYTES].decode("utf-8", errors="ignore").strip()


__all__ = ["INSTRUCTION", "SAMPLE_ROWS", "UNUSABLE", "build_prompt", "clean", "rows_allowed"]
