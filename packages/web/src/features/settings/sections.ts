import type { ComponentType, SVGProps } from "react";
import {
  SettingsAgentsIcon,
  SettingsAppearanceIcon,
  SettingsConfigIcon,
  SettingsContextIcon,
  SettingsInfoIcon,
  SettingsKeysIcon,
  SettingsMcpIcon,
  SettingsMemoryIcon,
  SettingsNotificationsIcon,
  SettingsRoutingIcon,
  SettingsRulesIcon,
  SettingsSkillsIcon,
  SettingsUsageIcon,
} from "../../ui/icons.tsx";

export type SettingsGroupId = "general" | "models" | "abilities" | "permissions" | "advanced";
export type SettingsGroup = { id: SettingsGroupId; title: string };
export type SettingsSection = {
  id: string;
  title: string;
  group: SettingsGroupId;
  /** One line under the title. */
  description: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
};

/** The groups, in the order of the sidebar. */
export const GROUPS: readonly SettingsGroup[] = [
  { id: "general", title: "General" },
  { id: "models", title: "Models" },
  { id: "abilities", title: "Abilities" },
  { id: "permissions", title: "Permissions" },
  { id: "advanced", title: "Advanced" },
];

/** The sections, grouped, in the order of the sidebar. A new section adds an entry here and a case in the screen. */
export const SECTIONS: readonly SettingsSection[] = [
  { id: "info", title: "Info", group: "general", icon: SettingsInfoIcon, description: "What is installed, where it lives, and whether it is healthy." },
  { id: "appearance", title: "Appearance", group: "general", icon: SettingsAppearanceIcon, description: "Theme, how much detail a chat shows, and the desktop app." },
  { id: "notifications", title: "Notifications", group: "general", icon: SettingsNotificationsIcon, description: "When golem tells you something, and when it keeps quiet." },
  { id: "keys", title: "API keys", group: "models", icon: SettingsKeysIcon, description: "Keys for hosted providers. Stored in the system keychain." },
  { id: "routing", title: "Routing", group: "models", icon: SettingsRoutingIcon, description: "Which model new chats start on, and when golem switches." },
  { id: "context", title: "Context", group: "models", icon: SettingsContextIcon, description: "Window size, when to clear old tool output, when to summarize." },
  { id: "usage", title: "Usage", group: "models", icon: SettingsUsageIcon, description: "Tokens and spend per model, per day." },
  { id: "mcp", title: "MCP servers", group: "abilities", icon: SettingsMcpIcon, description: "Tool servers golem can call." },
  { id: "skills", title: "Skills", group: "abilities", icon: SettingsSkillsIcon, description: "Instructions golem loads when a task matches." },
  { id: "agents", title: "Agents", group: "abilities", icon: SettingsAgentsIcon, description: "Helpers the lead can start, and the models they use." },
  { id: "memory", title: "Memory", group: "abilities", icon: SettingsMemoryIcon, description: "What golem remembers between chats." },
  { id: "rules", title: "Tool rules", group: "permissions", icon: SettingsRulesIcon, description: "Allow, ask or deny, per tool and per path." },
  { id: "config", title: "Config file", group: "advanced", icon: SettingsConfigIcon, description: "Edit config.toml directly. The other sections write to it too." },
];
