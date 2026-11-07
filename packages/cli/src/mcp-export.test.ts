import assert from "node:assert/strict";
import { test } from "node:test";

import type { McpServerDetail } from "../../protocol/gen/mcp-server-detail.ts";

import { exportServers, secretVariable } from "./mcp-export.ts";

function detail(name: string, config: McpServerDetail["config"]): McpServerDetail {
  return {
    server: { name, state: "running", enabled: true, tools: [] } as unknown as McpServerDetail["server"],
    config,
    scope: "user",
    path: "/home/me/.golem/config.toml",
    secrets: [],
  };
}

const GITHUB = detail("github", {
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-github"],
  env: { GITHUB_PERSONAL_ACCESS_TOKEN: "keychain:mcp/github", GITHUB_API_URL: "https://api.github.com" },
});
const DOCS = detail("remote-docs", {
  url: "https://docs.example.test/mcp",
  headers: { Authorization: "Bearer keychain:mcp/remote-docs" },
});

test("a keychain reference becomes a variable, and its value is never printed", () => {
  const made = exportServers([GITHUB, DOCS], "claude");
  assert.deepEqual(JSON.parse(made.json), {
    mcpServers: {
      github: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${MCP_GITHUB}", GITHUB_API_URL: "https://api.github.com" },
      },
      "remote-docs": {
        type: "http",
        url: "https://docs.example.test/mcp",
        headers: { Authorization: "Bearer ${MCP_REMOTE_DOCS}" },
      },
    },
  });
  assert.doesNotMatch(made.json, /keychain:/);
  assert.equal(made.notes.length, 2);
  assert.match(made.notes[0] ?? "", /set MCP_GITHUB .* mcp\/github/);
});

test("the VS Code format uses servers, type stdio, and ${env:…}", () => {
  const made = exportServers([GITHUB], "vscode");
  assert.deepEqual(JSON.parse(made.json), {
    servers: {
      github: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${env:MCP_GITHUB}", GITHUB_API_URL: "https://api.github.com" },
      },
    },
  });
});

test("a disabled server is marked in the Claude format, and settings with no place are noted", () => {
  const off = detail("db", {
    command: "uvx",
    args: ["x"],
    enabled: false,
    approval: "allow",
    tools: { include: [], exclude: ["drop_*"] },
  });
  const made = exportServers([off], "claude");
  assert.deepEqual(JSON.parse(made.json), { mcpServers: { db: { command: "uvx", args: ["x"], disabled: true } } });
  assert.match(made.notes.join("\n"), /db: its tool filter and approval/);
  assert.doesNotMatch(exportServers([off], "vscode").json, /disabled/);
});

test("no servers is an empty table", () => {
  assert.deepEqual(JSON.parse(exportServers([], "claude").json), { mcpServers: {} });
});

test("a secret name becomes MCP_ then the name in capitals", () => {
  assert.equal(secretVariable("x"), "MCP_X");
  assert.equal(secretVariable("my-tool.v2"), "MCP_MY_TOOL_V2");
});
