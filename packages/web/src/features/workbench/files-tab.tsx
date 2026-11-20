import { useEffect, useRef, useState } from "react";
import { useChangedFiles, useFileList, useFileRead } from "../../store/page-context.tsx";
import type { FileRead } from "../../store/files.ts";
import { Button } from "../../ui/button.tsx";
import { CopyButton } from "../../ui/copy-command.tsx";
import { Input } from "../../ui/input.tsx";
import type { LanguageId } from "../chat/languages.ts";
import { languageForPath } from "../chat/languages.ts";
import { useHiddenFiles } from "./hidden-files.ts";
import { useRequestedFile, type FileRequest } from "./workbench-state.ts";
import { Code } from "../../ui/code.tsx";

/** How long typing waits before the list is asked for, in ms. */
export const FILE_LIST_WAIT_MS = 150;

/** How many paths the list shows. */
export const FILE_LIST_LIMIT = 50;

/** Files longer than this are shown as plain text: colouring them would be slow. */
export const COLOUR_MAX_LINES = 2000;

type Token = { content: string; color?: string | undefined; fontStyle?: number | undefined };

const ITALIC = 1;
const BOLD = 2;

function splitLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines.length > 1 && lines.at(-1) === "") lines.pop();
  return lines;
}

/** The text as lines of coloured tokens, or null while they are not ready or when the text stays plain. */
function useTokens(text: string, language: LanguageId | null, lineCount: number): Token[][] | null {
  const [done, setDone] = useState<{ text: string; tokens: Token[][] } | null>(null);
  const colour = language !== null && lineCount <= COLOUR_MAX_LINES;
  useEffect(() => {
    if (!colour) return;
    let current = true;
    void import("../chat/highlight-engine.ts")
      .then(({ tokenize }) => tokenize(text.replace(/\n$/, ""), language))
      .then((tokens) => {
        if (current) setDone({ text, tokens });
      })
      .catch(() => {
        // A grammar that fails leaves the file plain.
      });
    return () => {
      current = false;
    };
  }, [text, language, colour]);
  return colour && done?.text === text ? done.tokens : null;
}

function Line({ number, width, text, tokens }: { number: number; width: number; text: string; tokens: readonly Token[] | undefined }) {
  return (
    <span data-line={number} className="flex">
      <span aria-hidden="true" style={{ minWidth: `${width + 2}ch` }} className="sticky left-0 shrink-0 bg-surface pr-3 text-right text-faint select-none">
        {number}
      </span>
      <span className="whitespace-pre">
        {tokens === undefined
          ? text
          : tokens.map((token, at) => (
              <span
                key={at}
                style={{
                  ...(token.color ? { color: token.color } : {}),
                  ...(token.fontStyle && token.fontStyle & ITALIC ? { fontStyle: "italic" } : {}),
                  ...(token.fontStyle && token.fontStyle & BOLD ? { fontWeight: 600 } : {}),
                }}
              >
                {token.content}
              </span>
            ))}
      </span>
    </span>
  );
}

type CodeViewProps = {
  path: string;
  text: string;
  /** The line to scroll into view, 1 for the first. */
  line?: number | null;
};

/**
 * A file's text with a gutter of line numbers that cannot be selected. A known language gets colours
 * when the file is short. The text is React children, never HTML, and a plain line is one text node.
 */
export function CodeView({ path, text, line = null }: CodeViewProps) {
  const lines = splitLines(text);
  const tokens = useTokens(text, languageForPath(path), lines.length);
  const root = useRef<HTMLDivElement>(null);
  const width = String(lines.length).length;

  useEffect(() => {
    if (line === null) return;
    const row = root.current?.querySelector<HTMLElement>(`[data-line="${String(line)}"]`);
    row?.scrollIntoView?.({ block: "center" });
  }, [line, text]);

  return (
    // Positioned, so visually hidden text inside it cannot make the page scroll.
    <div ref={root} tabIndex={0} role="region" aria-label={`Contents of ${path}`} className="relative min-h-0 flex-1 overflow-auto rounded-md border border-line bg-surface outline-offset-2 outline-clay focus-visible:outline-2">
      <pre className="w-max min-w-full py-2 font-mono text-xs leading-5 text-ink">
        {lines.map((content, at) => (
          <Line key={at} number={at + 1} width={width} text={content} tokens={tokens?.[at]} />
        ))}
      </pre>
    </div>
  );
}

function splitPath(path: string): [string, string] {
  const slash = path.lastIndexOf("/");
  return [path.slice(0, slash + 1), path.slice(slash + 1)];
}

function PathButton({ path, onOpen }: { path: string; onOpen: (path: string) => void }) {
  const [folder, name] = splitPath(path);
  return (
    <button
      type="button"
      title={path}
      onClick={() => {
        onOpen(path);
      }}
      className="flex w-full min-w-0 items-baseline rounded-sm px-1.5 py-1 text-left text-meta outline-offset-2 outline-clay hover:bg-sunken focus-visible:outline-2"
    >
      {folder === "" ? null : <Code tone="muted" className="min-w-0 truncate">{folder}</Code>}
      <Code className="flex-none">{name}</Code>
    </button>
  );
}

