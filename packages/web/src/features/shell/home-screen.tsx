import type { ReactNode } from "react";
import { NewSessionComposer, useStartSession } from "../composer/index.ts";
import { PixelGolem } from "../../ui/pixel-golem.tsx";
import { useKnownFolders, useNewSessionFolder, useNewSessionModel } from "../../store/page-context.tsx";
import { FolderBrowser } from "./folder-browser.tsx";
import { FolderChip, type FolderChipProps } from "./folder-chip.tsx";
import { NewSessionModelChip } from "./model-chip-new.tsx";
import "./shell.css";

/** The empty screen: the golem, a line, the composer's slot, and the folder chip. */
export function HomeView({
  headingLevel: Heading = "h1",
  composer = null,
  modelChip = null,
  folderError = null,
  ...chip
}: FolderChipProps & {
  /** The large composer. */
  composer?: ReactNode;
  /** The model chip, beside the folder chip. */
  modelChip?: ReactNode;
  /** Why the daemon refused the folder or the model, shown under the chips. */
  folderError?: string | null;
  /** The heading level. A page has one h1; the gallery shows the screen under its own headings. */
  headingLevel?: "h1" | "h2" | "h3" | "h4";
}) {
  return (
    <div data-screen="home" className="relative grid min-h-0 flex-1 place-items-center overflow-y-auto p-5">
      <div aria-hidden="true" className="empty-grid pointer-events-none absolute inset-0" />
      <div className="relative flex w-full max-w-xl flex-col items-center gap-4 text-center">
        <PixelGolem state="idle" size="lg" />
        <Heading className="font-prose text-2xl font-normal tracking-tight text-balance">Start a new session</Heading>
        {composer}
        <div className="flex flex-wrap items-center justify-center gap-2">
          <FolderChip {...chip} />
          {modelChip}
        </div>
        {folderError ? (
          <p role="alert" className="-mt-2 text-xs text-deny">
            {folderError}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function HomeScreen() {
  const [folder, setFolder] = useNewSessionFolder();
  const folders = useKnownFolders();
  const [model] = useNewSessionModel();
  const start = useStartSession(folder, model);
  return (
    <HomeView
      folder={folder}
      folders={folders}
      onChange={setFolder}
      browser={(props) => <FolderBrowser {...props} />}
      composer={<NewSessionComposer start={start} />}
      modelChip={<NewSessionModelChip />}
      folderError={start.folderError}
    />
  );
}
