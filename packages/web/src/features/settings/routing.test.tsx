import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, expect, test } from "vitest";
import { App } from "../../app.tsx";
import type { RoutingGetResult, RoutingSetResult } from "../../store/routing.ts";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { fakeClient, fakeFrame } from "../../store/test-support.ts";
import { settingsContextStore } from "./index.ts";
import { DEFAULT_ROUTING, ROUTING_LISTING, SAMPLE_ROUTING } from "./routing-sample.ts";

const READY = "How a new chat picks its model";

function mount(values: RoutingGetResult | "fail" = DEFAULT_ROUTING, setup?: (fake: ReturnType<typeof fakeClient>) => void) {
  history.replaceState(null, "", "/settings/routing");
  const fake = fakeClient();
  if (values === "fail") fake.raw.getRouting.mockRejectedValue(new Error("no routing"));
  else fake.raw.getRouting.mockResolvedValue(values);
  fake.raw.listModels.mockResolvedValue(ROUTING_LISTING);
  fake.raw.status.mockResolvedValue({ version: "0.5.0" });
  setup?.(fake);
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
  document.documentElement.removeAttribute("data-theme");
  history.replaceState(null, "", "/");
});

const radio = (name: string | RegExp) => screen.getByRole("radio", { name }) as HTMLInputElement;
const box = (name: string) => screen.getByRole("textbox", { name }) as HTMLInputElement;
const summary = () => screen.getByRole("region", { name: "Right now" }).textContent ?? "";

