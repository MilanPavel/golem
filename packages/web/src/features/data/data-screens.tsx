import { useState, type ReactNode } from "react";
import { askText, DATA_NOT_AVAILABLE, runQueryText } from "@golem/view";
import { dataErrorText, type DataSavedQuery, type DataSource } from "../../store/data.ts";
import { NEW_DRAFT_KEY } from "../../store/drafts.ts";
import { dataPath, settingsPath, type DataTab } from "../../store/router.ts";
import { useDataDescribe, useDataList, useDataNotes, useDataProfileLoader, useDraft, useNavigate, useNewSessionFolder, usePageActions, useRoute } from "../../store/page-context.tsx";
import { Button } from "../../ui/button.tsx";
import { Link } from "../../ui/link.tsx";
import { AddDialog } from "./add-dialog.tsx";
import { DataPanel } from "./data-panel.tsx";
import { SourcePage, type NotesView } from "./source-page.tsx";

function Frame({ children }: { children: ReactNode }) {
  return (
    <div data-screen="data" className="flex min-h-0 flex-1 flex-col overflow-y-auto px-7 py-5">
      {children}
    </div>
  );
}

/** The Add a source dialog on the live page: it asks the daemon through the store, and opens the new source's page. */
export function LiveAddDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const actions = usePageActions();
  const navigate = useNavigate();
  const [folder] = useNewSessionFolder();
  return (
    <AddDialog
      open={open}
      folder={folder}
      onInspect={actions.dataInspect}
      onInspectDatabase={actions.dataInspectDatabase}
      onInstallExtension={actions.dataInstallExtension}
      onAdd={actions.dataAdd}
      onAdded={(source: DataSource) => {
        onClose();
        navigate(dataPath(source.name, "notes"));
      }}
      onCancel={onClose}
      onOpenMcp={() => {
        onClose();
        navigate(settingsPath("mcp"));
      }}
    />
  );
}

/** The Data panel on the live page. */
export function LiveDataPanel() {
  const list = useDataList();
  const route = useRoute();
  const navigate = useNavigate();
  const [folder] = useNewSessionFolder();
  const [adding, setAdding] = useState(false);
  return (
    <>
      <DataPanel
        answer={list.data ?? null}
        error={list.error?.message ?? null}
        folder={folder}
        selected={route.name === "data-source" ? route.source : null}
        onNavigate={navigate}
        onAdd={() => setAdding(true)}
      />
      <LiveAddDialog open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

/** `/data`: what a source is, and a way to add one. */
export function DataScreen() {
  const list = useDataList();
  const [adding, setAdding] = useState(false);
  const sources = list.data?.status === "ready" ? list.data.data.sources : null;
  return (
    <Frame>
      <div className="flex max-w-2xl flex-col gap-2">
        <h1 className="font-prose text-2xl font-normal tracking-tight">Data</h1>
        <p className="text-sm text-pretty text-muted">
          Files and databases golem may ask questions of. golem reads them in place and never writes to them. It sends rows to a model only when the source&apos;s privacy level allows it.
        </p>
        {list.data?.status === "missing" ? <p className="text-sm text-muted">{DATA_NOT_AVAILABLE}</p> : null}
        {sources === null ? null : <p className="text-sm text-muted">{sources.length === 0 ? "No sources yet." : "Pick one from the list to see its tables, notes and queries."}</p>}
        <div>
          <Button kind="primary" size="sm" onClick={() => setAdding(true)}>
            <span aria-hidden="true">＋</span> Add a source
          </Button>
        </div>
      </div>
      <LiveAddDialog open={adding} onClose={() => setAdding(false)} />
    </Frame>
  );
}

/** `/data/:name`: one source, from `data.list` and `data.describe`. */
export function DataSourceScreen({ name, tab }: { name: string; tab: DataTab }) {
  const list = useDataList();
  const described = useDataDescribe(name);
  const notes = useDataNotes(name);
  const loadProfile = useDataProfileLoader(name);
  const actions = usePageActions();
  const navigate = useNavigate();
  const [, setDraft] = useDraft(NEW_DRAFT_KEY);

  if (list.data === undefined) {
    return (
      <Frame>
        <p className="text-sm text-muted">{list.error ? `Could not load the sources. ${dataErrorText(list.error, "")}` : "Loading the source."}</p>
      </Frame>
    );
  }
  if (list.data.status === "missing") {
    return (
      <Frame>
        <p className="text-sm text-muted">{DATA_NOT_AVAILABLE}</p>
      </Frame>
    );
  }
  const source = list.data.data.sources.find((each) => each.name === name);
  if (source === undefined) {
    return (
      <Frame>
        <p className="text-sm text-muted">
          There is no source called {name}.{" "}
          <Link href="/data" onNavigate={navigate} className="text-clay-ink underline underline-offset-2">
            Back to Data
          </Link>
        </p>
      </Frame>
    );
  }
  const describedAnswer = described.data;
  const notesAnswer = notes.data;
  const notesView: NotesView =
    notesAnswer === undefined
      ? notes.error
        ? { state: "error", message: dataErrorText(notes.error, "Could not read the notes.") }
        : { state: "loading" }
      : notesAnswer.status === "missing"
        ? { state: "missing" }
        : { state: "ready", text: notesAnswer.data.text ?? null, path: notesAnswer.data.path ?? null };
  const askInChat = (text: string): void => {
    setDraft(text);
    navigate("/");
  };
  return (
    <Frame>
      <SourcePage
        key={name}
        source={source}
        described={describedAnswer?.status === "ready" ? describedAnswer.data : null}
        describeMissing={describedAnswer?.status === "missing"}
        describeError={described.error ? dataErrorText(described.error, "Could not read the source.") : null}
        notes={notesView}
        tab={tab}
        onTab={(next) => navigate(dataPath(name, next))}
        onAsk={() => askInChat(askText(name))}
        onRun={(query: DataSavedQuery) => askInChat(runQueryText(name, query.sql))}
        onLoadProfile={loadProfile}
        onBrowse={(table, view) => actions.dataBrowse(name, table, view)}
        onAskView={askInChat}
        onSaveNotes={(text) => actions.dataNotesSet(name, text)}
        onDraftNotes={() => actions.dataNotesDraft(name)}
        onPrivacy={async (privacy) => {
          await actions.dataUpdate({ name, privacy });
        }}
        onChangePassword={async (password) => {
          await actions.dataUpdate({ name, password });
        }}
        onWatch={async (watch) => {
          await actions.dataUpdate({ name, watch });
        }}
        onInstallExtension={actions.dataInstallExtension}
        onRemove={async () => {
          await actions.dataRemove(name);
          navigate("/data");
        }}
      />
    </Frame>
  );
}
