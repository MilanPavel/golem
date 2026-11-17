import { useState } from "react";
import { actionErrorText } from "../../store/errors.ts";
import { usePageActions } from "../../store/page-context.tsx";
import type { RoutingSetParams } from "../../store/routing.ts";
import type { RoutingErrors } from "./routing-parts.tsx";

/**
 * Saves with `routing.set`. The daemon's field errors come back by the setting's path, a loose error
 * or a failed call as one message for an alert.
 */
export function useRoutingSave(): { errors: RoutingErrors; failure: string | null; save: (patch: RoutingSetParams) => Promise<void> } {
  const actions = usePageActions();
  const [errors, setErrors] = useState<RoutingErrors>({});
  const [failure, setFailure] = useState<string | null>(null);

  async function save(patch: RoutingSetParams): Promise<void> {
    setFailure(null);
    try {
      const result = await actions.setRouting(patch);
      if (result.ok) {
        setErrors({});
        return;
      }
      setErrors(Object.fromEntries((result.errors ?? []).map((error) => [error.path ?? "", error.message])));
      // An error with no setting to sit on goes where a failed save goes.
      const loose = (result.errors ?? []).find((error) => error.path == null);
      if (loose !== undefined) setFailure(loose.message);
    } catch (error) {
      setFailure(actionErrorText(error, "Could not save the setting."));
    }
  }

  return { errors, failure, save };
}
