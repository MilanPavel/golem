import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import type { ListedModel } from "../../../store/models.ts";
import { NO_PULLS } from "./models-sample.ts";
import { ModelTable } from "./models-table.tsx";

const model = (ref: string, label: string): ListedModel => ({ ref, label, provider: "ollama", source: "installed", status: "ready", tier: "local", price: { input: 0, output: 0 }, tools: true });

test("Ollama's table says a model is from Hugging Face for an hf.co ref and from the Ollama library for the rest", () => {
  const models = [model("ollama/hf.co/unsloth/gemma-4-12b-it-GGUF:Q4_K_M", "Gemma from HF"), model("ollama/qwen3.8:8b", "Qwen 8B")];
  render(<ModelTable label="Models on this Mac" models={models} defaultName={null} local pulls={NO_PULLS} busy={false} onStar={() => {}} />);
  const rows = screen.getAllByRole("row");
  expect(within(rows[1] as HTMLElement).getByText("Hugging Face")).toBeTruthy();
  expect(within(rows[1] as HTMLElement).queryByText("Ollama library")).toBeNull();
  expect(within(rows[2] as HTMLElement).getByText("Ollama library")).toBeTruthy();
  expect(screen.getByRole("columnheader", { name: "From" })).toBeTruthy();
});
