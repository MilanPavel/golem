Session stores, the live store, the query client, and the router.

- `create-store.ts`: a snapshot and its listeners; `set` with the same reference notifies nobody.
- `session-store.ts`: one session's `SessionView`; deltas fold once per frame, any other event folds at once.
- `sessions.ts`: the open sessions; routes events by session id, attaches on open, detaches on close.
- `session-list.ts`: the live session list, and `groupByFolder` for the sidebar.
- `query.ts`: the TanStack query client, and the pushed events that mark answers stale.
- `router.ts`: the current route from `location` and the history.
- `connection.ts`: the link state and the daemon's version.
- `login.ts`: takes the login token from the address and trades it for the cookie.
- `page.ts`: everything the page holds, built on one client, with the session reference counts and the visibility check.
- `boot.ts`: exchanges the token, makes the client, builds the page.
- `page-context.tsx`: `PageProvider` and the hooks features use: `useRoute`, `useNavigate`, `useSessionList`, `useSession`, `usePageActions`.
- `connection-context.tsx`: `ConnectionProvider` and `useConnection`.
- `test-support.ts`: a fake client and an event builder for tests.
