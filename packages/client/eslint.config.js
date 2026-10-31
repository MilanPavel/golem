import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**"] },
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    ignores: ["src/node.ts", "src/unix-link.ts", "src/socket-path.ts", "src/link-contract.ts", "src/ws-test-server.ts", "src/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["node:*"],
              message: "The browser-safe client core cannot use Node. Put Node code behind src/node.ts.",
            },
          ],
        },
      ],
    },
  },
);
