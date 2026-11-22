import { HOSTED_PROVIDERS, namesModel } from "@golem/view";
import type { AuthKeyStatus } from "../../../store/keys.ts";
import type { ListedModel, ModelListResult } from "../../../store/models.ts";

/** One provider of the list. The eight are fixed: Ollama, oMLX (later) and six hosted ones. */
export type ProviderEntry = {
  id: string;
  name: string;
  kind: "mac" | "later" | "hosted";
  /** The variable the key can be set in, for a hosted provider. */
  envVar: string | null;
  /** Where to get a key, without the scheme. */
  console: string | null;
};

export const OLLAMA: ProviderEntry = { id: "ollama", name: "Ollama", kind: "mac", envVar: null, console: null };
export const OMLX: ProviderEntry = { id: "omlx", name: "oMLX", kind: "later", envVar: null, console: null };

/** The hosted providers, in the order of the mock: OpenAI, Anthropic, DeepSeek, Google, Moonshot, xAI. */
const HOSTED_ORDER = ["openai", "anthropic", "deepseek", "google", "moonshot", "xai"];

export const HOSTED: readonly ProviderEntry[] = HOSTED_ORDER.flatMap((id) => {
  const found = HOSTED_PROVIDERS.find((provider) => provider.id === id);
  return found === undefined ? [] : [{ id, name: found.name, kind: "hosted" as const, envVar: found.env, console: found.console }];
});

export const PROVIDERS: readonly ProviderEntry[] = [OLLAMA, OMLX, ...HOSTED];

export function providerEntry(id: string): ProviderEntry | undefined {
  return PROVIDERS.find((provider) => provider.id === id);
}

/** Where a hosted provider's key is, from `auth.list`: the Keychain, the environment, or nowhere. */
export type KeyWhere = { source: "keychain" | "env" | null; envVar: string };

export function keyWhere(provider: ProviderEntry, keys: readonly AuthKeyStatus[]): KeyWhere {
  const status = keys.find((item) => item.provider === provider.id);
  const source = status?.source === "env" || status?.source === "keychain" ? status.source : null;
  return { source, envVar: status?.env_var ?? provider.envVar ?? "" };
}

export type ProviderGroups = { local: ProviderEntry[]; hosted: ProviderEntry[]; unset: ProviderEntry[] };

/** The list's three groups: on this Mac, hosted with a key, and hosted without one. */
export function groupProviders(keys: readonly AuthKeyStatus[]): ProviderGroups {
  const hosted = HOSTED.filter((provider) => keyWhere(provider, keys).source !== null);
  return { local: [OLLAMA, OMLX], hosted: [...hosted], unset: HOSTED.filter((provider) => !hosted.includes(provider)) };
}

/** An Ollama model is listed here once it is on this Mac or on its way. The rest of its catalog is in Get models. */
function onMac(model: ListedModel): boolean {
  return model.provider !== "ollama" || model.source === "installed" || model.status === "pulling";
}

/** The models of one provider, as its table lists them. */
export function modelsOf(models: readonly ListedModel[], provider: string): ListedModel[] {
  return models.filter((model) => model.provider === provider && onMac(model));
}

/** Every model of the providers that are set up: Ollama, and a hosted provider with a key. */
export function usableModels(listing: ModelListResult | null, keys: readonly AuthKeyStatus[]): ListedModel[] {
  const live = new Set([OLLAMA.id, ...HOSTED.filter((provider) => keyWhere(provider, keys).source !== null).map((provider) => provider.id)]);
  return (listing?.models ?? []).filter((model) => live.has(model.provider) && onMac(model));
}

export const isStarred = (model: ListedModel): boolean => model.starred === true;

export type OllamaState = "running" | "stopped" | "not_installed";

/** Ollama's state from `model.list`'s setup: `ollama.settings.get` only knows after golem has looked. */
export function ollamaState(listing: ModelListResult | null): OllamaState | null {
  if (listing === null) return null;
  if (!listing.setup.ollama_installed) return "not_installed";
  return listing.setup.ollama_running ? "running" : "stopped";
}

/** `$3 / $15` per million tokens in and out, `free` for a local model, `unknown` with no price. */
export function priceText(model: ListedModel): string {
  const price = model.price;
  if (price === null || price === undefined) return model.provider === "ollama" ? "free" : "unknown";
  if (price.input === 0 && price.output === 0) return "free";
  const num = (value: number): string => String(Number(value.toFixed(2)));
  return `$${num(price.input)} / $${num(price.output)}`;
}

/** The tools check: a tick when it passed, `no` when it failed, `not tested` before it ran. */
export function toolsText(model: ListedModel): { mark: string; text: string } {
  if (model.tools === true) return { mark: "✓", text: "Passed golem's tools check" };
  if (model.tools === false) return { mark: "no", text: "Failed golem's tools check" };
  return { mark: "not tested", text: "Not tested yet" };
}

export function speedText(model: ListedModel): string {
  const tps = model.speed?.reply_tps;
  return tps === null || tps === undefined ? "—" : `${Math.round(tps)} tok/s`;
}

/** The model a removed default would hand over to: the first ready one that is starred, else the first ready one. */
export function fallbackFor(listing: ModelListResult, removed: ListedModel): ListedModel | null {
  const ready = listing.models.filter((model) => model.status === "ready" && model.ref !== removed.ref);
  return ready.find(isStarred) ?? ready[0] ?? null;
}

/** What removing a model does to the default, said before it is removed. Empty when it is not the default. */
export function fallbackText(listing: ModelListResult, model: ListedModel): string {
  if (!namesModel(model, listing.default)) return "";
  const next = fallbackFor(listing, model);
  return next === null ? "It is the default for new chats, and no other model is ready." : `It is the default for new chats. They will start on ${next.label} instead.`;
}
