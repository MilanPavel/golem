import type { NotificationsSetParams, NotificationsSetResult, NotificationsValues, NotifyTestResult } from "@golem/client";

export type { NotificationsSetParams, NotificationsSetResult, NotificationsValues, NotifyTestResult };

/** The query key of `notifications.get`. A successful `notifications.set` marks it stale. */
export const NOTIFICATIONS_KEY = ["notifications.get"] as const;
