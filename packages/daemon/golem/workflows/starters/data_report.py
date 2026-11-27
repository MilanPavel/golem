# A golem starter. It runs saved queries of one data source with no model, has one model step
# write a short report about the results, and leaves it in the Inbox.
# A routine can run it on a schedule: give it the inputs source and queries (one query name
# on each line).
# The model step uses this run's model, or golem's default one. For a source whose rows stay on
# this computer the starter does not send them to a model at all: it posts the results as
# they are and says why. To have a local model write that report, copy this starter and name
# the model in @workflow.
from golem.workflow import Run, workflow

LOCAL_LEVELS = ("rows local", "schema only")
"""What a source line says when its rows may not go to a hosted model."""


def names_of(queries: str) -> list[str]:
    """The saved query names, one on each line, with no blank lines and no repeats."""
    return list(dict.fromkeys(line.strip() for line in queries.splitlines() if line.strip()))


def keeps_rows_local(sources: str, source: str) -> bool:
    """True when the source's line in ``data_sources`` says its rows stay on this computer.

    A source that is not listed counts as local: when golem cannot tell, the rows stay here.
    """
    for line in sources.splitlines():
        if line.startswith(f"{source}  "):
            return any(level in line for level in LOCAL_LEVELS)
    return True


@workflow(
    title="Data report",
    description="Runs saved queries with no model, then one model step writes a short report.",
)
async def data_report(run: Run, source: str, queries: str, path: str = "") -> str:
    del path  # a routine that watches a folder passes the new file's path; the report ignores it
    wanted = names_of(queries)
    if not wanted:
        raise ValueError("queries is empty: give the name of at least one saved query")
    sources = await run.tool("data_sources")
    results: list[str] = []
    for name in wanted:
        rows = await run.tool("data_query", key=f"query {name}", source=source, saved=name)
        results.append(f"{name}\n{rows}")
    if keeps_rows_local(sources, source):
        report = (
            f"The rows of {source} stay on this computer, so no model wrote this report. "
            "These are the results:\n\n" + "\n\n".join(results)
        )
        await run.notify(report, title=f"Data report: {source}")
        return report
    prompt = (
        "Write three short sentences about these results for their owner. Name the biggest "
        "change. Use only the numbers below.\n\n" + "\n\n".join(results)
    )
    report = await run.llm(prompt, key="report", title="Write the report")
    await run.notify(report, title=f"Data report: {source}")
    return report
