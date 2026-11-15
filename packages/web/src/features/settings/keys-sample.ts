import type { KeyServer } from "@golem/view";
import type { AuthKeyStatus } from "../../store/keys.ts";

const key = (provider: string, source: AuthKeyStatus["source"], env_var: string | null = null): AuthKeyStatus => ({
  provider,
  takes_key: true,
  needs_key: true,
  source,
  env_var,
});

const OLLAMA: AuthKeyStatus = { provider: "ollama", takes_key: false, needs_key: false, source: null, env_var: null };

const SERVERS: KeyServer[] = [
  { name: "github", title: "GitHub" },
  { name: "brave-search", title: "Brave Search" },
  { name: "linear", title: "Linear" },
  { name: "sentry", title: "Sentry" },
  { name: "notion", title: "Notion" },
  { name: "acme", title: "acme-internal" },
];

const MIXED: AuthKeyStatus[] = [
  key("anthropic", null),
  key("openai", "keychain", "OPENAI_API_KEY"),
  key("google", "env", "GEMINI_API_KEY"),
  key("deepseek", null),
  key("xai", null),
  key("moonshot", null),
  key("together", null),
  OLLAMA,
  key("mcp/github", "keychain"),
  key("mcp/linear-oauth", "keychain"),
  key("mcp/brave-search", null),
  key("mcp/sentry-oauth", null),
  key("mcp/notion-oauth", "keychain"),
  key("mcp/acme-api_key", null),
];

const HOSTED = ["anthropic", "openai", "google", "deepseek", "xai", "moonshot"];

export type KeysCase = {
  label: string;
  providers: AuthKeyStatus[];
  servers: KeyServer[];
  /** The ref whose Replace and Remove commands start open. */
  openKey?: string;
};

/** Settings → API keys in the states the page draws, for the gallery. */
export const KEYS_CASES: KeysCase[] = [
  { label: "Mixed", providers: MIXED, servers: SERVERS },
  { label: "Fresh install", providers: [...HOSTED.map((id) => key(id, null)), OLLAMA, key("mcp/github", null)], servers: SERVERS },
  {
    label: "All set",
    providers: [
      ...HOSTED.map((id) => key(id, id === "google" ? "env" : "keychain", id === "google" ? "GEMINI_API_KEY" : null)),
      key("mcp/github", "keychain"),
      key("mcp/linear-oauth", "keychain"),
      key("mcp/brave-search", "env", "BRAVE_API_KEY"),
      key("mcp/notion-oauth", "keychain"),
    ],
    servers: SERVERS,
  },
  { label: "No MCP keys", providers: [key("anthropic", "keychain"), key("openai", "keychain"), ...HOSTED.slice(2).map((id) => key(id, null)), OLLAMA], servers: [] },
  { label: "Drawer open", providers: MIXED, servers: SERVERS, openKey: "openai" },
  { label: "Drawer open, key from the environment", providers: MIXED, servers: SERVERS, openKey: "google" },
];
