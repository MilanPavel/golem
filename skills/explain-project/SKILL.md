---
name: explain-project
description: Explain what the project in the current folder is and how it is laid out. Use when the user asks what this project is, how it is organised, or where to start reading.
argument-hint: "[folder or question]"
allowed-tools: read_file list_dir glob grep
---

# Explain this project

Give someone new to this folder a short, true picture of it. Read before you answer; do not guess from the folder name.

1. Look at the top level of the folder. Read the README and the file that names the project (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, or similar).
2. Find the entry points and the main folders. Open one or two files to see what the code really does.
3. If the user gave a folder or a question, focus on it instead of the whole project.

Answer in this shape, in plain words:

- **What it is**: one or two sentences.
- **How it is laid out**: the main folders, one line each.
- **How to run it**: the commands the README or scripts give. Say so if you could not find any.
- **Where to start reading**: two or three files, and why.

Keep it under 20 lines. Say what you did not check.
