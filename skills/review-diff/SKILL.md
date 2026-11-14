---
name: review-diff
description: Review the changes in the working tree for bugs and risks before they are committed. Use when the user asks for a review of their diff, their changes, or their branch.
argument-hint: "[file or concern]"
allowed-tools: git_status git_diff read_file grep
---

# Review my diff

Review what changed, as a careful colleague would. Do not edit any file.

1. Run `git_status`, then `git_diff` for the staged changes. If nothing is staged, use the unstaged changes and say so.
2. For each changed file, read enough of the file around the change to understand it. If the user named a file or a concern, start there.
3. Look for: wrong results, missing checks for empty or missing input, errors that are swallowed, secrets or paths written into the code, and a change that needs a test or a doc update and has none.
4. Skip style and taste unless it hides a bug.

Report:

- **Problems**: each as `file:line`, what is wrong, and a one-line fix. Most serious first.
- **Questions**: things you could not tell from the diff.
- **Looks fine**: one line on what you checked and found sound.

If you find no problems, say so plainly. Never invent one to have something to say.
