# Changelog

What changed in each release of golem, newest first. `just release` writes each section from the commit messages on `main` ([CONTRIBUTING.md](CONTRIBUTING.md)), and the release pull request is the place to edit it. The GitHub release shows the same section. How a release is made is in [docs/sre.md](docs/sre.md), section 5.

## [0.5.0] - 2026-11-02

### Features

- **skills:** a skill body is filled in with its arguments, its folder, and the session ID ([#148](https://github.com/MilanPavel/golem/pull/148))
- **skills:** message.send can run a skill by name, and the log says which skill and when ([#149](https://github.com/MilanPavel/golem/pull/149))
- **tui:** /name runs a skill, /skill run reaches any, and skills show in the / suggestions ([#194](https://github.com/MilanPavel/golem/pull/194))
- **web:** a web UI package that just check builds, lints, and tests ([#195](https://github.com/MilanPavel/golem/pull/195))
- **tui:** an invoked skill shows as the line you typed, and Ctrl-O shows its body ([#198](https://github.com/MilanPavel/golem/pull/198))
- **web:** golem's design tokens, with light and dark themes that follow the system ([#197](https://github.com/MilanPavel/golem/pull/197))
- **skills:** a skill the session ran can read its own files and run its own scripts ([#200](https://github.com/MilanPavel/golem/pull/200))
- **tui:** the question you are reading stays pinned at the top while its answer scrolls ([#201](https://github.com/MilanPavel/golem/pull/201))
- **client:** the client connects over a WebSocket, and stops retrying when its login is refused ([#202](https://github.com/MilanPavel/golem/pull/202))
- **web:** the web UI's building blocks, and the pixel golem with its five states ([#203](https://github.com/MilanPavel/golem/pull/203))
- **protocol:** each method says whether a browser may call it, and auth.set and auth.remove may not ([#211](https://github.com/MilanPavel/golem/pull/211))
- **daemon:** golem builds a system prompt for each model call, shown first in /debug model ([#213](https://github.com/MilanPavel/golem/pull/213))
- **web:** the gateway lets one allowed JSON request per message through to golem, and nothing else ([#215](https://github.com/MilanPavel/golem/pull/215))
- **skills:** session.set_skills pins a skill, and its body is in every model call until unpinned ([#216](https://github.com/MilanPavel/golem/pull/216))
- **tui:** /skill pin and /skill unpin keep a skill on for the chat, and the status line shows it ([#218](https://github.com/MilanPavel/golem/pull/218))
- **web:** gateway login with a token file, session cookie, and Origin and Host checks ([#219](https://github.com/MilanPavel/golem/pull/219))
- **skills:** an edited, deleted, or broken pinned skill is logged once, and the turn still runs ([#255](https://github.com/MilanPavel/golem/pull/255))
- **web:** gateway server that bridges a WebSocket to the daemon socket ([#256](https://github.com/MilanPavel/golem/pull/256))
- **cli:** golem web command that starts the gateway or reuses a running one ([#257](https://github.com/MilanPavel/golem/pull/257))
- **web:** embed the page's files in the golem binary and serve them from the gateway ([#259](https://github.com/MilanPavel/golem/pull/259))
- **cli:** golem offers to start its background service when no daemon answers ([#260](https://github.com/MilanPavel/golem/pull/260))
- **sessions:** a fork starts with its source's pinned skills and on-demand MCP servers ([#297](https://github.com/MilanPavel/golem/pull/297))
- **web:** connection store and full-screen connection states ([#298](https://github.com/MilanPavel/golem/pull/298))
- **web:** embed the built web page in the golem binary ([#299](https://github.com/MilanPavel/golem/pull/299))
- **daemon:** a daemon that can't start says why, in the TUI and golem status ([#300](https://github.com/MilanPavel/golem/pull/300))
- **cli:** commands that need the daemon say how to start it, or why it could not start ([#304](https://github.com/MilanPavel/golem/pull/304))
- **web:** session stores, the session list, a query client, and a router ([#313](https://github.com/MilanPavel/golem/pull/313))
- **web:** app shell and a sidebar of sessions grouped by folder ([#316](https://github.com/MilanPavel/golem/pull/316))
- **tui:** after brew upgrade, ctrl-r restarts golem's service from the chat ([#315](https://github.com/MilanPavel/golem/pull/315))
- **cli:** golem web offers to start golem's service before it opens the browser ([#317](https://github.com/MilanPavel/golem/pull/317))
- **web:** the transcript, with sanitized markdown and highlighted code ([#319](https://github.com/MilanPavel/golem/pull/319))
- **web:** the composer and dock, with pastes, history, and stop ([#320](https://github.com/MilanPavel/golem/pull/320))
- **web:** the favicon and tab title show what golem is doing ([#324](https://github.com/MilanPavel/golem/pull/324))
- **models:** the model list says what setup needs, and no model is a clean state ([#326](https://github.com/MilanPavel/golem/pull/326))
- **web:** tool lines open into their arguments and output ([#336](https://github.com/MilanPavel/golem/pull/336))
- **tui:** a first start shows three choices: on this Mac, with an API key, or later ([#338](https://github.com/MilanPavel/golem/pull/338))
- **web:** file changes show as unified or split diffs in the tool's tablet ([#339](https://github.com/MilanPavel/golem/pull/339))

### Fixes

- **daemon:** wait up to 60 s for ollama serve, so a fresh install's first start is not stopped ([#146](https://github.com/MilanPavel/golem/pull/146))
- **client:** the client dials through a Link, and characters split across socket reads stay whole ([#193](https://github.com/MilanPavel/golem/pull/193))
- **tui:** golem opens the newest session in the folder it was started in ([#199](https://github.com/MilanPavel/golem/pull/199))

### Docs

- a vision for web, desktop, serve mode, spawn, and iPhone golem ([#147](https://github.com/MilanPavel/golem/pull/147))
- ADR-028, a browser reaches the daemon only through a strict gateway in the golem binary ([#188](https://github.com/MilanPavel/golem/pull/188))
- ADR-029, the web UI techstack ([#190](https://github.com/MilanPavel/golem/pull/190))
- the web UI design, its tokens checked for contrast, and the approved prototype ([#192](https://github.com/MilanPavel/golem/pull/192))
- ADR-034, the docs are a VitePress site over docs/ on GitHub Pages ([#302](https://github.com/MilanPavel/golem/pull/302))
- a map of the docs and a template for the How agents work pages ([#303](https://github.com/MilanPavel/golem/pull/303))
- a VitePress site over docs/, with a side menu, search, and Mermaid ([#312](https://github.com/MilanPavel/golem/pull/312))
- the docs site uses golem's palette and type, and draws Mermaid in it ([#318](https://github.com/MilanPavel/golem/pull/318))
- the pixel golem is the docs site's logo, favicon, and 404 page ([#321](https://github.com/MilanPavel/golem/pull/321))
- **install:** brew install, then golem, is all a new user types ([#322](https://github.com/MilanPavel/golem/pull/322))
- the docs site's home page, with the pixel golem, the legend, and why golem ([#323](https://github.com/MilanPavel/golem/pull/323))
- approval, output, and concept blocks for docs pages, in the web UI's style ([#325](https://github.com/MilanPavel/golem/pull/325))
- introduction and first chat pages, the start of the user guide on the docs site ([#328](https://github.com/MilanPavel/golem/pull/328))
- models and commands pages on the docs site, with every shell and chat command ([#337](https://github.com/MilanPavel/golem/pull/337))

## [0.4.0] - 2026-10-29

### Features

- **tui:** the composer has a ❯ prompt between two thin rules, and a placeholder ([#132](https://github.com/MilanPavel/golem/pull/132))
- **tui:** short hints such as copied or Ctrl-C again to exit show on the right and go away ([#133](https://github.com/MilanPavel/golem/pull/133))
- **tui:** copies say how many characters, and over SSH they ask the terminal to copy ([#138](https://github.com/MilanPavel/golem/pull/138))
- **tui:** drag over the chat to select text, and it is copied when you let go ([#142](https://github.com/MilanPavel/golem/pull/142))
- **tui:** a long paste shows as [Pasted text #N +M lines] in the input, and sends in full ([#143](https://github.com/MilanPavel/golem/pull/143))
- **tui:** Up and Down move between the rows of a multiline draft ([#144](https://github.com/MilanPavel/golem/pull/144))

### Fixes

- **tui:** the install question goes away once Ollama answers, and stays out of the model picker ([#129](https://github.com/MilanPavel/golem/pull/129))

## [0.3.0] - 2026-10-28

### Features

- **install:** scripts/setup.sh, just setup, and a /setup skill for a fresh checkout ([#19](https://github.com/MilanPavel/golem/pull/19))
- **ci:** a /ship skill that opens a pull request, and skills in .agents/skills for any agent ([#20](https://github.com/MilanPavel/golem/pull/20))
- **skills:** find, list, and check skills, and reload them without a restart ([#55](https://github.com/MilanPavel/golem/pull/55))
- **protocol:** run.failed says which model server did not answer, and how to fix it ([#67](https://github.com/MilanPavel/golem/pull/67))
- **models:** a model server that does not answer says how to start it ([#68](https://github.com/MilanPavel/golem/pull/68))
- **tui:** the banner and the status line say which model server is down ([#70](https://github.com/MilanPavel/golem/pull/70))
- **models:** golem can start and stop a local ollama serve ([#76](https://github.com/MilanPavel/golem/pull/76))
- **models:** golem starts a local Ollama when a model call, a download, or /model needs it ([#77](https://github.com/MilanPavel/golem/pull/77))
- **protocol:** golem status and model.server.status show who runs the local model server ([#78](https://github.com/MilanPavel/golem/pull/78))
- **tui:** the meter says starting ollama while golem starts it ([#79](https://github.com/MilanPavel/golem/pull/79))
- **daemon:** golem doctor no longer asks you to start Ollama, since golem starts it ([#111](https://github.com/MilanPavel/golem/pull/111))
- **protocol:** golem says when Ollama is not installed, not only that it is down ([#117](https://github.com/MilanPavel/golem/pull/117))
- **tui:** the TUI can run brew install ollama and show its output in a band ([#118](https://github.com/MilanPavel/golem/pull/118))
- **tui:** choosing a local model without Ollama offers to install it, then downloads the model ([#119](https://github.com/MilanPavel/golem/pull/119))
- **tui:** a message that fails because Ollama is missing offers to install it and send again ([#120](https://github.com/MilanPavel/golem/pull/120))
- **daemon:** golem doctor and the install guide point to /model to install Ollama ([#121](https://github.com/MilanPavel/golem/pull/121))
- **tui:** the terminal tab shows the session title and whether golem is working ([#125](https://github.com/MilanPavel/golem/pull/125))
- **tui:** terminals that show progress show it on the tab while a run works ([#126](https://github.com/MilanPavel/golem/pull/126))
- **tui:** iTerm2 tabs show a coloured dot and the state ([#127](https://github.com/MilanPavel/golem/pull/127))

## [0.2.0] - 2026-10-24

### Features

- **release:** when signing settings are missing, say which ones and where they belong
- **cli:** golem doctor checks the install and says how to fix each problem
- **mcp:** golem runs stdio MCP servers from config.toml
- **mcp:** servers per session or project, restarts, HTTP and Keychain tokens, and a /mcp manager
- **ci:** conventional commits, checked by a commit-msg hook
- **ci:** pull requests, a PR template, and a ruleset on main ([#1](https://github.com/MilanPavel/golem/pull/1))
- **release:** CHANGELOG.md and release notes from the commits, with … ([#2](https://github.com/MilanPavel/golem/pull/2))

### Fixes

- **mcp:** the launch test finds sh in /bin first, so it passes on Linux too

### Docs

- a step-by-step guide for installing golem with Homebrew, from setup to the first chat
- a shorter, friendlier front page: the pixel golem, the legend in an old typeface, and brew install first

## [0.1.0] - 2026-10-22

The first release: a daemon that keeps your chats running, and a chat screen in the terminal that attaches to it.

### Features

- **daemon:** one daemon per user on a Unix socket, kept running by launchd. Every session event is stored in golem.db, and a chat's context survives a restart.
- **tui:** a full-terminal chat with streamed answers. Several screens can follow one chat, and a reopened screen catches up on what it missed.
- **sessions:** named sessions, `/sessions`, `/new`, `/title`, `/fork`, closing a session, and filtering the list by typing.
- **tui:** stop an answer with Ctrl-C and keep what it wrote, edit and recall messages, copy an answer, export a chat, and a `/debug` panel.
- **models:** named profiles, Ollama and hosted providers, a `/model` picker that can switch mid-conversation, and downloading and removing Ollama models.
- **secrets:** API keys in the macOS Keychain, with `golem auth` and `/login`.
- **tools:** read, list, glob, and grep inside the session folder; `write_file` and `edit_file` with a diff to approve; a sandboxed shell; `web_fetch` with host rules.
- **tools:** a permission engine with allow, ask, and deny rules, approvals that wait across a restart, and big tool output kept as artifacts.
- **tui:** a todo band above the composer, and `/todos`.
- **install:** one signed `golem` command, safe upgrades that copy the databases first, `golem daemon install | restart | uninstall`, and `brew install` from a tap.
- **release:** a version tag builds, signs, and checks golem on a clean Mac, then publishes it.
