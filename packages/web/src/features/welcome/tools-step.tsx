import { Button } from "../../ui/button.tsx";
import { ToolsOfferView, type ToolsOfferViewProps } from "../setup/tools-offer.tsx";
import { Working } from "./step-card.tsx";

export type ToolsStepProps = {
  /** The offer, or null while the starter list is read. */
  offer: ToolsOfferViewProps | null;
  /** The starter list could not be read. */
  failed: boolean;
  onContinue: () => void;
};

/** Tools: the starter servers on offer, then each one's progress. The panel is the one Settings → Setup draws too. */
export function ToolsStep({ offer, failed, onContinue }: ToolsStepProps) {
  if (offer !== null) return <ToolsOfferView {...offer} />;
  return (
    <>
      <h2 className="font-prose text-2xl font-normal tracking-tight text-balance">Give golem some tools?</h2>
      {failed ? (
        <>
          <p role="alert" className="-mt-2 max-w-md text-balance text-deny">
            Could not read the starter tools. You can add them in Settings.
          </p>
          <div className="flex items-center justify-center gap-2.5">
            <Button kind="ink" onClick={onContinue}>
              Continue
            </Button>
          </div>
        </>
      ) : (
        <Working>Checking…</Working>
      )}
    </>
  );
}
