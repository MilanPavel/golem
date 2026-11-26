import { useMemo } from "react";
import { useDataList } from "../../store/page-context.tsx";

/** The names of the data sources `@` can name. They are read only once the draft holds an `@`. */
export function useMentions(typing: boolean): readonly string[] {
  const list = useDataList(typing);
  const answer = list.data;
  return useMemo(() => (answer?.status === "ready" ? answer.data.sources.filter((source) => source.status !== "error").map((source) => source.name) : []), [answer]);
}
