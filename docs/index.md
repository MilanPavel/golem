---
# The home page. The hero's golem is PixelGolem (theme/index.ts); the rest is in theme/Home*.vue.
layout: home
title: golem
titleTemplate: Your own AI agent, living on your Mac
hero:
  name: golem
  text: Your own AI agent, living on your Mac.
  tagline: Learn how an agent is built. Run it on your own models. Put it behind your apps.
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

Some of this is still the road ahead. [The vision](./vision.md) says where golem is going, and [the roadmap](./roadmap.md) links the steps.

## See it work

<HomeDemo />

## Get started

You need an Apple Silicon Mac and [Homebrew](https://brew.sh).

```bash
brew install milanpavel/golem/golem   # install
cd ~/my-project && golem              # open the chat in your project folder
golem web                             # or open the same chats in your browser
```

The first time, golem asks to start its background service. Press Enter, then pick a model: a local one downloads right there, and a hosted one asks for your API key. [Install golem on a Mac](./install.md) walks through every step, plus upgrading and removing.
