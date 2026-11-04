import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, expect, test } from "vitest";
import { createPage } from "../../store/page.ts";
import { PageProvider } from "../../store/page-context.tsx";
import { ev, fakeClient, fakeFrame } from "../../store/test-support.ts";
import { SAMPLE_LISTING } from "../models/sample.ts";
import { SessionDock } from "./session-dock.tsx";

const noContrast = { rules: { "color-contrast": { enabled: false } } };
const wait = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 5)));

const SKILLS = {
  skills: [
    { name: "review", description: "Reviews the diff.", argument_hint: "[path]", path: "/s/review", source: "project", usable: true },
    { name: "commit", description: "Writes a commit message.", path: "/s/commit", source: "user", usable: true },
  ],
} as never;

function setup() {
  const fake = fakeClient();
  fake.raw.listSkills.mockResolvedValue(SKILLS);
  fake.raw.listModels.mockResolvedValue(SAMPLE_LISTING);
  const doc = new EventTarget() as unknown as Document;
  (doc as { visibilityState: string }).visibilityState = "visible";
  const page = createPage(fake.client, { frame: fakeFrame(), doc });
  page.start();
  fake.setState({ status: "connected" });
  const view = render(
    <PageProvider page={page}>
      <SessionDock sessionId="a" />
    </PageProvider>,
  );
  return { fake, page, view, user: userEvent.setup() };
}

const box = () => screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;
const list = () => screen.queryByRole("listbox", { name: "Commands" });
const options = () => within(screen.getByRole("listbox", { name: "Commands" })).getAllByRole("option");
const selected = () => options().find((option) => option.getAttribute("aria-selected") === "true");
const live = () => document.querySelector('[aria-live="polite"]');

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  document.documentElement.dataset.theme = "";
});

test("a plain chat never asks for the model or skill list", async () => {
  const { fake, user } = setup();
  await user.type(box(), "hello");
  await wait();
  expect(fake.raw.listSkills).not.toHaveBeenCalled();
  expect(fake.raw.listModels).not.toHaveBeenCalled();
  expect(list()).toBeNull();
});

test("/ opens the list, typing filters it, and the textarea names the list and the active option", async () => {
  const { fake, user } = setup();
  await user.type(box(), "/");
  await wait();
  expect(fake.raw.listSkills).toHaveBeenCalledTimes(1);
  expect(options().length).toBeGreaterThan(10);
  expect(options()[0]?.textContent).toContain("/artifact");
  expect(box().getAttribute("aria-controls")).toBe(screen.getByRole("listbox", { name: "Commands" }).id);
  expect(box().getAttribute("aria-activedescendant")).toBe(selected()?.id);
  expect(box().getAttribute("aria-autocomplete")).toBe("list");
  expect(box().hasAttribute("aria-expanded")).toBe(false);
  await user.type(box(), "mo");
  expect(options().map((option) => option.textContent)).toEqual([expect.stringContaining("/model")]);
  expect(options()[0]?.textContent).toContain("Opens the model picker");
});

test("the live region counts the suggestions when the count changes, and not otherwise", async () => {
  const { user } = setup();
  expect(live()?.textContent).toBe("");
  await user.type(box(), "/mod");
  expect(live()?.textContent).toBe("1 suggestion");
  await user.type(box(), "{Backspace}{Backspace}{Backspace}");
  expect(live()?.textContent).toMatch(/^\d+ suggestions$/);
  await user.type(box(), "{Backspace}");
  expect(live()?.textContent).toBe("");
});

test("Up and Down move the active option and stop at the ends", async () => {
  const { user } = setup();
  await user.type(box(), "/");
  expect(selected()).toBe(options()[0]);
  await user.keyboard("{ArrowDown}");
  expect(selected()).toBe(options()[1]);
  expect(box().getAttribute("aria-activedescendant")).toBe(options()[1]?.id);
  await user.keyboard("{ArrowUp}{ArrowUp}");
  expect(selected()).toBe(options()[0]);
});

test("Tab completes the active option", async () => {
  const { user } = setup();
  await user.type(box(), "/cl");
  await user.keyboard("{Tab}");
  expect(box().value).toBe("/close ");
});

test("Shift+Tab and modified arrows are left alone", async () => {
  const { user } = setup();
  await user.type(box(), "/");
  await user.keyboard("{Shift>}{Tab}{/Shift}");
  expect(box().value).toBe("/");
  await user.keyboard("{Alt>}{ArrowDown}{/Alt}");
  expect(selected()).toBe(options()[0]);
});

