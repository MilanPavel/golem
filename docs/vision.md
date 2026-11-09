# Vision

![Two ways to see ahead: on parchment the golem gazes into a glowing crystal ball, and across the torn page it wears a VR headset in a neon future](images/vision.svg)

Golem today is one daemon on your Mac, with a chat in your terminal and in your browser. This page says where golem goes from there, and why. It does not say when.

**A vision, not a plan.** Nothing here is built yet. The [roadmap](roadmap.md) links the issues that hold the work, step by step. When a part of this page becomes work, it moves there, and its choices get an ADR in [adr/](adr/README.md).

## What golem becomes

Your own agent, on hardware you choose. It does real work with small local models, and pays for a big hosted one only when that pays off. It learns from what it does. It keeps working when you walk away, splits big jobs into small ones, and asks you only when it matters, wherever you are. And the same agent you shaped on your laptop can be the agent behind your application.

Five ideas carry it:

| | Idea | In one line |
|---|---|---|
| 1 | [One daemon, many clients](vision/everywhere.md#one-daemon-many-clients) | Every client speaks one protocol to one daemon. Everything that faces a network lives in one gateway |
| 2 | [Golem everywhere you are](vision/everywhere.md#the-native-apps) | A native app family for the Mac and the iPhone, built once in SwiftUI |
| 3 | [Workflows](vision/workflows.md) | Work that runs on its own, survives a crash, waits for you, and acts once |
| 4 | [Sub-agents](vision/sub-agents.md) | Golem hands parts of a task to smaller agents, each with its own brief and model |
| 5 | [Serve mode](vision/serve-mode.md#serve-mode-the-agent-behind-your-app) | The agent deployed behind an app, with the models kept strictly outside |

They stand on [the core features](vision/core.md): skills, memory, local models, routing and cost, evals.

---
