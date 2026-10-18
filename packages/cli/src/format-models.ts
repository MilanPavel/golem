import type { ListedModel, ModelListResult } from "../../protocol/gen/model-list-result.ts";

const STATUS: Record<ListedModel["status"], string> = {
  ready: "ready",
  needs_key: "needs key",
  not_installed: "download",
  server_down: "server down",
  pulling: "downloading",
};

/** One row per model, grouped by provider, then a line per provider that needs something. */
export function formatModels(listing: ModelListResult): string {
  const rows = listing.models.map((model) => [
    model.ref === listing.default || (model.profiles ?? []).includes(listing.default) ? "*" : " ",
    model.ref,
    (model.profiles ?? []).join(","),
    contextLabel(model.ctx),
    priceLabel(model),
    sizeLabel(model),
    STATUS[model.status] +
      (model.status === "pulling" && typeof model.progress === "number" ? ` ${Math.floor(model.progress * 100)}%` : "") +
      (model.stale ? " (cached)" : ""),
  ]);
  const widths = rows.reduce<number[]>(
    (max, row) => row.map((cell, index) => Math.max(max[index] ?? 0, cell.length)),
    [],
  );
  const lines = rows.map((row) =>
    row
      .map((cell, index) => (index === row.length - 1 ? cell : cell.padEnd(widths[index] ?? 0)))
      .join("  ")
      .trimEnd(),
  );
  const notes = listing.providers
    .filter((provider) => provider.status === "needs_key" || provider.status === "server_down")
    .map((provider) =>
      provider.status === "needs_key"
        ? `${provider.provider}: no key, golem auth set ${provider.provider} to list its models`
        : `${provider.provider}: not answering`,
    );
  const memory = listing.ram_gb === null || listing.ram_gb === undefined ? [] : [`memory: ${listing.ram_gb} GB`];
  return [...lines, ...(notes.length > 0 ? ["", ...notes] : []), ...memory].join("\n");
}

function contextLabel(ctx: number | null | undefined): string {
  if (ctx === null || ctx === undefined) {
    return "";
  }
  return ctx >= 1000 ? `${Math.round(ctx / 1000)}k` : String(ctx);
}

function priceLabel(model: ListedModel): string {
  const price = model.price;
  if (price === null || price === undefined) {
    return "$?";
  }
  if (price.input === 0 && price.output === 0) {
    return "free";
  }
  return `$${trimNumber(price.input)}/${trimNumber(price.output)}`;
}

function sizeLabel(model: ListedModel): string {
  if (model.size_gb === null || model.size_gb === undefined) {
    return "";
  }
  const fit = model.fit === "too_big" ? " too big" : model.fit === "tight" ? " tight" : "";
  return `${model.size_gb} GB${fit}`;
}

function trimNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "");
}
