import type { ComponentType, SVGProps } from "react";
import {
  SettingsAgentsIcon,
  SettingsChatIcon,
  SettingsAppearanceIcon,
  SettingsConfigIcon,
  SettingsDevicesIcon,
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
  /** The names of the options on the page, in the person's words. Search matches them, and the row with the same `data-setting` is where a jump lands. */
  keywords: readonly string[];
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
  { id: "info", title: "Info", group: "general", icon: SettingsInfoIcon, description: "What is installed, where it lives, and whether it is healthy.", keywords: ["golem", "version", "service", "ollama", "model", "disk", "socket", "logs", "data", "daemon", "jobs", "install"] },
  { id: "chat", title: "Chat", group: "general", icon: SettingsChatIcon, description: "Your instructions, how golem answers and what a chat shows. These are the defaults for every new chat.", keywords: ["default mode", "autopilot", "start with a plan", "steps", "open it when a step fails", "thinking", "footer", "send", "instructions", "response style", "system prompt", "suggestions", "from your chats"] },
  { id: "appearance", title: "Appearance", group: "general", icon: SettingsAppearanceIcon, description: "Theme and the desktop app.", keywords: ["theme", "app"] },
  { id: "notifications", title: "Notifications", group: "general", icon: SettingsNotificationsIcon, description: "When golem tells you something, and when it keeps quiet.", keywords: ["tell me", "clicking a notification", "quiet hours", "pause"] },
  { id: "keys", title: "API keys", group: "models", icon: SettingsKeysIcon, description: "Keys for hosted providers. Stored in the system keychain.", keywords: ["provider", "anthropic", "openai", "keychain"] },
  { id: "routing", title: "Routing", group: "models", icon: SettingsRoutingIcon, description: "Which model new chats start on, and when golem switches.", keywords: ["new chats", "path of a turn", "paid gate", "exceptions", "ollama"] },
  { id: "context", title: "Context", group: "models", icon: SettingsContextIcon, description: "Window size, when to clear old tool output, when to summarize.", keywords: ["window size", "when it fills up", "tokens", "summarize"] },
  { id: "usage", title: "Usage", group: "models", icon: SettingsUsageIcon, description: "Tokens and spend per model, per day.", keywords: ["today", "this week", "last 7 days", "saved by running locally", "cost"] },
  { id: "mcp", title: "MCP servers", group: "abilities", icon: SettingsMcpIcon, description: "Tool servers golem can call.", keywords: ["catalog", "import", "server", "stdio", "token", "sign in", "keychain", "replace token"] },
  { id: "skills", title: "Skills", group: "abilities", icon: SettingsSkillsIcon, description: "Instructions golem loads when a task matches.", keywords: ["project", "user", "bundled", "instructions"] },
  { id: "agents", title: "Agents", group: "abilities", icon: SettingsAgentsIcon, description: "Helpers the lead can start. Each one is a Markdown file.", keywords: ["helpers", "explorer", "sub-agent", "model", "limits", "prompt", "definition"] },
  { id: "memory", title: "Memory", group: "abilities", icon: SettingsMemoryIcon, description: "What golem remembers between chats.", keywords: ["paid model", "scopes", "remember", "forget"] },
  { id: "devices", title: "Devices", group: "permissions", icon: SettingsDevicesIcon, description: "Phones paired with this Mac: pair one, rename it, or cut it off.", keywords: ["phone", "iphone", "pair", "qr code", "revoke", "relay"] },
  { id: "rules", title: "Tool rules", group: "permissions", icon: SettingsRulesIcon, description: "Allow, ask or deny, per tool and per path.", keywords: ["rules", "allow", "deny", "permission"] },
  { id: "config", title: "Config file", group: "advanced", icon: SettingsConfigIcon, description: "Edit config.toml directly. The other sections write to it too.", keywords: ["which file", "problems", "toml", "raw"] },
];
