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
  stop(): Promise<void>;
}

export interface FakeOllamaOptions {
  /** Names `/api/tags` lists from the start. */
  installed?: string[];
  /** What `/api/chat` answers. Default `The stub answers.` */
  answer?: string;
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

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/** A stub of the Ollama HTTP API (tags, show, pull, delete) on a free 127.0.0.1 port. */
export async function startFakeOllama(options: FakeOllamaOptions = {}): Promise<FakeOllama> {
  const installed = [...(options.installed ?? [])];
  const pulls: string[] = [];
  const requests: string[] = [];
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
      json(res, 200, { model_info: {}, capabilities: ["completion", "tools"] });
    } else if (url.pathname === "/api/pull") {
      const name = modelName(raw);
      pulls.push(name);
      await pull(res, name);
    } else if (url.pathname === "/api/chat") {
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      res.write(`${JSON.stringify({ model: modelName(raw), message: { role: "assistant", content: options.answer ?? "The stub answers." }, done: false })}\n`);
      res.end(`${JSON.stringify({ model: modelName(raw), message: { role: "assistant", content: "" }, done: true, done_reason: "stop", prompt_eval_count: 3, eval_count: 4 })}\n`);
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
