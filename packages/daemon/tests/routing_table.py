"""The routing cases as data, and the Markdown table of what each must get.

``just routing-table`` prints the table. ``docs/architecture/models.md`` holds a copy between two
markers, and ``test_routing_table.py`` fails when the copy is out of date.
"""

from __future__ import annotations

import tomllib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

DATA = Path(__file__).parent / "data" / "routing_cases.toml"
DOC = Path(__file__).resolve().parents[3] / "docs" / "architecture" / "models.md"
BEGIN = "<!-- routing-table:begin -->"
END = "<!-- routing-table:end -->"


@dataclass(frozen=True, slots=True)
class Case:
    name: str
    route: str
    session_model: str  # a fixture name
    models: tuple[str, ...]
    prompt_tokens: int | None = None
    paid_ok: bool = False
    spent_today: float = 0.0
    step_floor: str | None = None
    local_only_folder: bool = False
    action: str = "send"
    wish: str = ""  # a helper wish, for the action `pick_helper`
    settings: dict[str, Any] = field(default_factory=dict[str, Any])
    expect: dict[str, Any] = field(default_factory=dict[str, Any])


def load() -> tuple[dict[str, dict[str, Any]], list[Case]]:
    """The model fixtures by name, and the cases in file order."""
    raw = tomllib.loads(DATA.read_text(encoding="utf-8"))
    fixtures: dict[str, dict[str, Any]] = raw["model"]
    cases: list[Case] = []
    for item in raw["case"]:
        fields: dict[str, Any] = {**item, "models": tuple(item["models"])}
        fields.setdefault("route", "auto")
        cases.append(Case(**fields))
    return fixtures, cases


def _size(count: int) -> str:
    return f"{count // 1000}K" if count % 1000 == 0 else str(count)


def _inputs(case: Case, fixtures: dict[str, dict[str, Any]]) -> str:
    parts: list[str] = []
    if case.prompt_tokens is not None:
        parts.append(f"prompt {_size(case.prompt_tokens)}")
    if case.paid_ok:
        parts.append("paid yes")
    if case.spent_today:
        parts.append(f"spent ${case.spent_today:.2f}")
    if case.step_floor:
        parts.append(f"floor {case.step_floor}")
    if case.local_only_folder:
        parts.append("local-only folder")
    budget = case.settings.get("budget", {})
    for key, label in (("daily_usd", "daily cap"), ("session_usd", "session cap")):
        if key in budget:
            parts.append(f"{label} ${budget[key]:.2f}")
    if budget.get("over") == "ask":
        parts.append("over = ask")
    routing = case.settings.get("routing", {})
    if "paid" in routing:
        parts.append(f"paid = {routing['paid']}")
    for role, ref in routing.get("roles", {}).items():
        parts.append(f"{role} = {ref}")
    if case.wish:
        parts.append(f"wish {case.wish}")
    if case.action in ("stronger", "struggle", "provider_down", "rate_limited"):
        parts.append(case.action.replace("_", " "))
    known = ", ".join(fixtures[name]["ref"].partition("/")[2] for name in case.models)
    return f"{'; '.join(parts) + '; ' if parts else ''}models {known}"


def _outcome(case: Case) -> tuple[str, str]:
    expect = case.expect
    if "error" in expect:
        return f"refused: `{expect['error']}`", ""
    model = f"`{expect['model']}`"
    if expect.get("asks"):
        model += " after the paid question"
    if expect.get("fresh"):
        model += " in a fresh window"
    return model, f"`{expect['reason']}`" if "reason" in expect else ""


def render() -> str:
    """The Markdown table of every case with its expected decision."""
    fixtures, cases = load()
    rows = [
        "| Case | Route | Session model | Situation | Model | Reason |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for case in cases:
        model, reason = _outcome(case)
        route = "" if case.action.endswith("_role") or case.wish else f"`{case.route}`"
        session = f"`{fixtures[case.session_model]['ref']}`"
        cells = [case.name, route, session, _inputs(case, fixtures), model, reason]
        rows.append("| " + " | ".join(cells) + " |")
    return "\n".join(rows)


def in_doc(text: str) -> str | None:
    """The table between the markers of ``text``, or None when the markers are missing."""
    start, _, rest = text.partition(BEGIN)
    table, found, _ = rest.partition(END)
    return table.strip() if start != text and found else None


if __name__ == "__main__":
    print(render())
