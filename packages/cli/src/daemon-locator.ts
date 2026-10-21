import path from "node:path";

/** How to start `python -m golem` (or the frozen daemon) for `golem daemon …`. */
export interface DaemonCommand {
  command: string;
  args: string[];
}

export class DaemonNotFoundError extends Error {
  readonly tried: readonly string[];

  constructor(tried: readonly string[]) {
    super(`golem daemon not found. Tried:\n${tried.map((item) => `  ${item}`).join("\n")}`);
    this.name = "DaemonNotFoundError";
    this.tried = tried;
  }
}

export function locateDaemon(input: {
  golemDaemon: string | undefined;
  execPath: string;
  startDir: string;
  exists: (candidate: string) => boolean;
  workspaceRoot: (start: string) => string | null;
}): DaemonCommand {
  const tried: string[] = [];
  const override = input.golemDaemon?.trim() ?? "";
  if (override.length > 0) {
    tried.push(`GOLEM_DAEMON=${override}`);
    if (!input.exists(override)) {
      throw new DaemonNotFoundError(tried);
    }
    return { command: override, args: [] };
  }

  const beside = path.resolve(
    path.dirname(input.execPath),
    "../libexec/golem-daemon/golem-daemon",
  );
  tried.push(beside);
  if (input.exists(beside)) {
    return { command: beside, args: [] };
  }

  const root = input.workspaceRoot(input.startDir);
  if (root !== null) {
    tried.push(`uv run --project ${root}`);
    return {
      command: "uv",
      args: ["run", "--project", root, "python", "-m", "golem"],
    };
  }

  tried.push("checkout (uv run)");
  throw new DaemonNotFoundError(tried);
}
