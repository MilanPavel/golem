import { render } from "@testing-library/react";
import { expect, test } from "vitest";
import { HuggingFaceIcon } from "./hugging-face-icon.tsx";
import { ProviderIcon } from "./provider-icons.tsx";

test("Ollama and oMLX draw a mark, not a letter", () => {
  for (const provider of ["ollama", "omlx"]) {
    const { container } = render(<ProviderIcon provider={provider} name="Name" />);
    expect(container.querySelector("path")).not.toBeNull();
    expect(container.querySelector("text")).toBeNull();
  }
});

test("the Hugging Face icon keeps its own colours and is hidden from screen readers", () => {
  const { container } = render(<HuggingFaceIcon />);
  expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  expect(container.querySelector('path.fill-hf-yellow')).not.toBeNull();
});
