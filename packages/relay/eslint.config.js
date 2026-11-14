import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**"] },
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    ignores: ["src/**/*.test.ts", "src/bun/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["node:*", "bun", "bun:*"],
              message: "The relay core uses web-standard APIs only. Put Bun and Node code in the adapter.",
            },
          ],
        },
      ],
    },
  },
);
