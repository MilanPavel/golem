import type { ListedModel, ModelListResult } from "@golem/client";

/**
 * The first start, the same in the terminal and the browser. Whichever opens
 * first sets golem up for both, since they share one daemon and one ~/.golem.
 *
 * `service` waits for golem's service to answer. `choose` offers three ways to
 * think: on this Mac, with an API key, or later. `local` and `key` are those
 * paths in progress. `ready` goes to the chat.
 */
export type FirstRunOption = "local" | "key" | "later";

export type FirstRun =
  | { step: "service" }
  | { step: "choose"; option: FirstRunOption }
  | { step: "local" }
  | { step: "key" }
  | { step: "ready" };

export const FIRST_RUN_OPTIONS: readonly FirstRunOption[] = ["local", "key", "later"];

/** True when `name` is the ref or a profile of `model`. */
export function namesModel(model: ListedModel, name: string | null): boolean {
  return name !== null && (model.ref === name || (model.profiles ?? []).includes(name));
}

/**
 * What a first start does. `null` when the default resolves. With no default,
 * one ready model is used without asking; otherwise the user picks.
 */
export function firstRunChoice(listing: ModelListResult): { kind: "auto"; model: ListedModel } | { kind: "pick" } | null {
  if (listing.models.some((model) => namesModel(model, listing.default))) {
    return null;
  }
  const ready = listing.models.filter((model) => model.status === "ready");
  const only = ready[0];
  if (ready.length === 1 && only !== undefined) {
    return { kind: "auto", model: only };
  }
  return { kind: "pick" };
}

/**
 * Where a start begins. `null` while the model list is not in yet. A start
 * with nothing to pick, or one ready model to use, goes to `ready`; the UI
 * uses that model through {@link firstRunChoice}.
 */
export function startFirstRun(listing: ModelListResult | null, serviceUp: boolean): FirstRun | null {
  if (!serviceUp) {
    return { step: "service" };
  }
  if (listing === null) {
    return null;
  }
  return firstRunChoice(listing)?.kind === "pick" ? { step: "choose", option: suggestedOption(listing) } : { step: "ready" };
}

/** The option Enter takes first: an API key when one is stored, else this Mac. */
export function suggestedOption(listing: ModelListResult): FirstRunOption {
  return listing.setup.keys !== undefined && listing.setup.keys.length > 0 ? "key" : "local";
}

/** What the local path still has to do before a model can download. */
export function localNeeds(listing: ModelListResult): "install" | "start" | null {
  if (!listing.setup.ollama_installed) {
    return "install";
  }
  return listing.setup.ollama_running ? null : "start";
}

export type FirstRunKey = "up" | "down" | "enter" | "back";

/** One key on the first-run screen. Keys that do nothing on a step leave it as it is. */
export function pressFirstRun(state: FirstRun, key: FirstRunKey): FirstRun {
  switch (state.step) {
    case "choose": {
      if (key === "enter") {
        return state.option === "later" ? { step: "ready" } : { step: state.option };
      }
      if (key === "back") {
        return state;
      }
      const at = FIRST_RUN_OPTIONS.indexOf(state.option);
      const next = Math.min(Math.max(at + (key === "up" ? -1 : 1), 0), FIRST_RUN_OPTIONS.length - 1);
      return { step: "choose", option: FIRST_RUN_OPTIONS[next] ?? state.option };
    }
    case "local":
    case "key":
      return key === "back" ? { step: "choose", option: state.step } : state;
    case "service":
    case "ready":
      return state;
  }
}

/** The service answered: go on from where the model list says. */
export function serviceStarted(state: FirstRun, listing: ModelListResult | null): FirstRun | null {
  return state.step === "service" ? startFirstRun(listing, true) : state;
}

/** A model was chosen, downloaded, or unlocked by a key: the chat opens. */
export function modelChosen(state: FirstRun): FirstRun {
  return state.step === "service" ? state : { step: "ready" };
}
