import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

// A local rule, so the font-mono check can warn while the dangerouslySetInnerHTML check stays an error
// (one no-restricted-syntax setting has one severity). It matches string and template literals inside a
// JSX className and inside cn(...), the way no-restricted-syntax selectors would.
// The className of an <input>, <textarea>, <select> or <pre> (or the Input and Textarea components) is
// allowed: those hold literals you could paste.
const FONT_MONO = /\bfont-mono\b/;
const FIELDS = new Set(["input", "textarea", "select", "pre", "Input", "Textarea"]);
const noFontMono = {
  meta: { type: "suggestion", schema: [], messages: { raw: "Use <Code> for literals; labels and meta are Geist." } },
  create(context) {
    // Fields and <pre> hold literals you could paste, so they may be mono.
    const inField = (node) => {
      for (let n = node.parent; n; n = n.parent) {
        if (n.type === "JSXOpeningElement") return FIELDS.has(n.name.name);
        if (n.type === "JSXElement") return false;
      }
      return false;
    };
    const check = (node, text) => {
      if (FONT_MONO.test(text) && !inField(node)) context.report({ node, messageId: "raw" });
    };
    const literal = (node) => typeof node.value === "string" && check(node, node.value);
    const template = (node) => check(node, node.value.raw);
    return {
      "JSXAttribute[name.name='className'] Literal": literal,
      "JSXAttribute[name.name='className'] TemplateElement": template,
      "CallExpression[callee.name='cn'] Literal": literal,
      "CallExpression[callee.name='cn'] TemplateElement": template,
    };
  },
};

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
    files: ["src/**/*.{ts,tsx}"],
    plugins: { golem: { rules: { "no-font-mono": noFontMono } } },
    rules: { "golem/no-font-mono": "warn" },
  },
  {
    // The primitives for literals, the styles and the gallery may name font-mono.
    files: ["src/ui/code.tsx", "src/ui/kbd.tsx", "src/ui/copy-command.tsx", "src/styles/**", "src/gallery/**"],
    rules: { "golem/no-font-mono": "off" },
  },
  {
    // The one place that may put sanitized HTML in the page.
    files: ["src/features/chat/markdown-view.tsx"],
    rules: { "no-restricted-syntax": "off" },
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
