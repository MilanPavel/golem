import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";

export interface Reply {
  text: string;
  /** When set, the reply is this tool call and `text` is ignored. */
  tool?: { name: string; args: Record<string, unknown> };
  /** Pause after each word-sized chunk. */
  delayMs?: number;
}

export interface FakeModel {
  /** `http://127.0.0.1:<port>/v1` */
  baseUrl: string;
  port: number;
  /** Queue the text of the next reply. Replies are used in order; after that the default is used. */
  reply(text: string, options?: { delayMs?: number }): void;
  /** Queue a reply that is one tool call. The arguments stream in two chunks. */
  toolCall(name: string, args: Record<string, unknown>, options?: { delayMs?: number }): void;
  /** The delay between chunks for replies that do not set their own. */
  delayMs: number;
  /** Request bodies, parsed, in the order they arrived. */
  readonly requests: unknown[];
  /** Replies that stopped early because the client went away. */
  readonly aborted: number;
  stop(): Promise<void>;
}

export const DEFAULT_REPLY = "Here is the fake answer.";

function chunk(delta: Record<string, unknown>, finish: "stop" | "tool_calls" | null): string {
  const body = {
    id: "fake-1",
    object: "chat.completion.chunk",
    model: "fake",
    choices: [{ index: 0, delta, finish_reason: finish }],
  };
  return `data: ${JSON.stringify(body)}\n\n`;
}

function words(text: string): string[] {
  return text.split(/(?<=\s)(?=\S)/);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let buf = "";
    req.on("data", (d: Buffer) => (buf += d.toString()));
    req.on("end", () => resolve(buf));
    req.on("error", () => resolve(buf));
  });
}

/** An OpenAI-compatible streaming endpoint on a free 127.0.0.1 port. */
export async function startFakeModel(): Promise<FakeModel> {
  const queue: Reply[] = [];
  const requests: unknown[] = [];
  const sockets = new Set<Socket>();
  const state = { delayMs: 0, aborted: 0 };
  let callCount = 0;

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const raw = await readBody(req);
    // The daemon lists models with a GET. That is not a chat, so it must not use up a queued reply.
    if (req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: [{ id: "fake", object: "model" }] }));
      return;
    }
    try {
      requests.push(JSON.parse(raw));
    } catch {
      requests.push(raw);
    }
    const next = queue.shift() ?? { text: DEFAULT_REPLY };
    const delay = next.delayMs ?? state.delayMs;
    let closed = false;
    res.on("close", () => {
      if (!res.writableFinished) {
        closed = true;
        state.aborted += 1;
      }
    });
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    if (next.tool !== undefined) {
      callCount += 1;
      const json = JSON.stringify(next.tool.args);
      const cut = Math.max(1, Math.floor(json.length / 2));
      const call = (fn: Record<string, string>): Record<string, unknown> => ({
        role: "assistant",
        tool_calls: [{ index: 0, ...(fn["name"] === undefined ? {} : { id: `call_${callCount}`, type: "function" }), function: fn }],
      });
      res.write(chunk(call({ name: next.tool.name, arguments: json.slice(0, cut) }), null));
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      if (closed) return;
      res.write(chunk(call({ arguments: json.slice(cut) }), null));
      res.write(chunk({}, "tool_calls"));
      res.end("data: [DONE]\n\n");
      return;
    }
    for (const piece of words(next.text)) {
      if (closed) return;
      res.write(chunk({ content: piece }, null));
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    }
    if (closed) return;
    res.write(chunk({}, "stop"));
    res.end("data: [DONE]\n\n");
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
    reply(text, options) {
      queue.push({ text, ...(options?.delayMs === undefined ? {} : { delayMs: options.delayMs }) });
    },
    toolCall(name, args, options) {
      queue.push({ text: "", tool: { name, args }, ...(options?.delayMs === undefined ? {} : { delayMs: options.delayMs }) });
    },
    get delayMs() {
      return state.delayMs;
    },
    set delayMs(value: number) {
      state.delayMs = value;
    },
    requests,
    get aborted() {
      return state.aborted;
    },
    stop: () =>
      new Promise<void>((done) => {
        for (const s of sockets) s.destroy();
        server.close(() => done());
      }),
  };
}
