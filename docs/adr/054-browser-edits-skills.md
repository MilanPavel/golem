# ADR-054: The browser edits user skills, and project skills only in a trusted project; writing a skill never trusts it

**Date**: 2026-11-14
**Status**: accepted

## The idea

A skill is a text file that steers the model, and its `allowed-tools` and scripts can widen what a run may do. Step 2.9 ([#734](https://github.com/MilanPavel/golem/issues/734)) lets a person read, edit, create, and turn off a skill from the TUI, the CLI, and the browser, through one checked path in the daemon. [ADR-037](037-browser-manages-mcp-and-config.md) did the same for MCP servers: the browser may write, and the daemon refuses edits that widen trust. This record does it for skills.

The daemon cannot tell which client a line came from, and the gateway does not speak the protocol ([ADR-028](028-web-gateway.md)). So, as with `config.raw.set` and `config.raw.set_protected`, the rule is carried by two methods, not by a flag on the connection.

## Decision

### What the browser may call

| Method | Access | What it does |
|---|---|---|
| `skill.read` | browser | The text, `mtime_ns`, and source of any listed skill, in any project |
| `skill.write` | browser | A checked write of a `SKILL.md`. A project skill only when the project is in `trusted_projects` |
| `skill.create` | browser | A new skill folder with valid frontmatter. A project skill only in a trusted project |
| `skill.set_disabled` | browser | Add or remove a name in `[skills] disabled` of the user's `config.toml` |
| `skill.write_protected`, `skill.create_protected` | local | The same checks without the trusted-project rule. The TUI and the CLI use them |

- **User skills** (`~/.golem/skills` and the other user folders) are editable from the browser.
- **Project skills** are editable from the browser only when the session folder is in `trusted_projects`. An untrusted project gives the browser `skill.read` and nothing more. The TUI and the CLI can still write there, because the person at the terminal has the project open.
- **Every write** goes only to a `SKILL.md` directly inside a skill folder of a folder the registry lists for that `cwd`. Never a bundled skill, never a path outside, never through a symlink. A changed file is refused (`base_mtime_ns`, as in `config.raw.set`).
- **After a write** the daemon checks the registry at once, so `skill.registry.changed` goes out without waiting for the poll.

### Writing a skill never trusts it

Trust is a separate decision, made by a person, in a place a skill file cannot reach. A write, from any client, does not trust a skill, does not add its `allowed-tools` as pre-approvals, and does not change a project's trust.

Step 2.6 adds per-skill trust: a skill the person trusted may run its scripts and use `allowed-tools` without asking. That step must follow this rule, which is recorded here so it is not forgotten:

- **Editing a trusted skill's `allowed-tools`, or any script in its folder, drops its trust** until the person trusts it again.
- Trust is kept apart from the file, so an edit can never write it back.

Until 2.6 lands, no skill carries trust, so there is nothing to drop and the daemon has no trust code for skills. The rule binds 2.6, not this change.

### What a bad edit does

`skill.write` checks the text with the same parser as `golem skills check` and returns every error and warning with a line number when it has one. With `dry_run` it writes nothing. Without it, the text is saved even with errors, and the skill lists as broken; the caller chooses by passing `dry_run` first.

## Alternatives Considered

**The browser reads skills only.** It keeps the browser as small as ADR-028 first made it. It also leaves the web app unable to turn a skill off or fix a typo, which is what step 2.9 is for.

**The browser writes every skill.** A script in the page could then change a project's skill, in a project the person never trusted, to steer the model. Limiting it to trusted projects costs the browser nothing it needs.

**A flag on the connection that says "browser".** The daemon could then apply the rule inside one method. It needs the gateway to speak the protocol, which ADR-028 rejects. Two extra methods and one rule that holds for every client are simpler to test.

**Refuse a text with errors.** A broken skill could never be saved half done. Claude Code saves what you type, and golem lists the skill as broken with the reason, which is the same experience as a hand edit.

## Consequences

### Positive

- Create, edit, and turn off a skill from the browser, with the same checks as the terminal.
- A script in the page cannot change a skill in a project the person did not trust.
- The rule for editing trusted skills is written before 2.6 needs it.

### Negative

- Two more methods in `METHOD_ACCESS`, and a client picks which one to call.
- A project that is not trusted is edited in the terminal. The web app must say so when it refuses.

### Risks

- A skill in a trusted project, or one of the user's, can still say anything to the model. That was true of a hand edit, and the browser has no new power over the machine ([ADR-028](028-web-gateway.md)).
- 2.6 must implement the trust-drop rule. A test there should fail when an edit leaves a trusted skill's `allowed-tools` changed and its trust intact.
