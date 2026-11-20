import { useCallback } from "react";
import { useMcpList, useModelList, usePageActions, usePulls, useSkillList } from "../../store/page-context.tsx";
import { FolderBrowser } from "../shell/folder-browser.tsx";
import { ModelPick } from "../settings/routing-model-pick.tsx";
import { usableModels } from "../settings/routing-derive.ts";
import { RoutineEditor, type RoutineDraft } from "./routine-editor.tsx";

export type LiveRoutineEditorProps = {
  /** True to make a routine, false to change the one `draft` names. */
  create: boolean;
  draft: RoutineDraft;
  now: number;
  /** The routine was written. */
  onSaved: (name: string) => void;
  onCancel: () => void;
};

/** The routine editor on the live page: the skills, servers and models come from the daemon, and Save is `routine.update`. */
export function LiveRoutineEditor({ create, draft, now, onSaved, onCancel }: LiveRoutineEditorProps) {
  const actions = usePageActions();
  const skills = useSkillList(null);
  const servers = useMcpList(null);
  const models = useModelList();
  const pulls = usePulls();
  const onPreview = useCallback((schedule: string) => actions.previewRoutine(schedule), [actions]);
  const listing = models.data ?? null;
  return (
    <RoutineEditor
      create={create}
      draft={draft}
      now={now}
      skills={skills.data?.skills ?? []}
      servers={(servers.data?.servers ?? []).map((server) => server.name)}
      folderBrowser={({ onPick, onCancel: close }) => <FolderBrowser initialPath={draft.folder ?? null} autoFocus onPick={onPick} onCancel={close} />}
      modelPick={({ value, onPick }) => (
        <ModelPick label="Model" value={value} listing={listing} models={usableModels(listing)} pulls={pulls} emptyText="Default" onPick={onPick} className="text-meta" />
      )}
      onPreview={onPreview}
      onSave={async (name, fields) => {
        await actions.saveRoutine(name, fields, create);
        onSaved(name);
      }}
      onCancel={onCancel}
    />
  );
}
