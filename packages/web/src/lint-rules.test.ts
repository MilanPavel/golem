// @vitest-environment node
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { expect, test } from "vitest";

const cwd = fileURLToPath(new URL("..", import.meta.url));
const eslint = new ESLint({ cwd });

async function messages(code: string, filePath: string) {
  const [result] = await eslint.lintText(code, { filePath: `${cwd}${filePath}` });
  return result?.messages ?? [];
}

test("ui may not import from features", async () => {
  const found = await messages(
    'import { x } from "../features/chat/x";\nexport const y = x;\n',
    "src/ui/button.ts",
  );
  expect(found.map((m) => m.ruleId)).toContain("no-restricted-imports");
});

test("ui may not import from store", async () => {
  const found = await messages(
    'import { x } from "../store/live";\nexport const y = x;\n',
    "src/ui/button.ts",
  );
  expect(found.map((m) => m.ruleId)).toContain("no-restricted-imports");
});

test("features may not import @golem/client", async () => {
  const found = await messages(
    'import { x } from "@golem/client";\nexport const y = x;\n',
    "src/features/chat/send.ts",
  );
  expect(found.map((m) => m.ruleId)).toContain("no-restricted-imports");
});

test("dangerouslySetInnerHTML is refused", async () => {
  const found = await messages(
    "export const A = () => <div dangerouslySetInnerHTML={{ __html: 'x' }} />;\n",
    "src/features/chat/a.tsx",
  );
  expect(found.map((m) => m.ruleId)).toContain("no-restricted-syntax");
});

test("a clean file under ui has no errors", async () => {
  const found = await messages("export const y = 1;\n", "src/ui/clean.ts");
  expect(found).toEqual([]);
});
