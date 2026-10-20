import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ChatMessage } from "./chat-state.ts";
import { visibleText } from "./sanitize.ts";

/** `$PAGER`, split on spaces, or `less` when it is unset. */
export function pagerCommand(env: NodeJS.ProcessEnv = process.env): string[] {
  const pager = env.PAGER?.trim() ?? "";
  const parts = pager.split(/\s+/).filter((part) => part.length > 0);
  return parts.length > 0 ? parts : ["less"];
}

/** The artifact of the newest tool call that has one, for `/artifact` without an id. */
export function newestArtifact(messages: readonly ChatMessage[]): string | null {
  for (const message of [...messages].reverse()) {
    for (const tool of [...(message.tools ?? [])].reverse()) {
      if (tool.artifactId !== undefined) {
        return tool.artifactId;
      }
    }
  }
  return null;
}

/** Shows `text` in the pager while the terminal is suspended. Returns the pager's exit code. */
export async function showInPager(
  text: string,
  suspend: (run: () => Promise<void>) => Promise<void>,
  run: (command: readonly string[], file: string) => Promise<number> = runPager,
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const dir = await mkdtemp(join(tmpdir(), "golem-artifact-"));
  const file = join(dir, "artifact.txt");
  try {
    await writeFile(file, visibleText(text), { encoding: "utf8", mode: 0o600 });
    let code = 1;
    await suspend(async () => {
      code = await run(pagerCommand(env), file);
    });
    return code;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function runPager(command: readonly string[], file: string): Promise<number> {
  const [bin, ...args] = command;
  if (bin === undefined) {
    return Promise.resolve(1);
  }
  return new Promise((resolve, reject) => {
    const child = spawn(bin, [...args, file], { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}
