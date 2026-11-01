import assert from "node:assert/strict";
import { test } from "node:test";

import {
  alertLabel,
  fitSegments,
  formatMessageCount,
  formatUptime,
  modelChip,
  preferModel,
  sessionTitleLabel,
  shortCwd,
  shownSessionTitle,
  startedAtMs,
  statusLabel,
  statusSegments,
  uptimeRefreshMs,
  versionLabel,
} from "./status-label.ts";

test("the alert names a model server that is down before any MCP server", () => {
  assert.equal(alertLabel(null, ""), "");
  assert.equal(alertLabel("ollama", ""), "ollama ✗");
  assert.equal(alertLabel(null, "mcp ✗ github"), "mcp ✗ github");
  assert.equal(alertLabel("ollama", "mcp ✗ github"), "ollama ✗  mcp ✗ github");
});

test("status bar text follows the connection", () => {
  assert.equal(statusLabel({ status: "connecting" }), "connecting");
  assert.equal(statusLabel({ status: "connected" }), "connected");
  assert.equal(
    statusLabel({ status: "reconnecting", attempt: 2, delayMs: 400 }),
    "reconnecting",
  );
  assert.equal(statusLabel({ status: "closed", reason: "closed" }), "closed");
  assert.equal(
    statusLabel({ status: "rejected", reason: "protocol major mismatch: client 1, daemon 9" }),
    "protocol major mismatch: client 1, daemon 9",
  );
});

test("the model chip prefers a name and profile, then either one", () => {
  assert.equal(modelChip("qwen3.5:4b", "remote"), "qwen3.5:4b · remote");
  assert.equal(modelChip(null, "remote"), "remote");
  assert.equal(modelChip("qwen3:8b", "ollama/qwen3:8b"), "qwen3:8b");
  assert.equal(modelChip(null, "ollama/qwen3:8b"), "ollama/qwen3:8b");
  assert.equal(modelChip("qwen3.5:4b", null), "qwen3.5:4b");
  assert.equal(modelChip(null, null), "");
});

test("a session model wins, and a missing name falls back to the daemon", () => {
  const daemon = { profile: "remote", provider: "openai_compat", name: "qwen3.5:4b" };
  assert.deepEqual(preferModel(null, daemon), daemon);
  assert.deepEqual(
    preferModel({ profile: "local", provider: null, name: null }, daemon),
    { profile: "local", provider: "openai_compat", name: "qwen3.5:4b" },
  );
});

test("the working directory is shortened against home", () => {
  assert.equal(shortCwd("/Users/milan.pavel/repos/golem", "/Users/milan.pavel"), "~/repos/golem");
  assert.equal(shortCwd("/tmp", "/Users/milan.pavel"), "/tmp");
});

test("a matching daemon version is one number, and a mismatch is a yellow notice", () => {
  assert.deepEqual(versionLabel("0.0.0", "0.0.0"), { text: "0.0.0", warn: false });
  assert.deepEqual(versionLabel("0.0.0", ""), { text: "0.0.0", warn: false });
  assert.deepEqual(versionLabel("0.0.0", "0.1.0"), {
    text: "tui 0.0.0 · daemon 0.1.0 · run golem daemon restart",
    warn: true,
  });
});

test("the session title falls back to untitled", () => {
  assert.equal(sessionTitleLabel(null), "untitled");
  assert.equal(sessionTitleLabel("  "), "untitled");
  assert.equal(sessionTitleLabel("Trip"), "Trip");
  assert.equal(shownSessionTitle(null, null, "Trip"), "untitled");
  assert.equal(shownSessionTitle("s", null, "Trip"), "Trip");
  assert.equal(shownSessionTitle("s", { sessionId: "other", title: "Other" }, "Trip"), "Trip");
  assert.equal(shownSessionTitle("s", { sessionId: "s", title: "Renamed" }, "Trip"), "Renamed");
});

test("message count and daemon uptime format for the status line", () => {
  assert.equal(formatMessageCount(0), "0 msgs");
  assert.equal(formatMessageCount(1), "1 msg");
  assert.equal(formatMessageCount(4), "4 msgs");
  assert.equal(formatUptime(0), "up 0s");
  assert.equal(formatUptime(59.9), "up 59s");
  assert.equal(formatUptime(60), "up 1m");
  assert.equal(formatUptime(180), "up 3m");
  assert.equal(formatUptime(3_600), "up 1h");
  assert.equal(formatUptime(3_660), "up 1h 1m");
  assert.equal(formatUptime(86_400), "up 1d");
  assert.equal(formatUptime(90_000), "up 1d 1h");
  assert.equal(formatUptime(Number.NaN), "");
  assert.equal(startedAtMs(10_000, 2.5), 7_500);
  assert.equal(startedAtMs(10_000, -1), null);
  assert.equal(uptimeRefreshMs(12), 1_000);
  assert.equal(uptimeRefreshMs(60), 60_000);
  assert.equal(uptimeRefreshMs(null), null);
});

