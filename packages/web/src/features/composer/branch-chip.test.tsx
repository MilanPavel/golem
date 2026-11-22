import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { GitInfoResult } from "../../store/dirs.ts";
import { App } from "../../app.tsx";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { ev, fakeClient, fakeFrame, rpcError, summary } from "../../store/test-support.ts";
import { BranchChipView } from "./branch-chip.tsx";

const CWD = "/Users/you/repos/golem";
const noContrast = { rules: { "color-contrast": { enabled: false } } };
const wait = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 5)));
const BRANCHES = { current: "main", branches: [{ name: "main", last_used: null }, { name: "fix-x", last_used: null }] };
const INFO: GitInfoResult = { repository: true, root: CWD, branch: "main", detached: false, changed: 0, worktrees: [] };

function setup(path: string, info: Partial<GitInfoResult> = {}) {
  history.replaceState(null, "", path);
  const fake = fakeClient();
  fake.raw.gitInfo.mockResolvedValue({ ...INFO, ...info });
  fake.raw.gitBranches.mockResolvedValue(BRANCHES);
  const doc = new EventTarget() as unknown as Document;
  (doc as { visibilityState: string }).visibilityState = "visible";
  const page = createPage(fake.client, { frame: fakeFrame(), doc });
  page.start();
  fake.setState({ status: "connected" });
  const view = render(
    <PageProvider page={page}>
      <App />
    </PageProvider>,
  );
  return { fake, page, ...view, user: userEvent.setup() };
}

const box = () => screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;
const chip = () => screen.queryByRole("button", { name: /^Branch: / });
const findChip = () => screen.findByRole("button", { name: /^Branch: / });

beforeEach(() => localStorage.clear());
afterEach(() => history.replaceState(null, "", "/"));

async function home(info: Partial<GitInfoResult> = {}) {
  const ctx = setup("/", info);
  act(() => ctx.fake.emitSummary(summary("x", "2026-11-01T11:59:00Z", CWD)));
  await wait();
  return ctx;
}

test("home: the chip is hidden outside a repo", async () => {
  await home({ repository: false, branch: null });
  expect(chip()).toBeNull();
});

test("home: the chip shows the folder's branch, and a changed count that does not disable anything", async () => {
  const { user } = await home({ changed: 3 });
  const button = await findChip();
  expect(button.getAttribute("aria-label")).toBe("Branch: main");
  expect(button.textContent).toContain("±3");
  await user.click(button);
  const menu = screen.getByRole("dialog", { name: "Branches" });
  expect(menu.textContent).toContain("3 changed files in golem. They go along to the new branch.");
  expect((within(menu).getByRole("button", { name: /fix-x/ }) as HTMLButtonElement).disabled).toBe(false);
  expect(document.activeElement).toBe(within(menu).getByRole("textbox", { name: "Search or create a branch" }));
});

test("home: picking marks the branch, shows the line, and send passes it", async () => {
  const { fake, user } = await home();
  await user.click(await findChip());
  await user.click(within(await screen.findByRole("dialog", { name: "Branches" })).getByRole("button", { name: /fix-x/ }));
  expect((chip() as HTMLElement).getAttribute("aria-label")).toBe("Branch: fix-x");
  expect(screen.getByText(/golem switches/).textContent).toBe("golem switches golem from main to fix-x when you send.");
  await user.type(box(), "hi{Enter}");
  await wait();
  expect(fake.raw.createSession).toHaveBeenCalledWith({ cwd: CWD, branch: "fix-x" });
});

test("home: a name that matches nothing offers Create, and send passes create_branch", async () => {
  const { fake, user } = await home();
  await user.click(await findChip());
  await user.type(await screen.findByRole("textbox", { name: "Search or create a branch" }), "fix-y");
  const create = screen.getByRole("button", { name: /^Create fix-y from main/ });
  await user.click(create);
  expect((chip() as HTMLElement).getAttribute("aria-label")).toBe("Branch: fix-y");
  await user.type(box(), "hi{Enter}");
  await wait();
  expect(fake.raw.createSession).toHaveBeenCalledWith({ cwd: CWD, branch: "fix-y", createBranch: true });
});