test("every part shows the values the daemon sends", async () => {
  mount(SAMPLE_ROUTING);
  await screen.findByRole("heading", { name: READY });
  expect(radio(/^Auto/).checked).toBe(true);
  expect(radio(/^Ask every time/).checked).toBe(true);
  expect(radio("ask me").checked).toBe(true);
  expect(screen.getByRole("button", { name: "Local: Gemma 4 E4B" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Budget: Llama 3.3 70B" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Frontier: Claude Sonnet 4" })).toBeTruthy();
  expect(box("Per day").value).toBe("2");
  expect(box("Per chat").value).toBe("0.5");
  expect(screen.getByRole("button", { name: "Titles: Qwen3 8B" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Summaries: Automatic" })).toBeTruthy();
  const folders = within(screen.getByRole("list", { name: "Folders that never leave this Mac" })).getAllByRole("listitem");
  expect(folders.map((item) => item.textContent)).toEqual(["/Users/me/private×", "/Users/me/taxes×"]);
  expect(box("Budget tier price limit").value).toBe("2");
  expect(summary()).toContain("It stops paying at $2.00 a day or $0.50 a chat; then it asks you.");
});

test("with nothing set an empty step says what golem picks, and the limits are empty", async () => {
  mount();
  await screen.findByRole("heading", { name: READY });
  expect(radio(/^Pinned/).checked).toBe(true);
  expect(screen.getByRole("button", { name: "Local: Auto · qwen3:8b" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Budget: Auto · qwen/qwen3-235b" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /^Frontier:/ })).toBeNull();
  expect(screen.getByText("No model is ready for this step, so the path ends at Budget.")).toBeTruthy();
  expect(box("Per day").value).toBe("");
  expect(box("Per chat").value).toBe("");
  expect(screen.getByRole("button", { name: "Explorer: Automatic" })).toBeTruthy();
  expect(screen.getByText("No folders yet.")).toBeTruthy();
  expect(screen.getByText(/the steps are not used/)).toBeTruthy();
});

test("choosing a route, a paid rule or an over-limit rule saves it at once", async () => {
  const { fake, user } = mount();
  await screen.findByRole("heading", { name: READY });
  await user.click(radio(/^Local only/));
  await user.click(radio(/^Never pay/));
  await user.click(radio("ask me"));
  await waitFor(() => expect(fake.raw.setRouting).toHaveBeenCalledTimes(3));
  expect(fake.raw.setRouting.mock.calls.map((call) => call[0])).toEqual([
    { routing: { mode: "local" } },
    { routing: { paid: "never" } },
    { budget: { over: "ask" } },
  ]);
});

test("a route change rewrites the summary", async () => {
  const { fake, user } = mount(SAMPLE_ROUTING);
  await screen.findByRole("heading", { name: READY });
  expect(summary()).toContain("golem asks you every time");
  fake.raw.getRouting.mockResolvedValue({ ...SAMPLE_ROUTING, routing: { ...SAMPLE_ROUTING.routing, mode: "local" } });
  await user.click(radio(/^Local only/));
  await waitFor(() => expect(summary()).toContain("Nothing is sent to a hosted provider, and nothing costs money."));
  expect(screen.getByRole("button", { name: /^Paid gate: closed · local only/ })).toBeTruthy();
});

test("each step lists only models of its tier, and picking saves that line", async () => {
  const { fake, user } = mount();
  await screen.findByRole("heading", { name: READY });
  await user.click(screen.getByRole("button", { name: /^Local:/ }));
  let options = await screen.findAllByRole("option");
  expect(options.map((option) => option.textContent)).toEqual([
    expect.stringContaining("ollama/qwen3:8b"),
    expect.stringContaining("ollama/gemma4:e4b"),
  ]);
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: /^Budget:/ }));
  options = await screen.findAllByRole("option");
  expect(options.map((option) => option.textContent).join(" ")).toContain("Llama 3.3 70B");
  expect(options.map((option) => option.textContent).join(" ")).not.toContain("ollama/");
  await user.click(options.find((option) => option.textContent?.includes("Llama 3.3 70B")) as HTMLElement);
  await user.click(screen.getByRole("button", { name: "Use this model" }));
  await waitFor(() => expect(fake.raw.setRouting).toHaveBeenCalledWith({ ladder: { budget: "groq/llama-3.3-70b" } }));
});

test("the Auto choice clears a step and a job goes back to Automatic", async () => {
  const { fake, user } = mount(SAMPLE_ROUTING);
  await screen.findByRole("heading", { name: READY });
  await user.click(screen.getByRole("button", { name: /^Budget:/ }));
  await user.click(await screen.findByRole("button", { name: "Auto · qwen/qwen3-235b" }));
  await waitFor(() => expect(fake.raw.setRouting).toHaveBeenCalledWith({ ladder: { budget: null } }));
  await user.click(screen.getByRole("button", { name: /^Titles:/ }));
  await user.click(await screen.findByRole("button", { name: "Automatic" }));
  await waitFor(() => expect(fake.raw.setRouting).toHaveBeenCalledWith({ roles: { titles: "session" } }));
});

test("a limit saves as a number, and an empty box clears it", async () => {
  const { fake, user } = mount(SAMPLE_ROUTING);
  await screen.findByRole("heading", { name: READY });
  await user.clear(box("Per day"));
  await user.type(box("Per day"), "3.5");
  await user.tab();
  await waitFor(() => expect(fake.raw.setRouting).toHaveBeenCalledWith({ budget: { daily_usd: 3.5 } }));
  await user.clear(box("Per chat"));
  await user.tab();
  await waitFor(() => expect(fake.raw.setRouting).toHaveBeenCalledWith({ budget: { session_usd: null } }));
});

test("the day meter shows today's spend from cost.get", async () => {
  mount(SAMPLE_ROUTING, (fake) =>
    fake.raw.getCost.mockResolvedValue({
      today: { calls: 3, input: 1, output: 1, cost_usd: 0.5, saved_usd: 0 },
      week: { calls: 3, input: 1, output: 1, cost_usd: 0.5, saved_usd: 0 },
    }),
  );
  expect(await screen.findByText("$0.50 of $2.00 spent today")).toBeTruthy();
});

test("a word in a number box is refused where it is typed and nothing is saved", async () => {
  const { fake, user } = mount();
  await screen.findByRole("heading", { name: READY });
  await user.type(box("Per day"), "lots");
  await user.tab();
  expect((await screen.findByRole("alert")).textContent).toBe("Enter a number.");
  expect(box("Per day").getAttribute("aria-invalid")).toBe("true");
  expect(fake.raw.setRouting).not.toHaveBeenCalled();
});

test("a field error from the daemon shows at its setting", async () => {
  const { fake, user } = mount();
  await screen.findByRole("heading", { name: READY });
  const refused: RoutingSetResult = { ok: false, errors: [{ path: "budget.daily_usd", message: "Input should be greater than or equal to 0" }] };
  fake.raw.setRouting.mockResolvedValue(refused);
  await user.type(box("Per day"), "-1");
  await user.tab();
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe("Input should be greater than or equal to 0");
  expect(box("Per day").getAttribute("aria-describedby")).toContain(alert.id);
  expect(fake.raw.setRouting).toHaveBeenCalledWith({ budget: { daily_usd: -1 } });
});

test("a rejected save is shown, and the next good save clears the errors", async () => {
  const { fake, user } = mount();
  await screen.findByRole("heading", { name: READY });
  fake.raw.setRouting.mockRejectedValueOnce(new Error("the daemon is gone"));
  await user.click(radio(/^Local only/));
  expect((await screen.findByRole("alert")).textContent).toContain("the daemon is gone");
  fake.raw.setRouting.mockResolvedValue({ ok: true, errors: [] });
  await user.click(radio(/^Auto/));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
});

test("local-only folders can be removed, and added with the folder browser", async () => {
  const { fake, user } = mount(SAMPLE_ROUTING);
  await screen.findByRole("heading", { name: READY });
  await user.click(screen.getByRole("button", { name: "Remove /Users/me/private" }));
  await waitFor(() => expect(fake.raw.setRouting).toHaveBeenCalledWith({ routing: { local_only: ["/Users/me/taxes"] } }));
  await user.click(screen.getByRole("button", { name: /Add a folder/ }));
  await user.click(await screen.findByRole("button", { name: "Use this folder" }));
  await waitFor(() =>
    expect(fake.raw.setRouting).toHaveBeenCalledWith({ routing: { local_only: ["/Users/me/private", "/Users/me/taxes", "/home/me"] } }),
  );
});

test("the budget tier price limit saves as a number", async () => {
  const { fake, user } = mount();
  await screen.findByRole("heading", { name: READY });
  await user.click(screen.getByText("More"));
  await user.clear(box("Budget tier price limit"));
  await user.type(box("Budget tier price limit"), "3");
  await user.tab();
  await waitFor(() => expect(fake.raw.setRouting).toHaveBeenCalledWith({ routing: { budget_max_price: 3 } }));
});

test("a pressed situation shows its sentence, and a settings change replays it", async () => {
  const { fake, user } = mount(SAMPLE_ROUTING);
  await screen.findByRole("heading", { name: READY });
  expect(screen.getByText("Nothing picked yet.")).toBeTruthy();
  const button = screen.getByRole("button", { name: "Today's limit is spent" });
  await user.click(button);
  expect(button.getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByText(/The limit is reached, so golem asks before it pays more/)).toBeTruthy();
  fake.raw.getRouting.mockResolvedValue({ ...SAMPLE_ROUTING, budget: { ...SAMPLE_ROUTING.budget, over: "local" } });
  await user.click(radio("stay local"));
  await waitFor(() => expect(screen.getByText(/The limit is reached, so the turn stays on/)).toBeTruthy());
  await user.click(button);
  expect(screen.getByText("Nothing picked yet.")).toBeTruthy();
});

test("the empty Frontier step opens Settings › Models", async () => {
  const { user } = mount();
  await screen.findByRole("heading", { name: READY });
  await user.click(screen.getByRole("button", { name: "Add an API key" }));
  expect(location.pathname).toBe("/settings/models");
});

test("the Frontier step offers its ready models when none is chosen, not an API key", async () => {
  const listing = {
    ...ROUTING_LISTING,
    models: ROUTING_LISTING.models.map((model) => (model.tier === "frontier" ? { ...model, status: "ready" as const } : model)),
  };
  mount(DEFAULT_ROUTING, (fake) => fake.raw.listModels.mockResolvedValue(listing));
  await screen.findByRole("heading", { name: READY });
  await waitFor(() => expect(screen.getByRole("button", { name: "Frontier: Choose a model" })).toBeTruthy());
  expect(screen.getByText("No model is chosen for this step, so the path ends at Budget.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Add an API key" })).toBeNull();
});

test("Routing ends with a card that opens Settings › Context", async () => {
  const { user } = mount();
  await screen.findByRole("heading", { name: READY });
  const card = screen.getByRole("region", { name: "Context window and long chats" });
  expect(within(card).getByText("clear at 70%")).toBeTruthy();
  expect(within(card).getByText("summarise at 85%")).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Long chats on a local model" })).toBeNull();
  await user.click(within(card).getByRole("button", { name: "Settings › Context →" }));
  expect(location.pathname).toBe("/settings/context");
});

test("the gate on the path says what it does", async () => {
  mount(SAMPLE_ROUTING);
  await screen.findByRole("heading", { name: READY });
  expect(screen.getByRole("button", { name: /^Paid gate: asks every time/ })).toBeTruthy();
});

test("a failed read shows the error and Retry reads again", async () => {
  const { fake, user } = mount("fail");
  expect((await screen.findByRole("alert")).textContent).toContain("no routing");
  fake.raw.getRouting.mockResolvedValue(DEFAULT_ROUTING);
  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByRole("heading", { name: READY })).toBeTruthy();
});

for (const theme of ["slip", "kiln"] as const) {
  test(`the page passes axe in ${theme}`, async () => {
    document.documentElement.setAttribute("data-theme", theme);
    mount(SAMPLE_ROUTING);
    const heading = await screen.findByRole("heading", { name: READY });
    const page = heading.closest("section")?.parentElement as HTMLElement;
    const results = await axe.run(page, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
}
