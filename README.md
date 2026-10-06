# golem

A personal agent you run from the terminal. It is a long-running Python daemon, built on LangGraph, that runs chats and durable flows against local and remote LLMs. An Ink TUI is its main client. Every side effect goes through a single permission layer, and approvals still work when the TUI is closed. The name comes from the Prague legend.

See [docs/architecture.md](docs/architecture.md) for the architecture, [docs/monorepo.md](docs/monorepo.md) for the Python and TypeScript workspace setup, and [docs/plan.md](docs/plan.md) for the phased plan.
