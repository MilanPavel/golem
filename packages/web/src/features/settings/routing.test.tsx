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

function mount(values: RoutingGetResult | "fail" = DEFAULT_ROUTING) {
  history.replaceState(null, "", "/settings/routing");
  const fake = fakeClient();
  if (values === "fail") fake.raw.getRouting.mockRejectedValue(new Error("no routing"));
  else fake.raw.getRouting.mockResolvedValue(values);
  fake.raw.listModels.mockResolvedValue(ROUTING_LISTING);
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

const radio = (title: string) => {
  const found = screen.getAllByRole("radio").find((item) => item.closest("label")?.querySelector("span span")?.textContent === title);
  if (found === undefined) throw new Error(`no radio titled ${title}`);
  return found as HTMLInputElement;
};
const box = (name: string) => screen.getByRole("textbox", { name }) as HTMLInputElement;

test("every group shows the values the daemon sends", async () => {
  mount(SAMPLE_ROUTING);
  await screen.findByRole("heading", { name: "Default route" });
  expect(radio("Auto").checked).toBe(true);
  expect(radio("Always ask").checked).toBe(true);
  expect(radio("Ask me").checked).toBe(true);
  expect(screen.getByRole("button", { name: "Local: Gemma 4 E4B" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Budget: Llama 3.3 70B" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Frontier: Claude Sonnet 4" })).toBeTruthy();
  expect(box("Per day").value).toBe("2");
  expect(box("Per session").value).toBe("0.5");
  expect(screen.getByRole("button", { name: "Titles: Qwen3 8B" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Summaries: Same as the session" })).toBeTruthy();
  const folders = within(screen.getByRole("list", { name: "Local-only folders" })).getAllByRole("listitem");
  expect(folders.map((item) => item.textContent)).toEqual(["/Users/me/privateRemove", "/Users/me/taxesRemove"]);
  expect(screen.getByText("Chats in these folders never leave this Mac.")).toBeTruthy();
  expect(radio("A number").checked).toBe(true);
  expect(box("Window size").value).toBe("16384");
  expect(box("Budget tier price limit").value).toBe("2");
  expect(box("Reply reserve").value).toBe("2048");
  expect(box("Clear at").value).toBe("60");
  expect(box("Clear to").value).toBe("35");
  expect(box("Summarise at").value).toBe("80");
  expect(box("Turns kept").value).toBe("6");
});

test("with nothing set an empty ladder row says what golem picks, and the caps are empty", async () => {
  mount();
  await screen.findByRole("heading", { name: "Default route" });
  expect(radio("Pinned").checked).toBe(true);
  expect(screen.getByRole("button", { name: "Local: Picked for you: qwen3:8b" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Budget: Picked for you: qwen/qwen3-235b" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Frontier: Picked for you: nothing is ready" })).toBeTruthy();
  expect(box("Per day").value).toBe("");
  expect(box("Per session").value).toBe("");
  expect(screen.getByRole("button", { name: "Explorer: Same as the session" })).toBeTruthy();
  expect(screen.getByText("No folders yet.")).toBeTruthy();
  expect(radio("Auto (sized to memory)").checked).toBe(true);
});

test("choosing a route, a paid rule or an over-cap rule saves it at once", async () => {
  const { fake, user } = mount();
  await screen.findByRole("heading", { name: "Default route" });
  await user.click(radio("Local only"));
  await user.click(radio("Never"));
  await user.click(radio("Ask me"));
  await waitFor(() => expect(fake.raw.setRouting).toHaveBeenCalledTimes(3));
  expect(fake.raw.setRouting.mock.calls.map((call) => call[0])).toEqual([
    { routing: { mode: "local" } },
    { routing: { paid: "never" } },
    { budget: { over: "ask" } },
  ]);
});

test("each ladder picker lists only models of its tier, and picking saves that line", async () => {
  const { fake, user } = mount();
  await screen.findByRole("heading", { name: "Default route" });
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
  expect(options.map((option) => option.textContent).join(" ")).not.toContain("Claude");
  await user.click(options.find((option) => option.textContent?.includes("Llama 3.3 70B")) as HTMLElement);
  await user.click(screen.getByRole("button", { name: "Use this model" }));
  await waitFor(() => expect(fake.raw.setRouting).toHaveBeenCalledWith({ ladder: { budget: "groq/llama-3.3-70b" } }));
});

test("the empty choice clears a ladder line and a job goes back to the session", async () => {
  const { fake, user } = mount(SAMPLE_ROUTING);
  await screen.findByRole("heading", { name: "Default route" });
  await user.click(screen.getByRole("button", { name: /^Frontier:/ }));
  await user.click(await screen.findByRole("button", { name: "Picked for you: nothing is ready" }));
  await waitFor(() => expect(fake.raw.setRouting).toHaveBeenCalledWith({ ladder: { frontier: null } }));
  await user.click(screen.getByRole("button", { name: /^Titles:/ }));
  await user.click(await screen.findByRole("button", { name: "Same as the session" }));
  await waitFor(() => expect(fake.raw.setRouting).toHaveBeenCalledWith({ roles: { titles: "session" } }));
});

test("a cap saves as a number, and an empty box clears it", async () => {
  const { fake, user } = mount(SAMPLE_ROUTING);
  await screen.findByRole("heading", { name: "Default route" });
  await user.clear(box("Per day"));
  await user.type(box("Per day"), "3.5");
  await user.tab();
  await waitFor(() => expect(fake.raw.setRouting).toHaveBeenCalledWith({ budget: { daily_usd: 3.5 } }));
  await user.clear(box("Per session"));
  await user.tab();
  await waitFor(() => expect(fake.raw.setRouting).toHaveBeenCalledWith({ budget: { session_usd: null } }));
});

test("a word in a number box is refused where it is typed and nothing is saved", async () => {
  const { fake, user } = mount();
  await screen.findByRole("heading", { name: "Default route" });
  await user.type(box("Per day"), "lots");
  await user.tab();
  expect((await screen.findByRole("alert")).textContent).toBe("Enter a number.");
  expect(box("Per day").getAttribute("aria-invalid")).toBe("true");
  expect(fake.raw.setRouting).not.toHaveBeenCalled();
});

test("a field error from the daemon shows under its field", async () => {
  const { fake, user } = mount();
  await screen.findByRole("heading", { name: "Default route" });
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
  await screen.findByRole("heading", { name: "Default route" });
  fake.raw.setRouting.mockRejectedValueOnce(new Error("the daemon is gone"));
  await user.click(radio("Local only"));
  expect((await screen.findByRole("alert")).textContent).toContain("the daemon is gone");
  fake.raw.setRouting.mockResolvedValue({ ok: true, errors: [] });
  await user.click(radio("Auto"));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
});

test("local-only folders can be removed, and added with the folder browser", async () => {
  const { fake, user } = mount(SAMPLE_ROUTING);
  await screen.findByRole("heading", { name: "Default route" });
  await user.click(screen.getByRole("button", { name: "Remove /Users/me/private" }));
  await waitFor(() => expect(fake.raw.setRouting).toHaveBeenCalledWith({ routing: { local_only: ["/Users/me/taxes"] } }));
  await user.click(screen.getByRole("button", { name: "Add a folder" }));
  await user.click(await screen.findByRole("button", { name: "Use this folder" }));
  await waitFor(() =>
    expect(fake.raw.setRouting).toHaveBeenCalledWith({ routing: { local_only: ["/Users/me/private", "/Users/me/taxes", "/home/me"] } }),
  );
});

test("the window caption says what Auto gives for the default local model", async () => {
  const { fake } = mount();
  fake.raw.getModelOptions.mockResolvedValue({
    model: "qwen3:8b",
    options: [],
    defaults: { num_ctx: 32768 },
    default_from: { num_ctx: "golem" },
    saved: {},
    session: {},
    memory: { ram_gb: 36, size_gb: 5, kv_gb_per_1k_tokens: 0.1, overhead_gb: 1, fits_share: 0.7, tight_share: 0.85 },
  });
  expect(await screen.findByText("Auto picks 32K for qwen3:8b on this Mac (36 GB).")).toBeTruthy();
});

test("the window can be Ollama's default or a number", async () => {
  const { fake, user } = mount();
  await screen.findByRole("heading", { name: "Default route" });
  await user.click(radio("Ollama's default"));
  await waitFor(() => expect(fake.raw.setRouting).toHaveBeenCalledWith({ context: { window: "ollama" } }));
  await user.click(radio("A number"));
  await user.type(box("Window size"), "8192");
  await user.tab();
  await waitFor(() => expect(fake.raw.setRouting).toHaveBeenCalledWith({ context: { window: 8192 } }));
});

test("the advanced settings save as shares and counts", async () => {
  const { fake, user } = mount();
  await screen.findByRole("heading", { name: "Default route" });
  await user.click(screen.getByText("Advanced"));
  await user.clear(box("Clear at"));
  await user.type(box("Clear at"), "65");
  await user.tab();
  await waitFor(() => expect(fake.raw.setRouting).toHaveBeenCalledWith({ context: { clear_at: 0.65 } }));
  await user.clear(box("Reply reserve"));
  await user.type(box("Reply reserve"), "2048");
  await user.tab();
  await waitFor(() => expect(fake.raw.setRouting).toHaveBeenCalledWith({ context: { reply_reserve: 2048 } }));
  await user.clear(box("Budget tier price limit"));
  await user.type(box("Budget tier price limit"), "3");
  await user.tab();
  await waitFor(() => expect(fake.raw.setRouting).toHaveBeenCalledWith({ routing: { budget_max_price: 3 } }));
  await user.clear(box("Keep loaded for"));
  await user.tab();
  await waitFor(() => expect(fake.raw.setRouting).toHaveBeenCalledWith({ context: { keep_alive: null } }));
});

test("a failed read shows the error and Retry reads again", async () => {
  const { fake, user } = mount("fail");
  expect((await screen.findByRole("alert")).textContent).toContain("no routing");
  fake.raw.getRouting.mockResolvedValue(DEFAULT_ROUTING);
  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByRole("heading", { name: "Default route" })).toBeTruthy();
});

test("the page passes axe", async () => {
  mount(SAMPLE_ROUTING);
  await screen.findByRole("heading", { name: "Default route" });
  const results = await axe.run(screen.getByRole("heading", { name: "Default route" }).parentElement?.parentElement?.parentElement as HTMLElement, { rules: { "color-contrast": { enabled: false } } });
  expect(results.violations).toEqual([]);
});
