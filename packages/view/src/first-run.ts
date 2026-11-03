import type { ListedModel, ModelListResult } from "@golem/client";

/**
 * The models a first start offers. The setup window (setup-window.ts) uses
 * them, in the terminal and the browser.
 */

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
 * The local model to offer first: a downloaded one that is ready, else the
 * one the daemon recommends for this Mac's memory. An older daemon marks
 * none, so then it is the largest catalog model in a quarter of memory.
 */
export function recommendedLocal(listing: ModelListResult): ListedModel | null {
  const local = listing.models.filter((model) => model.provider === "ollama");
  const ready = local.find((model) => model.status === "ready");
  if (ready !== undefined) {
    return ready;
  }
  const marked = local.find((model) => model.recommended === true && model.status !== "pulling");
  if (marked !== undefined) {
    return marked;
  }
  const cap = (listing.ram_gb ?? 32) / 4;
  const fitting = local.filter(
    (model) =>
      model.source === "catalog" && model.status !== "pulling" && model.fit === "fits" && (model.size_gb ?? Infinity) <= cap,
  );
  return fitting.reduce<ListedModel | null>((best, model) => (best === null || (model.size_gb ?? 0) > (best.size_gb ?? 0) ? model : best), null);
}

/** Hosted providers to name on the card: those with a key first, then the rest that take one. */
export function hostedProviders(listing: ModelListResult): string[] {
  const keyed = new Set(listing.setup.keys ?? []);
  const hosted = listing.providers
    .filter((item) => item.provider !== "ollama" && (item.status === "needs_key" || keyed.has(item.provider)))
    .map((item) => item.provider);
  return [...hosted.filter((name) => keyed.has(name)), ...hosted.filter((name) => !keyed.has(name))];
}

/** What a send with no model chosen shows. The message stays in the composer for after the pick. */
export const NO_MODEL_NOTICE = "No model yet · pick one, then Enter sends your message";

/** True for the daemon's `model_not_configured` when no model was ever chosen. */
export function noModelChosen(code: number, message: string, notConfigured: number): boolean {
  return code === notConfigured && message === "no model chosen yet";
}
