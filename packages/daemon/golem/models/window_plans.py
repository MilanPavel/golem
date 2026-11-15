"""The window golem plans for each local model, and what it remembers about it.

``plan_window`` is the rule. This is the state around it: the settings, what discovery
knows, and the windows a model proved too big for (lowered) or fit (raised). The plan of
a model is the same number on every call, so Ollama never reloads for a changed
``num_ctx``. Nothing here uses the network.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Callable
from pathlib import Path
from typing import Protocol

from golem.config import ContextSettings
from golem.models.window_plan import plan_window, step_down

log = logging.getLogger(__name__)

CACHE_NAME = "windows.json"

_Key = tuple[object, ...]


class PlanFacts(Protocol):
    """What discovery already knows about an installed Ollama model."""

    def ollama_facts(self, model_id: str) -> tuple[int | None, float | None]:
        """``(maximum context, size in GB)``, each None when unknown. No I/O."""
        ...


class WindowPlans:
    """The planned ``num_ctx`` of each Ollama model id."""

    def __init__(
        self,
        *,
        settings: Callable[[], ContextSettings],
        discovery: PlanFacts | None,
        ram_gb: float | None,
        cache_dir: Path | None,
    ) -> None:
        self._settings = settings
        self._discovery = discovery
        self._ram_gb = ram_gb
        self._file = None if cache_dir is None else cache_dir / CACHE_NAME
        self._saved = self._read()
        self._memo: dict[str, tuple[_Key, int | None]] = {}

    def planned(self, model_id: str) -> int | None:
        """The window to send for ``model_id``, or None when golem should send nothing."""
        window = self._settings().window
        if window == "ollama":
            return None
        model_max, size_gb = self._facts(model_id)
        saved = self._saved.get(model_id, {})
        lowered = saved.get("lowered_to")
        raised = saved.get("raised_to")
        key: _Key = (window, model_max, size_gb, self._ram_gb, lowered, raised)
        memo = self._memo.get(model_id)
        if memo is not None and memo[0] == key:
            return memo[1]
        plan = self._plan(window, model_max, size_gb, lowered, raised)
        self._memo[model_id] = (key, plan)
        return plan

    def lower(self, model_id: str) -> int | None:
        """Step ``model_id`` down one window, remember it, and return the new plan.

        Only a window golem chose is lowered. A number set in ``[context] window`` stays.
        """
        if self._settings().window != "auto":
            return None
        current = self.planned(model_id)
        if current is None:
            return None
        lower = step_down(current)
        if lower is None:
            return None
        self._saved[model_id] = {"lowered_to": lower}
        self._write()
        return self.planned(model_id)

    def raised(self, model_id: str, to: int) -> None:
        """Remember that ``model_id`` ran well at ``to``, which is now its plan."""
        saved = dict(self._saved.get(model_id, {}))
        saved["raised_to"] = to
        self._saved[model_id] = saved
        self._write()

    def _plan(
        self,
        window: str | int,
        model_max: int | None,
        size_gb: float | None,
        lowered: int | None,
        raised: int | None,
    ) -> int | None:
        if isinstance(window, int):
            return min(window, model_max) if model_max is not None else window
        if raised is not None:
            return min(raised, model_max) if model_max is not None else raised
        return plan_window(
            model_max=model_max, size_gb=size_gb, ram_gb=self._ram_gb, lowered_to=lowered
        )

    def _facts(self, model_id: str) -> tuple[int | None, float | None]:
        if self._discovery is None:
            return None, None
        return self._discovery.ollama_facts(model_id)

    def _read(self) -> dict[str, dict[str, int]]:
        if self._file is None:
            return {}
        try:
            raw: object = json.loads(self._file.read_text())
        except (OSError, ValueError):
            return {}
        if not isinstance(raw, dict):
            return {}
        saved: dict[str, dict[str, int]] = {}
        for name, entry in raw.items():  # pyright: ignore[reportUnknownVariableType]
            if not isinstance(name, str) or not isinstance(entry, dict):
                continue
            kept = {
                k: v
                for k, v in entry.items()  # pyright: ignore[reportUnknownVariableType]
                if k in ("lowered_to", "raised_to")
                and isinstance(v, int)
                and not isinstance(v, bool)
                and v > 0
            }
            if kept:
                saved[name] = kept
        return saved

    def _write(self) -> None:
        if self._file is None:
            return
        try:
            self._file.parent.mkdir(parents=True, exist_ok=True)
            self._file.write_text(json.dumps(self._saved, sort_keys=True))
        except OSError as exc:
            log.warning("could not save %s: %s", self._file, exc)
