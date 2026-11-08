import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { expect, test } from "vitest";
import type { TraceSpanResult } from "../../store/trace.ts";
import { APPROVAL_DETAIL, FULL_DETAIL, MODEL_DETAIL, NO_PROMPT_DETAIL, NUM_CTX_DETAIL, OLD_DETAIL, SECTIONS_DETAIL, TOOL_DETAIL, UNKNOWN_WINDOW_DETAIL } from "./sample.ts";
import { SpanDetail } from "./span-detail.tsx";
import { copyText, jsonOf, modelLine, promptSections, sectionLabel, tabsOf, toolGroups } from "./span-text.ts";

function show(result: TraceSpanResult) {
  const user = userEvent.setup();
  const view = render(<SpanDetail result={result} sessionId="s_1" />);
  return { user, ...view };
}

const tab = (name: string) => screen.getByRole("tab", { name });

test("a model call shows its header, with the model, time, first token, and tokens", () => {
  show(MODEL_DETAIL);
  expect(screen.getByRole("heading", { name: /model 2/ })).toBeTruthy();
  expect(document.body.textContent).toContain("ollama/qwen3-coder:30b · 0m 01.9s · first token 0m 00.120s · 3.4K → 210");
  expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Context", "Reply", "Metadata"]);
});

test("Context has the system prompt row, the tools row, the messages, and the divider at new_from", async () => {
  const { user } = show(MODEL_DETAIL);
  const prompt = screen.getByText("System prompt · ≈16 tokens");
  expect(screen.getByText(/System prompt ·/).closest("details")?.open).toBe(false);
  await user.click(prompt);
  expect(screen.getByText(/You are golem, a coding agent/)).toBeTruthy();
  await user.click(screen.getByText("Tools · 2 · ≈92 tokens"));
  await user.click(screen.getByText("read_file · ≈48", { selector: "summary" }));
  expect(document.body.textContent).toContain('"description": "Read a file."');

  const messages = within(screen.getByRole("list", { name: "Messages" }));
  const rows = messages.getAllByRole("listitem");
  // you, the divider, golem, and the tool result.
  expect(rows.map((row) => row.textContent?.slice(0, 3))).toEqual(["you", "new", "gol", "rea"]);
  expect(rows[0]?.textContent).toContain("≈8");
  expect(rows[3]?.textContent).toContain("≈3.3K");
  expect(rows[3]?.querySelector("span[aria-hidden='true'][style]")).toBeTruthy();
  expect(rows[1]?.textContent).toBe("new since the last call");
  expect(messages.getByText("→ read_file(path=\"notes.txt\")")).toBeTruthy();
  expect(messages.getByText("notes.txt", { selector: "strong" })).toBeTruthy();
});

test("a tool result folds after 20 lines, and Show all opens it", async () => {
  const { user } = show(MODEL_DETAIL);
  const messages = within(screen.getByRole("list", { name: "Messages" }));
  expect(messages.queryByText(/line 30:/)).toBeNull();
  expect(messages.getByText(/line 20:/)).toBeTruthy();
  await user.click(messages.getByRole("button", { name: "Show all 30 lines" }));
  expect(messages.getByText(/line 30:/)).toBeTruthy();
});

test("the first call has no divider, and the Reply tab shows the reply", async () => {
  const { user } = show({ ...MODEL_DETAIL, new_from: 0 });
  expect(screen.queryByText("new since the last call")).toBeNull();
  await user.click(tab("Reply"));
  expect(within(screen.getByRole("list", { name: "Reply" })).getByText("42", { selector: "strong" })).toBeTruthy();
});

test("Metadata lists every field, with the provider and why the call stopped", async () => {
  const { user } = show(MODEL_DETAIL);
  await user.click(tab("Metadata"));
  const text = document.body.textContent ?? "";
  for (const label of ["id", "duration_ms", "first_token_ms", "tokens.input", "tokens.cache_read", "stop_reason", "provider", "recorded"]) {
    expect(text, label).toContain(label);
  }
  expect(text).toContain("end_turn");
  expect(text).toContain("ollama");
});

test("a tool shows its args and its result, and has no Approval tab without an approval", async () => {
  const { user } = show(TOOL_DETAIL);
  expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Args", "Result"]);
  expect(document.body.textContent).toContain("notes.txt");
  await user.click(tab("Result"));
  expect(document.body.textContent).toContain("head of the output");
  expect(screen.getByRole("heading", { name: /read_file/ }).textContent).toContain("✓");
});

test("a call that had an approval has the tab, with the decision, the rule, and the edited args", async () => {
  const { user } = show(APPROVAL_DETAIL);
  expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Args", "Result", "Approval"]);
  await user.click(tab("Approval"));
  const text = document.body.textContent ?? "";
  expect(text).toContain("allow");
  expect(text).toContain("built-in default");
  expect(text).toContain("waited0m 12.0s");
  expect(text).toContain('"new_string": "edited"');
});

