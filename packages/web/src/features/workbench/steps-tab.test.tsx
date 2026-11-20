import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { closeHelper, useHelperOpen } from "../chat/helper-open.ts";
import { cloudFinishedChat, cloudRunningChat, localFinishedChat, localRunningChat, STEPS_NOW } from "./steps-sample.ts";
import { StepsView, hasSteps, stepsBatches } from "./steps-tab.tsx";

afterEach(() => {
  cleanup();
  closeHelper();
});

function Open() {
  const open = useHelperOpen();
  return <p data-testid="open">{open === null ? "none" : `${open.callId}:${open.helperId}`}</p>;
}

function kinds(row: HTMLElement): string[] {
  return [...row.querySelectorAll("[data-segment]")].map((segment) => segment.getAttribute("data-segment") ?? "");
}

test("a finished batch: a row per helper with a bar, a legend and the head", () => {
  render(<StepsView batches={stepsBatches(localFinishedChat(), STEPS_NOW)} />);
  expect(screen.getByRole("heading", { name: "3 helpers · 3 done" })).toBeTruthy();
  expect(document.querySelectorAll("[data-step-row]")).toHaveLength(3);
  expect(screen.getByText("waiting in line")).toBeTruthy();
  expect(screen.getByText("waiting for you")).toBeTruthy();
  expect(screen.getAllByText("done").length).toBe(3);
  // The bar has a text alternative, and the whole scale is 50 s.
  const bars = screen.getAllByRole("img").map((bar) => bar.getAttribute("aria-label"));
  expect(bars).toEqual(["worked 0m 20s", "worked 0m 15s, waited in line 0m 20s", "worked 0m 15s, waited in line 0m 35s"]);
});

test("a running batch ends its open rows at now and moves with it", () => {
  const chat = localRunningChat();
  const early = stepsBatches(chat, STEPS_NOW)[0];
  const later = stepsBatches(chat, STEPS_NOW + 30_000)[0];
  expect(early?.list.spanMs).toBe(60_000);
  expect(later?.list.spanMs).toBe(90_000);
  render(<StepsView batches={stepsBatches(chat, STEPS_NOW)} />);
  const rows = [...document.querySelectorAll<HTMLElement>("[data-step-row]")];
  const states = rows.map((row) => row.querySelector("[data-row-state]")?.textContent ?? "");
  expect(states[0]).toBe("done");
  expect(states[1]).toBe("running");
  expect(states[2]).not.toBe("running");
  expect(kinds(rows[1] as HTMLElement)).toEqual(["line", "work"]);
});

test("a row is a button that opens its helper, named with its state", () => {
  render(
    <>
      <StepsView batches={stepsBatches(localRunningChat(), STEPS_NOW)} />
      <Open />
    </>,
  );
  const button = screen.getByRole("button", { name: /^Open docs, running/ });
  fireEvent.click(button);
  expect(screen.getByTestId("open").textContent).toBe("d1:h2");
  expect(within(screen.getByRole("region", { name: /^Steps, / })).getAllByRole("button")).toHaveLength(3);
});

test("local only: helpers take turns, so later rows start in line", () => {
  render(<StepsView batches={stepsBatches(localFinishedChat(), STEPS_NOW)} />);
  const rows = [...document.querySelectorAll<HTMLElement>("[data-step-row]")];
  expect(kinds(rows[0] as HTMLElement)).toEqual(["work"]);
  expect(kinds(rows[1] as HTMLElement)).toEqual(["line", "work"]);
  expect(kinds(rows[2] as HTMLElement)).toEqual(["line", "work"]);
});

test("cloud only: helpers overlap with no line segment, and a wait for you is its own kind", () => {
  render(<StepsView batches={stepsBatches(cloudFinishedChat(), STEPS_NOW)} />);
  const rows = [...document.querySelectorAll<HTMLElement>("[data-step-row]")];
  expect(document.querySelector('[data-segment="line"]')).toBeNull();
  expect(kinds(rows[0] as HTMLElement)).toEqual(["work"]);
  expect(kinds(rows[1] as HTMLElement)).toEqual(["work", "you", "work"]);
  // Both start at the left edge of the shared scale.
  expect((rows[1]?.querySelector("[data-segment]") as HTMLElement).style.left).toBe("0%");
  expect(screen.getByRole("img", { name: "worked 0m 22s, waited for you 0m 08s" })).toBeTruthy();
});

test("a running cloud batch", () => {
  render(<StepsView batches={stepsBatches(cloudRunningChat(), STEPS_NOW)} />);
  expect(screen.getByRole("heading", { name: "2 helpers · 1 running · 1 done" })).toBeTruthy();
});

test("the tab is there only when the session has a batch", () => {
  expect(hasSteps(localFinishedChat())).toBe(true);
  expect(hasSteps({ batches: {} })).toBe(false);
});
