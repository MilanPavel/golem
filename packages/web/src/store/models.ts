import type { ListedModel, ModelListResult } from "@golem/client";

export type { ListedModel, ModelListResult };

/** The query key of the model listing. The pushed events that change it invalidate this key. */
export const MODEL_LIST_KEY = ["model.list"] as const;
