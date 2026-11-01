import { PixelGolem } from "../../ui/pixel-golem.tsx";
import { useKnownFolders, useNewSessionFolder } from "../../store/page-context.tsx";
import { FolderChip, type FolderChipProps } from "./folder-chip.tsx";
import "./shell.css";

/**
 * The large composer of the empty screen goes here (step 10.8.4). It reads the folder with
 * `useNewSessionFolder` when it creates the session.
 */
export function NewSessionComposerSlot() {
  return null;
}

/** The empty screen: the golem, a line, the composer's slot, and the folder chip. */
export function HomeView({
  headingLevel: Heading = "h1",
  ...chip
}: FolderChipProps & {
  /** The heading level. A page has one h1; the gallery shows the screen under its own headings. */
  headingLevel?: "h1" | "h2" | "h3" | "h4";
}) {
  return (
    <div data-screen="home" className="relative grid min-h-0 flex-1 place-items-center overflow-y-auto p-5">
      <div aria-hidden="true" className="empty-grid pointer-events-none absolute inset-0" />
      <div className="relative flex w-full max-w-xl flex-col items-center gap-4 text-center">
        <PixelGolem state="idle" size="lg" />
        <Heading className="font-prose text-2xl font-normal tracking-tight text-balance">Start a new session</Heading>
        <NewSessionComposerSlot />
        <FolderChip {...chip} />
      </div>
    </div>
  );
}

export function HomeScreen() {
  const [folder, setFolder] = useNewSessionFolder();
  const folders = useKnownFolders();
  return <HomeView folder={folder} folders={folders} onChange={setFolder} />;
}
