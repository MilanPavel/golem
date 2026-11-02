import type { Page } from "../../store/page.ts";
import { overallState } from "../sessions/index.ts";
import { faviconHref } from "./favicon.ts";
import { tabTitle } from "./title.ts";

type TabDoc = Pick<Document, "title" | "head" | "createElement">;

function iconLink(doc: TabDoc): HTMLLinkElement {
  const found = doc.head.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  if (found) {
    return found;
  }
  const link = doc.createElement("link");
  link.rel = "icon";
  doc.head.append(link);
  return link;
}

/**
 * Keep the tab's favicon and title in step with golem's state. It listens to the stores
 * directly, not through React or a frame, so a hidden tab still changes. Returns a stop.
 */
export function watchTabStatus(
  page: Pick<Page, "connection" | "sessionList" | "router">,
  doc: TabDoc = document,
): () => void {
  const link = iconLink(doc);
  let lastTitle: string | undefined;
  let lastHref: string | undefined;

  function update(): void {
    const connected = page.connection.getSnapshot().state.status === "connected";
    const list = page.sessionList.getSnapshot();
    const state = overallState(
      connected,
      list.filter((session) => session.status !== "closed"),
    );
    const route = page.router.getSnapshot();
    const current = route.name === "session" ? list.find((session) => session.session_id === route.id) : undefined;
    const title = tabTitle(state, current?.title ?? null);
    if (title !== lastTitle) {
      lastTitle = title;
      doc.title = title;
    }
    const href = faviconHref(state);
    if (href !== lastHref) {
      lastHref = href;
      link.href = href;
    }
  }

  const offs = [
    page.connection.subscribe(update),
    page.sessionList.subscribe(update),
    page.router.subscribe(update),
  ];
  update();
  return () => {
    for (const off of offs) {
      off();
    }
  };
}
