import { RpcError, SESSION_BUSY } from "@golem/client";

const INVALID_PARAMS = -32602;

export const SESSION_BUSY_TEXT = "golem is still answering. Stop it first, or wait.";

/** The daemon refused a call's parameters, such as a folder that is not absolute or does not exist. */
export function isInvalidParams(error: unknown): error is RpcError {
  return error instanceof RpcError && error.code === INVALID_PARAMS;
}

/** One short line for a message that could not be sent. */
export function sendErrorText(error: unknown): string {
  if (error instanceof RpcError) {
    return error.code === SESSION_BUSY ? SESSION_BUSY_TEXT : error.message;
  }
  return error instanceof Error && error.message !== "" ? error.message : "Could not send the message.";
}

/** One short line for a session action (rename, fork, close) the daemon refused or could not reach. */
export function actionErrorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message !== "" ? error.message : fallback;
}
