import { useState, type ReactNode } from "react";
import type { ListedModel, ModelListResult } from "../../../store/models.ts";
import type { PullsSnapshot } from "../../../store/pulls.ts";
import { Badge } from "../../../ui/badge.tsx";
import { Button } from "../../../ui/button.tsx";
import { Code } from "../../../ui/code.tsx";
import { Input } from "../../../ui/input.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../ui/tabs.tsx";
import { diskText, shortName } from "../../models/model-text.ts";
import { Sheet } from "./sheet.tsx";

export type GetModelsProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  listing: ModelListResult | null;
  pulls: PullsSnapshot;
  /** Starts a download. It rejects with the words to show. */
  onPull: (ref: string) => Promise<void>;
  /** Where the tab starts, for the gallery. */
  initialTab?: string;
};

type TabProps = Pick<GetModelsProps, "listing" | "pulls"> & {
  busy: string | null;
  failure: string | null;
  pull: (ref: string) => Promise<boolean>;
};

/**
 * The tabs of Get models. A new place to get models from is one more entry here, with its own panel.
 */
const TABS: readonly { id: string; label: string; panel: (props: TabProps) => ReactNode }[] = [
  { id: "mac", label: "For this Mac", panel: (props) => <ForThisMac {...props} /> },
  { id: "name", label: "By name", panel: (props) => <ByName {...props} /> },
];

function fitText(model: ListedModel): string {
  const size = model.size_gb === null || model.size_gb === undefined ? "size unknown" : `${model.size_gb} GB`;
  const fit = model.fit === "fits" ? " · fits" : model.fit === "tight" ? " · tight on memory" : model.fit === "too_big" ? " · too big for this Mac" : "";
  return `${size}${fit}`;
}

function ForThisMac({ listing, pulls, busy, failure, pull }: TabProps) {
  // The ones golem recommends come first, then the rest in its own order.
  const rows = (listing?.models ?? [])
    .filter((model) => model.provider === "ollama" && (model.source === "installed" || model.source === "catalog"))
    .map((model, index) => ({ model, index }))
    .sort((a, b) => Number(b.model.recommended === true) - Number(a.model.recommended === true) || a.index - b.index)
    .map(({ model }) => model);
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm text-muted">golem&apos;s list, sized for this Mac. Recommended first.</p>
      {failure === null ? null : (
        <p role="alert" className="text-sm text-deny">
          {failure}
        </p>
      )}
      {rows.length === 0 ? <p className="py-3 text-sm text-muted">golem has no list for this Mac yet.</p> : null}
      <ul aria-label="Models for this Mac" className="flex flex-col">
        {rows.map((model) => {
          const installed = model.source === "installed" && model.status === "ready";
          const downloading = model.status === "pulling" || pulls.active.has(model.ref);
          const failed = pulls.failed.get(model.ref);
          const disk = listing === null ? null : diskText(model, listing);
          return (
            <li key={model.ref} className="flex items-center gap-3 border-t border-line py-2">
              <div className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2">
                  <Code>{shortName(model.ref)}</Code>
                  {model.recommended === true ? (
                    <Badge tone="allow" className="px-1.5 py-0">
                      RECOMMENDED
                    </Badge>
                  ) : null}
                </span>
                <small className={model.fit === "too_big" ? "block text-sm text-deny" : "block text-sm text-faint"}>{fitText(model)}</small>
                {disk === null ? null : <small className="block text-sm text-wait">{disk}</small>}
                {failed === undefined || failed === "cancelled" ? null : <small className="block text-sm text-deny">{`Download failed: ${failed}`}</small>}
              </div>
              {installed ? (
                <Badge tone="allow">INSTALLED</Badge>
              ) : downloading ? (
                <Badge>DOWNLOADING</Badge>
              ) : (
                <Button
                  size="sm"
                  disabled={busy !== null}
                  aria-label={`Download ${shortName(model.ref)}`}
                  onClick={() => {
                    void pull(model.ref);
                  }}
                >
                  {model.fit === "too_big" ? "Download anyway" : "Download"}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ByName({ busy, failure, pull }: TabProps) {
  const [name, setName] = useState("");
  const ref = name.trim() === "" ? "" : name.trim().startsWith("ollama/") ? name.trim() : `ollama/${name.trim()}`;
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (ref !== "") void pull(ref);
      }}
    >
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">An Ollama name</span>
        <Input
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
          placeholder="mistral-small3"
          autoComplete="off"
          spellCheck={false}
        />
        <small className="text-meta text-faint">A name from the Ollama library, with a size if you want one, such as qwen3:8b. golem downloads it with Ollama.</small>
      </label>
      {failure === null ? null : (
        <p role="alert" className="text-sm text-deny">
          {failure}
        </p>
      )}
      <div>
        <Button type="submit" kind="primary" size="sm" disabled={busy !== null || ref === ""}>
          Download
        </Button>
      </div>
    </form>
  );
}

/** Get models: golem's list for this Mac, and a name typed in. The sheet closes once a download has started. */
export function GetModelsSheet({ open, onOpenChange, listing, pulls, onPull, initialTab = "mac" }: GetModelsProps) {
  const [tab, setTab] = useState(initialTab);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const ram = listing?.ram_gb;
  async function pull(ref: string): Promise<boolean> {
    setBusy(ref);
    setFailure(null);
    try {
      await onPull(ref);
      onOpenChange(false);
      return true;
    } catch (error) {
      setFailure(error instanceof Error && error.message !== "" ? error.message : "Could not start the download.");
      return false;
    } finally {
      setBusy(null);
    }
  }
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Get models"
      description={`For Ollama on this Mac${ram === null || ram === undefined ? "" : ` · ${ram} GB of memory`}. The download keeps going if you close this.`}
    >
      <Tabs value={tab} onValueChange={setTab} className="flex flex-col gap-3">
        <TabsList aria-label="Where to get models">
          {TABS.map((item) => (
            <TabsTrigger key={item.id} value={item.id}>
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {TABS.map((item) => (
          <TabsContent key={item.id} value={item.id}>
            {item.panel({ listing, pulls, busy, failure, pull })}
          </TabsContent>
        ))}
      </Tabs>
    </Sheet>
  );
}
