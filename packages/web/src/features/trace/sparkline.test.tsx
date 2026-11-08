import { render } from "@testing-library/react";
import { expect, test } from "vitest";
import { Sparkline } from "./sparkline.tsx";

test("one value gives no SVG, and several give a labelled one", () => {
  expect(render(<Sparkline values={[5]} />).container.querySelector("svg")).toBeNull();
  const { getByRole } = render(<Sparkline values={[21700, 24000, 28400, 32000]} />);
  expect(getByRole("img").getAttribute("aria-label")).toBe("Input tokens per model call: 21.7K, 24.0K, 28.4K, 32.0K");
});
