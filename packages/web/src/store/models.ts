import type { ListedModel, ModelListResult, SetupRow } from "@golem/client";

export type { ListedModel, ModelListResult, SetupRow };

/** The query key of the model listing. The pushed events that change it invalidate this key. */
export const MODEL_LIST_KEY = ["model.list"] as const;

/** The model listing with show all on. It starts with `MODEL_LIST_KEY`, so the events that refresh that refresh this too. */
export const MODEL_LIST_ALL_KEY = ["model.list", "all"] as const;

/** The query key of `setup.status`. The model-list and model-server events refresh it as well. */
export const SETUP_STATUS_KEY = ["setup.status"] as const;
