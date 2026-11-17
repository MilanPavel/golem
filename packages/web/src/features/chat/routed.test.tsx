import { fireEvent, render, screen } from "@testing-library/react";
import type { ListedModel } from "../../store/models.ts";
import { expect, test, vi } from "vitest";
import { ModelRow } from "../models/model-row.tsx";
import { ROUTED_CASES, ROUTED_SESSION } from "./sample.ts";
import { TranscriptMessages } from "./transcript.tsx";

const footers = (container: HTMLElement) => Array.from(container.querySelectorAll("article > p")).map((node) => node.textContent);

function turn(label: string, session = ROUTED_SESSION) {
  const found = ROUTED_CASES.find((item) => item.label === label)!;
  return render(
    <TranscriptMessages
      chat={{ messages: [found.message], error: null, notice: null, route: { mode: "auto", last: null, ...found.route } }}
      session={session}
    />,
  );
}

test("a turn that ran on a higher tier starts its model part with an arrow and the reason", () => {
  const { container } = turn("a higher tier");
  expect(footers(container)).toEqual(["8.4s · ↑ deepseek-chat · did not fit in 32K · deepseek-chat · 12.4K tok · $0.01"]);
});

test("a turn on another model of the same tier has the reason and no arrow", () => {
  const { container } = turn("another local model");
  expect(footers(container)).toEqual(["8.4s · qwen3:8b · the daily budget is spent · qwen3:8b · local · 12.4K tok · $0.00"]);
});

test("a turn on the chat's own model has no note", () => {
  const { container } = turn("the chat's own model");
  expect(footers(container)).toEqual(["8.4s · qwen3:27b · local · 12.4K tok · $0.00"]);
});

test("without the session's model there is no note", () => {
  const found = ROUTED_CASES[0]!;
  const { container } = render(
    <TranscriptMessages chat={{ messages: [found.message], error: null, notice: null, route: { mode: "auto", last: null, ...found.route } }} />,
  );
  expect(footers(container)[0]).toBe("8.4s · deepseek-chat · 12.4K tok · $0.01");
});

test("the model dialog's rows carry the tier tag", () => {
  const model = (tier: ListedModel["tier"]): ListedModel => ({ ref: `x/${tier}`, label: tier, provider: "x", source: "remote", status: "ready", tier });
  for (const tier of ["local", "budget", "frontier"] as const) {
    const { unmount } = render(
      <ModelRow model={model(tier)} providerMissing={false} current={false} isDefault={false} category={null} pull={undefined} failed={undefined} />,
    );
    expect(screen.getAllByText(tier).length).toBeGreaterThan(1);
    unmount();
  }
});

test("the last answer's footer ends with the stronger-model action, and a click runs it", () => {
  const found = ROUTED_CASES.find((item) => item.label === "the chat's own model")!;
  const onClick = vi.fn();
  const { container } = render(
    <TranscriptMessages
      chat={{ messages: [found.message], error: null, notice: null, route: { mode: "auto", last: null, ...found.route } }}
      session={ROUTED_SESSION}
      stronger={{ title: "Try again on deepseek-chat", onClick }}
    />,
  );
  expect(footers(container)).toEqual(["8.4s · qwen3:27b · local · 12.4K tok · $0.00 · ↑ stronger model"]);
  const action = screen.getByRole("button", { name: "↑ stronger model" });
  expect(action.getAttribute("title")).toBe("Try again on deepseek-chat");
  fireEvent.click(action);
  expect(onClick).toHaveBeenCalledOnce();
});

test("a turn that was tried again says on which model", () => {
  const found = ROUTED_CASES.find((item) => item.label === "a higher tier")!;
  const routed = Object.fromEntries(Object.entries(found.route.routed ?? {}).map(([id, pick]) => [id, { ...pick, replaces_model: "ollama/qwen3:27b" }]));
  const { container } = render(
    <TranscriptMessages chat={{ messages: [found.message], error: null, notice: null, route: { mode: "auto", last: null, ...found.route, routed } }} session={ROUTED_SESSION} />,
  );
  expect(footers(container)[0]).toContain("tried again on deepseek-chat");
});
