export interface LineSplitter {
  push(chunk: Uint8Array): string[];
  end(): string[];
}

/** Turn daemon bytes into lines. Lines are trusted and not parsed. */
export function createLineSplitter(): LineSplitter {
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  function take(text: string): string[] {
    const lines: string[] = [];
    for (const raw of text.split("\n")) {
      const line = raw.replace(/\r$/, "");
      if (line.length > 0) lines.push(line);
    }
    return lines;
  }

  return {
    push(chunk) {
      buffer += decoder.decode(chunk, { stream: true });
      const cut = buffer.lastIndexOf("\n");
      if (cut < 0) return [];
      const complete = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 1);
      return take(complete);
    },
    end() {
      const rest = buffer + decoder.decode();
      buffer = "";
      return take(rest);
    },
  };
}
