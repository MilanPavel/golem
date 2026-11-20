import { waitHint } from "@golem/view";
import { useConfig, useModelList, useSession } from "../../store/page-context.tsx";
import type { SessionView } from "../../store/session-store.ts";

/** The line above the composer. Empty text draws nothing. */
export function WaitHintView({ text }: { text: string }) {
  if (text === "") return null;
  return <p className="px-1 text-meta text-muted">{text}</p>;
}

const selectMode = ({ chat }: SessionView) => chat.route.mode;
const selectCwd = (view: SessionView) => view.cwd;
const selectModel = (view: SessionView) => view.model;
const selectUsed = (view: SessionView) => view.context.last?.used ?? null;

/**
 * When the session's local model will be slow to a first token, say so, and on `auto` name the budget
 * model that would not be. Only a local model reads the listing for it.
 */
export function WaitHint({ sessionId }: { sessionId: string }) {
  const model = useSession(sessionId, selectModel);
  const mode = useSession(sessionId, selectMode);
  const cwd = useSession(sessionId, selectCwd);
  const used = useSession(sessionId, selectUsed);
  const local = model?.provider === "ollama" && used !== null;
  const models = useModelList(local);
  const config = useConfig(cwd, sessionId, local);
  if (!local || models.data === undefined) return null;
  const session = models.data.models.find(
    (item) => item.ref === `${model.provider}/${model.name}` || (item.profiles ?? []).includes(model.profile),
  );
  return <WaitHintView text={waitHint({ mode, session, models: models.data.models, routing: config.data?.routing, inputTokens: used })} />;
}
