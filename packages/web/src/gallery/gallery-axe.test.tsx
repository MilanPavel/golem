import { sectionAxeTests } from "./gallery-axe-sections.tsx";
import { resetThemeAfterEach } from "./gallery-test-utils.ts";

resetThemeAfterEach();
// Every section in slip. The two themes differ only in `data-theme` and the `kiln-` id prefix, and axe runs
// without color-contrast here (tokens.test.ts checks the colors of both), so kiln is checked on one section.
sectionAxeTests("slip");
sectionAxeTests("kiln", ["card"]);
