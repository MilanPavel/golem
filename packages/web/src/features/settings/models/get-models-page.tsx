import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ModelListResult } from "../../../store/models.ts";
import type { PullsSnapshot } from "../../../store/pulls.ts";
import { Button } from "../../../ui/button.tsx";
import { cn } from "../../../ui/cn.ts";
import { ChevronLeftIcon, CloseIcon, CpuIcon, SearchIcon } from "../../../ui/icons.tsx";
import { HuggingFaceIcon } from "../../../ui/hugging-face-icon.tsx";
import { ProviderIcon } from "../../../ui/provider-icons.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../ui/tabs.tsx";
import { GetModelsFoot } from "./get-models-foot.tsx";
import { PicksTab, visiblePicks, type PicksFilter } from "./get-models-picks.tsx";
import { HuggingFaceTab, type HfActions, type HfTabProps } from "./hf-tab.tsx";
import { libraryRows, useLibraryList, type LibraryList, type OllamaLibraryActions, type OllamaLibraryInitial } from "./ollama-library.ts";
import { OllamaLibraryTab } from "./ollama-tab.tsx";

export type GetModelsProps = {
  listing: ModelListResult | null;
  pulls: PullsSnapshot;
  /** Starts a download. It rejects with the words to show. */
  onPull: (ref: string) => Promise<void>;
  /** Stops a download. */
  onStop: (ref: string) => Promise<void>;
  /** Removes the parts a failed download left on disk. */
  onCleanup?: (ref: string) => Promise<void>;
  /** Hugging Face: the search and a repo's sizes. */
  hf: HfActions;
  /** The Ollama library: its names and their sizes. */
  library: OllamaLibraryActions;
  /** Back to Ollama's models. */
  onBack: () => void;
  /** What the Hugging Face tab starts with, for the gallery. */
  initialHf?: HfTabProps["initial"];
  /** What the Ollama library tab starts with, for the gallery. */
  initialLibrary?: OllamaLibraryInitial;
  /** Where the page starts, for the gallery. */
  initialTab?: string;
  /** The search starts with this text, for the gallery. */
  initialSearch?: string;
  /** The filters of the first tab start like this, for the gallery. */
  initialFilter?: Partial<PicksFilter>;
};

/** What every panel gets. Each one reads what it needs. */
type PanelProps = Pick<GetModelsProps, "listing" | "pulls" | "hf" | "library" | "initialHf" | "initialLibrary"> & {
  /** The names of the Ollama library, which the page asked for once so the count of the tab follows the search. */
  list: LibraryList;
  /** The category and the switch of the first tab. The page holds them so the count of the tab follows them. */
  filter: PicksFilter;
  setFilter: (filter: PicksFilter) => void;
  /** The text of the search field. */
  search: string;
  setSearch: (text: string) => void;
  failure: string | null;
  pull: (ref: string) => Promise<boolean>;
  stop: (ref: string) => void;
  goTo: (id: string) => void;
};

type TabEntry = {
  id: string;
  label: string;
  icon: ReactNode;
  /** The placeholder of the search field on this tab. Null when the tab has its own field and the page's one is not used. */
  placeholder: string | null;
  /** How many the search leaves, or null when the tab cannot say before it is asked. */
  count: (props: PanelProps) => number | null;
  panel: (props: PanelProps) => ReactNode;
};

/**
 * The tabs of Get models. A new place to get models from is one more entry here, with its own panel.
 * The ids stay as they are, and each panel is given the text of the search.
 */
const TABS: readonly TabEntry[] = [
  {
    id: "mac",
    label: "Picked for this Mac",
    icon: <CpuIcon />,
    placeholder: "Search golem's list",
    count: ({ listing, search, filter }) => visiblePicks(listing, search, filter).length,
    panel: ({ listing, pulls, search, failure, pull, stop, goTo, filter, setFilter }) => (
      <PicksTab
        listing={listing}
        pulls={pulls}
        search={search}
        pull={pull}
        onStop={stop}
        failure={failure}
        places={[
          { id: "hf", label: "Search Hugging Face" },
          { id: "lib", label: "Search the Ollama library" },
        ]}
        onPlace={goTo}
        filter={filter}
        onFilter={setFilter}
      />
    ),
  },
  {
    id: "lib",
    label: "Ollama library",
    icon: <ProviderIcon provider="ollama" name="Ollama" />,
    placeholder: "A name from the Ollama library, such as mistral or qwen3.8:9b",
    // A name outside golem's list is known only after the registry is asked, so it has no count.
    count: ({ list, search }) => {
      if (list.all === null) return null;
      const found = libraryRows(list.all, search).length;
      return found === 0 && search.trim() !== "" ? null : found;
    },
    panel: ({ library, list, initialLibrary, listing, pulls, failure, pull, stop, search, goTo }) => (
      <OllamaLibraryTab
        library={library}
        list={list}
        listing={listing}
        pulls={pulls}
        failure={failure}
        pull={pull}
        onStop={stop}
        search={search}
        onHuggingFace={() => {
          goTo("hf");
        }}
        {...(initialLibrary === undefined ? {} : { initial: initialLibrary })}
      />
    ),
  },
  {
    id: "hf",
    label: "Hugging Face",
    icon: <HuggingFaceIcon />,
    placeholder: "Search Hugging Face, or paste a repo link",
    count: () => null,
    panel: ({ hf, initialHf, listing, pulls, failure, pull, stop, search, setSearch }) => (
      <HuggingFaceTab hf={hf} listing={listing} pulls={pulls} failure={failure} pull={pull} onStop={stop} search={search} onSearch={setSearch} {...(initialHf === undefined ? {} : { initial: initialHf })} />
    ),
  },
];

