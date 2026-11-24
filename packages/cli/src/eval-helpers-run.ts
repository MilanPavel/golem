import type { EvalUpdate, GolemClient } from "@golem/client";

import {
  costLine,
  formatAsks,
  formatList,
  formatMeasurement,
  formatPlan,
  formatProgress,
  memoryLine,
  refusals,
  riskLines,
  type HelpersArgs,
} from "./eval-helpers-format.ts";

/** What `golem eval helpers` needs from the service: a scripted client stands in for it in the tests. */
export type HelpersClient = Pick<
  GolemClient,
  | "evalsPlan"
  | "evalsStart"
  | "evalsStop"
  | "evalsResume"
  | "evalsList"
  | "evalsGet"
  | "evalsApply"
  | "evalsDelete"
  | "onEval"
>;

export interface HelpersDeps {
  now(): Date;
  write(line: string): void;
  error(line: string): void;
  /** Calls `handler` on Ctrl-C. The result takes the handler off again. */
  onInterrupt(handler: () => void): () => void;
}

const BASE = "golem eval helpers";

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** What the user sees after Ctrl-C: the run is not stopped. */
export function detachLines(id: string): string[] {
  return [
    `detached: measurement ${id} goes on in the golem service.`,
    `see it: ${BASE} show ${id}   stop it: ${BASE} stop ${id}`,
  ];
}

/**
 * Prints each progress line of measurement `id` until it ends, then the table and the proposal.
 * Ctrl-C detaches and leaves the run going. Returns the exit code.
 */
async function follow(
  client: HelpersClient,
  begin: () => Promise<string>,
  deps: HelpersDeps,
  started: (id: string) => string[],
): Promise<number> {
  const seen: EvalUpdate[] = [];
  let live: ((update: EvalUpdate) => void) | undefined;
  const off = client.onEval((update) => {
    if (live === undefined) seen.push(update);
    else live(update);
  });
  let interrupted: (() => void) | undefined;
  const detached = new Promise<"detached">((resolve) => {
    interrupted = () => resolve("detached");
  });
  const offInterrupt = deps.onInterrupt(() => interrupted?.());
  try {
    const id = await begin();
    for (const line of started(id)) deps.write(line);
    let last = -1;
    const ended = new Promise<"ended">((resolve) => {
      live = (update) => {
        if (update.kind === "progress" && update.progress.id === id) {
          const { index, state } = update.progress;
          // A run is announced once when it starts, and once when it ends.
          if (state !== "running" || index !== last) deps.write(formatProgress(update.progress));
          if (state === "running") last = index;
        } else if (update.kind === "ended" && update.ended.id === id) {
          resolve("ended");
        }
      };
      for (const update of seen) live(update);
    });
    const outcome = await Promise.race([ended, detached]);
    if (outcome === "detached") {
      for (const line of detachLines(id)) deps.write(line);
      return 0;
    }
    const { measurement } = await client.evalsGet(id);
    deps.write("");
    deps.write(formatMeasurement(measurement));
    return measurement.state === "done" ? 0 : 1;
  } finally {
    live = undefined;
    off();
    offInterrupt();
  }
}

async function runStart(
  client: HelpersClient,
  args: Extract<HelpersArgs, { kind: "start" }>,
  deps: HelpersDeps,
): Promise<number> {
  const models = Object.keys(args.models).length > 0 ? args.models : undefined;
  const plan = await client.evalsPlan(args.arms.length > 0 ? args.arms : undefined, models);
  if (args.arms.length === 0) {
    deps.write(formatPlan(plan.arms, plan.running));
    return 0;
  }
  const refused = refusals(plan.arms, args.arms, args.allowTight, args.ownRisk);
  if (refused.length > 0) {
    for (const line of refused) deps.error(line);
    deps.error("nothing was started.");
    return 1;
  }
  const chosen = plan.arms.filter((arm) => args.arms.includes(arm.name));
  for (const arm of chosen) {
    if (arm.kind === "local") deps.write(memoryLine(arm));
  }
  if (args.ownRisk) for (const line of riskLines(plan.arms, args.arms)) deps.write(line);
  const cost = costLine(plan.arms, args.arms);
  if (cost !== null) deps.write(cost);
  const [first, ...more] = args.arms;
  if (first === undefined) return 1;
  return follow(
    client,
    async () =>
      (
        await client.evalsStart({
          arms: [first, ...more],
          ...(models === undefined ? {} : { models }),
          allow_tight: args.allowTight,
          ...(args.ownRisk ? { own_risk: true } : {}),
        })
      ).id,
    deps,
    (id) => ["", `started in the golem service as measurement ${id}. Ctrl-C leaves it running.`, ""],
  );
}

