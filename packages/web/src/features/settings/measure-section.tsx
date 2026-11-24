import { runningId } from "@golem/view";
import { Button } from "../../ui/button.tsx";
import { MeasureListView } from "./measure-list.tsx";
import { MeasureRunView } from "./measure-run.tsx";
import type { Measure } from "./measure-state.ts";

/** The Measure tab, from what `useMeasure` keeps: the list, or one measurement opened from it. */
export function MeasureTab({ measure: m }: { measure: Measure }) {
  if (m.open !== null) {
    return (
      <MeasureRunView
        measurement={m.measurement}
        live={m.live}
        plan={m.plan?.arms ?? []}
        error={m.error}
        busy={m.busy}
        onBack={m.toList}
        onStop={() => void m.stop(m.open ?? "")}
        onResume={(allowTight, ownRisk) => void m.resume(m.open ?? "", allowTight, ownRisk)}
        onApply={() => void m.apply(m.open ?? "")}
        onDelete={() => void m.remove(m.open ?? "")}
      />
    );
  }
  if (m.plan === null || m.list === null) {
    if (m.error === null) return <p className="text-body text-muted">asking the daemon…</p>;
    return (
      <div className="flex flex-col items-start gap-2">
        <p role="alert" className="text-sm text-deny">
          {m.error}
        </p>
        <Button size="sm" onClick={m.refresh}>
          Retry
        </Button>
      </div>
    );
  }
  return (
    <MeasureListView
      arms={m.plan.arms}
      asks={m.plan.asks ?? []}
      history={m.list}
      running={m.plan.running ?? runningId(m.list)}
      models={m.models}
      error={m.error}
      busy={m.busy}
      onModel={m.chooseModel}
      onStart={(arms, allowTight, ownRisk) => void m.start(arms, allowTight, ownRisk)}
      onCheck={m.refresh}
      onOpen={m.openRun}
    />
  );
}
