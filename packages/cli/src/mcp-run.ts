import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";

import type { GolemClient } from "@golem/client";

import { editConfig, mcpRegion, WHOLE_FILE, type EditIo, type RawApi, type Region } from "./config-edit.ts";
import { askKey, editInEditor } from "./external-editor.ts";
import { allNew, formatScan, isImportSource, missingRefs, numbered, parsePicks } from "./import-cli.ts";
import { formatTestResult, formatTestStep } from "./mcp-format.ts";
import { readSecret } from "./read-secret.ts";

/** What these commands need from `main.ts`. */
export interface RunDeps {
  restartDaemon(): Promise<void>;
}

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

/** The test `golem mcp add` runs once the server is written. A failure is said, and the server stays. */
export async function testAfterAdd(client: GolemClient, name: string, sessionId?: string): Promise<void> {
  out(`testing ${name}…`);
  try {
    const result = await client.mcpTest({ name, ...(sessionId === undefined ? {} : { sessionId }) }, (progress) => {
      const line = formatTestStep(progress);
      if (line !== null) out(line);
    });
    out(formatTestResult(result));
    if (!result.ok) out(`${name} is added but does not work yet. Fix it with: golem mcp edit ${name}`);
  } catch (error) {
    process.stderr.write(`could not test ${name}: ${error instanceof Error ? error.message : String(error)}\n`);
  }
}

/** A session in the shell's folder, so the daemon can find that project's files. The caller closes it. */
export async function projectSession(client: GolemClient): Promise<string> {
  return (await client.createSession({ cwd: process.cwd() })).session_id;
}

function editIo(fileName: string, deps: RunDeps): EditIo {
  return {
    edit: (text) => editInEditor(text, fileName),
    key: askKey,
    write: out,
    restart: () => deps.restartDaemon(),
  };
}

async function edit(client: GolemClient, scope: "user" | "project", sessionId: string | undefined, region: Region, fileName: string, deps: RunDeps): Promise<number> {
  const session = sessionId === undefined ? {} : { sessionId };
  const api: RawApi = {
    get: () => client.configRawGet({ scope, ...session }),
    set: (text, base) => client.configRawSet({ text, baseMtimeNs: base, scope, ...session }, { local: true }),
  };
  return editConfig(api, region, editIo(fileName, deps));
}

/** `golem mcp edit <name>`: the server's tables in `$EDITOR`. The daemon checks the text and writes it, or says where it is wrong. */
export async function runMcpEdit(client: GolemClient, name: string, project: boolean, deps: RunDeps): Promise<number> {
  const sessionId = project ? await projectSession(client) : undefined;
  try {
    const detail = await client.mcpGet(name, sessionId);
    return await edit(client, detail.scope, sessionId, mcpRegion(name), `${name}.toml`, deps);
  } finally {
    if (sessionId !== undefined) await client.closeSession(sessionId).catch(() => undefined);
  }
}

/** `golem config edit [--project]`: the whole file in `$EDITOR`, with the same checks. */
export async function runConfigEdit(client: GolemClient, project: boolean, deps: RunDeps): Promise<number> {
  const sessionId = project ? await projectSession(client) : undefined;
  try {
    return await edit(client, project ? "project" : "user", sessionId, WHOLE_FILE, "config.toml", deps);
  } finally {
    if (sessionId !== undefined) await client.closeSession(sessionId).catch(() => undefined);
  }
}

async function askLine(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

/**
 * `golem mcp import`: find the servers other apps have (or read a file), say what each is, and add the ones picked.
 * A secret value never reaches this process: the daemon holds it. A value the other app did not have is asked for, hidden.
 */
export async function runMcpImport(client: GolemClient, from: string | null, all: boolean, project: boolean): Promise<number> {
  if (!all && !process.stdin.isTTY) {
    process.stderr.write("golem mcp import needs a terminal to pick from, or --all to add every new server\n");
    return 1;
  }
  const sessionId = project ? await projectSession(client) : undefined;
  try {
    const session = sessionId === undefined ? {} : { sessionId };
    let scan;
    if (from !== null && !isImportSource(from)) {
      let text: string;
      try {
        text = readFileSync(from, "utf8");
      } catch {
        process.stderr.write(`${from} is not an app (claude-desktop, claude-code, cursor, vscode, windsurf) or a file that can be read\n`);
        return 1;
      }
      scan = await client.scanMcpImport({ text, ...session });
    } else {
      scan = await client.scanMcpImport(session);
    }
    const sources = from !== null && isImportSource(from) ? scan.sources.filter((source) => source.id === from) : scan.sources;
    const items = numbered(sources);
    if (sources.length === 0) {
      out("no config files of other apps were found");
      return 0;
    }
    out(formatScan(sources));
    if (items.length === 0) {
      out("nothing to import");
      return 0;
    }
    let picks: { key: string; name: string; scope: "user" | "project" }[];
    if (all) {
      picks = allNew(items).map((item) => ({ key: item.candidate.key, name: item.candidate.name, scope: item.candidate.scope }));
    } else {
      const parsed = parsePicks(await askLine("\nImport which? Numbers, N=name to rename, a for every new one, Enter for none: "), items);
      if (!parsed.ok) {
        process.stderr.write(`${parsed.message}\n`);
        return 1;
      }
      picks = parsed.picks;
    }
    const [first, ...others] = picks;
    if (first === undefined) {
      out("nothing picked");
      return 0;
    }
    const secrets: Record<string, string> = {};
    if (process.stdin.isTTY) {
      for (const ref of missingRefs(items, picks.map((pick) => pick.key))) {
        const value = await readSecret(`value for ${ref} (Enter to set it later): `);
        if (value.length > 0) secrets[ref] = value;
      }
    }
    const applied = await client.applyMcpImport({ scan_id: scan.scan_id, picks: [first, ...others], secrets, ...(sessionId === undefined ? {} : { session_id: sessionId }) });
    for (const server of applied.added) out(`added ${server.name} · ${server.state}`);
    for (const failure of applied.failed ?? []) process.stderr.write(`not added ${failure.key}: ${failure.error}\n`);
    return (applied.failed ?? []).length > 0 ? 1 : 0;
  } finally {
    if (sessionId !== undefined) await client.closeSession(sessionId).catch(() => undefined);
  }
}