test("narrowing drops uptime, then the message count, then the folder", () => {
  const segments = statusSegments({
    connection: "connected",
    title: "Trip",
    model: "qwen · remote",
    folder: "~/repos/golem",
    messageCount: 4,
    uptimeSeconds: 180,
  });
  const ids = (columns: number) => fitSegments(segments, columns).map((segment) => segment.id);

  assert.deepEqual(ids(60), ["connection", "title", "model", "folder", "messages", "uptime"]);
  assert.deepEqual(ids(53), ["connection", "title", "model", "folder", "messages"]);
  assert.deepEqual(ids(45), ["connection", "title", "model", "folder"]);
  assert.deepEqual(ids(30), ["connection", "title", "model"]);
  assert.deepEqual(ids(15), ["connection", "title"]);
  assert.deepEqual(ids(9), ["connection"]);
  assert.equal(fitSegments(segments, 4)[0]?.text, "conn");
  assert.deepEqual(ids(0), []);
});

test("a long title shrinks instead of leaving the line", () => {
  const fitted = fitSegments(
    statusSegments({
      connection: "connected",
      title: "x".repeat(60),
      model: "",
      folder: "",
      messageCount: null,
      uptimeSeconds: null,
    }),
    20,
  );
  assert.deepEqual(
    fitted.map((segment) => segment.id),
    ["connection", "title"],
  );
  assert.equal(fitted[1]?.text, `${"x".repeat(8)}\u2026`);
  assert.deepEqual(
    fitSegments(
      statusSegments({
        connection: "connected",
        title: "Trip",
        model: "",
        folder: "",
        messageCount: null,
        uptimeSeconds: null,
      }),
      10,
    ).map((segment) => segment.id),
    ["connection"],
  );
});

test("new lines sit on the status line and leave after the folder", () => {
  const segments = statusSegments({
    connection: "connected",
    title: "Trip",
    model: "qwen",
    folder: "~/repos/golem",
    messageCount: 4,
    uptimeSeconds: 180,
    freshLines: 3,
  });
  assert.equal(segments.find((segment) => segment.id === "fresh")?.text, "\u2193 3 new lines");
  const ids = (columns: number) => fitSegments(segments, columns).map((segment) => segment.id);
  assert.equal(ids(80).includes("fresh"), true);
  assert.equal(ids(80).includes("uptime"), true);
  assert.equal(ids(60).includes("uptime"), false);
  assert.equal(ids(60).includes("fresh"), true);
  assert.equal(ids(30).includes("fresh"), false);
  assert.equal(ids(30).includes("model"), true);
});

test("an empty model or a missing uptime leaves no gap", () => {
  const fitted = fitSegments(
    statusSegments({
      connection: "connected",
      title: "untitled",
      model: "",
      folder: "",
      messageCount: null,
      uptimeSeconds: null,
    }),
    40,
  );
  assert.deepEqual(
    fitted.map((segment) => segment.text),
    ["connected", "untitled"],
  );
});

test("an alert sits after the connection and is the last to leave", () => {
  const segments = statusSegments({
    connection: "connected",
    title: "Trip",
    model: "qwen",
    folder: "~/repos/golem",
    messageCount: null,
    uptimeSeconds: null,
    alert: "mcp ✗ git",
  });
  const ids = (columns: number) => fitSegments(segments, columns).map((segment) => segment.id);
  assert.deepEqual(ids(80), ["connection", "alert", "title", "model", "folder"]);
  assert.deepEqual(ids(22), ["connection", "alert"]);
  assert.equal(segments.find((segment) => segment.id === "alert")?.tone, "alert");
});

test("pinned skills show after the model, and leave the line before new lines and the model", () => {
  const segments = statusSegments({
    connection: "connected",
    title: "Trip",
    model: "qwen",
    folder: "~/repos/golem",
    messageCount: null,
    uptimeSeconds: null,
    skills: ["ship", "setup"],
  });
  const ids = (columns: number) => fitSegments(segments, columns).map((segment) => segment.id);
  assert.equal(segments.find((segment) => segment.id === "skills")?.text, "skills: ship, setup");
  assert.deepEqual(ids(80), ["connection", "title", "model", "skills", "folder"]);
  assert.deepEqual(ids(50), ["connection", "title", "model", "skills"]);
  assert.deepEqual(ids(30), ["connection", "title", "model"]);
  assert.equal(
    statusSegments({ connection: "c", title: "t", model: "m", folder: "", messageCount: null, uptimeSeconds: null })
      .find((segment) => segment.id === "skills")?.text,
    "",
  );
});
