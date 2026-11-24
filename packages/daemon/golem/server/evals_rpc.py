"""``evals.*``: plan, run, follow, apply and delete a helper measurement (step 15.14).

The work is in :class:`golem.evals.job.EvalJobs`, which the daemon owns (``state.evals``). A call
that cannot be done now (a second start, an arm without room, a measurement that is not stopped)
is a JSON-RPC error whose message is plain text for the person.
"""

from __future__ import annotations

from golem.evals.job import NUMBER_KEYS, EvalJobs, EvalRefused
from golem.server.agents_edit import set_delegate_numbers
from golem.server.dispatcher import INTERNAL_ERROR, INVALID_PARAMS, RequestContext, RpcCallError
from golem_protocol.commands import (
    ConfigError,
    EvalsApplyParams,
    EvalsApplyResult,
    EvalsDeleteParams,
    EvalsDeleteResult,
    EvalsGetParams,
    EvalsGetResult,
    EvalsListParams,
    EvalsListResult,
    EvalsPlanParams,
    EvalsPlanResult,
    EvalsResumeParams,
    EvalsResumeResult,
    EvalsStartParams,
    EvalsStartResult,
    EvalsStopParams,
    EvalsStopResult,
)

NOTHING_MEASURED = (
    "This measurement did not measure any of the four numbers, so there is nothing to apply."
)


def _jobs(ctx: RequestContext) -> EvalJobs:
    jobs = ctx.state.evals
    if jobs is None:
        raise RpcCallError(INTERNAL_ERROR, "measurements are not ready")
    return jobs


async def evals_plan(ctx: RequestContext, params: EvalsPlanParams) -> EvalsPlanResult:
    """The arms, whether this Mac has room for each, and the id of the measurement that runs."""
    try:
        arms, running = await _jobs(ctx).plan(params.arms, params.models)
    except EvalRefused as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    return EvalsPlanResult(arms=arms, running=running, asks=_jobs(ctx).asks_wire())


async def evals_start(ctx: RequestContext, params: EvalsStartParams) -> EvalsStartResult:
    """Start a measurement in the background. Refused, with nothing started, when one runs or an
    arm may not run."""
    try:
        started = await _jobs(ctx).start(
            params.arms, params.models, params.allow_tight, params.own_risk
        )
    except EvalRefused as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    return EvalsStartResult(id=started)


async def evals_stop(ctx: RequestContext, params: EvalsStopParams) -> EvalsStopResult:
    return EvalsStopResult(stopped=await _jobs(ctx).stop(params.id))


async def evals_resume(ctx: RequestContext, params: EvalsResumeParams) -> EvalsResumeResult:
    try:
        resumed = await _jobs(ctx).resume(params.id, params.allow_tight, params.own_risk)
    except EvalRefused as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    return EvalsResumeResult(id=resumed)


async def evals_list(ctx: RequestContext, params: EvalsListParams) -> EvalsListResult:
    del params
    return EvalsListResult(measurements=_jobs(ctx).summaries())


async def evals_get(ctx: RequestContext, params: EvalsGetParams) -> EvalsGetResult:
    found = _jobs(ctx).get(params.id)
    if found is None:
        raise RpcCallError(INVALID_PARAMS, "There is no measurement with that id.")
    return EvalsGetResult(measurement=found)


async def evals_apply(ctx: RequestContext, params: EvalsApplyParams) -> EvalsApplyResult:
    """Write the measured numbers to ``[agents.delegate]``, the way ``agents.keep`` writes.

    A number that was not measured stays as it is. The measurement is marked in use with the four
    numbers that are in force afterwards.
    """
    jobs = _jobs(ctx)
    try:
        numbers = jobs.numbers_to_apply(params.id)
    except EvalRefused as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    if not numbers:
        return EvalsApplyResult(ok=False, errors=[ConfigError(message=NOTHING_MEASURED)])
    saved = await set_delegate_numbers(ctx, numbers)
    if saved.ok and saved.values is not None and saved.values.delegate is not None:
        delegate = saved.values.delegate
        jobs.mark_applied(params.id, {key: getattr(delegate, key).value for key in NUMBER_KEYS})
    return EvalsApplyResult(ok=saved.ok, errors=saved.errors, values=saved.values)


async def evals_delete(ctx: RequestContext, params: EvalsDeleteParams) -> EvalsDeleteResult:
    try:
        deleted = _jobs(ctx).delete(params.id)
    except EvalRefused as exc:
        raise RpcCallError(INVALID_PARAMS, str(exc)) from exc
    return EvalsDeleteResult(deleted=deleted)
