/** The default port of `golem web`. It stays the same so the browser keeps its origin. */
export const DEFAULT_WEB_PORT = 7480;

export interface WebArgs {
  port: number;
  /** True when `--port` was given. */
  portGiven: boolean;
  open: boolean;
  json: boolean;
}

/** The options of `golem web`, or null for anything else, or an option given twice. */
export function parseWebArgs(args: string[]): WebArgs | null {
  let port: number | null = null;
  let noOpen = false;
  let json = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--no-open" && !noOpen) noOpen = true;
    else if (arg === "--json" && !json) json = true;
    else if (arg === "--port" && port === null) {
      const value = args[i + 1];
      if (value === undefined || !/^\d{1,5}$/.test(value) || Number(value) > 65535) return null;
      port = Number(value);
      i += 1;
    } else return null;
  }
  return { port: port ?? DEFAULT_WEB_PORT, portGiven: port !== null, open: !noOpen && !json, json };
}

/** The address that logs the browser in. The token sits in the fragment, which is never sent to a server. */
export function webLink(port: number, token: string): string {
  return `http://127.0.0.1:${port}/#t=${token}`;
}

/** True when the link has only characters that need no escaping in a script. */
export function isSafeLink(link: string): boolean {
  return /^[A-Za-z0-9:/._#=-]+$/.test(link);
}

/** True when a `/healthz` answer is from the gateway with this pid. */
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
}

/** The lines `golem web` prints on stdout. Only `--no-open` and a failed open show the token. */
export function formatWebOutput(o: WebOutput): string[] {
  if (o.json) return [JSON.stringify({ url: o.link, port: o.port, pid: o.pid })];
  const lines = [
    o.opened
      ? `golem web: http://127.0.0.1:${o.port} (opened in your browser)`
      : `golem web: ${o.link}`,
  ];
  if (o.started) lines.push("Press Ctrl-C to stop.");
  return lines;
}
