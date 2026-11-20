import { daemonServiceRow, pageServiceRow, setupFormRows, type FormRow } from "@golem/view";
import { useMemo } from "react";
import { useConnection } from "../../store/connection-context.tsx";
import { usePageHost, useSetupStatus } from "../../store/page-context.tsx";

/** The Info health rows, or null while there is no status (or it could not be read). One derivation for the page and the badges. */
export function useSetupFormRows(): FormRow[] | null {
  const status = useSetupStatus();
  const connection = useConnection();
  const pageHost = usePageHost();
  const sourceRows = status.isError ? null : (status.data?.rows ?? null);
  return useMemo(
    () =>
      sourceRows === null
        ? null
        : setupFormRows(sourceRows, pageServiceRow(daemonServiceRow(sourceRows), connection.daemonVersion ?? ""), pageHost.kept),
    [sourceRows, connection.daemonVersion, pageHost.kept],
  );
}
