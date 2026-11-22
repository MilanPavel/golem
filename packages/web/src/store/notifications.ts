import type { ChatSetParams, ChatSetResult, ChatValues, ChatPromptResult, ChatDraftResult, ChatSuggestionsResult, ChatSuggestionDismissResult, NotificationsSetParams, NotificationsSetResult, NotificationsValues, NotifyTestResult } from "@golem/client";

import type { AgentsKeepResult, AgentsKeepValues } from "@golem/client";

export type { AgentsKeepResult, AgentsKeepValues };

/** The query key of `agents.keep`. A successful change marks it stale. */
export const AGENTS_KEEP_KEY = ["agents.keep"] as const;

export type { NotificationsSetParams, NotificationsSetResult, NotificationsValues, NotifyTestResult };

/** The query key of `notifications.get`. A successful `notifications.set` marks it stale. */
export const NOTIFICATIONS_KEY = ["notifications.get"] as const;

export type { ChatSetParams, ChatSetResult, ChatValues, ChatPromptResult, ChatDraftResult, ChatSuggestionsResult, ChatSuggestionDismissResult };

/** The query key of `chat.get`. A successful `chat.set` or a new default mode marks it stale. */
export const CHAT_KEY = ["chat.get"] as const;
/** The query key of `chat.prompt`, followed by the lines it was asked with. */
export const PROMPT_KEY = ["chat.prompt"] as const;
/** The query key of `chat.suggestions`. */
export const SUGGESTIONS_KEY = ["chat.suggestions"] as const;