function MacLine({ listing }: { listing: ModelListResult | null }) {
  const ram = listing?.ram_gb ?? null;
  const disk = listing?.disk_free_gb ?? null;
  if (ram === null && disk === null) return null;
  return (
    <span className="flex items-center gap-2.5 whitespace-nowrap rounded-full border border-line bg-surface px-3 py-1 text-meta text-muted">
      <span>This Mac</span>
      {ram === null ? null : <b className="font-semibold text-ink">{`${ram} GB memory`}</b>}
      {disk === null ? null : (
        <>
          <i aria-hidden="true" className="hidden h-3 w-px bg-line-strong sm:block" />
          <span className="hidden sm:inline">
            <b className="font-semibold text-ink">{`${disk} GB`}</b> free
          </span>
        </>
      )}
    </span>
  );
}

/**
 * Get models: a page that takes the place of the Models page. The header, the search, the tabs and the foot stay;
 * only the body scrolls. A download starts and the page stays: its line shows the progress.
 */
export function GetModelsPage({ listing, pulls, onPull, onStop, onCleanup, hf, library, onBack, initialHf, initialLibrary, initialTab = "mac", initialSearch = "", initialFilter }: GetModelsProps) {
  const [tab, setTab] = useState(initialTab);
  const [search, setSearch] = useState(initialSearch);
  const [filter, setFilter] = useState<PicksFilter>({ category: null, hideTooBig: false, ...initialFilter });
  const [failure, setFailure] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const list = useLibraryList(library, initialLibrary);
  const entry = TABS.find((item) => item.id === tab) ?? TABS[0];

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      // A menu or a dialog over the page keeps its own Esc.
      if (target instanceof Element && target.closest("[role='dialog'], [role='alertdialog'], [role='menu']") !== null) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onBack();
        return;
      }
      const typing = target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      if (event.key === "/" && !typing && field.current !== null && entry?.placeholder !== null) {
        event.preventDefault();
        field.current.focus();
      }
    }
    // Before the Settings page: its Esc leaves Settings and its / goes to its own search, and here they mean this page.
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onBack, entry]);

  async function pull(ref: string): Promise<boolean> {
    setFailure(null);
    try {
      await onPull(ref);
      return true;
    } catch (error) {
      setFailure(error instanceof Error && error.message !== "" ? error.message : "Could not start the download.");
      return false;
    }
  }

  function stop(ref: string): void {
    onStop(ref).catch((error: unknown) => {
      setFailure(error instanceof Error && error.message !== "" ? error.message : "Could not stop the download.");
    });
  }

  function cleanup(ref: string): void {
    onCleanup?.(ref).catch((error: unknown) => {
      setFailure(error instanceof Error && error.message !== "" ? error.message : "Could not remove the files.");
    });
  }

  function go(id: string): void {
    setTab(id);
    setFailure(null);
  }

  const props: PanelProps = { listing, pulls, hf, library, list, initialHf, initialLibrary, filter, setFilter, search, setSearch, failure, pull, stop, goTo: go };
  const own = entry?.placeholder === null;
  return (
    <div role="group" aria-label="Get models" data-setting="get models" className="flex min-h-0 w-full max-w-6xl flex-1 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-3 pb-3">
        <Button size="sm" kind="ghost" className="-ml-2" aria-label="Back to Ollama" onClick={onBack}>
          <ChevronLeftIcon />
          Ollama
        </Button>
        <h3 className="text-xl font-semibold">Get models</h3>
        <span className="flex items-center gap-1.5 text-sm text-muted">
          for Ollama
          <ProviderIcon provider="ollama" name="Ollama" width="16" height="16" />
        </span>
        <span className="ml-auto">
          <MacLine listing={listing} />
        </span>
      </header>
      <div
        // A tab with a search of its own keeps the room of this one, so the page does not change size between tabs.
        className={cn("flex h-11 shrink-0 items-center gap-2.5 rounded-lg border border-line-strong bg-surface px-3 focus-within:border-clay", own ? "invisible" : "")}
        aria-hidden={own ? true : undefined}
      >
        <SearchIcon aria-hidden="true" className="shrink-0 text-faint" />
        <input
          ref={field}
          type="search"
          value={search}
          disabled={own}
          aria-label="Search"
          placeholder={entry?.placeholder ?? ""}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
          className="min-w-0 flex-1 appearance-none bg-transparent text-sm text-ink outline-none placeholder:text-faint [&::-webkit-search-cancel-button]:hidden"
        />
        {search === "" ? null : (
          <button
            type="button"
            aria-label="Clear the search"
            onClick={() => {
              setSearch("");
              field.current?.focus();
            }}
            className="grid size-6 place-items-center rounded-sm text-faint outline-offset-2 outline-clay hover:text-ink focus-visible:outline-2"
          >
            <CloseIcon width="12" height="12" />
          </button>
        )}
      </div>
      <Tabs value={tab} onValueChange={go} className="mt-3 flex min-h-0 flex-1 flex-col">
        <TabsList aria-label="Where to get models" className="shrink-0">
          {TABS.map((item) => {
            const count = item.count(props);
            return (
              <TabsTrigger key={item.id} value={item.id} className="flex items-center gap-2 py-2">
                {item.icon}
                {item.label}
                {count === null ? null : <span className="rounded-full bg-sunken px-1.5 py-0.5 text-xs tabular-nums text-faint">{count}</span>}
              </TabsTrigger>
            );
          })}
        </TabsList>
        {TABS.map((item) => (
          <TabsContent key={item.id} value={item.id} className="flex min-h-0 flex-1 flex-col">
            {item.panel(props)}
          </TabsContent>
        ))}
      </Tabs>
      <GetModelsFoot listing={listing} pulls={pulls} pull={pull} stop={stop} cleanup={cleanup} onBack={onBack} />
    </div>
  );
}