test("Pretty and JSON switch, and JSON shows the raw part of the result for that tab", async () => {
  const { user } = show(TOOL_DETAIL);
  const format = () => within(screen.getByRole("group", { name: "Format" }));
  expect(format().getByRole("button", { name: "Pretty" }).getAttribute("aria-pressed")).toBe("true");
  await user.click(format().getByRole("button", { name: "JSON" }));
  expect(format().getByRole("button", { name: "JSON" }).getAttribute("aria-pressed")).toBe("true");
  expect(document.body.textContent).toContain('"offset": 0');
  await user.click(tab("Result"));
  // The choice holds across tabs, and Result's raw part has the artifact.
  expect(document.body.textContent).toContain('"artifact_id": "a_9f3c"');
  await user.click(format().getByRole("button", { name: "Pretty" }));
  expect(document.body.textContent).not.toContain('"artifact_id"');
});

test("Copy puts what the tab shows on the clipboard, and says Copied", async () => {
  const { user } = show(TOOL_DETAIL);
  await user.click(screen.getByRole("button", { name: "Copy" }));
  expect(await navigator.clipboard.readText()).toBe("path: notes.txt\noffset: 0");
  expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "JSON" }));
  await user.click(screen.getByRole("button", { name: "Copied" }));
  expect(JSON.parse(await navigator.clipboard.readText())).toEqual({ path: "notes.txt", offset: 0 });
});

test("a model call from before traces says not recorded where the data is missing", async () => {
  const { user } = show(OLD_DETAIL);
  expect(screen.getByText("Not recorded. This session ran before golem kept traces.")).toBeTruthy();
  expect(screen.queryByText(/System prompt/)).toBeNull();
  expect(screen.queryByText(/^Tools/)).toBeNull();
  await user.click(tab("Metadata"));
  expect(screen.getByText("Not recorded. This session ran before golem kept traces.")).toBeTruthy();
});

test("hostile text in a message is cleaned like the transcript's", () => {
  const hostile: TraceSpanResult = {
    ...MODEL_DETAIL,
    messages: [{ id: "u", role: "user", text: 'hi <img src=x onerror="alert(1)"> <script>alert(2)</script> [a](javascript:alert(3))' }],
    new_from: 0,
  };
  const { container } = show(hostile);
  expect(container.querySelector("img, script")).toBeNull();
  for (const el of container.querySelectorAll("*")) {
    expect(el.getAttributeNames().some((a) => a.startsWith("on"))).toBe(false);
    expect(el.getAttribute("href") ?? "").not.toMatch(/^javascript:/i);
  }
  expect(container.textContent).toContain("hi");
});

test("a run has no tabs, and says so", () => {
  const run: TraceSpanResult = { span: { id: "r", kind: "run", name: "go", start: "t", status: "ok", duration_ms: 1200 } };
  show(run);
  expect(screen.queryByRole("tablist")).toBeNull();
  expect(screen.getByText(/A run has no input or output of its own/)).toBeTruthy();
});

test("the text helpers: tabs, raw parts, copy, and the model line", () => {
  expect(tabsOf(MODEL_DETAIL)).toEqual(["context", "reply", "metadata"]);
  expect(tabsOf(APPROVAL_DETAIL)).toEqual(["args", "result", "approval"]);
  expect(jsonOf(OLD_DETAIL, "context")).toMatchObject({ system_prompt: null, tools: null, new_from: 0 });
  expect(copyText(MODEL_DETAIL, "context", "pretty")).toContain("--- new since the last call ---");
  expect(copyText(MODEL_DETAIL, "reply", "pretty")).toBe("golem: It says **42**.");
  const cached = { ...MODEL_DETAIL, span: { ...MODEL_DETAIL.span, tokens: { input: 1000, output: 5, cache_read: 800, cache_write: 200 } } };
  expect(modelLine(cached)).toContain("cache read 800 · cache write 200");
});

