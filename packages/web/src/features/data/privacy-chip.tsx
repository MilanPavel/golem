import { PRIVACY_CHIP, type DataPrivacy } from "@golem/view";
import { Badge } from "../../ui/badge.tsx";

const TONE = { open: "neutral", local: "allow", schema: "wait" } as const;

/** What may leave the machine, as a chip: `rows open`, `rows local` or `schema only`. */
export function PrivacyChip({ privacy, className }: { privacy: DataPrivacy; className?: string }) {
  return (
    <Badge tone={TONE[privacy]} className={className}>
      {PRIVACY_CHIP[privacy]}
    </Badge>
  );
}
