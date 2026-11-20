import { useMcpList } from "../../store/page-context.tsx";
import { useSettingsContext } from "./context.ts";
import { useSetupFormRows } from "./use-setup-form-rows.ts";

/**
 * How many things need attention in each section, by section id. A section with nothing to fix is absent.
 * It reads only what the page already loads: the Info health rows and the MCP server list.
 */
export function useSectionBadges(): Record<string, number> {
  const rows = useSetupFormRows();
  const sessionId = useSettingsContext()?.sessionId ?? null;
  const mcp = useMcpList(sessionId);
  const counts: Record<string, number> = {
    info: rows === null ? 0 : rows.filter((row) => row.mark !== "ok").length,
    mcp: mcp.data === undefined ? 0 : mcp.data.servers.filter((server) => server.state === "failed").length,
    // TODO: keys: count the providers the routing path uses that have no key.
    keys: 0,
  };
  return Object.fromEntries(Object.entries(counts).filter(([, count]) => count > 0));
}
