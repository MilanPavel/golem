import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { Code } from "./code.tsx";

test("Code renders a <code> in mono at the code size", () => {
  render(<Code>golem install</Code>);
  const node = screen.getByText("golem install");
  expect(node.tagName).toBe("CODE");
  expect(node.className).toContain("font-mono");
  expect(node.className).toContain("text-code");
  expect(node.className).toContain("text-ink");
});

test("Code takes a muted tone", () => {
  render(<Code tone="muted">~/.golem</Code>);
  expect(screen.getByText("~/.golem").className).toContain("text-muted");
});
