# ADR-038: A command you approve may run outside the sandbox, as a tool of its own

**Date**: 2026-11-06
**Status**: accepted

## Context

The shell sandbox ([ADR-014](014-shell-sandbox.md)) keeps commands off the network, out of `~/.config/gh`, `~/.ssh`, and the Keychain, and removes `*_TOKEN` variables. That is right for tests and builds, but it stops `gh` and `git push`. Running `/ship` in golem (#35) failed with `open ~/.config/gh/config.yml: operation not permitted`. A Claude Code skill that calls `gh` in a shell line must work unchanged (use case A2).

Step 2.8.2 (#206) asked for a way that `gh` and `git push` reach GitHub with the user's credentials, after an approval, while other commands still cannot.

## Decision

- **A second tool, `shell_unsandboxed`.** It takes the same arguments as `shell` (`command`, `timeout_seconds`) and runs the command in the session folder with the user's login shell, but without `sandbox-exec`. It keeps the variables that hold credentials, so `gh`, `git push`, SSH keys, and the Keychain work, and so does the network. It does not need a sandbox, so it also runs where `shell` cannot.
- **The model is told when to use it.** Its description says: only for a command that needs credentials or the network, such as `gh` or `git push`, and `shell` for everything else. `shell`'s description points to it.
- **It always asks by default.** It is not read-only, so the default rules ask. The approval band shows `shell_unsandboxed <command>`, and its keys work as for any tool: once, for this session (that exact command), always (a rule for that exact command), or deny.
- **Only a rule that names it allows it.** An `allow` rule with `tool = "*"` or `tool = "shell*"` does not cover `shell_unsandboxed` (`NAMED_ONLY` in `permissions/engine.py`). `deny` and `ask` rules match it as usual, so `tool = "*"`, `action = "deny"` still stops it. A project's `allow` rules count only in a trusted project, as for every tool ([ADR-012](012-permission-rules.md)).
- **`[shell]` still applies to `shell`.** `network = false` keeps plain commands offline. `timeout_seconds` caps both tools.

## Alternatives Considered

### A flag on `shell`, such as `sandbox: false`

- **Pros**: One tool, as some other agents do it.
- **Cons**: A rule or a session allowance for `shell` is keyed on the command. An allowance given for a sandboxed `git push` would let the same command out. Every check would have to keep the two apart.
- **Why not**: A tool name already separates rules, allowances, and the approval band, with no new code in any of them.

### `[shell]` names commands that may reach the network and `~/.config/gh`

- **Pros**: No extra approval for `gh`.
- **Cons**: The profile is built per command line, and one line can run several programs. A rule keyed on the first word lets `gh x; curl … | sh` through.
- **Why not**: It opens the box to whatever follows the trusted word.

### Small `gh` tools that run outside the sandbox

- **Pros**: Narrow. Each tool does one thing.
- **Cons**: A skill that runs `gh pr create` or `git push` in a shell line still fails. Each new `gh` subcommand needs a tool.
- **Why not**: It breaks A2, existing skills unchanged.

## Consequences

### Positive

- `gh auth status`, `gh pr create`, and `git push` work after one approval each, without `[shell] network = true`.
- `shell` is exactly as closed as before. A plain command still cannot read `~/.config/gh` or reach the network.

### Negative

- A long skill such as `/ship` asks for each unsandboxed command, unless the user allows it for the session or writes a rule. Approval rules for skill scripts come in 2.6.2.
- The model may pick `shell_unsandboxed` for a command that does not need it. The approval band shows the tool name, so the user can deny it.

### Risks

- An approved unsandboxed command can do anything the user can. The approval shows the whole command, and "for this session" and "always" cover only that exact command. A broad rule the user writes by hand, such as `match = "gh *"`, also allows `gh x; rm -rf ~`. The guide says so.
- The browser can approve it as it approves any call, and can add a rule through `policy.update` ([ADR-037](037-browser-manages-mcp-and-config.md)). That is the same power it has over every other tool.
