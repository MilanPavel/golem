import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import type { ModelListResult } from "../../../store/models.ts";
import type { PullsSnapshot } from "../../../store/pulls.ts";
import { GetModelsPage } from "./get-models-page.tsx";
import { GET_CASES, NO_ACTIONS, NO_PULLS } from "./models-sample.ts";

const FIRST = GET_CASES[0];
if (FIRST?.props.listing == null) throw new Error("The first case has a listing.");
const LISTING: ModelListResult = FIRST.props.listing;

function page(listing: ModelListResult, pulls: PullsSnapshot = NO_PULLS) {
  return <GetModelsPage listing={listing} pulls={pulls} onPull={() => Promise.resolve()} onStop={() => Promise.resolve()} hf={NO_ACTIONS.hf} onBack={() => undefined} />;
}

function rowOf(name: string): HTMLElement {
  const found = within(screen.getByRole("list", { name: "Models for this Mac" }))
    .getAllByRole("listitem")
    .find((item) => item.textContent?.includes(name));
  if (found === undefined) throw new Error(`No line for ${name}.`);
  return found;
}

test("a line goes from Download to progress to Installed without the page closing", () => {
  const ref = "ollama/gemma4:12b";
  const running: PullsSnapshot = {
    active: new Map([[ref, { track: { completed: 4e9, total: 8e9, samples: [] }, status: "pulling", progress: null }]]),
    failed: new Map(),
  };
  const { rerender } = render(page(LISTING));
  expect(within(rowOf("gemma4:12b")).getByRole("button", { name: "Download gemma4:12b" })).toBeTruthy();
  rerender(page(LISTING, running));
  expect(within(rowOf("gemma4:12b")).getByText("50%")).toBeTruthy();
  const installed = { ...LISTING, models: LISTING.models.map((model) => (model.ref === ref ? { ...model, source: "installed" as const, status: "ready" as const } : model)) };
  rerender(page(installed));
  expect(within(rowOf("gemma4:12b")).getByText("Installed")).toBeTruthy();
  // Installed, so the recommended card is gone.
  expect(screen.queryByRole("group", { name: "Recommended for this Mac" })).toBeNull();
});

test("a download that cannot start says why, and the page stays", async () => {
  const user = userEvent.setup();
  const onPull = vi.fn(() => Promise.reject(new Error("Ollama is not running.")));
  render(<GetModelsPage listing={LISTING} pulls={NO_PULLS} onPull={onPull} onStop={() => Promise.resolve()} hf={NO_ACTIONS.hf} onBack={() => undefined} />);
  await user.click(screen.getByRole("button", { name: "Download gpt-oss:120b" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Ollama is not running.");
});
