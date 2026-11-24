import { useState } from "react";
import { Button } from "../../../ui/button.tsx";
import { Input } from "../../../ui/input.tsx";

/** The By name tab: an Ollama name typed in, downloaded as it is. */
export function ByNameTab({ failure, pull }: { failure: string | null; pull: (ref: string) => Promise<boolean> }) {
  const [name, setName] = useState("");
  const ref = name.trim() === "" ? "" : name.trim().startsWith("ollama/") ? name.trim() : `ollama/${name.trim()}`;
  return (
    <form
      className="flex flex-col gap-2 py-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (ref !== "") void pull(ref);
      }}
    >
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">An Ollama name</span>
        <Input
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
          placeholder="mistral-small3"
          autoComplete="off"
          spellCheck={false}
        />
        <small className="text-meta text-faint">A name from the Ollama library, with a size if you want one, such as qwen3:8b. golem downloads it with Ollama.</small>
      </label>
      {failure === null ? null : (
        <p role="alert" className="text-sm text-deny">
          {failure}
        </p>
      )}
      <div>
        <Button type="submit" kind="primary" size="sm" disabled={ref === ""}>
          Download
        </Button>
      </div>
    </form>
  );
}
