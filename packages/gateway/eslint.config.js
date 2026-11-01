import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**"] },
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    ignores: ["src/**/*.test.ts", "src/token-file.ts", "src/run-file.ts", "src/node.ts", "src/bun/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["node:*", "bun", "bun:*"],
              message: "The gateway core cannot use Node or Bun. Put that code in the adapter.",
            },
          ],
        },
      ],
    },
  },
);
