import { spawn } from "node:child_process";

/** Open an address in the default browser. It is best effort: the screen also shows the address. */
export function openUrl(url: string, platform: NodeJS.Platform = process.platform): void {
  const command = platform === "darwin" ? "open" : platform === "win32" ? null : "xdg-open";
  if (command === null || !/^https?:\/\//.test(url)) {
    return;
  }
  try {
    const child = spawn(command, [url], { stdio: "ignore", detached: true });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    // The screen still names the address.
  }
}
