import { useEffect, useState, type ReactNode } from "react";
import { BranchSwitchLine, HomeBranchChip, NewSessionComposer, useStartSession } from "../composer/index.ts";
import { PixelGolem } from "../../ui/pixel-golem.tsx";
import { FinishSetupStrip } from "../welcome/index.ts";
import { folderDialogErrorText } from "../../store/errors.ts";
import { useFolderBranches, useFolderDialog, useFolderMenuRequest, useGitInfo, useHomeFolder, useKnownFolders, useNewSessionBranch, useNewSessionFolder, useNewSessionModel, usePageActions } from "../../store/page-context.tsx";
import { FolderBrowser } from "./folder-browser.tsx";
import { FolderChip } from "./folder-chip.tsx";
import { NewSessionModelChip } from "./model-chip-new.tsx";
import "./shell.css";

/** The empty screen: the golem, a line, and the composer's slot. The model and folder chips sit in the composer's row. */
export function HomeView({
  headingLevel: Heading = "h1",
  notice = null,
  composer = null,
  folderError = null,
}: {
  /** A quiet strip above the composer, such as `Finish setup`. */
  notice?: ReactNode;
  /** The large composer. */
  composer?: ReactNode;
  /** Why the daemon refused the folder or the model, shown under the composer. */
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
        {notice}
        {composer}
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
  const info = useGitInfo(folder);
  const branches = useFolderBranches(folders.slice(0, 8));
  const home = useHomeFolder();
  const dialog = useFolderDialog();
  const actions = usePageActions();
  // A session may have sent the person here to pick another folder: the menu opens once.
  const request = useFolderMenuRequest();
  const [openAtStart] = useState(request.asked);
  const { shown } = request;
  useEffect(() => {
    shown();
  }, [shown]);
  const [model] = useNewSessionModel();
  const [branch] = useNewSessionBranch();
  const start = useStartSession(folder, model, branch);
  return (
    <HomeView
      notice={<FinishSetupStrip />}
      composer={
        <NewSessionComposer
          start={start}
          note={<BranchSwitchLine folder={folder} />}
          barLeft={
            <>
              <NewSessionModelChip />
              <FolderChip
                folder={folder}
                folders={folders}
                onChange={setFolder}
                info={info.data ?? null}
                branches={branches}
                home={home}
                defaultOpen={openAtStart}
                onChoose={
                  dialog
                    ? async (start) => {
                        try {
                          return (await actions.chooseFolder(start)).path ?? null;
                        } catch (error) {
                          throw new Error(folderDialogErrorText(error));
                        }
                      }
                    : undefined
                }
                browser={(props) => <FolderBrowser {...props} />}
              />
              <HomeBranchChip folder={folder} />
            </>
          }
        />
      }
      folderError={start.folderError}
    />
  );
}
