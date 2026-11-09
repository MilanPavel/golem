# Sub-agents

![A parent golem hands three sub-agents a brief each, shown as swimlanes: an explorer and a worker on local models, a reviewer on a hosted one. The worker asks for an approval, which bubbles up; three summaries and a diff come back](../images/vision-subagents.svg)

### The idea

A workflow is code deciding what happens next. A sub-agent is the *model* deciding: in the middle of a task, golem hands a part of it to a smaller agent with a short brief, waits for the answer, and goes on.

This matters more for golem than for most agents. **A small local model is good at a narrow job with a short context, and bad at a long chat.** A sub-agent turns one long, wide task into several short, narrow ones. "Upgrade every dependency and fix what breaks" is hard for an 8B model. "Read this changelog and list what changed in the API" is not.

The two fit together: a workflow step can be an agent, and an agent can start a workflow.

### How it works

- **A tool, like any other.** The model calls `delegate` with a brief, an agent type, and optionally a model. It goes through the same permission layer as every tool call.
- **Its own session.** A child is a session of its own, linked to its parent, on its own thread. It starts from the brief and the files it needs, not from the whole chat. Its events go to the same log, so a crash or a restart resumes it like any session.
- **A summary back, not a transcript.** The parent gets the child's answer and its artifacts (a diff, a file, a list), never its whole chat. The parent's context stays small.
- **Agent types are files.** An agent is a markdown file with a header: name, model or profile, tools, skills, and rules, with its prompt as the body (`agents/*.md`, the same shape as `SKILL.md`). Golem comes with a few: an **explorer** that only reads, on a cheap local model; a **worker** that edits inside its own git worktree; a **reviewer** that checks a diff. The same files are what [serve mode](./serve-mode.md#serve-mode-the-agent-behind-your-app) deploys.
- **In parallel.** A parent can start several children at once, up to a limit, and wait for any or all.

### The rules

- **A child never has more than its parent.** Its tools and rules are the parent's, or fewer. It cannot grant itself anything.
- **Approvals bubble up.** When a child asks "may I run `uv lock`?", the question appears on whichever screen watches the parent: the terminal, the Mac, the phone. You answer once.
- **Every child has limits:** a budget, a time, a depth (a child may start children only so deep), and a number running at once.
- **A child's answer is data.** What a child returns is never an instruction about permissions, like anything a tool returns.

### Routing, per child

Each child picks its own model. Fan out to a free local model for search and summaries, and step up to a hosted model for the plan or the final review. Each child's cost is counted, and rolls up into the parent's, so one answer shows what the whole tree cost.

### Somewhere else

A child does not have to run on your Mac. The same child can start in a container, on a machine you own over `ssh`, or on a rented GPU with a bigger open model than your Mac can hold. Your golem attaches to it over the gateway like any client, watches it, and takes the result back **as a diff you review**, never as a write to your files. Your Keychain and your other chats never cross; tokens are for one task, and expire with it. A forgotten GPU is the main risk to money, so every remote child has a time limit and destroys itself when idle.

The same split works for tools: golem's own tools can run on another machine than the daemon, inside that machine's own sandbox and folders, so a daemon on a server can still work on your laptop's files.

### Seeing it work

Many agents at once are easy to lose. Each screen shows them in its own way:

- **The terminal:** a tree under the turn that started it, one line per child with its status, model, cost, and time. Expand a line to see its tool calls; press enter to open its chat.

  ```
  ▾ delegate · 3 helpers · $0.03 · 4m
    ✓ explorer   qwen3:8b       find what the upgrade breaks      $0.00  1m12s
    ◐ worker     qwen3-coder    upgrade httpx in a worktree       $0.00  2m40s  ⏸ may I run uv lock?
    ○ reviewer   claude         check the diff                    waiting
  ```

- **The Mac and the web UI:** a swimlane timeline, one lane per child (as in the figure above), with approvals as markers on the lane. Click a lane to open that child's chat; drag across the lanes to see what ran at the same time.
- **The phone:** one Live Activity for the whole tree: "3 helpers · 2 done · 1 asks you".

---
