import { MODEL_NOT_CONFIGURED, RpcError, SESSION_BUSY } from "@golem/client";
import { NO_MODEL_NOTICE, noModelChosen } from "@golem/view";

const INVALID_PARAMS = -32602;

export const SESSION_BUSY_TEXT = "golem is still answering. Stop it first, or wait.";

/** The daemon refused a call's parameters, such as a folder that is not absolute or does not exist. */
export function isInvalidParams(error: unknown): error is RpcError {
  return error instanceof RpcError && error.code === INVALID_PARAMS;
}

/** The daemon refused a new session's model: it does not resolve, or its provider has no key. */
export function isModelRefused(error: unknown): error is RpcError {
  return error instanceof RpcError && error.code === MODEL_NOT_CONFIGURED;
}

/** The daemon refused a message because no model was ever chosen: the welcome page picks one. */
export function isNoModelChosen(error: unknown): boolean {
  return error instanceof RpcError && noModelChosen(error.code, error.message, MODEL_NOT_CONFIGURED);
}

/** One short line for a message that could not be sent. */
export function sendErrorText(error: unknown): string {
  if (isNoModelChosen(error)) {
    return NO_MODEL_NOTICE;
  }
  if (error instanceof RpcError) {
    return error.code === SESSION_BUSY ? SESSION_BUSY_TEXT : error.message;
  }
  return error instanceof Error && error.message !== "" ? error.message : "Could not send the message.";
}

/** One short line for a session action (rename, fork, close) the daemon refused or could not reach. */
export function actionErrorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message !== "" ? error.message : fallback;
}
