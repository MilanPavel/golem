import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** `$EDITOR`, split on spaces, or `vi` when it is unset. */
export function editorCommand(env: NodeJS.ProcessEnv = process.env): string[] {
  const parts = (env["EDITOR"]?.trim() ?? "").split(/\s+/).filter((part) => part.length > 0);
  return parts.length > 0 ? parts : ["vi"];
}

function runEditor(command: readonly string[], file: string): Promise<number> {
  const [bin, ...args] = command;
  if (bin === undefined) return Promise.resolve(1);
  return new Promise((resolve, reject) => {
    const child = spawn(bin, [...args, file], { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

/** Writes `text` to a temporary file, runs the editor on it, and returns what was saved. Null when the editor failed. */
export async function editInEditor(
  text: string,
  fileName: string,
  run: (command: readonly string[], file: string) => Promise<number> = runEditor,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  const dir = await mkdtemp(join(tmpdir(), "golem-edit-"));
  const file = join(dir, fileName);
  try {
    await writeFile(file, text, "utf8");
    if ((await run(editorCommand(env), file)) !== 0) return null;
    return (await readFile(file, "utf8")).replace(/\r\n/g, "\n");
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** One key from `keys`, asked on the terminal. Without a terminal there is nobody to ask, so it is the last key (the safe one). */
export async function askKey(question: string, keys: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) return keys.slice(-1);
  process.stdout.write(question);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return await new Promise((resolve) => {
    const onData = (chunk: string): void => {
      const key = chunk.slice(0, 1).toLowerCase();
      if (chunk.length > 1 || !keys.includes(key)) return;
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write(`${key}\n`);
      resolve(key);
    };
    stdin.on("data", onData);
  });
}
