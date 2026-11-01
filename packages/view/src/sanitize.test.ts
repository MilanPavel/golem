import assert from "node:assert/strict";
import { test } from "node:test";

import { visibleText } from "./sanitize.ts";

test("escapes and other control characters are shown, not run", () => {
  assert.equal(visibleText("a\x1b]52;c;eA==\x07b\tc\nd\r"), "a␛]52;c;eA==�b\tc\nd�");
});