function PathGroup({ title, paths, onOpen }: { title: string | null; paths: readonly string[]; onOpen: (path: string) => void }) {
  if (paths.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5">
      {title === null ? null : <h4 className="px-1.5 pt-1 text-meta text-faint">{title}</h4>}
      <ul className="flex flex-col gap-0.5">
        {paths.map((path) => (
          <li key={path}>
            <PathButton path={path} onOpen={onOpen} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export type FilesViewProps = {
  /** What is typed in the filter box. */
  typed: string;
  onTyped: (typed: string) => void;
  /** Whether dot files are listed. */
  hidden: boolean;
  onHidden: (hidden: boolean) => void;
  /** Files of the change set, shown first while the box is empty. */
  changed: readonly string[];
  /** The paths that answer the filter, or null before the first answer. */
  found: readonly string[] | null;
  /** Whether more files matched than are listed. */
  more: boolean;
  listError: string | null;
  /** The path of the file shown, or null for the list. */
  open: string | null;
  file: FileRead;
  line: number | null;
  onOpen: (path: string) => void;
  onBack: () => void;
};

/** The filter box and its list, or one file under its header. It reads nothing itself. */
export function FilesView({ typed, onTyped, hidden, onHidden, changed, found, more, listError, open, file, line, onOpen, onBack }: FilesViewProps) {
  if (open !== null) {
    const count = file.file?.lines;
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Button kind="ghost" size="sm" onClick={onBack}>
            Back to the list
          </Button>
          <CopyButton text={open} label="path" />
        </div>
        <p className="flex min-w-0 items-baseline gap-2 text-meta">
          <Code title={open} className="min-w-0 truncate">
            {open}
          </Code>
          {count === undefined ? null : <span className="flex-none text-muted">{count === 1 ? "1 line" : `${count} lines`}</span>}
        </p>
        {file.error !== null ? (
          <p className="text-sm text-muted">{file.error}</p>
        ) : file.file === null ? (
          <p className="text-sm text-muted">Reading the file.</p>
        ) : (
          <>
            <CodeView path={file.file.path} text={file.file.text} line={line} />
            {file.file.truncated ? <p className="text-xs text-muted">Only the first part of this file is shown.</p> : null}
          </>
        )}
      </div>
    );
  }

  const asking = typed.trim() !== "";
  const first = asking ? found?.[0] : (changed[0] ?? found?.[0]);
  const rest = found === null ? [] : found.filter((path) => asking || !changed.includes(path));
  const nothing = (asking || changed.length === 0) && found !== null && rest.length === 0;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Input
        aria-label="Find a file"
        placeholder="Type part of a file name"
        autoComplete="off"
        spellCheck={false}
        value={typed}
        onChange={(event) => {
          onTyped(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && first !== undefined) {
            event.preventDefault();
            onOpen(first);
          }
        }}
      />
      <label className="flex w-fit items-center gap-2 text-sm text-muted">
        <input
          type="checkbox"
          checked={hidden}
          onChange={(event) => {
            onHidden(event.target.checked);
          }}
          className="size-4 accent-clay outline-offset-2 outline-clay focus-visible:outline-2"
        />
        Show hidden files
      </label>
      {listError !== null ? <p className="text-sm text-muted">{`Could not list the files. ${listError}`}</p> : null}
      {asking ? null : <PathGroup title="Changed in this session" paths={changed} onOpen={onOpen} />}
      <PathGroup title={asking ? null : changed.length === 0 ? null : "All files"} paths={rest} onOpen={onOpen} />
      {found === null && listError === null ? <p className="text-sm text-muted">Reading the files.</p> : null}
      {nothing ? <p className="text-sm text-muted">{asking ? "No file has that in its path." : "This folder has no files to show."}</p> : null}
      {more ? <p className="text-xs text-muted">{`Only the first ${String(FILE_LIST_LIMIT)} are listed. Type more of the name.`}</p> : null}
    </div>
  );
}

/**
 * The Files tab: a filter box over the session's folder, and any text file of it under a header
 * with line numbers. `openFile` from elsewhere opens the file it names, scrolled to its line.
 */
export function FilesTab({ sessionId }: { sessionId: string }) {
  const [typed, setTyped] = useState("");
  const [paused, setPaused] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [line, setLine] = useState<number | null>(null);
  const [requested, clearRequest] = useRequestedFile();

  // The list is asked for once typing pauses; an emptied box asks at once.
  useEffect(() => {
    if (typed === "") return;
    const timer = setTimeout(() => {
      setPaused(typed.trim());
    }, FILE_LIST_WAIT_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [typed]);
  const query = typed === "" ? "" : paused;

  // A new request is shown in this render; the effect takes the request off the store.
  const [taken, setTaken] = useState<FileRequest | null>(null);
  if (requested !== taken) {
    setTaken(requested);
    if (requested !== null) {
      setOpen(requested.path);
      setLine(requested.line);
    }
  }
  useEffect(() => {
    if (requested !== null) clearRequest();
  }, [requested, clearRequest]);

  const changedFiles = useChangedFiles(sessionId).files;
  const [hidden, setHidden] = useHiddenFiles();
  const list = useFileList(sessionId, query, FILE_LIST_LIMIT, hidden);
  const file = useFileRead(sessionId, open);
  const changed = (changedFiles ?? []).filter((entry) => entry.status !== "deleted").map((entry) => entry.path);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <FilesView
        typed={typed}
        onTyped={setTyped}
        hidden={hidden}
        onHidden={setHidden}
        changed={changed}
        found={list.data?.paths ?? null}
        more={list.data?.more ?? false}
        listError={list.error === null ? null : list.error.message}
        open={open}
        file={file}
        line={line}
        onOpen={(path) => {
          setOpen(path);
          setLine(null);
        }}
        onBack={() => {
          setOpen(null);
          setLine(null);
        }}
      />
    </div>
  );
}
