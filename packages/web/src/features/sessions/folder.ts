/** The last part of a folder path, or "No folder". The full path belongs in a tooltip. */
export function folderName(cwd: string | null | undefined): string {
  if (cwd === null || cwd === undefined || cwd === "") {
    return "No folder";
  }
  const parts = cwd.split("/").filter((part) => part !== "");
  return parts.at(-1) ?? "/";
}
