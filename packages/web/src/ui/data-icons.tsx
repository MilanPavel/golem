import { sourceFileType, type AddKind, type DataKind } from "@golem/view";
import { useId, type ReactNode } from "react";
import { DuckdbIcon, ExcelBrandIcon, MysqlIcon, ParquetBrandIcon, PostgresIcon, SqliteIcon } from "./data-brand-icons.tsx";
import { Icon, PlugIcon, type IconProps } from "./icons.tsx";

// Drawn here: the 16 px grid and the 1.5 stroke of `icons.tsx`. A file is a page with a folded corner and its own mark
// on the lower half. The databases and the Excel and Parquet files use their own marks, in `data-brand-icons.tsx`.

const PAGE = "M4.5 1.5h5L13 5v8a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 13V3a1.5 1.5 0 0 1 1.5-1.5zM9.5 1.5V5H13";

function Page({ children, ...props }: IconProps & { children?: ReactNode }) {
  return (
    <Icon {...props}>
      <path d={PAGE} />
      {children}
    </Icon>
  );
}

/** A page with a folded corner: a file golem has no picture for. */
export const SheetIcon = (props: IconProps) => <Page {...props} />;
/** A page with a solid band across it: a table of text, CSV or TSV. Large enough, the band says CSV. */
export function CsvIcon(props: IconProps) {
  const mask = useId();
  const large = Number(props.width ?? 16) >= 24;
  return (
    <Page {...props}>
      {large ? (
        <>
          <mask id={mask}>
            <rect x="3.5" y="7.75" width="9" height="4.75" fill="white" />
            <text x="8" y="11.3" textAnchor="middle" fontSize="3.6" fontWeight="700" fontFamily="system-ui, sans-serif" fill="black" stroke="none">
              CSV
            </text>
          </mask>
          <rect x="3.5" y="7.75" width="9" height="4.75" fill="currentColor" stroke="none" mask={`url(#${mask})`} />
        </>
      ) : (
        <rect x="3.5" y="8" width="9" height="4.5" fill="currentColor" stroke="none" />
      )}
    </Page>
  );
}
/** A page with a pair of braces: JSON. */
export const JsonIcon = (props: IconProps) => (
  <Page {...props}>
    <path d="M7 7.75h-.25a.75.75 0 0 0-.75.75v.5l-.75.5.75.5v.5a.75.75 0 0 0 .75.75H7M9 7.75h.25a.75.75 0 0 1 .75.75v.5l.75.5-.75.5v.5a.75.75 0 0 1-.75.75H9" />
  </Page>
);
/** A folder: many files read as one table. */
export const FolderIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.9a1.5 1.5 0 0 1 1.06.44L8.5 4.5h4A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z" />
  </Icon>
);
/** A cylinder with a cable leaving it: a database on a server, Postgres or MySQL. */
export const ServerDatabaseIcon = (props: IconProps) => (
  <Icon {...props}>
    <ellipse cx="6.5" cy="3.75" rx="4.25" ry="1.75" />
    <path d="M2.25 3.75v8.5c0 1 1.9 1.75 4.25 1.75s4.25-.75 4.25-1.75v-8.5M2.25 8c0 1 1.9 1.75 4.25 1.75S10.75 9 10.75 8M10.75 8h2.5M13.25 6.5v3" />
  </Icon>
);
/** A globe: a file on the web. */
export const GlobeIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="8" cy="8" r="5.75" />
    <path d="M2.25 8h11.5M8 2.25c-2 1.7-2.4 9.8 0 11.5M8 2.25c2 1.7 2.4 9.8 0 11.5" />
  </Icon>
);
/** golem's own figure, simplified: a block of a body, two eyes, two legs. */
export const GolemMarkIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4.5 3h7A1.5 1.5 0 0 1 13 4.5V10H3V4.5A1.5 1.5 0 0 1 4.5 3zM5.5 10v3M10.5 10v3" />
    <path d="M6 6.5h.01M10 6.5h.01" strokeWidth="2" />
  </Icon>
);

export type DataSourceIconProps = IconProps & {
  kind: DataKind;
  /** The path or address of the source: a file's extension says which page to draw. */
  location?: string | null | undefined;
};

/** The picture of a source: its own mark for the built-in one, a page for files by their type, a cylinder for a database, a globe for a URL. */
export function DataSourceIcon({ kind, location, ...props }: DataSourceIconProps) {
  if (kind === "builtin") return <GolemMarkIcon {...props} />;
  if (kind === "sqlite") return <SqliteIcon {...props} />;
  if (kind === "duckdb") return <DuckdbIcon {...props} />;
  if (kind === "postgres") return <PostgresIcon {...props} />;
  if (kind === "mysql") return <MysqlIcon {...props} />;
  if (kind === "url") return <GlobeIcon {...props} />;
  const type = sourceFileType(location ?? "");
  if (type === "csv") return <CsvIcon {...props} />;
  if (type === "excel") return <ExcelBrandIcon {...props} />;
  if (type === "parquet") return <ParquetBrandIcon {...props} />;
  if (type === "json") return <JsonIcon {...props} />;
  if (type === "folder") return <FolderIcon {...props} />;
  return <SheetIcon {...props} />;
}

/** The picture of a way to add a source: files, a database, a web address, or an MCP server. */
export function AddKindIcon({ kind, ...props }: IconProps & { kind: AddKind }) {
  if (kind === "files") return <FolderIcon {...props} />;
  if (kind === "database") return <ServerDatabaseIcon {...props} />;
  if (kind === "url") return <GlobeIcon {...props} />;
  return <PlugIcon {...props} />;
}
