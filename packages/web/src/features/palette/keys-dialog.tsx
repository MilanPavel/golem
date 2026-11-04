import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../ui/dialog.tsx";
import { Kbd } from "../../ui/kbd.tsx";
import { keySections } from "./keys-list.ts";

/** The keys the page answers to, in sections. */
export function KeysDialog({
  open,
  onOpenChange,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-screen max-w-xl overflow-y-auto" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogTitle>Keys</DialogTitle>
        <DialogDescription>What the keyboard does on this page.</DialogDescription>
        <div className="mt-4 flex flex-col gap-5">
          {keySections().map((section) => {
            const headingId = `keys-${section.title.toLowerCase().replace(/\s+/g, "-")}`;
            return (
              <section key={section.title} aria-labelledby={headingId}>
                <h3 id={headingId} className="px-1 pb-1 font-mono text-xs font-normal text-faint">
                  {section.title}
                </h3>
                {section.note === undefined ? null : <p className="px-1 pb-1 text-xs text-muted">{section.note}</p>}
                <ul className="flex list-none flex-col gap-0.5 p-0">
                  {section.rows.map((row) => (
                    <li key={row.label} className="flex items-baseline gap-3 rounded-md px-3 py-1.5 text-sm">
                      <span className="w-20 shrink-0">
                        {row.keys.map((key) => (
                          <Kbd key={key}>{key}</Kbd>
                        ))}
                      </span>
                      <span className="min-w-0 text-muted">{row.label}</span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
