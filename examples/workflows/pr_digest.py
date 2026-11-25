# examples/workflows/pr_digest.py
import json

from golem.workflow import Run, manual, workflow


def pulls_of(text: str) -> list[dict]:
    """The pull requests in the tool's JSON output: a list, or an object that holds one."""
    found = json.loads(text)
    if isinstance(found, dict):
        found = found.get("items") or found.get("pull_requests") or []
    return [pr for pr in found if isinstance(pr, dict)]


@workflow(
    trigger=manual(),
    inputs={"tool": str, "repo": str},
    description="One line for each open pull request, checked by you, then a notice.",
)
async def pr_digest(run: Run) -> str:
    # `tool` is an MCP tool that lists pull requests, such as mcp__github__list_pull_requests.
    listing = await run.tool(run.inputs["tool"], repo=run.inputs["repo"])
    pulls = pulls_of(listing)

    lines = await run.parallel(
        [
            run.llm(
                f"Summarise this pull request in one line:\n{json.dumps(pr)[:2000]}",
                key=f"summarise #{pr.get('number', i)}",
            )
            for i, pr in enumerate(pulls)
        ]
    )
    digest = "\n".join(
        f"- #{pr.get('number', '?')}: {line}" for pr, line in zip(pulls, lines, strict=True)
    )

    # To have a skill write the notes instead: digest = await run.skill("pr-notes", args=digest)
    ask = f"Digest of {len(pulls)} open PRs in {run.inputs['repo']}"
    reviewed = await run.review(digest, ask=ask)
    if reviewed["verdict"] == "reject":
        return "rejected"
    if reviewed["verdict"] == "edit":
        digest = reviewed["text"]
    await run.notify(digest, title=f"PR digest: {run.inputs['repo']}")
    return digest
