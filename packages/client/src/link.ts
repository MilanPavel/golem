/** One protocol connection. Lines are sent and received without the trailing "\n". */
export interface Link {
  send(line: string): void;
  close(error?: Error): void;
  onOpen(listener: () => void): void;
  onLine(listener: (line: string) => void): void;
  /** Called exactly once, after the link closed for any reason. `code` is a WebSocket close code when there is one. */
  onClose(listener: (error?: Error, code?: number) => void): void;
}

/** Opens a new link. The client calls it again for every reconnect. */
export type Dial = () => Link;
