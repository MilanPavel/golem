<p align="center">
  <img src="docs/images/logo.svg" alt="golem" width="180">
</p>

<h1 align="center">golem</h1>

<p align="center">
  <b>Your own AI agent, living on your Mac.</b><br>
  Local models first. Hosted ones when the task needs them. Your data stays home.
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/legend-dark.svg">
    <img src="docs/images/legend-light.svg" alt="The name comes from the Prague legend. A clay servant, brought to life to work on its maker's behalf." width="560">
  </picture>
</p>

<p align="center">
  <a href="https://github.com/MilanPavel/golem/releases/latest"><img src="https://img.shields.io/github/v/release/MilanPavel/golem?color=9C6B3C&label=release" alt="Latest release"></a>
  <a href="https://github.com/MilanPavel/golem/actions/workflows/ci.yml"><img src="https://github.com/MilanPavel/golem/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <img src="https://img.shields.io/badge/macOS-Apple%20Silicon-2A1408" alt="macOS on Apple Silicon">
</p>

<p align="center">
  <img src="docs/images/demo.gif?v=2" alt="Chatting in the golem terminal" width="900">
</p>

---

## Why golem

<table>
<tr>
<td width="50%" valign="top">
<img src="docs/images/why-local.svg" alt="The golem works inside your Mac; a hosted model in the cloud is called only when needed, and each answer shows its cost" width="100%">
<h3>Local models first</h3>
Most agent tools assume a huge hosted model. Golem gets real work out of the model on your laptop, and calls a hosted one only when the task needs it. You always see what each answer costs.
</td>
<td width="50%" valign="top">
<img src="docs/images/why-lab.svg" alt="A three-panel story: task 1 takes nine steps, the golem writes down a skill, and task 2 takes three" width="100%">
<h3>Learns as it goes</h3>
Memory and skills the agent writes for itself, so each task makes the next one easier. Golem is also a lab for context compaction, routing between models, and stepping up when a small model struggles.
</td>
</tr>
<tr>
<td width="50%" valign="top">
<img src="docs/images/why-built.svg" alt="A blueprint of the golem in a circle and a square, with its parts labelled: memory, protocol, crash recovery, permissions, sandbox, evals" width="100%">
<h3>Built from scratch</h3>
Golem builds the hard parts itself, to learn what a reliable agent really needs: it survives a crash, asks before risky steps, runs commands in a safe shell, and tests its own answers.
</td>
<td width="50%" valign="top">
<img src="docs/images/why-tools.svg" alt="The golem asks before it acts: a prompt reads 'May I run pytest -q?' with allow and deny buttons, above its tools: files, shell, git, web" width="100%">
<h3>Asks before it acts</h3>
Files, the shell, git, and the web are built in. Every tool call passes one permission layer, so golem asks before it does anything that matters.
</td>
</tr>
</table>

Much of this is still the road ahead. [docs/plan.md](docs/plan.md) lists what comes next, step by step.

## Get started

You need an Apple Silicon Mac and [Homebrew](https://brew.sh).

```bash
brew install milanpavel/golem/golem   # install
golem                                 # open the chat, in any project folder
golem web                             # or open the same chats in your browser
```

The first time, golem asks to start its background service. Press Enter, then pick a model: a local one downloads right there, and a hosted one asks for your API key. [Install](https://milanpavel.github.io/golem/install) walks through every step, plus upgrading and removing.

## 📖 Documentation

Everything else is in **[the documentation](https://milanpavel.github.io/golem/)**:

- [First chat](https://milanpavel.github.io/golem/guide/first-chat): a model, a first question, and a first approval
- [Models and API keys](https://milanpavel.github.io/golem/guide/models), [Commands](https://milanpavel.github.io/golem/guide/commands), [Tools and permissions](https://milanpavel.github.io/golem/guide/permissions), [MCP servers](https://milanpavel.github.io/golem/guide/mcp), [Skills](https://milanpavel.github.io/golem/guide/skills), and [the web UI](https://milanpavel.github.io/golem/guide/web)
- [Architecture](https://milanpavel.github.io/golem/architecture) and [the decisions](https://milanpavel.github.io/golem/adr/README) behind it

## Contributing

[Hacking on golem](https://milanpavel.github.io/golem/contributing/hacking) sets up a checkout in one command, and [CONTRIBUTING.md](CONTRIBUTING.md) says how a change gets to `main`.

<p align="center"><br><img src="docs/images/logo.svg" alt="" width="36"></p>
