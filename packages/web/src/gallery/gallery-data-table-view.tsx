import { useState } from "react";
import type { ViewFilter, ViewSort } from "@golem/view";
import { ColumnProfile } from "../features/data/column-profile.tsx";
import { EMPTY_VIEW, RowsBrowser, type RowsBrowserInitial, type RowsView } from "../features/data/rows-browser.tsx";
import { PASSENGER_COLUMNS, passengerRows, PASSENGERS, SAMPLE_PASSENGER_PROFILE, SAMPLE_TITANIC_TABLE } from "../features/data/table-sample.ts";

const NEVER = () => new Promise<never>(() => {});

const FEMALE: ViewFilter = { column: "Sex", op: "=", value: "female" };
const BY_FARE: ViewSort = { column: "Fare", desc: true };
const FEMALE_BY_FARE = passengerRows({ sex: "female", sortBy: 9, desc: true });

type Story = { title: string; view: RowsView; initial: RowsBrowserInitial; all: number };

const ROW_STORIES: readonly Story[] = [
  { title: "Rows, loading", view: EMPTY_VIEW, initial: {}, all: PASSENGERS.length },
  { title: "Rows, first page", view: EMPTY_VIEW, initial: { pages: { 0: PASSENGERS.slice(0, 200) }, total: PASSENGERS.length }, all: PASSENGERS.length },
  {
    title: "Rows, sorted and filtered",
    view: { filters: [FEMALE], search: "", sort: BY_FARE },
    initial: { pages: { 0: FEMALE_BY_FARE.slice(0, 200) }, total: FEMALE_BY_FARE.length },
    all: PASSENGERS.length,
  },
  {
    title: "Rows, row detail",
    view: EMPTY_VIEW,
    initial: { pages: { 0: PASSENGERS.slice(0, 200) }, total: PASSENGERS.length, selected: 1, open: true },
    all: PASSENGERS.length,
  },
];

const SHOWN = PASSENGER_COLUMNS.map((column) => ({ name: column.name, type: column.type }));

function Rows({ story }: { story: Story }) {
  const [view, setView] = useState(story.view);
  return <RowsBrowser source="titanic" table="titanic" columns={SHOWN} tableRows={story.all} view={view} onView={setView} onBrowse={NEVER} onAskView={() => {}} onKeep={NEVER} onExport={NEVER} initial={story.initial} />;
}

/** The column profile and the row browser, as they look with the passenger list of the design. */
export function DataTableViewGallery({ theme, id }: { theme: string; id: string }) {
  return (
    <section className="mt-6" id={id}>
      <h3 className="mb-2 font-mono text-xs text-faint">Data table view</h3>
      <div className="flex flex-col gap-4">
        {(["list", "cards"] as const).map((layout) => (
          <div key={layout} role="region" aria-label={`Profile, ${layout}, ${theme}`} className="rounded-lg border border-line bg-bg p-5">
            <ColumnProfile table={SAMPLE_TITANIC_TABLE} refresh={null} onLoadProfile={NEVER} onPick={() => {}} initial={{ layout, profile: SAMPLE_PASSENGER_PROFILE }} />
          </div>
        ))}
        {ROW_STORIES.map((story) => (
          <div key={story.title} role="region" aria-label={`${story.title}, ${theme}`} className="rounded-lg border border-line bg-bg p-5">
            <Rows story={story} />
          </div>
        ))}
      </div>
    </section>
  );
}
