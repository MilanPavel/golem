import { BRANCH_SWITCH_FAILED, MODEL_NOT_CONFIGURED, NOT_A_REPO, RpcError, SESSION_BUSY } from "@golem/client";
import { NO_MODEL_NOTICE, noModelChosen } from "@golem/view";

const INVALID_PARAMS = -32602;

export const SESSION_BUSY_TEXT = "golem is still answering. Stop it first, or wait.";

const NOT_LOCAL = -32022;
const UNSUPPORTED = -32023;
const DIALOG_BUSY = -32024;

/** One short line for a folder dialog that did not open. */
export function folderDialogErrorText(error: unknown): string {
  if (error instanceof RpcError) {
    if (error.code === NOT_LOCAL || error.code === UNSUPPORTED) return "The folder dialog is not available here. Use Browse in golem.";
    if (error.code === DIALOG_BUSY) return "A folder dialog is already open on your Mac.";
    return error.message;
  }
  return error instanceof Error && error.message !== "" ? error.message : "The folder dialog did not open.";
}

/** The daemon refused a call's parameters, such as a folder that is not absolute or does not exist. */
export function isInvalidParams(error: unknown): error is RpcError {
  return error instanceof RpcError && error.code === INVALID_PARAMS;
}

/** The daemon refused a new session's model: it does not resolve, or its provider has no key. */
export function isModelRefused(error: unknown): error is RpcError {
  return error instanceof RpcError && error.code === MODEL_NOT_CONFIGURED;
}

/** The daemon could not switch the folder to the branch a new session asked for. The message is git's own. */
export function isBranchRefused(error: unknown): error is RpcError {
  return error instanceof RpcError && (error.code === BRANCH_SWITCH_FAILED || error.code === NOT_A_REPO);
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
