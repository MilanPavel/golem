"""Memories as a document: JSON with every field, or Markdown to read (ADR-061)."""

from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import asdict
from typing import Literal

from golem.memory.records import MemoryRecord

ExportFormat = Literal["json", "markdown"]


def render(records: Sequence[MemoryRecord], fmt: ExportFormat) -> str:
    """``records`` in the order given. No rows is ``[]`` for JSON and an empty text for Markdown."""
    if fmt == "json":
        return json.dumps([asdict(r) for r in records], indent=2, ensure_ascii=False)
    return "\n\n".join(_markdown(r) for r in records)


def _markdown(record: MemoryRecord) -> str:
    facts = (
        f"- id: {record.id}\n- scope: {record.scope}\n- author: {record.author}\n"
        f"- state: {record.state}\n- privacy: {record.privacy}\n"
    )
    if record.folder:
        facts += f"- folder: {record.folder}\n"
    if record.sources:
        facts += "- sources: " + ", ".join(s.path for s in record.sources) + "\n"
    return f"## {record.title}\n\n{facts}\n{record.text}"


__all__ = ["ExportFormat", "render"]
