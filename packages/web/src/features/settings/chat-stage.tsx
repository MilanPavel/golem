import { useId, type ReactNode } from "react";

/**
 * One stage of the chat turn on Settings › Chat: a numbered badge on the left, a heading with a short muted line,
 * the content under it, and a thin line that joins this badge to the next. The heading labels the section.
 */
export function Stage({ number, title, hint, last = false, children }: { number: number; title: string; hint: string; last?: boolean; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={`${id}-head`} className="relative flex gap-x-4">
      {last ? null : <span aria-hidden="true" className="absolute top-8 bottom-0 left-4 w-0.5 bg-line" />}
      <span aria-hidden="true" className="flex size-8.5 items-center justify-center shrink-0 rounded-full bg-ink text-sm font-semibold text-bg">
        {number}
      </span>
      <div className={last ? "flex min-w-0 flex-1 flex-col gap-3" : "flex min-w-0 flex-1 flex-col gap-3 pb-6"}>
        <h3 id={`${id}-head`} className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 pt-1.5 text-base font-semibold text-ink">
          <span>{title}</span>
          <span className="text-sm font-normal text-faint">{hint}</span>
        </h3>
        {children}
      </div>
    </section>
  );
}

/** The sample message between two stages. It is decoration, so it is hidden from assistive technology. */
export function YouRow({ children }: { children: string }) {
  return (
    <div aria-hidden="true" className="relative flex items-start gap-x-4 pb-6">
      <span className="absolute top-8 bottom-0 left-4 w-0.5 bg-line" />
      <span className="flex size-8.5 items-center justify-center shrink-0 rounded-full bg-sunken text-meta text-muted">you</span>
      <p className="w-fit max-w-full rounded-xl bg-sunken px-3.5 py-2 text-chat text-ink">{children}</p>
    </div>
  );
}
