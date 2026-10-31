import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { GOLEM_STATE_LABEL, type GolemState } from "./golem-state.ts";
import { PixelGolem } from "./pixel-golem.tsx";
import { StatusDot } from "./status-dot.tsx";

const STATES = Object.keys(GOLEM_STATE_LABEL) as GolemState[];

test.each(STATES)("the golem in state %s has a label and an accessible name", (state) => {
  const label = GOLEM_STATE_LABEL[state];
  const { container } = render(<PixelGolem state={state} showLabel />);
  expect(screen.getByRole("img", { name: `golem · ${label}` })).toBeTruthy();
  expect(container.textContent).toBe(label);
  expect(container.querySelector("svg")?.getAttribute("data-state")).toBe(state);
});

test("the label is hidden unless asked for", () => {
  const { container } = render(<PixelGolem state="idle" />);
  expect(container.textContent).toBe("");
});

test("the figure is the 9 by 6 art, with two eyes", () => {
  const { container } = render(<PixelGolem state="idle" />);
  expect(container.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 9 6");
  expect(container.querySelectorAll("rect.eye").length).toBe(2);
});

test.each(STATES)("the status dot in state %s carries its word for screen readers", (state) => {
  render(<StatusDot state={state} />);
  expect(screen.getByText(GOLEM_STATE_LABEL[state])).toBeTruthy();
});
