import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { ROUTING_CASES } from "../features/settings/routing-sample.ts";
import { Gallery } from "./gallery.tsx";
import { DIALOG_RULES, expectAxeClean, resetThemeAfterEach, showTheme } from "./gallery-test-utils.ts";

resetThemeAfterEach();

// One test per state and theme: axe is slow in jsdom, and a loop in one test outgrows the timeout on CI.
for (const theme of ["slip", "kiln"] as const) {
  for (const { label, errors } of ROUTING_CASES) {
    test(`the gallery's Routing page shows "${label}" in ${theme}, and passes axe`, async () => {
      showTheme(theme);
      render(<Gallery />);
      const region = screen.getByRole("region", { name: `Routing, ${label}` });
      const group = within(region);
      expect(group.getByRole("region", { name: "Right now" })).toBeTruthy();
      expect(group.getByRole("group", { name: "Default route" })).toBeTruthy();
      if (label === "Pinned") expect(group.getByText(/the steps are not used/)).toBeTruthy();
      if (label === "Local only") expect(group.getByRole("button", { name: /^Paid gate: closed · local only/ })).toBeTruthy();
      if (label === "Paid never") expect(group.getByRole("button", { name: /^Paid gate: closed\./ })).toBeTruthy();
      if (label === "Auto with no frontier model") expect(group.getAllByText(/the path ends at Budget/).length).toBe(2);
      if (Object.keys(errors).length > 0) expect(group.getAllByRole("alert").length).toBeGreaterThan(0);
      await expectAxeClean(region, DIALOG_RULES);
    });
  }
}
