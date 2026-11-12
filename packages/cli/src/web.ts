/** The default port of `golem web`. It stays the same so the browser keeps its origin. */
export const DEFAULT_WEB_PORT = 7480;

export interface WebArgs {
  port: number;
  /** True when `--port` was given. */
  portGiven: boolean;
  open: boolean;
  json: boolean;
  /** `golem web serve`: a gateway for a job. It opens nothing and prints no token. */
  serve: boolean;
}

/** The options of `golem web`, or null for anything else, or an option given twice. */
export function parseWebArgs(args: string[]): WebArgs | null {
  const serve = args[0] === "serve";
  if (serve) args = args.slice(1);
  let port: number | null = null;
  let noOpen = false;
  let json = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--no-open" && !serve && !noOpen) noOpen = true;
    else if (arg === "--json" && !serve && !json) json = true;
    else if (arg === "--port" && port === null) {
      const value = args[i + 1];
      if (value === undefined || !/^\d{1,5}$/.test(value) || Number(value) > 65535) return null;
      port = Number(value);
      i += 1;
    } else return null;
  }
  return { port: port ?? DEFAULT_WEB_PORT, portGiven: port !== null, open: !serve && !noOpen && !json, json, serve };
}

/** The address that logs the browser in. The token sits in the fragment, which is never sent to a server. */
export function webLink(port: number, token: string): string {
  return `http://127.0.0.1:${port}/#t=${token}`;
}

/** True when the link has only characters that need no escaping in a script. */
export function isSafeLink(link: string): boolean {
  return /^[A-Za-z0-9:/._#=-]+$/.test(link);
}

/** True when a `/healthz` answer is from the gateway with this pid. A gateway from before `version` answers without one. */
export function isLiveHealth(body: unknown, pid: number): boolean {
  if (typeof body !== "object" || body === null) return false;
  const answer = body as Record<string, unknown>;
  return answer["golem"] === "web" && answer["pid"] === pid;
}

export interface WebOutput {
  json: boolean;
  /** The browser was opened. */
  opened: boolean;
  link: string;
  port: number;
  pid: number;
  /** This process started the gateway and stays in the foreground. */
  started: boolean;
  /** `golem web serve`: one line, no link. */
  serve?: boolean;
}

/** The lines `golem web` prints on stdout. Only `--no-open` and a failed open show the token. */
export function formatWebOutput(o: WebOutput): string[] {
  if (o.serve === true) return [`golem web: serving http://127.0.0.1:${o.port}`];
  if (o.json) return [JSON.stringify({ url: o.link, port: o.port, pid: o.pid })];
  const lines = [
    o.opened
      ? `golem web: http://127.0.0.1:${o.port} (opened in your browser)`
      : `golem web: ${o.link}`,
  ];
  if (o.started) lines.push("Press Ctrl-C to stop.");
  return lines;
}
