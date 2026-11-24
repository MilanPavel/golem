import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { SizeRows } from "./get-models-split.tsx";
import { hfSizeItems, sizeWords } from "./hf-sizes.ts";
import { HF_FILES, HF_FILES_SAME_NAMES } from "./models-sample.ts";

const size = (quant: string, sizeGb: number, recommended = false) => ({ quant, sizeGb, recommended });
const titles = (sizes: ReturnType<typeof size>[]) => sizeWords(sizes).map((words) => words.title);

test("sizes with different plain names keep them", () => {
  expect(titles([size("Q3_K_M", 13), size("Q4_K_M", 17, true), size("Q6_K", 22), size("Q8_0", 49), size("F16", 94)])).toEqual(["Small", "Balanced", "Large", "Largest", "F16"]);
});

test("only the bigger of two sizes keeps Largest, whichever comes first", () => {
  expect(titles([size("Q8", 28), size("Q8_0_V2", 29)])).toEqual(["Q8", "Largest"]);
  expect(titles([size("Q8_0_V2", 29), size("Q8", 28)])).toEqual(["Largest", "Q8"]);
});

test("only the smaller of two sizes keeps Smallest", () => {
  expect(titles([size("Q2_K", 9), size("Q2_K_S", 8)])).toEqual(["Q2_K", "Smallest"]);
});

test("the recommended size keeps its plain name, then a _M size, then the shortest code, then the first", () => {
  expect(titles([size("Q4_K_M", 17), size("Q4_K_S", 16, true)])).toEqual(["Q4_K_M", "Balanced"]);
  expect(titles([size("Q4_K_S", 16), size("Q4_K_M", 17)])).toEqual(["Q4_K_S", "Balanced"]);
  expect(titles([size("Q4_K_S", 16), size("Q4_0", 15)])).toEqual(["Q4_K_S", "Balanced"]);
  expect(titles([size("Q5_K_S", 5), size("Q5_K_L", 5)])).toEqual(["Larger", "Q5_K_L"]);
});

test("a demoted size shows its code as the title, with the line about what it means, and no second code", () => {
  const words = sizeWords([size("Q8", 28), size("Q8_0_V2", 29)]);
  expect(words[0]).toEqual({ title: "Q8", note: "As good as the original." });
  expect(words[1]?.title).toBe("Largest");
});

test("no plain name is used twice in one repo", () => {
  const quants = ["Q2_K", "Q2_K_S", "Q3_K_S", "Q3_K_M", "Q3_K_L", "Q4_0", "Q4_1", "Q4_K_S", "Q4_K_M", "Q5_K_S", "Q5_K_M", "Q6_K", "Q8_0", "Q8_0_V2", "F16", "BF16"];
  const result = titles(quants.map((quant, index) => size(quant, index + 1)));
  expect(new Set(result).size).toBe(result.length);
});

test("a repo's rows read Largest once, and the other size reads by its code", () => {
  const items = hfSizeItems(HF_FILES_SAME_NAMES.repo, HF_FILES_SAME_NAMES, null);
  expect(items.map((item) => item.title)).toEqual(["Q4_K_S", "Balanced", "Q8", "Largest"]);
  expect(items.find((item) => item.title === "Largest")?.name).toBe("Q8_0_V2");
});

test("a size row is one row: the name, the size, the memory bar and the button side by side, and a note under it", () => {
  const items = hfSizeItems(HF_FILES.repo, HF_FILES, null).map((item, index) => (index === 1 ? { ...item, problem: "Hugging Face is missing a file for this size, so the download can't finish right now." } : item));
  render(<SizeRows label="Sizes" intro="Pick." items={items} ramGb={64} pulls={{ active: new Map(), failed: new Map([[items[0]?.ref ?? "", "no space left"]]) }} pull={() => Promise.resolve(true)} onStop={() => undefined} />);
  const rows = within(screen.getByRole("group", { name: "Sizes" })).getAllByRole("listitem");
  for (const row of rows) {
    const line = row.firstElementChild as HTMLElement;
    // Nothing wraps, so the button cannot drop under the description.
    expect(line.className).not.toContain("flex-wrap");
    expect(within(line).getByRole("button", { name: /^Download / }).closest("div")).toBe(line);
    // Every cell but the words holds its width, and the words are the ones that shrink.
    expect(line.firstElementChild?.className).toContain("min-w-0");
    expect(Array.from(line.children).slice(1).every((cell) => cell.className.includes("shrink-0"))).toBe(true);
  }
  // The notes sit under the row, outside the line.
  expect(within(rows[0] as HTMLElement).getByText("Download failed: no space left").parentElement).toBe(rows[0]);
  expect(within(rows[1] as HTMLElement).getByText(/missing a file/).parentElement).toBe(rows[1]);
});
