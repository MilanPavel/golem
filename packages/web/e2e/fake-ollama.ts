import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";

export interface FakeOllama {
  /** `http://127.0.0.1:<port>/v1`, as a provider `base_url`. */
  baseUrl: string;
  port: number;
  /** Names `/api/tags` lists. A finished pull adds its name. */
  readonly installed: string[];
  /** Names `/api/pull` was asked for, in order. */
  readonly pulls: string[];
  /** Every `METHOD path` that reached the stub, in order. */
  readonly requests: string[];
  /** From now on a pull stops half way and waits for `releasePulls`. */
  holdPulls(): void;
  /** Lets the held pulls finish, and stops holding later ones. */
  releasePulls(): void;
  /** Queue a reply that is one tool call. Calls are answered in order; after that the plain answer is used. */
  toolCall(name: string, args: Record<string, unknown>): void;
  /** How many times a call loaded a model at a different `num_ctx` than the one it held. */
  readonly reloads: number;
  /** What each model is loaded at right now, by name. */
  readonly loaded: ReadonlyMap<string, { contextLength: number }>;
  stop(): Promise<void>;
}

export interface FakeOllamaOptions {
  /** Names `/api/tags` lists from the start. */
  installed?: string[];
  /** What `/api/chat` answers. Default `The stub answers.` */
  answer?: string;
  /** The window a call without `num_ctx` loads a model at. Default 32768. */
  defaultContext?: number;
  /** The largest window `/api/show` reports. Default 131072. */
  maxContext?: number;
  /** True makes `/api/ps` report half of each model in VRAM. */
  spill?: boolean;
}

type Line = Record<string, unknown>;

const FIRST_LINES: Line[] = [
  { status: "pulling manifest" },
  { status: "pulling aaa", digest: "sha256:aaa", total: 300, completed: 0 },
  { status: "pulling aaa", digest: "sha256:aaa", total: 300, completed: 300 },
  { status: "pulling bbb", digest: "sha256:bbb", total: 100, completed: 50 },
];
const LAST_LINES: Line[] = [
  { status: "pulling bbb", digest: "sha256:bbb", total: 100, completed: 100 },
  { status: "verifying sha256 digest" },
  { status: "writing manifest" },
  { status: "success" },
];

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let buf = "";
    req.on("data", (d: Buffer) => (buf += d.toString()));
    req.on("end", () => resolve(buf));
    req.on("error", () => resolve(buf));
  });
}

function modelName(raw: string): string {
  try {
    const body = JSON.parse(raw) as { model?: unknown; name?: unknown };
    const name = body.model ?? body.name;
    return typeof name === "string" ? name : "";
  } catch {
    return "";
  }
}

function parse(raw: string): Record<string, unknown> {
  try {
    const body: unknown = JSON.parse(raw);
    return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/** A stub of the Ollama HTTP API (tags, show, pull, delete) on a free 127.0.0.1 port. */
export async function startFakeOllama(options: FakeOllamaOptions = {}): Promise<FakeOllama> {
  const installed = [...(options.installed ?? [])];
  const pulls: string[] = [];
  const requests: string[] = [];
  const defaultContext = options.defaultContext ?? 32768;
  const maxContext = options.maxContext ?? 131072;
  const loaded = new Map<string, { contextLength: number }>();
  const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  let reloads = 0;
  const sockets = new Set<Socket>();
  let held = false;
  let waiting: Array<() => void> = [];

  async function pull(res: ServerResponse, name: string): Promise<void> {
    let closed = false;
    res.on("close", () => {
      closed = true;
    });
    res.writeHead(200, { "content-type": "application/x-ndjson" });
    for (const line of FIRST_LINES) res.write(`${JSON.stringify(line)}\n`);
    if (held) await new Promise<void>((resolve) => waiting.push(resolve));
    if (closed) return;
    for (const line of LAST_LINES) res.write(`${JSON.stringify(line)}\n`);
    if (!installed.includes(name)) installed.push(name);
    res.end();
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    requests.push(`${req.method ?? "GET"} ${url.pathname}`);
    const raw = await readBody(req);
    if (url.pathname === "/api/tags") {
      json(res, 200, { models: installed.map((name) => ({ name, model: name })) });
    } else if (url.pathname === "/api/show") {
      json(res, 200, { model_info: { "general.architecture": "fake", "fake.context_length": maxContext }, capabilities: ["completion", "tools"] });
    } else if (url.pathname === "/api/pull") {
      const name = modelName(raw);
      pulls.push(name);
      await pull(res, name);
    } else if (url.pathname === "/api/ps") {
      const size = 5_000_000_000;
      json(res, 200, {
        models: [...loaded].map(([name, { contextLength }]) => ({
          name,
          model: name,
          size,
          size_vram: options.spill === true ? size / 2 : size,
          context_length: contextLength,
          details: {},
        })),
      });
    } else if (url.pathname === "/api/chat") {
      const body = parse(raw);
      const name = modelName(raw);
      const asked = (body.options as { num_ctx?: unknown } | undefined)?.num_ctx;
      const contextLength = typeof asked === "number" && asked > 0 ? asked : defaultContext;
      const held = loaded.get(name);
      if (held !== undefined && held.contextLength !== contextLength) reloads += 1;
      loaded.set(name, { contextLength });
      const messages = Array.isArray(body.messages) ? (body.messages as Array<{ role?: unknown; content?: unknown }>) : [];
      const text = (m: { content?: unknown }): string => (typeof m.content === "string" ? m.content : "");
      const totalChars = messages.reduce((sum, m) => sum + text(m).length, 0) + (body.tools === undefined ? 0 : JSON.stringify(body.tools).length);
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      const cut = lastUser !== undefined && text(lastUser).includes("[[cut]]");
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      const tool = toolCalls.shift();
      const message =
        tool === undefined
          ? { role: "assistant", content: options.answer ?? "The stub answers." }
          : { role: "assistant", content: "", tool_calls: [{ function: { name: tool.name, arguments: tool.args } }] };
      res.write(`${JSON.stringify({ model: name, message, done: false })}\n`);
      res.end(
        `${JSON.stringify({ model: name, message: { role: "assistant", content: "" }, done: true, done_reason: cut ? "length" : "stop", prompt_eval_count: Math.min(Math.ceil(totalChars / 4), contextLength), eval_count: 4 })}\n`,
      );
      // keep_alive 0 unloads the model once the reply is out.
      if (body.keep_alive === 0) loaded.delete(name);
    } else if (url.pathname === "/api/delete") {
      const name = modelName(raw);
      const at = installed.indexOf(name);
      if (at >= 0) installed.splice(at, 1);
      json(res, 200, {});
    } else {
      json(res, 404, { error: "not found" });
    }
  }

  const server: Server = createServer((req, res) => {
    void handle(req, res);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    port,
    installed,
    pulls,
    requests,
    toolCall(name, args) {
      toolCalls.push({ name, args });
    },
    get reloads() {
      return reloads;
    },
    loaded,
    holdPulls() {
      held = true;
    },
    releasePulls() {
      held = false;
      const release = waiting;
      waiting = [];
      for (const resolve of release) resolve();
    },
    stop: () =>
      new Promise<void>((done) => {
        for (const s of sockets) s.destroy();
        server.close(() => done());
      }),
  };
}
