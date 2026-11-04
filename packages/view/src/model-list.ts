import type { ListedModel, ModelListResult } from "@golem/client";

// What the model picker shows, shared by the terminal and the browser.

/** A download in progress, from `model.pull.progress`. */
export type PullState = { progress: number | null; status: string };

export type PickerGroup = { title: string; models: ListedModel[] };

/** The listing with live download progress laid over it. */
export function withPulls(listing: ModelListResult | null, pulls: Readonly<Record<string, PullState>>): ModelListResult | null {
  if (listing === null) {
    return null;
  }
  const refs = Object.keys(pulls);
  if (refs.length === 0) {
    return listing;
  }
  const known = new Set(listing.models.map((model) => model.ref));
  const models = listing.models.map((model) => {
    const pull = pulls[model.ref];
    return pull === undefined ? model : { ...model, status: "pulling" as const, progress: pull.progress };
  });
  for (const ref of refs.filter((item) => !known.has(item))) {
    models.push({
      ref,
      label: ref.slice(ref.indexOf("/") + 1),
      provider: ref.slice(0, ref.indexOf("/")),
      source: "catalog",
      status: "pulling",
      progress: pulls[ref]?.progress ?? null,
      price: { input: 0, output: 0 },
    });
  }
  return { ...listing, models };
}

/** The name to send for a model: its first profile, else its ref. */
export function pickerName(model: ListedModel): string {
  return model.profiles?.[0] ?? model.ref;
}

/** Names `/model ` suggests: profiles first, then ready refs. */
export function modelNames(listing: ModelListResult | null): string[] {
  if (listing === null) {
    return [];
  }
  const profiles = listing.models.flatMap((model) => model.profiles ?? []);
  const refs = listing.models.filter((model) => model.status === "ready").map((model) => model.ref);
  return [...new Set([...profiles.sort(), ...refs])];
}

/** True when the listing says `provider` is a local server that is not installed. */
export function providerMissing(listing: ModelListResult | null, provider: string): boolean {
  return listing?.providers.some((item) => item.provider === provider && item.status === "not_installed") ?? false;
}

/** Groups in display order, filtered by `query` on ref, label, and profile names. */
export function pickerGroups(listing: ModelListResult, query: string): PickerGroup[] {
  const needle = query.toLowerCase();
  const matches = (model: ListedModel): boolean =>
    needle.length === 0 ||
    model.ref.toLowerCase().includes(needle) ||
    model.label.toLowerCase().includes(needle) ||
    (model.profiles ?? []).some((name) => name.toLowerCase().includes(needle));
  const shown = listing.models.filter(matches);
  const profiled = shown.filter((model) => (model.profiles ?? []).length > 0 || model.source === "profile");
  const rest = shown.filter((model) => !profiled.includes(model));
  const groups: PickerGroup[] = [
    { title: "Profiles", models: profiled },
    { title: "Installed", models: rest.filter((model) => model.source === "installed") },
    { title: "Download", models: rest.filter((model) => model.source === "catalog") },
  ];
  const providers = [...new Set(rest.filter((model) => model.source === "remote").map((model) => model.provider))];
  for (const provider of providers.sort()) {
    groups.push({ title: provider, models: rest.filter((model) => model.source === "remote" && model.provider === provider) });
  }
  return groups.filter((group) => group.models.length > 0);
}

/** Every selectable model, in display order. */
export function pickerModels(listing: ModelListResult | null, query: string): ListedModel[] {
  return listing === null ? [] : pickerGroups(listing, query).flatMap((group) => group.models);
}

export function contextLabel(ctx: number | null | undefined): string {
  if (ctx === null || ctx === undefined) {
    return "";
  }
  return ctx >= 1000 ? `${Math.round(ctx / 1000)}k` : String(ctx);
}

export function priceLabel(model: ListedModel): string {
  const price = model.price;
  if (price === null || price === undefined) {
    return "$?";
  }
  if (price.input === 0 && price.output === 0) {
    return "free";
  }
  return `$${trim(price.input)}/${trim(price.output)}`;
}

export function sizeLabel(model: ListedModel): string {
  if (model.size_gb === null || model.size_gb === undefined) {
    return "";
  }
  const fitText = model.fit === "too_big" ? " too big" : model.fit === "tight" ? " tight" : model.fit === "fits" ? " fits" : "";
  return `${model.size_gb} GB${fitText}`;
}

/** `missing` is a provider whose program is not on this Mac: its models install it first. */
export function statusLabel(model: ListedModel, missing: boolean): string {
  switch (model.status) {
    case "ready":
      return model.stale ? "cached" : "";
    case "needs_key":
      return "needs key";
    case "not_installed":
      return missing ? "install" : "download";
    case "pulling":
      return model.progress === null || model.progress === undefined
        ? "downloading"
        : `downloading ${Math.floor(model.progress * 100)}%`;
    case "server_down":
      return "down";
  }
}

function trim(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "");
}
