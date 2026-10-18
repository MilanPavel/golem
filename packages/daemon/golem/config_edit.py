"""Small edits to ``config.toml`` that keep the user's comments and layout.

The file is edited with ``tomlkit``, written to a temporary file next to it,
and moved into place, so a crash never leaves half a config.
"""

from __future__ import annotations

import os
from pathlib import Path

import tomlkit


def set_default_model(config_file: Path, model: str) -> None:
    """Set the top-level ``default_model``. Creates the file when it is missing."""
    text = config_file.read_text("utf-8") if config_file.is_file() else ""
    document = tomlkit.parse(text)
    document["default_model"] = model
    config_file.parent.mkdir(parents=True, exist_ok=True)
    temp = config_file.with_name(f".{config_file.name}.tmp")
    temp.write_text(tomlkit.dumps(document), "utf-8")
    if config_file.exists():
        os.chmod(temp, config_file.stat().st_mode & 0o777)
    temp.replace(config_file)
