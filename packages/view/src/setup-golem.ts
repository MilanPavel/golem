import type { SetupStatusResult } from "@golem/client";

/**
 * The golem block of Settings → Setup: where golem is installed, where it keeps its files, and the
 * launchd jobs that run it, as key/value rows. The daemon sends the facts on `setup.status`.
 */

export type GolemFact = {
  label: string;
  /** What the row shows. A path has the user's home folder written as `~`. */
  value: string;
  /** The full text, for the tooltip of a value that is cut short. */
  title: string;
  /** The path to copy, whole. Null for a row that is not a path. */
  copy: string | null;
};

export type GolemBlock = {
  version: string;
  facts: GolemFact[];
};

const METHOD_WORDS: Record<NonNullable<SetupStatusResult["install"]>["method"], string> = {
  homebrew: "Homebrew",
  script: "Install script",
  dev: "Dev checkout",
};

/** A path with the user's home folder as `~`, for the folders a Mac and a Linux box use. */
export function tildePath(path: string): string {
  return path.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, "~");
}

function path(label: string, full: string): GolemFact {
  return { label, value: tildePath(full), title: full, copy: full };
}

/** The rows of the block, or null when the daemon sent none of the facts (an older daemon). */
export function golemBlock(status: Pick<SetupStatusResult, "install" | "paths" | "jobs">): GolemBlock | null {
  const { install, paths } = status;
  const jobs = status.jobs ?? [];
  if (!install && !paths && jobs.length === 0) return null;
  const facts: GolemFact[] = [];
  if (install) {
    const how = METHOD_WORDS[install.method];
    if (install.binary) {
      facts.push({ label: "Installed", value: `${how} · ${tildePath(install.binary)}`, title: `${how} · ${install.binary}`, copy: install.binary });
    } else {
      facts.push({ label: "Installed", value: `${how} · golem is not on the PATH`, title: how, copy: null });
    }
    facts.push(path("Daemon", install.daemon_binary));
  }
  if (paths) {
    facts.push(path("Data", paths.home), path("Config", paths.config), path("Logs", paths.logs), path("Socket", paths.socket));
  }
  for (const job of jobs) {
    const state = !job.loaded ? "not loaded" : job.pid == null ? "loaded, not running" : `pid ${job.pid}`;
    facts.push({ label: "Job", value: `${job.label} · ${state}`, title: `${tildePath(job.plist)}`, copy: null });
  }
  return { version: install?.version ?? "", facts };
}
