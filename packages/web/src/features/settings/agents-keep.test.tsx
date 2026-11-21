import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test } from "vitest";
import { App } from "../../app.tsx";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { fakeClient, fakeFrame, summary } from "../../store/test-support.ts";
import { closePalette } from "../palette/index.ts";
import { SAMPLE_AGENTS } from "./agents-sample.ts";
import { settingsContextStore } from "./index.ts";

const FOLDER = "/Users/you/repos/golem";
const noContrast = { rules: { "color-contrast": { enabled: false } } };

function mount(values = { keep_days: 7, keep_problem_days: 30 }) {
  history.replaceState(null, "", "/settings/agents");
  const fake = fakeClient();
  fake.raw.listAgents.mockResolvedValue({ agents: SAMPLE_AGENTS });
  fake.raw.agentsKeep.mockResolvedValue({ ok: true, errors: [], values });
  fake.raw.status.mockResolvedValue({ version: "0.5.0" });
  const page = createPage(fake.client, { frame: fakeFrame() });
  page.start();
  fake.setState({ status: "connected" });
  act(() => {
    fake.emitSummary(summary("a", "2026-11-01T11:59:00Z", FOLDER));
  });
  settingsContextStore.set({ sessionId: "a", cwd: FOLDER });
  const view = render(
    <PageProvider page={page}>
      <App />
    </PageProvider>,
  );
  return { fake, user: userEvent.setup(), ...view };
}

beforeEach(() => {
  localStorage.clear();
  settingsContextStore.set(null);
});
afterEach(() => {
  closePalette();
  settingsContextStore.set(null);
  history.replaceState(null, "", "/");
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

test("the block shows both counts, the for ever choices and what stays", async () => {
  mount();
  const steps = (await screen.findByRole("textbox", { name: "Keep the steps for days" })) as HTMLInputElement;
  const problem = screen.getByRole("textbox", { name: "Keep failed, stopped and asking helpers for days" }) as HTMLInputElement;
  expect([steps.value, problem.value]).toEqual(["7", "30"]);
  expect(screen.getAllByRole("checkbox", { name: "for ever" })).toHaveLength(2);
  expect(screen.getByText(/the brief, the answer, the model and the cost/)).toBeTruthy();
});

test("changing 7 to 14 writes keep_days and the page shows 14 after the daemon answers", async () => {
  const { fake, user } = mount();
  const steps = await screen.findByRole("textbox", { name: "Keep the steps for days" });
  fake.raw.agentsKeep.mockResolvedValue({ ok: true, errors: [], values: { keep_days: 14, keep_problem_days: 30 } });
  await user.clear(steps);
  await user.type(steps, "14{Enter}");
  await waitFor(() => expect(fake.raw.agentsKeep).toHaveBeenCalledWith({ keep_days: 14 }));
  await waitFor(() => expect((screen.getByRole("textbox", { name: "Keep the steps for days" }) as HTMLInputElement).value).toBe("14"));
});

test("for ever writes 0, and turning it off writes the default again", async () => {
  const { fake, user } = mount();
  await screen.findByRole("textbox", { name: "Keep the steps for days" });
  fake.raw.agentsKeep.mockResolvedValue({ ok: true, errors: [], values: { keep_days: 7, keep_problem_days: 0 } });
  await user.click(screen.getAllByRole("checkbox", { name: "for ever" })[1]!);
  await waitFor(() => expect(fake.raw.agentsKeep).toHaveBeenCalledWith({ keep_problem_days: 0 }));
  const problem = (await waitFor(() => {
    const box = screen.getByRole("textbox", { name: "Keep failed, stopped and asking helpers for days" }) as HTMLInputElement;
    expect(box.disabled).toBe(true);
    return box;
  })) as HTMLInputElement;
  expect(problem.value).toBe("");
  fake.raw.agentsKeep.mockResolvedValue({ ok: true, errors: [], values: { keep_days: 7, keep_problem_days: 30 } });
  await user.click(screen.getAllByRole("checkbox", { name: "for ever" })[1]!);
  await waitFor(() => expect(fake.raw.agentsKeep).toHaveBeenCalledWith({ keep_problem_days: 30 }));
});

test("a value the config refuses shows its error at the field", async () => {
  const { fake, user } = mount();
  const steps = await screen.findByRole("textbox", { name: "Keep the steps for days" });
  fake.raw.agentsKeep.mockResolvedValue({ ok: false, errors: [{ path: "agents.keep_days", message: "Input should be greater than or equal to 0" }] });
  await user.clear(steps);
  await user.type(steps, "-1{Enter}");
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe("Input should be greater than or equal to 0");
  expect(steps.getAttribute("aria-invalid")).toBe("true");
  expect(steps.getAttribute("aria-describedby")).toBe(alert.id);
});

test("text that is not a number is said at the field and nothing is sent", async () => {
  const { fake, user } = mount();
  const steps = await screen.findByRole("textbox", { name: "Keep the steps for days" });
  await user.clear(steps);
  await user.type(steps, "soon{Enter}");
  expect((await screen.findByRole("alert")).textContent).toMatch(/whole number of days/);
  expect(fake.raw.agentsKeep).toHaveBeenCalledTimes(1);
});

test("a failed call is an alert", async () => {
  const { fake, user } = mount();
  const steps = await screen.findByRole("textbox", { name: "Keep the steps for days" });
  fake.raw.agentsKeep.mockRejectedValue(new Error("the daemon is gone"));
  await user.clear(steps);
  await user.type(steps, "3{Enter}");
  expect((await screen.findByRole("alert")).textContent).toBe("the daemon is gone");
});

test("axe is clean with the block", async () => {
  const { container } = mount();
  await screen.findByRole("textbox", { name: "Keep the steps for days" });
  expect((await axe.run(container, noContrast)).violations).toEqual([]);
});
