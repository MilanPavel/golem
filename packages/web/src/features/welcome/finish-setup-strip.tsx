import { namesModel } from "@golem/view";
import { useModelList, useNavigate } from "../../store/page-context.tsx";
import { welcomePath } from "../../store/router.ts";
import { Button } from "../../ui/button.tsx";
import { useWelcomeProgress } from "./welcome-store.ts";

/** A quiet strip above home's composer: setup was left, and chats start once a model is ready. */
export function FinishSetupStripView({ onFinish }: { onFinish: () => void }) {
  return (
    <div role="status" className="flex w-full items-center gap-3 rounded-md border border-line bg-surface px-3 py-2.5 text-left text-sm text-muted">
      <span aria-hidden="true" className="font-mono font-semibold text-wait">
        !
      </span>
      <span className="min-w-0 flex-1">
        <strong className="font-semibold text-ink">Setup isn't finished.</strong> Chats start once a model is ready.
      </span>
      <Button size="sm" onClick={onFinish}>
        Finish setup
      </Button>
    </div>
  );
}

/**
 * The strip of the empty screen. It shows after `Later`, and goes once a default model is ready.
 * `Finish setup` goes back to the step that was left.
 */
export function FinishSetupStrip() {
  const { leftAt } = useWelcomeProgress();
  const navigate = useNavigate();
  const listing = useModelList(leftAt !== null).data;
  if (leftAt === null || listing === undefined) return null;
  if (listing.models.some((model) => namesModel(model, listing.default) && model.status === "ready")) return null;
  return (
    <FinishSetupStripView
      onFinish={() => {
        navigate(welcomePath(leftAt));
      }}
    />
  );
}
