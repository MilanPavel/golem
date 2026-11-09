# Workflows

![Dependency upgrades as a workflow: steps tick through, the daemon dies after step 3 and resumes without repeating anything, the review waits two days for you, and the pull requests are opened exactly once](../images/vision-workflow.svg)

### The problem

An agent is good at one task, in one sitting, with you watching. Most useful work is not like that. It repeats every morning. It takes an hour, and your laptop restarts in the middle. It needs a person to say yes, and the person answers on Thursday. It sends an email, and must never send it twice.

A chat cannot carry that. Its order lives in the model's head, so it is different every time; when the process dies, the plan dies with it; and nothing remembers that the email already went out.

### What a workflow is

Steps that **your code** puts in order, where any step can call a tool, a model, or a whole agent. Golem keeps the rest:

- **Durable.** Every finished step is saved. A crash, a restart, or an upgrade continues after the last saved step, and nothing finished runs again.
- **Patient.** A step can stop and wait for your review, for days. The question finds you on the Mac or the phone.
- **Exactly once.** A step that touches the world (posts, sends, pays, merges) carries a key, so a retry never does it twice.
- **Watchable.** `/runs` shows each step, its time, its cost, and its output, live. A step that ran an agent opens into that agent's chat.
- **Triggered.** A schedule, a new file in a folder, a webhook, a message from your phone, or another workflow.

| | Who decides what happens next | Good for |
|---|---|---|
| **Skill** | The model, following written instructions | "Open a pull request the way this project likes it" |
| **Agent** | The model, choosing tools | "Fix the failing test" |
| **Workflow** | Your code. The model does the steps | "Every Monday, upgrade each outdated package and open a pull request for every green one, after I approve" |

Workflows are written in **Python**, the daemon's language, because durability is the hard part and one engine is enough. A short YAML or markdown form for simple step lists can come later, compiled to the same engine. An app written in TypeScript starts and watches workflows through the app API.

### One example, in depth: dependency upgrades

Every project falls behind on its packages. Each upgrade is small, but there are many, each one can break something, and nobody wants to spend Monday on them. That is a good job for a workflow: the order is always the same, the fuzzy parts are small, and a person should say yes before anything leaves the machine.

- **Trigger:** every Monday at 6:00.
- **Does:** lists the outdated packages and starts one [sub-agent](./sub-agents.md) per package, each in its own git worktree. Each one reads the changelog, upgrades, fixes what broke, and runs the tests.
- **You get:** a pull request for every green upgrade, and a short note for each one that failed, with the reason. Your phone shows "4 ready, 1 needs you".

#### The workflow in Python

A sketch of how it could read. The names are not final; the shape is the point: plain code decides the order, agents do the fuzzy parts, and each `await` is a step golem saves.

```python
from golem.workflow import Run, schedule, workflow

from .packages import list_outdated, open_pull_request


@workflow(trigger=schedule("mon 06:00"))
async def upgrade_dependencies(run: Run) -> None:
    # Step 1: plain code, no model. The result is saved, so a restart does not run it again.
    outdated = await run.step("list outdated", list_outdated, run.repo)
    if not outdated:
        return

    # Step 2: one sub-agent per package, side by side, each in its own worktree.
    upgrades = await run.parallel(
        run.agent(
            "upgrader",  # agents/upgrader.md: its prompt, tools, and rules
            brief=f"Upgrade {pkg.name} from {pkg.current} to {pkg.latest}. "
            "Read the changelog, fix what breaks, and run the tests.",
            worktree=f"upgrade/{pkg.name}",
            model="local",  # a small local model first; steps up only if it gets stuck
            budget="$0.50",
        )
        for pkg in outdated
    )
    green = [u for u in upgrades if u.tests_passed]
    stuck = [u for u in upgrades if not u.tests_passed]

    # Step 3: tell you, then wait. The run sleeps here for as long as it takes.
    await run.notify(f"{len(green)} ready, {len(stuck)} need you")
    approved = await run.review(green, ask="Open these pull requests?")

    # Step 4: touch the world, exactly once. The key makes a retry a no-op.
    for u in approved:
        await run.step(
            f"open PR for {u.package}",
            open_pull_request,
            u,
            key=f"pr:{u.package}:{u.version}",
        )
```

`list_outdated` and `open_pull_request` are ordinary functions in your repository: one runs `uv lock --upgrade --dry-run` or `pnpm outdated`, the other runs `gh pr create`. Golem does not need to know what they do. It needs to know where each step starts and ends.

#### What happens on Monday

1. **6:00.** The daemon starts the run. `list outdated` finds five packages, and the list is saved with the run.
2. **6:01.** Five sub-agents start, one per package. Each gets the brief, not your chat history, so a small local model can do the job. Each works in its own worktree and can only edit there; anything outside asks you first, as in a chat.
3. **6:20.** The Mac restarts for an update while two agents are still working. When the daemon is back, the run continues: the three finished upgrades are not done again, and the two unfinished ones continue from their last saved turn.
4. **6:40.** Four upgrades pass their tests. The fifth, a major version with a changed API, does not: its agent stops at the budget and writes down why. The local model did all five for $0.00; one asked for a hosted model for one hard step, for $0.12.
5. **7:30.** Your phone shows "4 ready, 1 needs you". The review waits. If you answer on Wednesday, it is Wednesday's answer.
6. **You approve** with Face ID. Four pull requests open. If the network fails halfway and the step runs again, the key makes sure no pull request opens twice.
7. **The stuck one** opens as a chat: its diff, the failing test, and the agent's note. You can take it from there yourself, or give the agent a hint and let it try again.

`/runs` shows the whole run while it happens: each step, its time, its cost, and its output. A step that ran an agent opens into that agent's chat.

The same shape fits much else: a trigger, plain code for the order, agents for the fuzzy parts, a review where a person decides, and one action that happens exactly once.

---