test("home: another open session in the folder gets a quiet note", async () => {
  const { fake, user } = await home();
  act(() => fake.emitSummary({ ...summary("x", "2026-11-01T12:00:00Z", CWD, 2), title: "Review files" }));
  await wait();
  await user.click(await findChip());
  expect((await screen.findByRole("dialog", { name: "Branches" })).textContent).toContain("Review files also works in golem. If you switch, it sees the new branch too; golem tells its model.");
});

test("home: a failed switch shows git's message, keeps the text, and starts nothing", async () => {
  const { fake, user } = await home();
  fake.raw.createSession.mockRejectedValueOnce(rpcError(-32026, "error: pathspec 'fix-x' did not match", { reason: "branch_switch_failed" }));
  await user.click(await findChip());
  await user.click(within(await screen.findByRole("dialog", { name: "Branches" })).getByRole("button", { name: /fix-x/ }));
  await user.type(box(), "hello{Enter}");
  await wait();
  expect(screen.getByRole("alert").textContent).toBe("error: pathspec 'fix-x' did not match");
  expect(box().value).toBe("hello");
  expect(fake.raw.sendMessage).not.toHaveBeenCalled();
  expect(location.pathname).toBe("/");
});

async function session(branch: string | null = "main", info: Partial<GitInfoResult> = {}) {
  const ctx = setup("/s/a", info);
  act(() => ctx.fake.emitSummary({ ...summary("a", "2026-11-01T11:59:00Z", CWD), branch }));
  await wait();
  act(() => ctx.fake.emitEvent(ev("a", "session.created", { cwd: CWD, model_profile: "local", model_provider: "ollama", model_name: "qwen3:27b" })));
  await wait();
  return ctx;
}

test("session: rows say New session and lead home with the folder and branch marked", async () => {
  const { fake, user } = await session();
  await user.click(await findChip());
  const menu = await screen.findByRole("dialog", { name: "Branches" });
  expect(menu.textContent).toContain("This session stays on main. Pick a branch to start a new session on it.");
  expect(within(menu).getByRole("button", { name: /fix-x/ }).textContent).toContain("New session ↗");
  await user.click(within(menu).getByRole("button", { name: /fix-x/ }));
  await wait();
  expect(location.pathname).toBe("/");
  expect((chip() as HTMLElement).getAttribute("aria-label")).toBe("Branch: fix-x");
  expect(fake.raw.createSession).not.toHaveBeenCalled();
});

test("session: the chip follows SessionSummary.branch and turns amber after branch.changed until the turn ends", async () => {
  const { fake } = await session();
  expect((await findChip()).dataset["amber"]).toBeUndefined();
  act(() => fake.emitSummary({ ...summary("a", "2026-11-01T12:00:00Z", CWD, 2), branch: "fix-x" }));
  act(() => {
    fake.emitEvent(ev("a", "run.started", {}));
    fake.emitEvent(ev("a", "branch.changed", { from_branch: "main", to_branch: "fix-x", paths_count: 3 }));
  });
  await wait();
  expect((chip() as HTMLElement).getAttribute("aria-label")).toBe("Branch: fix-x");
  expect((chip() as HTMLElement).dataset["amber"]).toBe("true");
  act(() => fake.emitEvent(ev("a", "run.completed", {})));
  await wait();
  expect((chip() as HTMLElement).dataset["amber"]).toBeUndefined();
});

test("session: no chip when the session has no branch", async () => {
  await session(null);
  expect(chip()).toBeNull();
});

test("the chip is hidden under 330 px and icon-only under 500 px", () => {
  render(<BranchChipView mode="home" folder={CWD} shown="main" current="main" changed={0} branches={["main"]} onPick={() => {}} onCreate={() => {}} />);
  const button = screen.getByRole("button", { name: "Branch: main" });
  expect(button.className).toContain("@max-row-330/comp:hidden");
  expect(button.querySelector("code")?.className).toContain("@max-row-500/comp:sr-only");
});

test("the menu has no accessibility violations, open, in a session", async () => {
  const { user, baseElement } = await session("main", { changed: 2 });
  await user.click(await findChip());
  await screen.findByRole("dialog", { name: "Branches" });
  expect((await axe.run(baseElement, noContrast)).violations).toEqual([]);
});
