import { RpcError, type AgentInfo, type AgentsListResult, type AgentsSaveResult } from "@golem/client";

export type { AgentInfo, AgentsListResult, AgentsSaveResult };

/** The query key of `agents.list`. The pushed `agent.registry.changed` marks it stale. */
export const AGENT_LIST_KEY = ["agents.list"] as const;

const METHOD_NOT_FOUND = -32601;

/** The daemon does not know `agents.list`: it is older than this page. */
export const AGENTS_OLD_TEXT = "Agents are not available. This golem is too old for them. Update golem.";

/** The daemon has no `agents.*` methods. */
export function isAgentsMissing(error: unknown): boolean {
  return error instanceof RpcError && error.code === METHOD_NOT_FOUND;
}
