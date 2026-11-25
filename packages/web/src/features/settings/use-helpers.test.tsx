import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { expect, test } from "vitest";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { fakeClient, fakeFrame } from "../../store/test-support.ts";
import { UseHelpers, UseHelpersSection } from "./use-helpers-setting.tsx";

const LINES = {
  when_needed: "The lead is told these reasons and decides when to start a helper. golem reminds it when the window passes the \"already full\" share.",
  ask: "golem asks before it starts a helper.",
  never: "golem works alone.",
} as const;

test.each(["when_needed", "ask", "never"] as const)("%s: the control checks it and the line explains it", (value) => {
  render(<UseHelpers value={value} onChoose={() => {}} />);
  expect(screen.getByRole("group", { name: "Use helpers" })).toBeTruthy();
  const labels = ["When needed", "Ask me first", "Never"];
  const radios = labels.map((name) => screen.getByRole("radio", { name }) as HTMLInputElement);
  expect(radios.map((r) => r.checked)).toEqual([value === "when_needed", value === "ask", value === "never"]);
  expect(screen.getByText(LINES[value])).toBeTruthy();
});

test("a daemon without the value reads as When needed", () => {
  render(<UseHelpers value={undefined} onChoose={() => {}} />);
  expect((screen.getByRole("radio", { name: "When needed" }) as HTMLInputElement).checked).toBe(true);
});

test("an error shows under the control, and a failed send in a line", () => {
  render(<UseHelpers value="ask" errors={{ "agents.use_helpers": "Not one of when_needed, ask, never." }} failure="Could not save when helpers are used." onChoose={() => {}} />);
  expect(screen.getAllByRole("alert").map((a) => a.textContent)).toEqual(["Not one of when_needed, ask, never.", "Could not save when helpers are used."]);
});

function mount(use_helpers: "when_needed" | "ask" | "never" = "when_needed") {
  const fake = fakeClient();
  let values = { keep_days: 7, keep_problem_days: 30, use_helpers };
  fake.raw.agentsKeep.mockImplementation(async (change) => {
    if (change?.use_helpers !== undefined) values = { ...values, use_helpers: change.use_helpers };
    return { ok: true, errors: [], values };
  });
  const page = createPage(fake.client, { frame: fakeFrame() });
  page.start();
  fake.setState({ status: "connected" });
  render(
    <PageProvider page={page}>
      <UseHelpersSection />
    </PageProvider>,
  );
  return { fake, user: userEvent.setup() };
}

test("choosing Ask me first saves use_helpers and the page shows it after the daemon answers", async () => {
  const { fake, user } = mount();
  await screen.findByRole("radio", { name: "When needed" });
  await user.click(screen.getByRole("radio", { name: "Ask me first" }));
  await waitFor(() => {
    expect(fake.raw.agentsKeep).toHaveBeenCalledWith({ use_helpers: "ask" });
    expect((screen.getByRole("radio", { name: "Ask me first" }) as HTMLInputElement).checked).toBe(true);
  });
  expect(screen.getByText(LINES.ask)).toBeTruthy();
});

test("a refusal from the daemon shows its message", async () => {
  const { fake, user } = mount("ask");
  await screen.findByRole("radio", { name: "Ask me first" });
  fake.raw.agentsKeep.mockResolvedValueOnce({ ok: false, errors: [{ path: "agents.use_helpers", message: "Not allowed." }] });
  await user.click(screen.getByRole("radio", { name: "Never" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Not allowed.");
});

test("a send that fails shows a line", async () => {
  const { fake, user } = mount();
  await screen.findByRole("radio", { name: "When needed" });
  fake.raw.agentsKeep.mockRejectedValueOnce(new Error("offline"));
  await user.click(screen.getByRole("radio", { name: "Never" }));
  expect((await screen.findByRole("alert")).textContent).toBe("offline");
});

test("the block passes axe", async () => {
  const { container } = render(<UseHelpers value="ask" onChoose={() => {}} />);
  await act(async () => {});
  const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
  expect(results.violations).toEqual([]);
});
