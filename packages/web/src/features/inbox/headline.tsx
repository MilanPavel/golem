import { Fragment } from "react";
import { Code } from "../../ui/code.tsx";

/** The headline with its `code` parts set in mono. */
export function Headline({ text }: { text: string }) {
  const parts = text.split("`");
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <Code key={index} className="rounded-sm bg-code-bg px-1">
            {part}
          </Code>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}
