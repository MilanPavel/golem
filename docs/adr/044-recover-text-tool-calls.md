# ADR-044: Recover tool calls a model writes as text

**Date**: 2026-11-10
**Status**: accepted

## Context

With `ollama/qwen3-coder:30b`, some replies hold a tool call written as markup in the text, with no real tool call:

```text
<function=todo_write>
<parameter=todos>
[{"id":"1","status":"in_progress","text":"Explore the project structure"}]
</parameter>
</function>
</tool_call>
```

The model left out its opening `<tool_call>` token. Ollama's parser for this model only starts reading a call at that token, so the whole reply comes back as `content` and `tool_calls` is empty. golem sees no tool calls and ends the turn. The markup is stored in the history, and the model copies it on the next turn.

Measured on 2026-11-10 (Ollama 0.40.14), with one session's first message and its 14 tool schemas sent straight to `/api/chat`: 3 of 8 streamed calls and 2 of 8 unstreamed calls leaked. A 32768 `num_ctx` leaked 5 of 10, a short system prompt 3 of 10, and one leaked reply already in the history 8 of 10. Only `temperature` 0.2 gave 0 of 10. So the cause is the model and the server's parser, not golem's window or streaming.

## Decision

After a model call, `call_model` turns text into tool calls when all of these hold: the reply has no tool calls, the session offers tools, the profile is still offered tools, and the text contains `<function=`. The parser is `golem.graphs.text_calls.recover`.

The rule is strict:

- A block is `<function=NAME>`, any number of `<parameter=KEY>VALUE</parameter>`, and `</function>`. The `<tool_call>` and `</tool_call>` tags around it are optional.
- NAME must be a tool golem offered in this call, and each KEY must be a property of that tool.
- A value is kept as text when its schema type is `string` or it has none. Any other value must be valid JSON.
- It is all or nothing. If any block fails, the reply stays exactly as it was. golem never recovers half of a reply.

On success the stored message is a normal assistant message with tool calls and the text before the markup, so the turn goes on and the history no longer teaches the model to leak. golem logs each recovery.

## Alternatives Considered

### Alternative 1: Lower the temperature

- **Pros**: It was the only variant that gave no leaks in the measurement.
- **Cons**: It changes how the model answers for every call.
- **Why not**: Phase 12 decided that a model's own defaults come first. The *precise* preset in `/tune` already sets 0.2, and people can choose it.

### Alternative 2: A default system prompt about the call format

- **Pros**: It needs no parser.
- **Cons**: It adds tokens to every call of every model, and the short system prompt still leaked 3 of 10.
- **Why not**: It does not fix the cause and costs context everywhere.

### Alternative 3: Wait for Ollama

- **Pros**: The parser is the right place to fix it.
- **Cons**: Nobody has asked for it, and people see broken chats today.
- **Why not**: golem can fix it now. An upstream report can still be made.

## Consequences

### Positive

- A turn no longer stops on a call written as text, and the broken text is not stored.
- No protocol change. The recovered calls show in the trace as normal calls.

### Negative

- golem knows one more model quirk, and the parser follows Qwen's format only.
- A value is kept as text when its property allows a string, or its schema names no type. Otherwise it is read as JSON. The types come from `type` (a name or a list) and from `anyOf`/`oneOf` branches, with `null` left out, so an optional integer such as `shell.timeout_seconds` is read as a number.

### Risks

- A model could write markup for an offered tool as an example, and golem would run it. The strict rule keeps this to well-formed calls of offered tools, and every call still goes through the permission check.
