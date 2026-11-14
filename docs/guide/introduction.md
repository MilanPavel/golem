---
title: Introduction
description: What golem is, and why it exists.
---

# Introduction

Golem is an AI agent that lives on your Mac. You chat with it in your terminal or your browser, and it works in the folder you open it in: it reads and searches your files, edits them, runs commands, and looks things up on the web. It asks you first before it does anything that matters.

![Golem, wake up! On parchment under a crescent moon, the golem sleeps with its head bowed, and the shem, a small scroll, slides into the slot in its forehead. On a dark screen the shem glows in the same golem's forehead, its eyes light up, and a prompt types: $ golem tui, then hello](../images/intro-wake.svg)

## What golem is for

**Learning how a modern agent is built.** Golem builds every hard part itself, in the open, to find out what a reliable agent really needs: the agent loop, the protocol, sessions, permissions, sandboxes, context, skills. Each part is a chapter in [How golem works](../architecture.md): the idea in agents generally, then golem's version. Read it, then change it.

**Your own models, and your privacy.** Most agent tools assume a huge hosted model. Golem gets real work out of the model on your laptop, for free, and nothing leaves the machine. A hosted model (Anthropic, OpenAI, Google, and others) is a choice you make per task.

**Clever routing, when cost matters.** The cheapest model that can do a job should do it. Golem shows what every answer cost, and grows toward trying a small model first, stepping up only when it struggles, and keeping to a budget.

**Nothing is lost.** Every chat is written to disk as it happens. Close the terminal in the middle of an answer and the answer keeps going. A crash, a restart, or an upgrade picks up where it left off.

**Work that runs without you.** Next come workflows that run on a schedule and act exactly once, sub-agents that split a big task into small ones a local model can do, and approvals that reach you on your phone.

**The agent behind your application.** The same agent you shape in your terminal can be deployed behind an app, with its rules and tools, while the models stay outside it as endpoints you can swap.

Some of this is built, and some is the road ahead. [The vision](../vision.md) says where golem is going, and [the roadmap](../roadmap.md) links the steps.

## What you need

- A Mac with Apple Silicon (M1 or newer).
- [Homebrew](https://brew.sh).
- For a local model, a few GB of free disk and memory. For a hosted one, an API key.

## Next

[Install golem](../install.md). It takes about five minutes. Then [First chat](./first-chat.md) walks through your first question.
