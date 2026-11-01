import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**"] },
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    ignores: ["src/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["node:*"],
              message: "The view package runs in a browser. It cannot use Node.",
            },
            {
              group: ["ink", "ink/*", "react", "react/*", "react-dom", "react-dom/*"],
              message: "The view package has no UI framework. Rendering belongs to the TUI and the web app.",
            },
            {
              group: ["@golem/tui", "@golem/tui/*", "**/packages/tui/**", "**/tui/src/**"],
              message: "The view package cannot depend on the TUI.",
            },
          ],
        },
      ],
    },
  },
);
