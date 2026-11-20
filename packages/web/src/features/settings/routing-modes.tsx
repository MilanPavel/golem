import { ROUTE_MODES, ROUTING_WORDS, type RouteMode } from "@golem/view";
import type { ReactNode } from "react";
import { CardChoices, Part, type RoutingErrors } from "./routing-parts.tsx";

const SVG = { viewBox: "0 0 56 44", width: 56, height: 44, fill: "none" } as const;
const STROKE = { strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

const PICTURES: Readonly<Record<RouteMode, ReactNode>> = {
  auto: (
    <svg {...SVG}>
      <rect className="fill-clay" x="4" y="28" width="13" height="12" rx="2" />
      <rect className="fill-clay" x="21" y="19" width="13" height="21" rx="2" opacity=".7" />
      <rect className="fill-clay" x="38" y="10" width="13" height="30" rx="2" opacity=".45" />
      <path className="stroke-ink" {...STROKE} d="M8 20 L24 11 L40 3 M34 3h6v6" />
    </svg>
  ),
  local: (
    <svg {...SVG}>
      <rect className="fill-clay" x="4" y="28" width="13" height="12" rx="2" />
      <rect className="stroke-line-strong" strokeWidth="1.5" strokeDasharray="3 3" x="26" y="19" width="11" height="21" rx="2" />
      <rect className="stroke-line-strong" strokeWidth="1.5" strokeDasharray="3 3" x="41" y="10" width="11" height="30" rx="2" />
      <path className="stroke-ink" {...STROKE} d="M21.5 4 V40" />
    </svg>
  ),
  pinned: (
    <svg {...SVG}>
      <rect className="fill-line-strong" x="4" y="22" width="13" height="18" rx="2" opacity=".5" />
      <rect className="fill-clay" x="21" y="22" width="13" height="18" rx="2" />
      <rect className="fill-line-strong" x="38" y="22" width="13" height="18" rx="2" opacity=".5" />
      <path className="stroke-ink" {...STROKE} d="M27.5 18 V9 M23.5 9 h8 M27.5 4 v5" />
    </svg>
  ),
};

/** Part B: the default route, three cards with a picture each. Choosing one saves `routing.mode`. */
export function RoutingModes({ mode, errors, onChoose }: { mode: RouteMode; errors: RoutingErrors; onChoose: (mode: RouteMode) => void }) {
  return (
    <Part setting="new chats" title={ROUTING_WORDS.route.title} line={ROUTING_WORDS.route.line}>
      <CardChoices legend="Default route" path="routing.mode" choices={ROUTE_MODES} value={mode} errors={errors} onChoose={onChoose} pictures={PICTURES} />
    </Part>
  );
}
