import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

/**
 * Copying text to the clipboard, for `/copy` and the selection.
 *
 * `pbcopy` comes first, because it says whether the copy worked. OSC 52 asks
 * the terminal to copy instead: it works over SSH, where `pbcopy` would fill
 * the other machine's clipboard, but the terminal never answers, and some
 * terminals ignore it. 8.1 adds Linux and Windows to {@link clipboardCommand}.
 */

export type ClipboardWay = "command" | "osc52";

/** A program that reads the text on stdin and puts it on the clipboard. */
export type ClipboardCommand = { command: string; args: string[] };

const PBCOPY = "/usr/bin/pbcopy";

/** The clipboard program for this machine, or null when there is none. */
export function clipboardCommand(
  platform: NodeJS.Platform = process.platform,
  exists: (file: string) => boolean = existsSync,
): ClipboardCommand | null {
  if (platform === "darwin" && exists(PBCOPY)) {
    return { command: PBCOPY, args: [] };
  }
  return null;
}

/** True when golem runs over SSH, so this machine's clipboard is not the user's. */
export function overSsh(env: NodeJS.ProcessEnv): boolean {
  return (env.SSH_TTY ?? "") !== "" || (env.SSH_CONNECTION ?? "") !== "";
}

/** The OSC 52 sequence that asks the terminal to put `text` on the clipboard. */
export function osc52(text: string): string {
  return `\u001b]52;c;${Buffer.from(text, "utf8").toString("base64")}\u0007`;
}

/**
 * The hint after a copy. Over OSC 52 golem only asked the terminal, which may
 * not copy at all, so it says that instead of `copied`.
 */
export function copiedHint(way: ClipboardWay, text: string): string {
  const chars = [...text].length;
  const what = `${chars} ${chars === 1 ? "char" : "chars"}`;
  return way === "command" ? `copied ${what} to clipboard` : `asked the terminal to copy ${what}`;
}

export type Run = (command: ClipboardCommand, text: string) => Promise<void>;

export type ClipboardDeps = {
  env?: NodeJS.ProcessEnv;
  command?: ClipboardCommand | null;
  run?: Run;
  /** Where OSC 52 goes: the terminal. */
  write?: (data: string) => void;
};

/**
 * Put `text` on the clipboard and say how. A command that fails falls back to
 * OSC 52, which cannot fail here, since the terminal does not answer.
 */
export async function copyText(text: string, deps: ClipboardDeps = {}): Promise<ClipboardWay> {
  const env = deps.env ?? process.env;
  const command = deps.command === undefined ? clipboardCommand() : deps.command;
  const write = deps.write ?? ((data: string) => process.stdout.write(data));
  if (command !== null && !overSsh(env)) {
    try {
      await (deps.run ?? runCommand)(command, text);
      return "command";
    } catch {
      // The terminal may still copy it.
    }
  }
  write(osc52(text));
  return "osc52";
}

function runCommand(command: ClipboardCommand, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command.command, command.args, { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const detail = stderr.trim();
      reject(new Error(detail.length > 0 ? detail : `${command.command} exited with code ${code ?? "?"}`));
    });
    child.stdin?.end(text);
  });
}
