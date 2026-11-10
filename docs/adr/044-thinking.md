# ADR-044: golem keeps a model's thinking, shows it as one line, and never sends it back

**Date**: 2026-11-10
**Status**: accepted

## Context

Some models think before they answer. Providers expose this differently: Ollama has `think`, Anthropic has adaptive thinking with an effort, OpenAI and the others have a reasoning effort. golem wants one `think` setting for every model that can think, and the thinking shown the same way whichever model sent it.

Today golem drops the thinking. langchain-ollama keeps `message.thinking` as `reasoning_content` only when its `reasoning` field is set, and then it also sends `think` to Ollama. golem leaves `reasoning` unset, so the field is thrown away.

What Ollama does was measured on 2026-11-10 with Ollama 0.40.14 and `qwen3.5:4b`, whose `/api/show` capabilities include `thinking`. The question was "What is 17*23?".

| # | Request | Reply |
|---|---|---|
| T1 | no `think` | `message.thinking` is full ("Thinking Process: …"), `content` is `391` |
| T2 | `think: true` | the same as T1 |
| T3 | `think: false` | `thinking` is empty, `content` is `391` |
| T4 | `think: "high"` | the same as T1 |

So a thinking model thinks by default, and golem already pays for it: the time, and the output tokens (`num_predict` counts them). Throwing the text away gives nothing back. No `<think>` tags showed up in `content`, though some older model templates still put them there.

## Decision

- **One think setting across providers.** The setting is a model setting, sent in the request. Later tickets of step 12.9 add it, one provider group at a time. This ADR gets a section from each of them.
- **First, keep what Ollama already returns, and send nothing new.** `OllamaChat` keeps `message.thinking` as `reasoning_content` whatever `reasoning` is, and the request to Ollama is unchanged: no `think`, no `reasoning`.
- **`<think>` in content.** When an answer's content starts with `<think>`, everything up to `</think>` is thinking. The daemon splits it while streaming, across chunks. If the stream ends inside `<think>`, it was all thinking. Content that has `<think>` later, not at the start, stays text.
- **The wire.** `message.thinking.delta` carries thinking fragments, apart from `message.delta`. `message.completed` has `thinking` (the whole text) and `thinking_ms` (from the first thinking fragment to the first answer fragment, or to the end when no answer came), both null when the model did not think. The daemon measures the time. `golem.db` drops the thinking deltas when the message completes, as it does `message.delta`.
- **Never send thinking back.** golem takes `reasoning_content` off every earlier reply when it builds a call's messages. The checkpoint keeps it, so a reloaded session still has it, but the model never sees it again. The one exception is an Anthropic tool loop, where the provider needs the thinking of the turn that is still going; step 12.9.3 adds it. This also keeps the cut rules of [ADR-043](043-ollama-context-window.md) and the trace true: a new user message does not change an earlier reply's size.
- **The collapsed line.** A reply that thought shows one dim line above the answer: `thinking…` while it streams, `thought for 12s` when done, `thought` when the time is not known. The terminal shows the text under it with Ctrl-O, like tool output. The web shows it when the line is clicked. Both clients draw the same text from `thinkingLine` in `packages/view`.
- **Show or hide is a display setting, `think` is a model setting.** Whether the line is shown at all belongs to each client, like `/time`: it changes what the screen draws, not what the model does. `think` changes the request, so it lives with the model's other settings. Step 12.9.5 adds the display toggle.

## Alternatives Considered

### Alternative 1: send `think: true` to get the thinking

- **Pros**: the library keeps the text with no override.
- **Cons**: measured (T1 and T2): Ollama already thinks without it, so it changes nothing for a thinking model. For a model without the capability, Ollama can refuse the request.
- **Why not**: it sends something new for no gain, and this change must not alter the request.

### Alternative 2: keep the thinking in the answer text

- **Pros**: no new event.
- **Cons**: the answer, its copy button, the title, the next prompt and every length count would all carry it.
- **Why not**: thinking is not part of the answer.

### Alternative 3: send earlier thinking back

- **Pros**: some providers say it helps.
- **Cons**: it fills the window with text the model wrote for itself, and the trace's cut rules would have to know about it.
- **Why not**: golem never did, and nothing measured says it should.

## Consequences

### Positive

- A thinking model's thinking is visible, with the time it took.
- The request to Ollama is the same as before.
- The prompt of a later call does not grow with earlier thinking.

### Negative

- The thinking is stored in the event log, so a long thought makes the database larger.
- A reply stopped by Cancel while it was still thinking keeps the thinking only in the clients that were attached.

### Risks

- A library update that renames how `OllamaChat` reaches `reasoning` can bring back the dropped thinking silently. A test sends a fake Ollama stream through `OllamaChat` to catch it.
