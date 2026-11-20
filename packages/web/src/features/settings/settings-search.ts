import { useEffect } from "react";
import { SECTIONS, type SettingsSection } from "./sections.ts";

/** One search result: a section, and the keyword that matched when the title did not. */
export type SettingsMatch = { section: SettingsSection; keyword: string | null };

/** Case-insensitive substring match, on the title first, then on the keywords. Client only. */
export function searchSettings(query: string, sections: readonly SettingsSection[] = SECTIONS): SettingsMatch[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [];
  const found: SettingsMatch[] = [];
  for (const section of sections) {
    if (section.title.toLowerCase().includes(needle)) found.push({ section, keyword: null });
    else {
      const keyword = section.keywords.find((word) => word.toLowerCase().includes(needle));
      if (keyword !== undefined) found.push({ section, keyword });
    }
  }
  return found;
}

/** The ring on the row a jump lands on. The keyframes are `flash` in tokens.css; with reduced motion the ring just shows. */
const FLASH = "animate-flash motion-reduce:ring-2 motion-reduce:ring-clay";
const FLASH_MS = 1500;
const TRY_MS = 100;
const TRIES = 20;

/** The row tagged with this keyword: the exact tag first, then a tag that starts with it. */
export function findSettingRow(root: ParentNode, keyword: string): HTMLElement | null {
  const rows = Array.from(root.querySelectorAll<HTMLElement>("[data-setting]"));
  const want = keyword.toLowerCase();
  return rows.find((row) => row.dataset.setting === want) ?? rows.find((row) => (row.dataset.setting ?? "").startsWith(want)) ?? null;
}

/**
 * After a keyword result opens its section, scrolls the tagged row into view and flashes a ring
 * around it. A section may load its rows late, so it looks for about two seconds. With no such
 * row, the section simply stays open.
 */
export function useSettingJump(jump: { section: string; keyword: string } | null, section: string, done: () => void): void {
  useEffect(() => {
    if (jump === null || jump.section !== section) return;
    let tries = 0;
    let timer: number | undefined;
    const look = (): boolean => {
      const row = findSettingRow(document, jump.keyword);
      if (row === null) return false;
      row.scrollIntoView({ block: "center" });
      const classes = FLASH.split(" ");
      row.classList.add(...classes);
      window.setTimeout(() => {
        row.classList.remove(...classes);
      }, FLASH_MS);
      return true;
    };
    if (look()) done();
    else {
      timer = window.setInterval(() => {
        tries += 1;
        if (look() || tries >= TRIES) {
          window.clearInterval(timer);
          done();
        }
      }, TRY_MS);
    }
    // The ring's own timer is left to run: `done` ends the jump at once, which re-runs this cleanup.
    return () => {
      window.clearInterval(timer);
    };
  }, [jump, section, done]);
}
