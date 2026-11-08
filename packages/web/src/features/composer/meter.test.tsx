import { act, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { elapsedSeconds, Meter } from "./meter.tsx";

afterEach(() => {
  vi.useRealTimers();
});

const START = "2026-11-01T10:00:00+00:00";

test("working shows the seconds since the run began, ticking once a second", () => {
  vi.useFakeTimers({ now: Date.parse(START) + 12_000 });
  render(<Meter state="thinking" runStartedAt={START} />);
  expect(screen.getByText("working · 0m 12s")).toBeTruthy();
  act(() => vi.advanceTimersByTime(3000));
  expect(screen.getByText("working · 0m 15s")).toBeTruthy();
});

test("it does not tick when idle, and says idle", () => {
  vi.useFakeTimers({ now: Date.parse(START) });
  const spy = vi.spyOn(globalThis, "setInterval");
  const { container } = render(<Meter state="idle" runStartedAt={null} />);
  expect(spy).not.toHaveBeenCalled();
  expect(container.textContent).toBe("idle");
  expect(screen.getByRole("img", { name: "golem · idle" })).toBeTruthy();
});

test("waiting for you, with no clock", () => {
  render(<Meter state="waiting" runStartedAt={START} />);
  expect(screen.getByText("waiting for you")).toBeTruthy();
});

test("elapsed seconds never go below zero or come out as NaN", () => {
  expect(elapsedSeconds(null, 5000)).toBe(0);
  expect(elapsedSeconds("nonsense", 5000)).toBe(0);
  expect(elapsedSeconds(START, Date.parse(START) - 4000)).toBe(0);
});
