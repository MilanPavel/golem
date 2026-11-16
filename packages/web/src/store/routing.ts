import type { RoutingGetResult, RoutingSetParams, RoutingSetResult } from "@golem/client";

export type { RoutingGetResult, RoutingSetParams, RoutingSetResult };

/** The query key of `routing.get`. A successful `routing.set` marks it stale. */
export const ROUTING_KEY = ["routing.get"] as const;
