import { act, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { emptyChat, reduceChat, waitText } from "@golem/view";

type ChatEvent = Parameters<typeof reduceChat>[1];
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

test("while the model loads with a larger window, the meter says which", () => {
  render(<Meter state="thinking" runStartedAt={START} localWait loading="loading qwen3:8b with a 64K window" />);
  expect(screen.getByText("loading qwen3:8b with a 64K window")).toBeTruthy();
});

test("a wait with a reason says the web sentence; without one, the old words", () => {
  const { rerender } = render(
    <Meter state="thinking" runStartedAt={START} localWait wait="waiting for qwen3:14b · 2nd in line, behind Refactor auth" />,
  );
  expect(screen.getByText("waiting for qwen3:14b · 2nd in line, behind Refactor auth")).toBeTruthy();
  rerender(<Meter state="thinking" runStartedAt={START} localWait />);
  expect(screen.getByText("waiting for the local model")).toBeTruthy();
});

/** The web status line for a `model.waiting` event, through the reducer, `waitText` and the meter. */
function lineFor(data: Record<string, unknown>) {
  const event = {
    session_id: "s",
    run_id: "r",
    seq: 1,
    ts: "t",
    type: "model.waiting",
    data: { message_id: "a", waiting: true, ...data },
  } as ChatEvent;
  const chat = reduceChat(emptyChat, event);
  return { chat, text: waitText(chat.wait, "web") };
}

test("local only: a slot wait shows the position and the holder, on the local model's name", () => {
  const { chat, text } = lineFor({ reason: "slot", line: "qwen3:14b", position: 2, holder: "Refactor auth" });
  render(<Meter state="thinking" runStartedAt={START} localWait={chat.localWait} wait={text} />);
  expect(screen.getByText("waiting for qwen3:14b · 2nd in line, behind Refactor auth")).toBeTruthy();
});

test("cloud only: a hosted provider wait says the provider is busy and never says local model", () => {
  const { chat, text } = lineFor({ reason: "provider", line: "anthropic", position: 1, retry_in_ms: 8000 });
  const { container } = render(<Meter state="thinking" runStartedAt={START} localWait={chat.localWait} wait={text} />);
  expect(screen.getByText("anthropic is busy · 1st in line · trying again in 8 s")).toBeTruthy();
  expect(container.textContent).not.toMatch(/local/i);
});

test("elapsed seconds never go below zero or come out as NaN", () => {
  expect(elapsedSeconds(null, 5000)).toBe(0);
  expect(elapsedSeconds("nonsense", 5000)).toBe(0);
  expect(elapsedSeconds(START, Date.parse(START) - 4000)).toBe(0);
});
