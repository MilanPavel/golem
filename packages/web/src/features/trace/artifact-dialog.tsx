import { useArtifact } from "../../store/page-context.tsx";
import { Button } from "../../ui/button.tsx";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "../../ui/dialog.tsx";

function Body({ sessionId, artifactId }: { sessionId: string; artifactId: string }) {
  const query = useArtifact(sessionId, artifactId);
  if (query.isPending) {
    return (
      <p role="status" className="mt-3 text-sm text-muted">
        Reading the output…
      </p>
    );
  }
  if (query.isError) {
    return (
      <p role="alert" className="mt-3 text-sm text-deny">
        {query.error.message}
      </p>
    );
  }
  const pages = query.data.pages;
  const last = pages[pages.length - 1];
  const text = pages.map((page) => page.text).join("");
  return (
    <>
      <pre tabIndex={0} aria-label="Full output" className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-sm bg-code-bg p-3 font-mono text-xs">
        {text}
      </pre>
      <div className="mt-3 flex items-center gap-3">
        {query.hasNextPage ? (
          <Button size="sm" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
            Show more
          </Button>
        ) : null}
        <p className="font-mono text-xs text-faint">
          {text.length.toLocaleString("en-US")} of {(last?.size ?? 0).toLocaleString("en-US")} characters
        </p>
      </div>
    </>
  );
}

/** The whole output of a tool call that was too big for the model, read from its artifact a page at a time. */
export function ArtifactDialog({ sessionId, artifactId, open, onOpenChange }: { sessionId: string; artifactId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogTitle>Full output</DialogTitle>
        <DialogDescription>
          Artifact <span className="font-mono">{artifactId}</span>
        </DialogDescription>
        {open ? <Body sessionId={sessionId} artifactId={artifactId} /> : null}
        <div className="mt-3 flex justify-end">
          <DialogClose asChild>
            <Button size="sm">Close</Button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}
