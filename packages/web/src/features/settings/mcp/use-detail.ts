import { useQuery } from "@tanstack/react-query";
import { MCP_GET_KEY } from "../../../store/mcp.ts";
import { usePageActions } from "../../../store/page-context.tsx";

/** `mcp.get` for one server: its config, and which of the secrets it names the Keychain has. Always read again, since a token may have changed. */
export function useMcpDetail(name: string, sessionId: string | null) {
  const actions = usePageActions();
  return useQuery({
    queryKey: [...MCP_GET_KEY, name, sessionId],
    queryFn: () => actions.getMcp(name, sessionId),
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
}
