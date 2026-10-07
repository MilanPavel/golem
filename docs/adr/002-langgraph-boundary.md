# ADR-002: The graph library only runs graphs

**Date**: 2026-10-05
**Status**: accepted

## The idea

LangGraph runs an agent loop and a long flow: stop, resume, stream tokens, retry a step.

The rule is small. The library runs a graph. Our packages own everything around the graph. Imports stay in `golem/graphs/` and `golem/models/`.

```mermaid
flowchart TB
  subgraph daemon ["golem package"]
    paths["home directory"]
    settings["settings"]
    logs["logs"]
    subgraph runtime ["LangGraph"]
      loop["agent loop and flows"]
    end
  end
  proto["golem-protocol<br>message shapes"]
  proto --- daemon
```

A graph may call our functions. It does not become the place where message shapes, settings, or logs are defined. Those already have packages.

Graph state stays small. A big tool result belongs in our own store. The graph keeps an id and a short summary.

When graph code is added, two styles stay separate:

- **Agent.** The model picks the next step. One graph, with different settings per session.
- **Flow.** Our Python picks the next step. A step that costs money or changes the disk is saved, so a resume does not run it again.

A step that stops for a person runs again from its first line when it resumes. A side effect goes after that stop, or in its own step, so it does not happen twice.

## What the code does today

`packages/daemon` depends on LangGraph 1.2 and `langgraph-checkpoint-sqlite` 3.1. The checkpoint core package on that line is 4.x. The sqlite package has no 4.x release, so the pin is `>=3.1,<4`.

The chat graph is `START → call_model → END`. There are no tools. `AsyncSqliteSaver` is opened once in `DaemonApp.serve` and closed on shutdown. It writes `checkpoints.db`. The thread id is the session id. `golem/graphs/adapter.py` turns stream chunks into `message.delta` and `message.completed`. Provider clients are built in `golem/models/router.py`. `anthropic` and `openai` read `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`. `openai_compat` builds `ChatOpenAI` against `model_base_url`, or `http://127.0.0.1:11434/v1` when that field is empty, and sends the placeholder key `ollama`. Tests pass a fake chat model and do not call the network.

The split is already visible as packages. Message shapes are `golem_protocol`. The home directory, settings, and logs are `golem`. The TypeScript package imports generated types and does not import Python.

## Other shapes that lost

Making the whole program a graph means a message shape, a permission rule, and a budget become checkpoint fields. Swapping the library later means rewriting those.

Writing our own loop means rebuilding stop and resume.

Putting permission rules inside the graph ties a policy edit to old checkpoints. The same rules also have to cover work that did not start inside that graph.

## What it costs

The graph's thread id and our session id are the same string. Wiping `checkpoints.db` drops the model's memory and leaves the home directory's other files.

Each new piece of code has to sit on one side of the line: inside a graph, or in a golem package.
