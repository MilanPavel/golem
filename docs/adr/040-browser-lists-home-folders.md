# ADR-040: The browser may list folders under your home

**Date**: 2026-11-06
**Status**: accepted

## Context

A new session in the browser needs a folder. Today the folder chip offers the folders of earlier sessions, or a path typed by hand. A person who wants a folder they have not used yet has to know and type its full path.

The page can't browse the Mac by itself: it reaches the daemon only through the gateway's allowlist ([ADR-028](028-web-gateway.md)), and no method lists folders. The daemon's file tools are scoped to a session's folder and are the model's, not the page's.

## Decision

Add one method, `fs.list_dirs`, declared `"browser"` in `golem_protocol/methods.py`.

- **Params:** `{ path?: string }`. With no path it lists the home folder.
- **Result:** `{ path, home, parent, entries: [{ name, path, git }], truncated }`.

It is narrow on purpose:

| Rule | Why |
|---|---|
| Only under `$HOME`. The path is resolved first (symlinks, `..`), and a path outside is refused. | The page only needs the places people keep projects. |
| Only folders. No file names, sizes, times, or contents. | A folder's name is enough to pick it. |
| Dot-folders, `~/Library`, and every entry of `SECRET_DIRS` (`.ssh`, `.gnupg`, `.aws`, `.golem`, `Library/Keychains`, …) are skipped. | These are never a project, and some names are themselves a hint. |
| An entry that resolves outside home is skipped. | A symlink can't widen the rule above. |
| At most 500 entries, with `truncated`. | One call stays small. |
| `git` says whether the folder has `.git`. | It is the one fact that helps pick a project. |

A path typed by hand still works as before: `session.create` takes any absolute `cwd`. It now also checks that the path is a folder.

## Why this does not widen ADR-028

ADR-028's threat is script in the page (XSS) using the methods the browser may call. With this method, such script learns the names of folders under home. It already can learn more than that:

- `session.list` shows earlier folders.
- A session's file tools read inside its folder.
- `approval.respond` can allow a tool.

It can't learn file names, contents, or anything in `SECRET_DIRS` through this method. The defences of ADR-028 (CSP, sanitized output, the cookie and origin checks) apply as before.

## Alternatives Considered

### The browser's own folder picker (`<input webkitdirectory>`, the File System Access API)

- **Pros**: no new method.
- **Cons**: it uploads or exposes files, not a path. The browser never tells the page the folder's absolute path, which is what `cwd` needs.
- **Why not**: it can't produce a path.

### List the whole disk

- **Pros**: any folder, such as `/Volumes/…` or `/opt/…`, can be picked.
- **Cons**: much more to show, and most of it is never a project.
- **Why not**: a typed path covers the rare folder outside home.

## Consequences

### Positive

- A new folder can be picked without knowing its path.
- The rule is one pure function, with tests for each line of the table.

### Negative

- One more browser method to keep narrow.

### Risks

- A future change might add file names or widen the root. Any such change needs a new ADR.
