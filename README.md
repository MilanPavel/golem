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
  <b>In the browser</b><br>
  <img src="docs/images/demo-web.gif" alt="In the browser, golem is asked about infinity and good sources to study. It searches the web and reads three pages, then answers with a small source chip after each claim, and a chip's card shows the page it read. Then, in a new chat, it is asked to make a hello world app in Rust with a test and run it: an approval card shows each file as a diff and you allow it, then cargo test and cargo run, while the Changes panel fills with the two new files" width="900">
</p>

<p align="center">
  <b>In the terminal</b><br>
  <img src="docs/images/demo-tui.gif" alt="In the terminal, golem writes the same Rust hello world app: you allow each file as a diff and then the test run. A routine then asks for approval in another session, the banner and the status line say so, and /runs lists what needs you and what finished" width="900">
</p>

## Get started

You need an Apple Silicon Mac and [Homebrew](https://brew.sh).

```bash
brew install milanpavel/golem/golem   # install
golem                                 # open golem in your browser
golem tui                             # or chat in the terminal, in any project folder
```

The first time, golem asks to start its background service. Press Enter, then pick a model: a local one downloads right there, and a hosted one asks for your API key. [Install](https://milanpavel.github.io/golem/install) walks through every step, plus upgrading and removing.

## 📖 Documentation

Everything else is in **[the documentation](https://milanpavel.github.io/golem/)**:

- [First chat](https://milanpavel.github.io/golem/guide/first-chat): a model, a first question, and a first approval
- [Models and API keys](https://milanpavel.github.io/golem/guide/models), [Commands](https://milanpavel.github.io/golem/guide/commands), [Tools and permissions](https://milanpavel.github.io/golem/guide/permissions), [MCP servers](https://milanpavel.github.io/golem/guide/mcp), [Skills](https://milanpavel.github.io/golem/guide/skills), and [the web UI](https://milanpavel.github.io/golem/guide/web)
- [Architecture](https://milanpavel.github.io/golem/architecture) and [the decisions](https://milanpavel.github.io/golem/adr/README) behind it
- [Vision](docs/vision.md): where golem is going, and [the roadmap](docs/roadmap.md): the next steps

## Contributing

[Hacking on golem](https://milanpavel.github.io/golem/contributing/hacking) sets up a checkout in one command, and [CONTRIBUTING.md](CONTRIBUTING.md) says how a change gets to `main`.

<p align="center"><br><img src="docs/images/logo.svg" alt="" width="36"></p>
