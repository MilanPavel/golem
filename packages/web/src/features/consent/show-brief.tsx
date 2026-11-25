import { useId, useState } from "react";
import { useArtifact } from "../../store/page-context.tsx";
import { Button } from "../../ui/button.tsx";
import { DiffView } from "../diff/diff-view.tsx";

/** The diff of a helper's question, read from its artifact. It mounts when "Show" opens, so it is fetched once, on open. */
function BriefDiff({ sessionId, artifactId }: { sessionId: string; artifactId: string }) {
  const artifact = useArtifact(sessionId, artifactId, true);
  if (artifact.isError) {
    return (
      <p role="alert" data-brief-diff="error" className="text-sm text-deny">
        The diff could not be read.
      </p>
    );
  }
  if (artifact.data === undefined) {
    return (
      <p role="status" data-brief-diff="loading" className="text-sm text-muted">
        Reading the diff…
      </p>
    );
  }
  const text = artifact.data.pages.map((page) => page.text).join("");
  return (
    <div data-brief-diff="ready" className="max-h-72 overflow-auto rounded-md border border-line bg-sunken p-2 text-meta">
      <DiffView diff={text} mode="unified" />
      {artifact.hasNextPage ? (
        <div className="mt-2">
          <Button
            kind="ghost"
            disabled={artifact.isFetchingNextPage}
            onClick={() => {
              void artifact.fetchNextPage();
            }}
          >
            Load more
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * "Show" for a helper's paid question: the brief it would send, and the diff behind it. Collapsed by default;
 * the diff is read on first open only. Without `sessionId` the diff is not offered.
 */
export function ShowBrief({
  brief,
  diffArtifactId,
  sessionId,
}: {
  brief: string | null;
  diffArtifactId: string | null;
  sessionId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  if (brief === null && diffArtifactId === null) return null;
  return (
    <div className="mt-1" data-show-brief="">
      <Button
        kind="ghost"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        {open ? "Hide" : "Show"}
      </Button>
      {open ? (
        <div id={bodyId} className="mt-1 flex flex-col gap-2">
          {brief === null ? null : (
            <pre
              data-brief=""
              tabIndex={0}
              aria-label="The brief"
              className="max-h-48 overflow-auto rounded-md border border-line bg-sunken p-2 font-mono text-meta leading-snug whitespace-pre-wrap wrap-anywhere"
            >
              {brief}
            </pre>
          )}
          {diffArtifactId !== null && sessionId !== null ? <BriefDiff sessionId={sessionId} artifactId={diffArtifactId} /> : null}
        </div>
      ) : null}
    </div>
  );
}
