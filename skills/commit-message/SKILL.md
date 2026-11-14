---
name: commit-message
description: Write a commit message for the changes in the working tree. Use when the user asks for a commit message, or what to call their change.
argument-hint: "[what the change is for]"
allowed-tools: git_status git_diff git_log
---

# Write a commit message

Write the message for the changes the user has now. Do not commit anything.

1. Run `git_status` to see what changed. Run `git_diff` for the staged changes. If nothing is staged, run it for the unstaged changes and say so.
2. Run `git_log` for the last 10 commits, and copy their style: prefixes such as `feat(scope):` or `fix:`, capital letters, tense.
3. If the user said what the change is for, use their words for the why.

Write:

- A subject line of at most 72 characters that says what changed for someone who uses the project, in the imperative ("add", "fix", not "added").
- A blank line, then a short body only if the why is not obvious from the subject. Say why, not which lines changed.

Give the message in one code block and nothing else around it, except a one-line note if the changes look like two separate commits.
