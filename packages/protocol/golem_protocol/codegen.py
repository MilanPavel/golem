"""Write JSON Schema files for the protocol models."""

from __future__ import annotations

import json
from pathlib import Path

from pydantic import BaseModel

from golem_protocol.events import Ping

MODELS: tuple[type[BaseModel], ...] = (Ping,)


def schema_stem(name: str) -> str:
    """Turn ``MessageDelta`` into ``message-delta``."""
    chars: list[str] = []
    for char in name:
        if char.isupper() and chars:
            chars.append("-")
        chars.append(char.lower())
    return "".join(chars)


def default_gen_dir() -> Path:
    """``packages/protocol/gen``, derived from this source file."""
    return Path(__file__).resolve().parent.parent / "gen"


def export_schemas(directory: Path) -> list[Path]:
    """Write one JSON Schema file per protocol model. Returns the paths written."""
    directory.mkdir(parents=True, exist_ok=True)
    for stale in directory.glob("*.schema.json"):
        stale.unlink()
    written: list[Path] = []
    for model in MODELS:
        schema = model.model_json_schema()
        path = directory / f"{schema_stem(model.__name__)}.schema.json"
        path.write_text(
            json.dumps(schema, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        written.append(path)
    return written


def main() -> None:
    export_schemas(default_gen_dir())


if __name__ == "__main__":
    main()
