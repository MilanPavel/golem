import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test } from "vitest";
import { App } from "../../app.tsx";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { ev, fakeClient, fakeFrame, rpcError, summary } from "../../store/test-support.ts";
import { ChecksStrip } from "../chat/checks-strip.tsx";
import { drawerOpenStore } from "../drawer/drawer-open.ts";
import { tabStore } from "./workbench-state.ts";

const CWD = "/Users/you/repos/golem";
const wait = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 5)));

async function setup() {
  history.replaceState(null, "", "/s/a");
  const fake = fakeClient();
  const doc = new EventTarget() as unknown as Document;
  (doc as { visibilityState: string }).visibilityState = "visible";
  const page = createPage(fake.client, { frame: fakeFrame(), doc });
  page.start();
  fake.setState({ status: "connected" });
  render(
    <PageProvider page={page}>
      <App />
    </PageProvider>,
  );
  act(() => {
    fake.emitSummary({ ...summary("a", "2026-11-01T11:59:00Z", CWD), title: "Lint", last_seq: 2 });
  });
  await wait();
  const emit = async (type: Parameters<typeof ev>[1], data: Record<string, unknown> = {}, runId = "r1") => {
    act(() => {
      fake.emitEvent({ ...ev("a", type, data), run_id: runId } as ReturnType<typeof ev>);
    });
    await wait();
  };
  await emit("session.created", { cwd: CWD, model_profile: "local", model_name: "qwen3:8b", title: "Lint" });
  return { fake, emit };
}

const started = (id: string, name: string, round = 0) => ({ check_id: id, name, command: `${name} cmd`, round });
const done = (id: string, name: string, status: string, round = 0, extra: Record<string, unknown> = {}) => ({
  check_id: id,
  name,
  status,
  exit_code: status === "passed" ? 0 : 1,
  duration_ms: 2000,
  output: status === "passed" ? "" : "src/a.ts:1: error",
  round,
  ...extra,
});

async function answerAndEdit(emit: Awaited<ReturnType<typeof setup>>["emit"]) {
  await emit("run.started");
  await emit("message.started", { message_id: "m1" });
  await emit("message.completed", { message_id: "m1", role: "assistant", text: "I fixed the import." });
}

beforeEach(() => {
  localStorage.clear();
  tabStore.set(null);
  drawerOpenStore.set(false);
});
afterEach(() => {
  history.replaceState(null, "", "/");
  localStorage.clear();
  drawerOpenStore.set(false);
});

test("the strip says each tone in words, and Show opens the panel on Checks", async () => {
  const user = userEvent.setup();
  const { rerender } = render(<ChecksStrip tone="ok" text="✓ checks passed" detail="ruff · tsc · 6.2 s" />);
  expect(screen.getByText("✓ checks passed")).toBeTruthy();
  expect(screen.getByText("ruff · tsc · 6.2 s")).toBeTruthy();
  expect(document.querySelector("[data-checks-strip]")?.className).toContain("bg-allow-soft");
  rerender(<ChecksStrip tone="run" text="◐ checking…" detail="ruff ✓ · tsc running" />);
  expect(document.querySelector("[data-checks-strip]")?.className).toContain("bg-wait-soft");
  rerender(<ChecksStrip tone="bad" text="✗ ruff: failed" detail="golem is fixing · round 1" />);
  expect(document.querySelector("[data-checks-strip]")?.className).toContain("bg-deny-soft");
  await user.click(screen.getByRole("button", { name: "Show the checks" }));
  expect(tabStore.getSnapshot()).toBe("checks");
  expect(drawerOpenStore.getSnapshot()).toBe(true);
});

test("a turn that breaks lint shows red, then golem's fix, then green", async () => {
  const { emit } = await setup();
  await answerAndEdit(emit);
  await emit("check.started", started("k1", "ruff"));
  expect(screen.getByText("◐ checking…")).toBeTruthy();
  await emit("check.completed", done("k1", "ruff", "failed"));
  expect(screen.getByText("✗ ruff: failed")).toBeTruthy();
  expect(screen.getByText("golem is fixing · round 1")).toBeTruthy();
  await emit("check.started", started("k2", "ruff", 1));
  await emit("check.completed", done("k2", "ruff", "passed", 1));
  expect(screen.getByText("✓ checks passed")).toBeTruthy();
  expect(screen.queryByText("✗ ruff: failed")).toBeNull();
  await emit("run.completed");
  expect(screen.getByText("✓ checks passed")).toBeTruthy();
});

test("a failure after the last round stays red and says how many rounds", async () => {
  const { emit } = await setup();
  await answerAndEdit(emit);
  await emit("check.started", started("k1", "tsc"));
  await emit("check.completed", done("k1", "tsc", "failed"));
  await emit("check.started", started("k2", "tsc", 1));
  await emit("check.completed", done("k2", "tsc", "failed", 1));
  await emit("run.completed");
  expect(screen.getByText("✗ tsc: failed")).toBeTruthy();
  expect(screen.getByText("still failing after 1 round")).toBeTruthy();
});

