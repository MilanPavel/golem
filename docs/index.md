---
# The home page. The hero's golem is PixelGolem (theme/index.ts); the rest is in theme/Home*.vue.
layout: home
title: golem
titleTemplate: Your own AI agent, living on your Mac
hero:
  name: golem
  text: Your own AI agent, living on your Mac.
  tagline: Local models first. Hosted ones when the task needs them. Your data stays home.
  actions:
    - theme: brand
      text: Get started
      link: /install
    - theme: alt
      text: GitHub
      link: https://github.com/MilanPavel/golem
---

<HomeLegend />

## Why golem

<HomeWhy />

Much of this is still the road ahead. [The plan](./plan.md) lists what comes next, step by step.

## See it work

<HomeDemo />

## Get started

You need an Apple Silicon Mac and [Homebrew](https://brew.sh).

```bash
brew install milanpavel/golem/golem   # install
golem daemon install                  # start golem's background service
cd ~/my-project && golem              # open the chat, and pick a model
```

[Install golem on a Mac](./install.md) walks through every step, plus upgrading and removing.
