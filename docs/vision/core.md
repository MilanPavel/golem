# Core features

![The router as a gauge from local to hosted. Four requests in turn: small and private ones go to local models for nothing, a migration plan steps up to a hosted model for two cents, against a daily budget](../images/vision-core.svg)

Everything above stands on the same core, and the core is where golem is also a lab: the point is to find out, in the open, what a reliable agent really needs.

- **It learns.** [Skills](../architecture/skills.md) it can pin, load on demand, pick by meaning, and in the end write for itself. Memory you can see and edit, that keeps only what you confirm, with a separate space per app user in serve mode.
- **Local models, first.** Ollama today. **MLX**, Apple's own framework, often faster on a Mac, started and stopped by golem the same way, in its own process. A tool-calling eval per model answers "does this one work as an agent?".
- **Cheap first, step up when it pays.** Every call shows its tokens and cost. A cheap profile, budgets, and escalation: try the small model, and move up only when it struggles.
- **Long sessions.** Small local models have small windows. Compaction keeps a long session going without losing the thread.
- **Evals and replay.** Tracing, eval suites, replaying a run, crash tests. On your Mac they make golem better; in serve mode they gate a deploy.
- **More than macOS.** One small interface for everything that depends on the OS, then Linux (servers and containers run it) and, later, Windows.

The [roadmap](../roadmap.md) links the issues that list these as steps.

---
