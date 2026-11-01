# ADR-031: The system prompt is built for each model call, and never stored

**Date**: 2026-11-01
**Status**: accepted

## Context

Golem had no system prompt. `call_model` sent the checkpointed messages and nothing else. Step 2.3 pins a skill for a whole session, and 2.4 lists the skills the model may load. Both need text that the model reads before the chat, on every call, and that follows the skill when its file changes.

## Decision

- **Built per call.** `golem/graphs/prompt.py` holds a `SystemPrompt`: a list of sections. Each section reads the checkpoint values and the session folder, and returns its text or nothing. `call_model` builds the prompt and puts it in front of the history, for that one model call.
- **Never stored.** The node returns only the model's reply. The system message is not in its update, so it never reaches the checkpoint. A section that reads a file shows an edit on the next call, and compaction later (9.5) never has to keep it.
- **Empty means none.** With no section to say anything, there is no system message at all, and the model sees exactly what it saw before.
- **Seen in `/debug model`.** `session.inspect` builds the same prompt for the next call and returns it as the first message, with role `system`. `message_count` counts only the stored messages.

```mermaid
flowchart LR
  state[("checkpoint<br>messages, skill state")] --> build["SystemPrompt<br>sections"]
  build --> call["one model call:<br>system + history"]
  call -->|"reply only"| state
  build --> inspect["session.inspect<br>system row"]
```

2.3.1 adds the builder with no sections, so nothing changes for a user yet. 2.3.2 adds the first one: the bodies of the pinned skills.

## Alternatives Considered

### Store the system message as the first message in the checkpoint

- **Pros**: The history alone says what the model saw.
- **Cons**: An edited skill would need the stored message rewritten. Forks and compaction would have to treat it as special. The checkpoint grows with text that is already on disk.
- **Why not**: The text has a source of truth, the skill files, so it should be read from there.

### Pass it through the model's own system parameter

- **Pros**: Some providers have a separate field for it.
- **Cons**: Each provider class does it differently.
- **Why not**: LangChain already maps a `SystemMessage` at the front to each provider's field.

## Consequences

### Positive

- Pinned skills, the skill index, and later items such as the date or `AGENTS.md` are one section each.
- The checkpoint stays as small as before.

### Negative

- The history in the checkpoint is not, alone, what the model saw. `/debug model` shows both together.

### Risks

- A section that is slow, for example one that reads many files, slows every model call. Sections should read little, and cache by file hash if they read more.
