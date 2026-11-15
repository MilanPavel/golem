"""Which checks a project has: from ``[[coding.check]]``, or detected from its files."""

from __future__ import annotations

import json
import re
import tomllib
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, cast

from golem.config import CodingSettings

MAX_DETECTED = 4
_DEFAULT_TIMEOUT = 120


@dataclass(frozen=True, slots=True)
class Check:
    name: str
    command: str
    timeout_seconds: int
    source: Literal["config", "detected"]


def checks_for(root: Path, settings: CodingSettings) -> list[Check]:
    """The configured checks, or when there are none, the detected ones."""
    if settings.check:
        return [Check(c.name, c.command, c.timeout_seconds, "config") for c in settings.check]
    return detect(root)


def detect(root: Path) -> list[Check]:
    """Checks implied by the files in ``root`` itself, at most four. Tests are never detected."""
    found: list[Check] = []

    def add(name: str, command: str) -> None:
        found.append(Check(name, command, _DEFAULT_TIMEOUT, "detected"))

    if _has_just_recipe(root, "lint"):
        add("lint", "just lint")
    scripts = _package_scripts(root)
    if "lint" in scripts or "typecheck" in scripts:
        pm = _package_manager(root)
        if "lint" in scripts:
            add("lint", f"{pm} run lint")
        if "typecheck" in scripts:
            add("typecheck", f"{pm} run typecheck")
    if _has_ruff(root):
        add("ruff", "ruff check .")
    if (root / "Cargo.toml").is_file():
        add("cargo check", "cargo check")
    if (root / "go.mod").is_file():
        add("go vet", "go vet ./...")
    return found[:MAX_DETECTED]


def _read(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None


def _has_just_recipe(root: Path, name: str) -> bool:
    pattern = re.compile(rf"^{re.escape(name)}\b.*:", re.MULTILINE)
    for file in ("justfile", "Justfile"):
        text = _read(root / file)
        if text is not None and pattern.search(text):
            return True
    return False


def _package_scripts(root: Path) -> dict[str, Any]:
    text = _read(root / "package.json")
    if text is None:
        return {}
    try:
        data = json.loads(text)
    except ValueError:
        return {}
    if not isinstance(data, dict):
        return {}
    scripts = cast("dict[str, Any]", data).get("scripts")
    return cast("dict[str, Any]", scripts) if isinstance(scripts, dict) else {}


def _package_manager(root: Path) -> str:
    if (root / "pnpm-lock.yaml").is_file():
        return "pnpm"
    if (root / "yarn.lock").is_file():
        return "yarn"
    if (root / "bun.lockb").is_file() or (root / "bun.lock").is_file():
        return "bun"
    return "npm"


def _has_ruff(root: Path) -> bool:
    if (root / "ruff.toml").is_file():
        return True
    text = _read(root / "pyproject.toml")
    if text is None:
        return False
    try:
        data = tomllib.loads(text)
    except tomllib.TOMLDecodeError:
        return False
    tool = data.get("tool")
    return isinstance(tool, dict) and isinstance(tool.get("ruff"), dict)  # pyright: ignore[reportUnknownMemberType]