for (const [name, result] of [["a model call", MODEL_DETAIL], ["a full call", FULL_DETAIL], ["an unknown window", UNKNOWN_WINDOW_DETAIL], ["a tool with an artifact", TOOL_DETAIL], ["an old call", OLD_DETAIL]] as const) {
  test(`${name} has no accessibility violations`, async () => {
    const { container } = show(result);
    const results = await axe.run(container, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
}

test("a recorded call with no system prompt says why, and not Not recorded", () => {
  show(NO_PROMPT_DETAIL);
  expect(screen.getByText("No system prompt was sent on this call. golem sends one only when a skill is pinned.")).toBeTruthy();
  expect(document.body.textContent).not.toContain("Not recorded");
});

test("a prompt in two sections opens to two folds, each with Copy", async () => {
  const { user } = show(SECTIONS_DETAIL);
  await user.click(screen.getByText(/^System prompt ·/));
  expect(screen.getByText("Pinned skills · ≈1.1K", { selector: "summary" })).toBeTruthy();
  expect(screen.getByText("Section 2 · ≈50", { selector: "summary" })).toBeTruthy();
  await user.click(screen.getByText(/^Pinned skills/));
  expect(document.body.textContent).toContain("review: read the diff first ✅");
  const block = screen.getByText(/review: read the diff first/, { selector: "pre" });
  expect(block.textContent).not.toContain("Rules:");
  await user.click(screen.getByRole("button", { name: "Copy Pinned skills" }));
  expect(await navigator.clipboard.readText()).toBe("## Pinned skills\n\nreview: read the diff first ✅");
});

test("promptSections splits by code points and refuses a wrong total", () => {
  expect(promptSections("a ✅\n\nb", [{ name: "x", chars: 3 }, { name: "y", chars: 1 }])).toEqual([
    { name: "x", text: "a ✅" },
    { name: "y", text: "b" },
  ]);
  expect(promptSections("ab\n\ncd", [{ name: "x", chars: 2 }, { name: "y", chars: 2 }])).toEqual([
    { name: "x", text: "ab" },
    { name: "y", text: "cd" },
  ]);
  expect(promptSections("a ✅\n\nb", [{ name: "x", chars: 4 }, { name: "y", chars: 1 }])).toBeNull();
  expect(promptSections("ab", null)).toBeNull();
  expect(promptSections("ab", [])).toBeNull();
});

test("sectionLabel", () => {
  expect(sectionLabel("pinned_skills")).toBe("Pinned skills");
  expect(sectionLabel("section_2")).toBe("Section 2");
});

const legend = () => within(screen.getByRole("list", { name: "What fills the context" }));

test("a model call shows the context meter above the tabs, with the legend and Free", () => {
  show(MODEL_DETAIL);
  const section = screen.getByRole("region", { name: "Context window" });
  expect(section.textContent).toContain("Context · 3.4K / 32K · 10%");
  expect(legend().getAllByRole("listitem").map((row) => row.textContent)).toEqual([
    "System prompt16",
    "Tool definitions · 2 tools92",
    "Your messages8",
    "Replies30",
    "Tool results3.3K",
    "Free29.4K",
  ]);
  expect(section.compareDocumentPosition(screen.getByRole("tablist")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("a nearly full call warns in deny, and an Ollama call over num_ctx says so", () => {
  const full = show(FULL_DETAIL);
  expect(screen.getByText("Context is 96% full.").className).toContain("text-deny");
  full.unmount();
  show(NUM_CTX_DETAIL);
  expect(screen.getByText("Input is larger than num_ctx 8K. Ollama dropped the oldest part.")).toBeTruthy();
});

test("an unknown window shows the split without Free, and the hint for the provider", () => {
  const first = show(UNKNOWN_WINDOW_DETAIL);
  expect(screen.getByRole("region", { name: "Context window" }).textContent).toContain("Context · 3.4K · window unknown");
  expect(legend().getAllByRole("listitem")).toHaveLength(5);
  expect(legend().queryByText("Free")).toBeNull();
  expect(screen.getByText(/golem sent no num_ctx, so Ollama used its own default window/)).toBeTruthy();
  first.unmount();
  show({ ...UNKNOWN_WINDOW_DETAIL, provider: "openai" });
  expect(screen.getByText("golem does not know this model's window.")).toBeTruthy();
});

test("the Tools fold shows the cost, grouped by server and largest first", async () => {
  const { user } = show(FULL_DETAIL);
  await user.click(screen.getByText("Tools · 7 · ≈22.8K tokens"));
  const fold = screen.getByText("Tools · 7 · ≈22.8K tokens").closest("details");
  const titles = [...(fold?.querySelectorAll(":scope > div > div > details > summary") ?? [])].map((summary) => summary.textContent);
  expect(titles).toEqual(["github · 3 tools · ≈20.0K", "fs · 2 tools · ≈2.2K", "built-in · 2 tools · ≈600"]);
  await user.click(screen.getByText("github · 3 tools · ≈20.0K"));
  const github = screen.getByText("github · 3 tools · ≈20.0K").closest("details");
  const inner = [...(github?.querySelectorAll("details > summary") ?? [])].slice(1).map((s) => s.textContent);
  expect(inner[0]).toBe("create_issue · ≈9.0K");
});

test("a tool span and an old call have no meter, and the Context JSON carries the context", async () => {
  const tool = show(TOOL_DETAIL);
  expect(screen.queryByRole("region", { name: "Context window" })).toBeNull();
  tool.unmount();
  show(OLD_DETAIL);
  expect(screen.queryByRole("region", { name: "Context window" })).toBeNull();
  expect(jsonOf(MODEL_DETAIL, "context")).toMatchObject({ context: { used: 3400 } });
});

test("toolGroups puts a schema with no item under built-in with no tokens", () => {
  const groups = toolGroups([{ name: "mystery" }], []);
  expect(groups).toEqual([{ group: null, label: "built-in", tokens: null, tools: [{ name: "mystery", label: "mystery", tokens: null, schema: { name: "mystery" } }] }]);
});
