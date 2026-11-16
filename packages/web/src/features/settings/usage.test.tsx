import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, expect, test } from "vitest";
import { App } from "../../app.tsx";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { fakeClient, fakeFrame } from "../../store/test-support.ts";
import { settingsContextStore } from "./index.ts";
import { EMPTY_USAGE, SAMPLE_USAGE } from "./usage-sample.ts";

function mount(result: typeof SAMPLE_USAGE | "fail") {
  history.replaceState(null, "", "/settings/usage");
  const fake = fakeClient();
  if (result === "fail") fake.raw.getCost.mockRejectedValue(new Error("no cost"));
  else fake.raw.getCost.mockResolvedValue(result);
  fake.raw.status.mockResolvedValue({ version: "0.5.0" });
  const page = createPage(fake.client, { frame: fakeFrame() });
  page.start();
  fake.setState({ status: "connected" });
  render(
    <PageProvider page={page}>
      <App />
    </PageProvider>,
  );
  return { fake, user: userEvent.setup() };
}

afterEach(() => {
  settingsContextStore.set(null);
  history.replaceState(null, "", "/");
});

test("Usage shows the tiles, seven bars and the model table from cost.get", async () => {
  const { fake } = mount(SAMPLE_USAGE);
  const today = await screen.findByRole("group", { name: "Today" });
  expect(today.textContent).toContain("$0.42");
  expect(screen.getByRole("group", { name: "This week" }).textContent).toContain("$2.10");
  const saved = screen.getByRole("group", { name: "Saved by running locally" });
  expect(saved.textContent).toContain("$3.40");
  expect(saved.textContent).toContain("against deepseek-chat prices");
  expect(within(screen.getByRole("list", { name: "Tokens per day" })).getAllByRole("listitem")).toHaveLength(7);
  const rows = within(screen.getByRole("table")).getAllByRole("row");
  expect(rows.map((row) => row.textContent)).toEqual([
    "ModelTierCallsTokens inTokens outCost",
    "claude-opusfrontier538.0K3.0K$1.91",
    "deepseek-chatbudget20240.0K20.0K$0.19",
    "qwen3:27blocal711.0M100.0K$0.00",
  ]);
  expect(fake.raw.getCost).toHaveBeenCalled();
  const results = await axe.run(screen.getByRole("table"), { rules: { "color-contrast": { enabled: false } } });
  expect(results.violations).toEqual([]);
});

test("with more than one job Usage adds a table by job", async () => {
  mount({
    ...SAMPLE_USAGE,
    by_role: [
      { role: "chat", calls: 80, input: 1_100_000, output: 100_000, cost_usd: 1.5 },
      { role: "explore", calls: 16, input: 300_000, output: 20_000, cost_usd: 0.6 },
    ],
  });
  const table = await screen.findByRole("table", { name: "By job, last 7 days" });
  expect(
    within(table)
      .getAllByRole("row")
      .map((row) => row.textContent),
  ).toEqual(["JobCallsTokens inTokens outCost", "chat801.1M100.0K$1.50", "helper16300.0K20.0K$0.60"]);
});

test("the bars' heights are proportional to the day's tokens", async () => {
  mount(SAMPLE_USAGE);
  const items = within(await screen.findByRole("list", { name: "Tokens per day" })).getAllByRole("listitem");
  const heights = (item: HTMLElement) => {
    const part = (kind: string) => Number.parseFloat((item.querySelector(`[data-bar="${kind}"]`) as HTMLElement).style.height);
    return { local: part("local"), paid: part("paid") };
  };
  // The 12th is the busiest day: 300K local and 40K paid fill the height.
  const busiest = heights(items[3] as HTMLElement);
  expect(busiest.local + busiest.paid).toBeCloseTo(100, 5);
  expect(busiest.local).toBeCloseTo((300 / 340) * 100, 5);
  expect(heights(items[4] as HTMLElement).local).toBeCloseTo((250 / 340) * 100, 5);
  expect(heights(items[2] as HTMLElement)).toEqual({ local: 0, paid: 0 });
});

test("with no reference the Saved tile is left out", async () => {
  mount({ ...SAMPLE_USAGE, saved_reference: null });
  await screen.findByRole("group", { name: "Today" });
  expect(screen.queryByRole("group", { name: "Saved by running locally" })).toBeNull();
});

test("with no calls Usage says so", async () => {
  mount(EMPTY_USAGE);
  expect(await screen.findByText("No model calls yet.")).toBeTruthy();
  expect(screen.queryByRole("table")).toBeNull();
});

test("a failed read shows the error and Retry reads again", async () => {
  const { fake, user } = mount("fail");
  expect((await screen.findByRole("alert")).textContent).toContain("no cost");
  fake.raw.getCost.mockResolvedValue(SAMPLE_USAGE);
  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByRole("group", { name: "Today" })).toBeTruthy();
});
