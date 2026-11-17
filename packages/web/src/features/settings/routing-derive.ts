import { localSize, namesModel, shortModel, turnCost, type LocalWindow, type RoutingState } from "@golem/view";
import type { ListedModel, ModelListResult } from "../../store/models.ts";
import type { RoutingGetResult } from "../../store/routing.ts";

export type Tier = "local" | "budget" | "frontier";
export const TIERS: readonly Tier[] = ["local", "budget", "frontier"];

/** One step of the path: what the person chose, what golem picked, and the model that results. */
export type TierInfo = {
  tier: Tier;
  /** The model the person chose, or null when the step is left on Auto. */
  chosen: string | null;
  /** The model the step uses: the choice, else golem's pick. Null when nothing is ready. */
  ref: string | null;
  model: ListedModel | null;
  empty: boolean;
};

/** The models a setting may name: everything but the catalog of models to download. */
export function usableModels(listing: ModelListResult | null): ListedModel[] {
  return (listing?.models ?? []).filter((model) => model.source !== "catalog");
}

export function tierInfo(values: RoutingGetResult, listing: ModelListResult | null, tier: Tier): TierInfo {
  const chosen = values.ladder[tier] ?? null;
  const ref = chosen ?? values.picked[tier] ?? null;
  const model = ref === null ? null : (usableModels(listing).find((item) => namesModel(item, ref)) ?? null);
  return { tier, chosen, ref, model, empty: ref === null };
}

/** The kind of the window setting: a number is Fixed, `"ollama"` is Ollama's, anything else is Auto. */
export function windowKind(context: RoutingGetResult["context"]): "auto" | "fixed" | "ollama" {
  return typeof context.window === "number" ? "fixed" : context.window === "ollama" ? "ollama" : "auto";
}

/** The settings as the shared rules read them. */
export function routingState(values: RoutingGetResult, listing: ModelListResult | null, window: LocalWindow): RoutingState {
  const [local, budget, frontier] = TIERS.map((tier) => tierInfo(values, listing, tier));
  const name = (info: TierInfo | undefined) => (info?.ref == null ? null : shortModel(info.ref));
  const price = budget?.model?.price ?? null;
  return {
    mode: values.routing.mode,
    paid: values.routing.paid,
    over: values.budget.over,
    daily: values.budget.daily_usd ?? null,
    chat: values.budget.session_usd ?? null,
    local: name(local),
    budget: name(budget),
    frontier: name(frontier),
    budgetCost: price === null ? null : turnCost(price),
    window: window.tokens === null ? null : localSize(window.tokens, window.estimated),
  };
}
