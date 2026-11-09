# Serve mode: the agent behind your app

![Your app calls a deployment that holds only the gateway, an owner queue, and the daemon with its agent file and router. Across a hard boundary are the models, as endpoints; a simple question goes to your GPU box for free, a hard one steps up to a hosted model](../images/vision-serve.svg)

Golem deployed on a server, as the agent behind an application. It has nothing to do with your Mac: no Keychain, no personal chats, no files of yours. The people who talk to it are the app's users.

### The boundary: the model is never inside

**A deployment of golem holds the agent, never the model.** The image has the gateway and the daemon, the app's agent files, and its workflows. It runs on a small CPU machine. Every model, open or hosted, is an **endpoint by URL**, configured as a provider like any other, and the router picks one per request.

- **Your own open model is just another endpoint.** Qwen on vLLM or SGLang, on a GPU box you run, is a URL, the same as Anthropic or OpenAI is a URL.
- **Each side scales on its own.** Add GPU for more tokens per second, add agent containers for more users, and neither waits for the other.
- **Swap a model without a deploy.** Point the router at a new endpoint, run the evals, done. The agent's code and its approvals do not move.
- **The same agent runs on your Mac.** `golem serve` on your laptop talks to the same kinds of endpoints. What you shaped in the terminal ships as it is.
- **The bill stays visible.** Every call crosses the boundary through the router, so every call has a cost, and every API key has a budget.

### What an app gets

- **Agents in the app's repository.** The same `agents/*.md` files as [sub-agents](./sub-agents.md#how-it-works), with the workflows and evals next to them. CI runs the evals, and a failing eval stops the deploy.
- **The app API:** start a run and follow its events over SSE, resuming after a dropped connection; or the OpenAI chat completions API, where `model` is an agent's name. Every app framework already speaks it.
- **A session per app user,** and memory kept apart per app user.
- **Rules with nobody watching.** In serve mode there is no one to ask, so `ask` becomes `deny`, or `owner`: the call waits in a queue, such as "issue a refund", for someone on the app's team to approve in the admin console.
- **Replay.** A bad production run can be replayed in your local terminal, step by step.

### Why golem here

Agent backends exist already. Golem's case is that the agent and workflows you shaped by hand ship unchanged, they run well on open models you host yourself, approvals survive a restart, and the line between agent and model keeps both cheap to change. The first version is small on purpose: one agent behind `/v1/chat/completions`, in one container, for your own apps.

---
