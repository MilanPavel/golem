import { ROLES, ROUTING_WORDS } from "@golem/view";
import { useState, type ReactNode } from "react";
import type { ModelListResult } from "../../store/models.ts";
import type { PullsSnapshot } from "../../store/pulls.ts";
import type { RoutingGetResult, RoutingSetParams } from "../../store/routing.ts";
import { Button } from "../../ui/button.tsx";
import { ModelPick } from "./routing-model-pick.tsx";
import { CARD, FieldError, Part, type RoutingErrors } from "./routing-parts.tsx";
import { usableModels } from "./routing-derive.ts";

export type FolderBrowserSlot = (done: { onPick: (path: string) => void; onCancel: () => void }) => ReactNode;

function Folders({
  folders,
  errors,
  onChange,
  folderBrowser,
}: {
  folders: readonly string[];
  errors: RoutingErrors;
  onChange: (patch: RoutingSetParams) => void;
  folderBrowser: FolderBrowserSlot;
}) {
  const [adding, setAdding] = useState(false);
  const words = ROUTING_WORDS.exceptions;
  return (
    <div className={`${CARD} flex flex-col gap-3 p-5`}>
      <div>
        <h4 className="text-sm font-semibold">{words.folders}</h4>
        <p className="text-note text-muted">{words.foldersLine}</p>
      </div>
      {folders.length === 0 ? (
        <p className="text-sm text-muted">{words.noFolders}</p>
      ) : (
        <ul aria-label={words.folders} className="flex flex-col gap-1.5">
          {folders.map((folder) => (
            <li key={folder} className="flex items-center gap-2.5 rounded-md border border-line bg-bg px-2.5 py-2 text-sm">
              <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" className="flex-none text-allow">
                <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
                <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
              </svg>
              <span className="min-w-0 flex-1 font-mono text-xs wrap-anywhere">{folder}</span>
              <button
                type="button"
                aria-label={`Remove ${folder}`}
                onClick={() => onChange({ routing: { local_only: folders.filter((item) => item !== folder) } })}
                className="px-1 text-base leading-none text-faint hover:text-ink"
              >
                <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <FieldError id="local-only-error" path="routing.local_only" errors={errors} />
      {adding ? (
        <div className="rounded-lg border border-line">
          {folderBrowser({
            onPick: (path) => {
              setAdding(false);
              if (!folders.includes(path)) onChange({ routing: { local_only: [...folders, path] } });
            },
            onCancel: () => setAdding(false),
          })}
        </div>
      ) : (
        <div>
          <Button size="sm" onClick={() => setAdding(true)}>
            + {words.addFolder}
          </Button>
        </div>
      )}
    </div>
  );
}

function Jobs({
  roles,
  listing,
  pulls,
  errors,
  onChange,
}: {
  roles: RoutingGetResult["roles"];
  listing: ModelListResult | null;
  pulls: PullsSnapshot;
  errors: RoutingErrors;
  onChange: (patch: RoutingSetParams) => void;
}) {
  const words = ROUTING_WORDS.exceptions;
  const models = usableModels(listing);
  return (
    <div className={`${CARD} p-5`}>
      <h4 className="text-sm font-semibold">{words.jobs}</h4>
      <p className="mb-3 text-note text-muted">{words.jobsLine}</p>
      {ROLES.map(({ role, title, line }) => {
        const path = `routing.roles.${role}`;
        const errorId = `role-${role}-error`;
        const value = roles[role];
        return (
          <div key={role} className="grid grid-cols-1 items-center gap-3 border-t border-line py-2 first:border-t-0 @route:cols-route-job">
            <div>
              <b className="block text-sm font-medium">{title}</b>
              <span className="text-note text-muted">{line}</span>
            </div>
            <div className="flex flex-col gap-1">
              <ModelPick
                label={title}
                value={value === "session" ? null : value}
                listing={listing}
                models={models}
                pulls={pulls}
                emptyText={words.automatic}
                onPick={(ref) => onChange({ roles: { [role]: ref ?? "session" } })}
                describedBy={errors[path] === undefined ? undefined : errorId}
                invalid={errors[path] !== undefined}
                className="w-full font-mono text-note"
              />
              <FieldError id={errorId} path={path} errors={errors} />
            </div>
          </div>
        );
      })}
      <p className="mt-2.5 border-t border-line pt-2.5 text-note text-muted">{words.automaticNote}</p>
    </div>
  );
}

/** Part E: the folders that never leave this Mac, and the model of each small job. */
export function RoutingExceptions({
  values,
  listing,
  pulls,
  errors,
  onChange,
  folderBrowser,
}: {
  values: RoutingGetResult;
  listing: ModelListResult | null;
  pulls: PullsSnapshot;
  errors: RoutingErrors;
  onChange: (patch: RoutingSetParams) => void;
  folderBrowser: FolderBrowserSlot;
}) {
  return (
    <Part title={ROUTING_WORDS.exceptions.title}>
      <div className="grid grid-cols-1 items-start gap-4 @route:grid-cols-2">
        <Folders folders={values.routing.local_only} errors={errors} onChange={onChange} folderBrowser={folderBrowser} />
        <Jobs roles={values.roles} listing={listing} pulls={pulls} errors={errors} onChange={onChange} />
      </div>
    </Part>
  );
}
