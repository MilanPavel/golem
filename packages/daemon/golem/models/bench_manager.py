"""``model.bench``: run the benchmark as a daemon task and send its rows.

:class:`BenchManager` starts :func:`golem.models.bench.bench` for one local model, sends
``model.bench.progress`` after each row and ``model.bench.done`` at the end (neither is
stored). One run per model at a time. A hosted model, or a setup with no local model, is
refused before anything starts.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from typing import Protocol

from pydantic import BaseModel

from golem.models.bench import MAX_AT_ONCE, NoLocalModel, OnRow, Result, Row, bench, local_profile
from golem.models.bench_store import BenchStore
from golem.models.engine import OLLAMA
from golem.models.errors import ModelUnreachable, failure_of, provider_error
from golem.models.ollama import LocalServers
from golem.models.router import ModelRouter
from golem_protocol.commands import ModelBenchDone, ModelBenchProgress, ModelBenchRow
from golem_protocol.rpc import ModelBenchDoneNotification, ModelBenchProgressNotification

log = logging.getLogger(__name__)

Broadcast = Callable[[BaseModel], None]


class Run(Protocol):
    """Measures one local model. :func:`golem.models.bench.bench` is the real one."""

    def __call__(
        self,
        router: ModelRouter,
        local: LocalServers,
        model: str | None = None,
        *,
        limit: int = 1,
        on_row: OnRow | None = None,
    ) -> Awaitable[Result]: ...


def _row_wire(row: Row) -> ModelBenchRow:
    return ModelBenchRow(
        shape=row.shape,
        at_once=row.at_once,
        each=list(row.each),
        total=row.total,
        window=row.window,
    )


class BenchManager:
    """Starts benchmarks and follows them. One run per model at a time.

    The numbers are only right on an idle machine. The calls do not take dispatcher
    slots, so a chat that runs on the same server during a run shares it and slows the
    numbers down. The run does not hold dispatcher lines.
    """

    def __init__(
        self,
        router: ModelRouter,
        local: LocalServers,
        *,
        broadcast: Broadcast | None = None,
        run: Run = bench,
        store: BenchStore | None = None,
    ) -> None:
        self._router = router
        self._local = local
        self.broadcast: Broadcast = broadcast or (lambda _model: None)
        self._run_bench = run
        self._store = store
        self._runs: dict[str, asyncio.Task[None]] = {}

    def benching(self) -> list[str]:
        return list(self._runs)

    async def aclose(self) -> None:
        tasks = list(self._runs.values())
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    def start(self, name: str, engine: str | None = None) -> tuple[str, bool]:
        """Start a run. Returns ``(ref, started)``; ``started`` is false when one already runs.

        Raises :class:`NoLocalModel` when ``name`` is not a local model, naming the reason.
        Nothing is started and no model is called then.
        """
        if engine is not None and engine != OLLAMA.id:
            raise NoLocalModel(f"golem cannot measure on {engine}")
        profile = local_profile(self._router, name)
        target = self._router.ollama_server(profile)
        if target is None or self._local.get(*target) is None:
            raise NoLocalModel(f"{profile} does not run on this machine")
        ref = self._router.resolve(profile).ref
        if ref in self._runs:
            return ref, False
        task = asyncio.create_task(self._run(profile, ref, target), name=f"golem-bench-{ref}")
        self._runs[ref] = task
        log.info("bench started ref=%s", ref)
        return ref, True

    async def wait(self, ref: str) -> None:
        task = self._runs.get(ref)
        if task is not None:
            await asyncio.wait([task])

    async def _run(self, profile: str, ref: str, target: tuple[str, str]) -> None:
        rows: list[Row] = []
        error: str | None = None

        def progress(index: int, total: int, row: Row) -> None:
            rows.append(row)
            note = ModelBenchProgress(ref=ref, index=index, total=total, row=_row_wire(row))
            self._send(ModelBenchProgressNotification(params=note))

        try:
            limit = await self._limit(profile, target)
            result = await self._run_bench(
                self._router, self._local, profile, limit=limit, on_row=progress
            )
            self._save(profile, result)
        except asyncio.CancelledError:
            error = "cancelled"
        except NoLocalModel as exc:
            error = str(exc)
        except Exception as exc:
            error = await self._error_text(profile, exc)
        finally:
            self._runs.pop(ref, None)
            done = ModelBenchDone(
                ref=ref, ok=error is None, error=error, rows=[_row_wire(row) for row in rows]
            )
            self._send(ModelBenchDoneNotification(params=done))
            log.info("bench ended ref=%s error=%s", ref, error)

    def _save(self, profile: str, result: Result) -> None:
        """Keep a finished run. The store is asked by model id, which the router knows."""
        if self._store is None:
            return
        try:
            self._store.save(result, model_id=self._router.resolve(profile).model_id)
        except Exception:
            log.warning("could not save the bench of %s", result.model, exc_info=True)

    async def _limit(self, profile: str, target: tuple[str, str]) -> int:
        """Calls at once for a server golem did not start: 1 when the probe saw no overlap."""
        server = self._local.get(*target)
        parallel = min(max(self._local.settings.fixed_parallel, 1), MAX_AT_ONCE)
        if server is None:
            return parallel
        # The probe needs to know who runs the server, which the first use finds out.
        await server.ensure_running()
        found = await self._local.probe(target[1], self._router.resolve(profile).model_id)
        return 1 if found is not None and found.slots == 1 else parallel

    async def _error_text(self, profile: str, exc: Exception) -> str:
        down = self._router.unreachable(profile, exc) or await self._router.refused(profile, exc)
        if down is not None:
            return f"{down.message}: {down.hint}"
        failure = failure_of(exc)
        if failure != "other":
            provider = self._router.identity(profile).provider or "the provider"
            error: ModelUnreachable = provider_error(provider, failure)
            return f"{error.message}: {error.hint}"
        return str(exc) or type(exc).__name__

    def _send(self, notification: BaseModel) -> None:
        try:
            self.broadcast(notification)
        except Exception:
            log.debug("broadcast failed", exc_info=True)


__all__ = ["BenchManager", "Run"]
