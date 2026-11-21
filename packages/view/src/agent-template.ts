/**
 * The text a new agent starts from: a file the agent parser accepts as it is.
 * The file is named after the `name` line, so a new agent is `my-agent` until that line changes.
 */
export const AGENT_TEMPLATE = `---
name: my-agent
description: One line on what this helper does and when to use it.
model: cheapest
tools: read_file, list_dir, glob, grep
max-calls: 15
max-seconds: 300
max-answer-chars: 6000
asks: false
---
You are a helper. Answer the brief. Read only what you need. End with a short answer.
`;
