import { isRecord } from "./guards.ts";
import type { WireFrame } from "./wire.ts";

export function eventFrame(params: unknown): WireFrame {
  if (!isRecord(params) || typeof params["type"] !== "string") {
    return { direction: "in", kind: "event" };
  }
  const data = isRecord(params["data"]) ? params["data"] : undefined;
  if (params["type"] === "message.delta") {
    const text = data !== undefined && typeof data["text"] === "string" ? data["text"] : "";
    return { direction: "in", kind: "message.delta", chars: text.length, detail: text };
  }
  const seq = typeof params["seq"] === "number" ? `seq ${params["seq"]}` : "";
  return { direction: "in", kind: params["type"], detail: eventDetail(params["type"], seq, data) };
}

export function summaryFrame(params: unknown): WireFrame {
  if (!isRecord(params)) {
    return { direction: "in", kind: "session.summary" };
  }
  const parts = [params["session_id"], params["status"], params["title"]].filter(
    (part): part is string => typeof part === "string" && part.length > 0,
  );
  return { direction: "in", kind: "session.summary", detail: parts.join("  ") };
}

const REDACTED = "[redacted]";

/** The params as the wire view may show them. A key never leaves the payload sent to the daemon. */
export function shownParams(method: string, params: Record<string, unknown>): Record<string, unknown> {
  if (method === "auth.set" && "key" in params) {
    return { ...params, key: REDACTED };
  }
  return params;
}

export function outgoingDetail(method: string, params: Record<string, unknown>): string {
  if (method === "ping") {
    return "";
  }
  if (method.startsWith("auth.") && typeof params["provider"] === "string") {
    return params["provider"];
  }
  if (method === "message.send" && typeof params["text"] === "string") {
    return flat(params["text"]);
  }
  if (typeof params["session_id"] === "string") {
    return params["session_id"];
  }
  if (typeof params["run_id"] === "string") {
    return params["run_id"];
  }
  return "";
}

export function resultDetail(method: string, result: unknown): string {
  if (method === "ping" || !isRecord(result)) {
    return "";
  }
  if (method === "message.send" && typeof result["run_id"] === "string") {
    return result["run_id"];
  }
  if (
    (method === "session.create" || method === "session.fork" || method === "session.close") &&
    typeof result["session_id"] === "string"
  ) {
    return result["session_id"];
  }
  if (method === "session.rename" && typeof result["title"] === "string") {
    return flat(result["title"]);
  }
  if (method === "run.cancel" && typeof result["cancelled"] === "boolean") {
    return result["cancelled"] ? "cancelled" : "already ended";
  }
  if (method === "session.attach" && typeof result["last_seq"] === "number") {
    return `last seq ${result["last_seq"]}`;
  }
  if (method === "session.list" && Array.isArray(result["sessions"])) {
    return `${result["sessions"].length} sessions`;
  }
  if (method === "model.list" && Array.isArray(result["models"])) {
    return `${result["models"].length} models`;
  }
  if (method === "session.inspect" && typeof result["message_count"] === "number") {
    return `${result["message_count"]} messages`;
  }
  if (method === "daemon.status" && typeof result["model_name"] === "string") {
    return result["model_name"];
  }
  return "";
}

export function flat(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function eventDetail(type: string, seq: string, data: Record<string, unknown> | undefined): string {
  const parts: string[] = [];
  if (seq.length > 0) {
    parts.push(seq);
  }
  if (data === undefined) {
    return parts.join("  ");
  }
  if (type === "message.completed" || type === "message.started") {
    if (typeof data["role"] === "string") {
      parts.push(data["role"]);
    }
    if (typeof data["text"] === "string" && data["text"].length > 0) {
      parts.push(flat(data["text"]));
    }
    if (data["interrupted"] === true) {
      parts.push("interrupted");
    }
  } else if (type === "session.updated" && typeof data["title"] === "string") {
    parts.push(flat(data["title"]));
  } else if (type === "run.cancelled" && typeof data["reason"] === "string") {
    parts.push(data["reason"]);
  } else if (type === "run.failed" && typeof data["message"] === "string") {
    parts.push(flat(data["message"]));
  } else if (type === "model.selected") {
    const name = typeof data["model_name"] === "string" ? data["model_name"] : "";
    const profile = typeof data["model_profile"] === "string" ? data["model_profile"] : "";
    parts.push([name, profile].filter((part) => part.length > 0).join(" · "));
  } else if (type === "session.created") {
    const name = typeof data["model_name"] === "string" ? data["model_name"] : "";
    const profile = typeof data["model_profile"] === "string" ? data["model_profile"] : "";
    const model = [name, profile].filter((part) => part.length > 0).join(" · ");
    if (model.length > 0) {
      parts.push(model);
    }
    const parent = isRecord(data["forked_from"]) ? data["forked_from"]["session_id"] : undefined;
    if (typeof parent === "string") {
      parts.push(`fork of ${parent}`);
    }
  }
  return parts.join("  ");
}
