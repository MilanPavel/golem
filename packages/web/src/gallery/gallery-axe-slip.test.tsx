import { sectionAxeTests } from "./gallery-axe-sections.tsx";
import { resetThemeAfterEach } from "./gallery-test-utils.ts";

resetThemeAfterEach();
sectionAxeTests("slip");
