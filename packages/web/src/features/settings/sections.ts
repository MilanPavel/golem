export type SettingsSection = { id: string; title: string };

/** The sections, in the order of the list. A new section adds an entry here and a case in the screen. */
export const SECTIONS: readonly SettingsSection[] = [
  { id: "setup", title: "Setup" },
  { id: "mcp", title: "MCP servers" },
  { id: "skills", title: "Skills" },
  { id: "keys", title: "API keys" },
  { id: "routing", title: "Routing" },
  { id: "usage", title: "Usage" },
  { id: "rules", title: "Tool rules" },
  { id: "config", title: "Config file" },
  { id: "appearance", title: "Appearance" },
];
