import type { Found, LiveText } from "@golem/view";

/**
 * The Live side of a run that goes: what it has found so far (the one line of each step that is done), then the text of
 * each running step as it comes (a model's answer as it is written, or a step's "3 of 12"). It is shown only while a step
 * sends text; a run whose steps send none keeps the page it had.
 */
export function LivePane({ found, texts }: { found: readonly Found[]; texts: readonly LiveText[] }) {
  return (
    <div role="group" aria-label="Live" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <h3 className="m-0 text-sm font-medium">Found so far</h3>
        {found.length === 0 ? (
          <p className="m-0 text-meta text-muted">Nothing yet.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {found.map((one) => (
              <li key={one.key} className="flex min-w-0 flex-col text-sm">
                <span className="font-medium">{one.label}</span>
                <span className="min-w-0 break-words text-meta text-muted">{one.line}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {texts.map((one) => (
        <div key={one.key} role="group" aria-label={`${one.label}, as it comes`} className="flex flex-col gap-1.5">
          <h3 className="m-0 flex items-center gap-2 text-sm font-medium">
            {one.label}
            <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-clay" />
          </h3>
          <p className="m-0 max-w-prose text-sm break-words whitespace-pre-wrap">{one.text}</p>
        </div>
      ))}
    </div>
  );
}
