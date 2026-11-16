export { ChangesTab, ChangesView } from "./changes-tab.tsx";
export { FilesTab, FilesView } from "./files-tab.tsx";
export { Workbench, WORKBENCH_ID } from "./workbench.tsx";
export type { WorkbenchTab } from "./workbench.tsx";
export {
  openChange,
  openFile,
  openWorkbench,
  useRequestedChange,
  useRequestedFile,
  useWorkbenchTab,
} from "./workbench-state.ts";
export { useWorkbenchWidth } from "./workbench-width.ts";
