import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**"] },
  ...tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message:
            "HTML enters the page only through the sanitizer. Do not use dangerouslySetInnerHTML.",
        },
      ],
    },
  },
  {
    files: ["src/ui/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/features", "**/features/**", "**/store", "**/store/**", "**/gallery", "**/gallery/**"],
              message: "ui must not depend on features, store, or gallery.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/features/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@golem/client", "@golem/client/**"],
              message: "features read and act through store, not through @golem/client.",
            },
          ],
        },
      ],
    },
  },
);