test("Enter fills in a partial match, then runs the full one", async () => {
  const { fake, user } = setup();
  await user.type(box(), "/tit");
  await user.keyboard("{Enter}");
  expect(box().value).toBe("/title ");
  expect(fake.raw.renameSession).not.toHaveBeenCalled();
  await user.type(box(), "Plans");
  await user.keyboard("{Enter}");
  await wait();
  expect(fake.raw.renameSession).toHaveBeenCalledWith("a", "Plans");
  expect(box().value).toBe("");
});

test("Enter on a full match runs it", async () => {
  const { user } = setup();
  await user.type(box(), "/help");
  await user.keyboard("{Enter}");
  await wait();
  expect(screen.getByRole("dialog", { name: "Commands" })).toBeTruthy();
});

test("Esc closes the list for this draft, and a new keystroke opens it again", async () => {
  const { user } = setup();
  await user.type(box(), "/mo");
  await user.keyboard("{Escape}");
  expect(list()).toBeNull();
  expect(box().getAttribute("aria-activedescendant")).toBeNull();
  expect(box().getAttribute("aria-controls")).toBeNull();
  await user.type(box(), "d");
  expect(list()).toBeTruthy();
});

test("with a run in progress there is no list, so Esc stops the run", async () => {
  const { fake, user } = setup();
  act(() => {
    fake.emitEvent(ev("a", "run.started"));
  });
  await user.type(box(), "/");
  expect(list()).toBeNull();
  await user.keyboard("{Escape}");
  expect(fake.raw.cancelRun).toHaveBeenCalledWith("r1");
});

test("with the list closed, Up and Down browse the history again", async () => {
  localStorage.setItem("golem.history", JSON.stringify(["older", "newer"]));
  const { user } = setup();
  await user.type(box(), "/mo");
  await user.keyboard("{Escape}{Home}{ArrowUp}");
  expect(box().value).toBe("newer");
  await user.keyboard("{ArrowDown}");
  expect(box().value).toBe("/mo");
});

test("a recalled slash text does not open the list", async () => {
  localStorage.setItem("golem.history", JSON.stringify(["/model"]));
  const { user } = setup();
  await user.click(box());
  await user.keyboard("{ArrowUp}");
  expect(box().value).toBe("/model");
  expect(list()).toBeNull();
});

test("clicking an option completes it and keeps focus in the textarea", async () => {
  const { user } = setup();
  await user.type(box(), "/");
  const target = options().find((option) => option.textContent?.includes("/fork")) as HTMLElement;
  await user.click(target);
  expect(box().value).toBe("/fork ");
  expect(document.activeElement).toBe(box());
});

test("// is a message and never suggests", async () => {
  const { user } = setup();
  await user.type(box(), "//");
  expect(list()).toBeNull();
});

test("a run in progress hides the list", async () => {
  const { fake, user } = setup();
  await user.type(box(), "/");
  expect(list()).toBeTruthy();
  act(() => {
    fake.emitEvent(ev("a", "run.started"));
  });
  expect(list()).toBeNull();
});

test("model names follow /model, and skill names follow /skill run", async () => {
  const { user } = setup();
  await user.type(box(), "/model ");
  await wait();
  const names = options().map((option) => option.textContent ?? "");
  expect(names.some((name) => name.includes("local"))).toBe(true);
  expect(names.some((name) => name.includes("ollama/gemma4:e4b"))).toBe(true);
  await user.clear(box());
  await user.type(box(), "/skill run ");
  await wait();
  expect(options().map((option) => option.textContent ?? "").some((name) => name.includes("review"))).toBe(true);
  expect(options().length).toBe(2);
});

test("skills are suggested by name, with their hint, and run with their arguments", async () => {
  const { fake, user } = setup();
  await user.type(box(), "/rev");
  await wait();
  expect(options()[0]?.textContent).toContain("/review [path]");
  await user.type(box(), "iew src");
  await user.keyboard("{Enter}");
  await wait();
  expect(fake.raw.sendMessage).toHaveBeenCalledWith("a", "/review src", { skill: { name: "review", args: "src" } });
});

for (const theme of ["slip", "kiln"]) {
  test(`axe: the dock with suggestions open (${theme})`, async () => {
    document.documentElement.dataset.theme = theme;
    const { view, user } = setup();
    await user.type(box(), "/");
    await wait();
    expect((await axe.run(view.container, noContrast)).violations).toEqual([]);
  });
}
