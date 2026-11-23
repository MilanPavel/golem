import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";

export interface FakeMcp {
  /** `http://127.0.0.1:<port>/mcp` */
  url: string;
  /** The `Authorization` header values that reached the server, in order. A request with none is `""`. */
  readonly seen: string[];
  stop(): Promise<void>;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let buf = "";
    req.on("data", (d: Buffer) => (buf += d.toString()));
    req.on("end", () => resolve(buf));
    req.on("error", () => resolve(buf));
  });
}

/**
 * A tool server over HTTP that answers only to `Bearer <token>`. Any other token gets a 401 with
 * `bad credentials`. With the token it speaks enough MCP for a test: initialize, tools/list, ping.
 */
export async function startFakeMcp(token: string): Promise<FakeMcp> {
  const seen: string[] = [];
  const sockets = new Set<Socket>();

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const raw = await readBody(req);
    const auth = req.headers["authorization"] ?? "";
    seen.push(Array.isArray(auth) ? auth.join(",") : auth);
    if (auth !== `Bearer ${token}`) {
      res.writeHead(401, { "content-type": "text/plain" });
      res.end("bad credentials");
      return;
    }
    let message: { id?: number | string; method?: string };
    try {
      message = JSON.parse(raw) as typeof message;
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    if (message.id === undefined) {
      // A notification has no answer.
      res.writeHead(202);
      res.end();
      return;
    }
    const result: Record<string, unknown> =
      message.method === "initialize"
        ? { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "fake-mcp", version: "1.0.0" } }
        : message.method === "tools/list"
          ? { tools: [{ name: "lookup", description: "Looks something up.", inputSchema: { type: "object", properties: {} } }] }
          : {};
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
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
    url: `http://127.0.0.1:${port}/mcp`,
    seen,
    stop: () =>
      new Promise<void>((done) => {
        for (const s of sockets) s.destroy();
        server.close(() => done());
      }),
  };
}
