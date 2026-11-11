import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { SETUP_CASES } from "../features/setup/sample.ts";
import { Gallery } from "./gallery.tsx";
import { DIALOG_RULES, expectAxeClean, resetThemeAfterEach, showTheme } from "./gallery-test-utils.ts";

resetThemeAfterEach();

// One test per state, so a failure names the state and the tests can run in parallel.
for (const theme of ["slip", "kiln"] as const) {
  for (const { label } of SETUP_CASES) {
    test(`the gallery's setup window, ${label}, in ${theme} passes axe`, async () => {
      showTheme(theme);
      const user = userEvent.setup();
      render(<Gallery />);
      await user.click(screen.getByRole("button", { name: `Setup, ${label}, ${theme}` }));
      const dialog = await screen.findByRole("dialog", { name: "Setup" });
      if (label === "Overview") expect(dialog.textContent).toContain("not kept at login");
      if (label === "Engine, guided") expect(within(dialog).getByRole("list", { name: "Setup steps" })).toBeTruthy();
      if (label === "Ollama installing") expect(dialog.textContent).toContain("==> Pouring");
      if (label === "Ollama, no Homebrew") expect(within(dialog).getByRole("link", { name: "Open ollama.com/download" })).toBeTruthy();
      if (label === "Key") expect(dialog.textContent).toContain("golem auth set anthropic");
      if (label === "Model, downloading") expect(dialog.textContent).toContain("2.1 / 6.6 GB · 12 MB/s");
      if (label === "Model, download failed") expect(dialog.textContent).toContain("no space left on device");
      if (label === "Ready") expect(dialog.textContent).toContain("Gemma 4 E4B · saved as default");
      await expectAxeClean(dialog, DIALOG_RULES);
      await user.click(within(dialog).getByRole("button", { name: "Close setup" }));
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Setup" })).toBeNull());
    });
  }
}
