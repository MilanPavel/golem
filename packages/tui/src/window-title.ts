const ESC = "\u001b";

/** xterm saves the icon and window title. Restoring pops that stack. */
export const SAVE_WINDOW_TITLE = `${ESC}[22;0t`;
export const RESTORE_WINDOW_TITLE = `${ESC}[23;0t`;

export function windowTitle(sessionTitle: string): string {
  return `golem \u2014 ${sessionTitle}`;
}

/** OSC 0 sets the icon and window title. Controls in the name are dropped. */
export function oscWindowTitle(title: string): string {
  const safe = title.replace(/[\u0000-\u001f\u007f]/g, "");
  return `${ESC}]0;${safe}\u0007`;
}

export function pushWindowTitle(): void {
  write(SAVE_WINDOW_TITLE);
}

export function popWindowTitle(): void {
  write(RESTORE_WINDOW_TITLE);
}

export function applyWindowTitle(sessionTitle: string): void {
  write(oscWindowTitle(windowTitle(sessionTitle)));
}

function write(data: string): void {
  if (process.stdout.isTTY !== true) {
    return;
  }
  try {
    process.stdout.write(data);
  } catch {
    // The terminal is already gone.
  }
}