async function runResume(
  client: HelpersClient,
  args: Extract<HelpersArgs, { kind: "resume" }>,
  deps: HelpersDeps,
): Promise<number> {
  try {
    return await follow(
      client,
      async () => (await (args.ownRisk ? client.evalsResume(args.id, args.allowTight, true) : client.evalsResume(args.id, args.allowTight))).id,
      deps,
      (id) => [`resumed measurement ${id} in the golem service. Ctrl-C leaves it running.`, ""],
    );
  } catch (error) {
    const text = message(error);
    const hint =
      /own risk|--own-risk/i.test(text) && !args.ownRisk
        ? " Save your work, then add --own-risk to run it anyway."
        : /tight/i.test(text) && !args.allowTight
          ? " Save your work in other apps, then add --allow-tight."
          : "";
    deps.error(`${text}${hint}`);
    return 1;
  }
}

async function runStop(client: HelpersClient, id: string | undefined, deps: HelpersDeps): Promise<number> {
  let target = id;
  if (target === undefined) {
    const running = (await client.evalsPlan()).running;
    if (running === null || running === undefined) {
      deps.error("no measurement is running");
      return 1;
    }
    target = running;
  }
  const { stopped } = await client.evalsStop(target);
  if (!stopped) {
    deps.error(`measurement ${target} is not running`);
    return 1;
  }
  deps.write(`stopped measurement ${target}. The runs done are kept: ${BASE} resume ${target} plays the rest.`);
  return 0;
}

async function runApply(client: HelpersClient, id: string, deps: HelpersDeps): Promise<number> {
  const result = await client.evalsApply(id);
  if (!result.ok) {
    for (const item of result.errors ?? []) deps.error(item.message);
    if ((result.errors ?? []).length === 0) deps.error("nothing was written");
    return 1;
  }
  const delegate = result.values?.delegate;
  if (delegate === null || delegate === undefined) {
    deps.write("written to [agents.delegate] in config.toml");
    return 0;
  }
  deps.write("written to [agents.delegate] in config.toml:");
  for (const key of ["read_share", "fill_share", "job_share", "price_ratio"] as const) {
    const item = delegate[key];
    deps.write(`  ${key.padEnd(11)} ${item.value}${item.is_default ? "  (the default)" : ""}`);
  }
  return 0;
}

/** `golem eval helpers …`: the plan, a measurement and its progress, and the ones kept on this Mac. Returns the exit code. */
export async function runHelpers(client: HelpersClient, args: HelpersArgs, deps: HelpersDeps): Promise<number> {
  try {
    switch (args.kind) {
      case "start":
        return await runStart(client, args, deps);
      case "list":
        deps.write(formatList((await client.evalsList()).measurements ?? [], deps.now()));
        return 0;
      case "asks":
        deps.write(formatAsks((await client.evalsPlan()).asks ?? []));
        return 0;
      case "show":
        deps.write(formatMeasurement((await client.evalsGet(args.id)).measurement, { ...(args.ask === undefined ? {} : { ask: args.ask }), verbose: args.verbose }));
        return 0;
      case "stop":
        return await runStop(client, args.id, deps);
      case "resume":
        return await runResume(client, args, deps);
      case "apply":
        return await runApply(client, args.id, deps);
      case "delete": {
        const { deleted } = await client.evalsDelete(args.id);
        if (!deleted) {
          deps.error(`measurement ${args.id} was not deleted`);
          return 1;
        }
        deps.write(`deleted measurement ${args.id}`);
        return 0;
      }
      case "error":
        return 1;
    }
  } catch (error) {
    deps.error(message(error));
    return 1;
  }
}