test("the Checks tab shows the output, a badge, and folds the older turn", async () => {
  const { emit } = await setup();
  tabStore.set("checks");
  drawerOpenStore.set(true);
  await answerAndEdit(emit);
  await emit("check.started", started("k1", "ruff"));
  await emit("check.completed", done("k1", "ruff", "failed"));
  await emit("run.completed");
  expect(screen.getByRole("tab", { name: /Checks/ }).textContent).toContain("✗");
  const blocks = document.querySelectorAll("[data-check]");
  expect(blocks).toHaveLength(1);
  expect(within(blocks[0] as HTMLElement).getByText("ruff cmd")).toBeTruthy();
  expect(within(blocks[0] as HTMLElement).getByText("failed")).toBeTruthy();
  expect(within(blocks[0] as HTMLElement).getByText("2.0 s")).toBeTruthy();
  expect(screen.getByLabelText("Output of ruff").textContent).toBe("src/a.ts:1: error");
  await emit("run.started", {}, "r2");
  await emit("check.started", started("k9", "tsc"), "r2");
  await emit("check.completed", done("k9", "tsc", "passed"), "r2");
  const newest = document.querySelectorAll("ul[aria-label='Checks'] > [data-check]");
  expect(newest).toHaveLength(2);
  const older = document.querySelector("details[data-turn='r1']");
  expect(older?.textContent).toContain("✗ ruff: failed");
  expect(older?.hasAttribute("open")).toBe(false);
  expect(screen.getByRole("tab", { name: /Checks/ }).textContent).toContain("✓");
});

test("Read all loads the whole output from the artifact", async () => {
  const user = userEvent.setup();
  const { fake, emit } = await setup();
  tabStore.set("checks");
  drawerOpenStore.set(true);
  fake.raw.readArtifact.mockResolvedValue({ text: "line 1\nline 2\nthe whole output", offset: 0, size: 29 });
  await answerAndEdit(emit);
  await emit("check.started", started("k1", "ruff"));
  await emit("check.completed", done("k1", "ruff", "failed", 0, { artifact_id: "art_1" }));
  await user.click(screen.getByRole("button", { name: "Read all" }));
  await waitFor(() => expect(screen.getByLabelText("Full output of ruff").textContent).toContain("the whole output"));
  expect(fake.raw.readArtifact.mock.calls[0]?.slice(0, 2)).toEqual(["a", "art_1"]);
});

test("the switch sends session.set_checks, and shows a refusal", async () => {
  const user = userEvent.setup();
  const { fake, emit } = await setup();
  tabStore.set("checks");
  drawerOpenStore.set(true);
  await emit("run.started");
  const toggle = screen.getByRole("switch", { name: "Run checks after edits" });
  expect(toggle.getAttribute("aria-checked")).toBe("false");
  await user.click(toggle);
  expect(fake.raw.setChecks).toHaveBeenCalledWith("a", true);
  await emit("session.checks.changed", { on: true });
  expect(screen.getByRole("switch", { name: "Run checks after edits" }).getAttribute("aria-checked")).toBe("true");
  fake.raw.setChecks.mockRejectedValueOnce(rpcError(-32000, "refused"));
  await user.click(screen.getByRole("switch", { name: "Run checks after edits" }));
  expect((await screen.findByRole("alert")).textContent).toContain("refused");
});

test("the question asks once, sends the answer, and goes away", async () => {
  const user = userEvent.setup();
  const { fake, emit } = await setup();
  await answerAndEdit(emit);
  await emit("check.offered", { checks: [{ name: "ruff", command: "ruff check ." }, { name: "tsc", command: "pnpm run typecheck" }] });
  const question = screen.getByRole("region", { name: "Run checks?" });
  expect(question.textContent).toContain("Run checks after golem edits?");
  expect(question.textContent).toContain("ruff check .");
  expect(question.textContent).toContain("pnpm run typecheck");
  await user.click(within(question).getByRole("button", { name: "Run them" }));
  expect(fake.raw.setChecks).toHaveBeenCalledWith("a", true);
  await waitFor(() => expect(screen.queryByRole("region", { name: "Run checks?" })).toBeNull());
});

test("Not in this chat sends no", async () => {
  const user = userEvent.setup();
  const { fake, emit } = await setup();
  await emit("check.offered", { checks: [{ name: "ruff", command: "ruff check ." }] });
  await user.click(screen.getByRole("button", { name: "Not in this chat" }));
  expect(fake.raw.setChecks).toHaveBeenCalledWith("a", false);
  await emit("session.checks.changed", { on: false });
  expect(screen.queryByRole("region", { name: "Run checks?" })).toBeNull();
});

test("an answer from another window closes the question", async () => {
  const { emit } = await setup();
  await emit("check.offered", { checks: [{ name: "ruff", command: "ruff check ." }] });
  expect(screen.getByRole("region", { name: "Run checks?" })).toBeTruthy();
  await emit("session.checks.changed", { on: true });
  expect(screen.queryByRole("region", { name: "Run checks?" })).toBeNull();
});

test("/checks off and /checks on send the answer and say so", async () => {
  const user = userEvent.setup();
  const { fake } = await setup();
  const box = screen.getByRole("textbox", { name: "Message" });
  await user.click(box);
  await user.type(box, "/checks off{Enter}");
  await wait();
  expect(fake.raw.setChecks).toHaveBeenLastCalledWith("a", false);
  expect(document.body.textContent).toContain("Checks do not run in this chat.");
  await user.type(box, "/checks on{Enter}");
  await wait();
  expect(fake.raw.setChecks).toHaveBeenLastCalledWith("a", true);
});
