import { choiceForKey, type ServiceChoice } from "./service-gate.ts";

/** Print `question`, then wait for one key that `choiceForKey` knows. Needs a terminal. */
export async function readChoice(question: string): Promise<ServiceChoice> {
  const stdin = process.stdin;
  process.stdout.write(question);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return await new Promise((resolve) => {
    const onData = (chunk: string): void => {
      // An escape sequence (an arrow key) arrives as one chunk; only a lone Esc means quit.
      const choice = chunk.length > 1 && chunk.startsWith("\u001b") ? null : choiceForKey(chunk.slice(0, 1));
      if (choice === null) {
        return;
      }
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write("\n");
      resolve(choice);
    };
    stdin.on("data", onData);
  });
}
