import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ContextChipView } from "./context-chip.tsx";

test("an exact window shows the plain percent", () => {
  render(<ContextChipView used={32000} window={128000} onOpen={() => {}} />);
  const chip = screen.getByRole("button");
  expect(chip.textContent).toBe("ctx 25%");
  expect(chip.getAttribute("title")).not.toContain("not sent");
});

test("an estimated window shows ≈ and says why on hover", () => {
  const onOpen = vi.fn();
  render(<ContextChipView used={1300} window={16384} windowEstimated onOpen={onOpen} />);
  const chip = screen.getByRole("button");
  expect(chip.textContent).toBe("ctx ≈7%");
  expect(chip.getAttribute("title")).toContain("golem read this window from Ollama. It was not sent.");
  fireEvent.click(chip);
  expect(onOpen).toHaveBeenCalled();
});

test("an unknown window shows the tokens only", () => {
  render(<ContextChipView used={1300} window={null} onOpen={() => {}} />);
  expect(screen.getByRole("button").textContent).toBe("ctx 1.3K");
});
